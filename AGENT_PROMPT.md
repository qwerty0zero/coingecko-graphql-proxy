# Задача для ИИ-агента

Ты — senior backend инженер. В этом репозитории сейчас лежит только
заглушка (`index.js`, минимальный `package.json`) — она нужна была
исключительно для того, чтобы Render не отказывался деплоить пустой
репозиторий. Твоя задача — заменить заглушку полной реализацией.

Реализуй GraphQL-прослойку (proxy/cache layer) между CoinGecko Public API
и клиентами, которые запрашивают исторические цены криптовалют через
GraphQL. Сервис должен деплоиться ПОЛНОСТЬЮ БЕСПЛАТНО на:
- Render (Web Service — API, Background Worker — синхронизация)
- Neon (PostgreSQL)
- Upstash (Redis)

## Стек (фиксированный, не менять)
- Node.js 20 + TypeScript
- Apollo Server 4 + Express (Express нужен только ради `/health` роута)
- PostgreSQL через Prisma ORM (совместимо с Neon: используй `DATABASE_URL`
  с `?sslmode=require`; учти, что Neon serverless может разрывать неактивные
  соединения — добавь retry-логику на уровне обращений к Prisma)
- Redis через `ioredis`, подключение по `REDIS_URL` в формате `rediss://`
  (TLS обязателен для Upstash — передай `tls: {}` в опциях ioredis)
- BullMQ для очереди фоновых задач и rate-limit к CoinGecko
- Docker не обязателен — Render Free поддерживает Node buildpack напрямую

## Функциональные требования

### 1. GraphQL-схема
```graphql
enum Interval { DAILY WEEKLY MONTHLY }

type PricePoint {
  date: String!
  priceUsd: Float!
  marketCap: Float
  volume: Float
}

type Query {
  historicalPrices(
    coin: String!
    from: String!
    to: String!
    interval: Interval = WEEKLY
  ): [PricePoint!]!
}
```

### 2. Маппинг символа монеты в coingecko_id
Через кэш `/coins/list` (обновлять раз в 24 часа, хранить в таблице
`coin_list_cache` или аналоге). Результат маппинга кэшировать в таблице
`coins`, чтобы не резолвить повторно.

### 3. Клиент CoinGecko
- Все запросы к историческим ценам — ТОЛЬКО через
  `GET /coins/{id}/market_chart/range?vs_currency=usd&from={unix}&to={unix}&interval=daily`.
  Параметр `interval=daily` обязателен и указывается явно — тогда CoinGecko
  всегда отдаёт дневную гранулярность независимо от длины диапазона
  (доступно на всех планах, включая free/demo).
- Обёртка с троттлингом (например, через `bottleneck`): не более ~25
  запросов в минуту.
- Retry с exponential backoff при HTTP 429/5xx.

### 4. Резолвер `historicalPrices` — основной flow
1. Резолвить `coin` → `coingecko_id`.
2. Вычислить список дат, которые нужно отдать клиенту согласно `interval`
   (для WEEKLY — каждые 7 дней в `[from, to]`, для MONTHLY — раз в месяц,
   для DAILY — каждый день).
3. Проверить в таблице `price_history` (granularity='daily'), какие из
   нужных дат уже сохранены.
4. Если есть пробелы — вызвать клиент CoinGecko для недостающего диапазона
   дат, получить дневные точки.
5. UPSERT новых точек в `price_history` (уникальность по
   `coin_id + date + granularity`).
6. Собрать ответ СТРОГО из запрошенных дат (не отдавать клиенту данные,
   которые он не запрашивал, даже если в БД их больше) и вернуть.
7. Не блокируя ответ (fire-and-forget), поставить в BullMQ задачу
   `sync-max-range` с payload `{ coinId, coingeckoId, symbol }`.

### 5. Background Worker (отдельный процесс, слушает очередь BullMQ)
Обработчик `sync-max-range`:
- Определить самую раннюю доступную дату для монеты (`genesis_date` из
  `GET /coins/{id}`, либо fallback-константа, если поле отсутствует).
- Определить последнюю доступную дату (вчера, UTC).
- Сравнить с уже сохранённым диапазоном в таблице `coins`
  (`last_synced_from` / `last_synced_to`).
- Дозапросить недостающие куски через `market_chart/range` с
  `interval=daily`, разбивая большие диапазоны на чанки (например, по 2
  года за раз), уважая rate limit.
- Обновить `last_synced_from` / `last_synced_to` после успешной дозагрузки.
- Worker должен переподключаться к Redis/Postgres при обрыве соединения
  (настроить `retryStrategy` в ioredis и обработку ошибок в Prisma-запросах).

### 6. Health-check эндпоинт (КРИТИЧЕСКИ ВАЖНО)
`GET /health` — не должен трогать БД/Redis тяжело, отвечает `{ status: "ok" }`
за миллисекунды. Нужен для внешнего анти-sleep пинга (cron-job.org каждые
10 минут), чтобы Render Free web-сервис не засыпал через 15 минут простоя.

### 7. Схема БД (Prisma) — ориентир, можно адаптировать под свои нужды
```prisma
model Coin {
  id               Int      @id @default(autoincrement())
  symbol           String   @unique
  coingeckoId      String   @unique
  name             String?
  genesisDate      DateTime?
  lastSyncedFrom   DateTime?
  lastSyncedTo     DateTime?
  prices           PriceHistory[]
}

model PriceHistory {
  id           BigInt   @id @default(autoincrement())
  coinId       Int
  coin         Coin     @relation(fields: [coinId], references: [id])
  date         DateTime @db.Date
  priceUsd     Decimal
  marketCap    Decimal?
  volume       Decimal?
  granularity  String   @default("daily")
  source       String   @default("coingecko")
  createdAt    DateTime @default(now())
  @@unique([coinId, date, granularity])
}
```

### 8. render.yaml (одноклик-деплой обоих сервисов)
Создай `render.yaml` в корне с двумя сервисами: `web` (API, healthCheckPath
`/health`) и `worker` (Background Worker), оба план `free`, оба с env vars
`DATABASE_URL`, `REDIS_URL`, `COINGECKO_API_KEY` (sync: false — задаются
вручную в дашборде Render).

### 9. package.json scripts
```
"build": "tsc"
"start:api": "node dist/api/server.js"
"start:worker": "node dist/worker/index.js"
"postinstall": "prisma generate"
"migrate": "prisma migrate deploy"
```
Миграции НЕ запускать автоматически в `postinstall` — Neon может быть
недоступна во время сборки. Задокументируй ручной запуск `npm run migrate`
в README.

### 10. Обработка ошибок
- Некорректный диапазон дат, монета не найдена → понятная GraphQL-ошибка
  (`GraphQLError` с `extensions.code`).
- CoinGecko недоступен / rate limit исчерпан → вернуть частичные данные из
  кэша с warning, если возможно, иначе понятная ошибка.
- Обрыв соединения с Neon/Upstash → retry с backoff, не ронять процесс.

### 11. Тесты
- Unit: вычисление нужных дат по интервалу, gap detection.
- Integration: полный флоу резолвера с замоканным CoinGecko клиентом (nock
  или msw).

### 12. README.md должен содержать
- Локальный запуск (`.env.example` уже есть в репо — используй его).
- Команду миграций.
- Пример GraphQL-запроса.
- Пояснение про health-check и необходимость внешнего пинга (cron-job.org
  каждые 10 минут на `/health`), так как Render Free засыпает web-сервис
  после 15 минут простоя.

## Ограничения
- Не использовать платные фичи Render/Neon/Upstash — всё строго в рамках
  бесплатных тарифов.
- Не отдавать клиенту больше данных, чем он запросил.
- Все обращения к CoinGecko — только через единый rate-limited клиент.

## Порядок работы
1. Структура проекта и Prisma-схема.
2. CoinGecko клиент.
3. GraphQL резолвер.
4. Background worker.
5. Health-check роут.
6. `render.yaml`.
7. README.
8. Тесты.

После реализации удали заглушку `index.js` (её заменит `src/api/server.ts`
после сборки в `dist/`).
