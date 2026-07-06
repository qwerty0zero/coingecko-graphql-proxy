# CoinGecko GraphQL Proxy

A caching proxy layer for CoinGecko Public API via GraphQL. 
It enables retrieving historical prices for cryptocurrencies by serving cached data when available and fetching missing intervals from CoinGecko, complying with their rate limits.

## Stack
- Node.js 20 + TypeScript
- Apollo Server 4 + Express
- Prisma (Neon PostgreSQL)
- BullMQ + ioredis (Upstash Redis)

## Local Development

1. Duplicate `.env.example` to `.env` and fill in the required credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run Prisma Migrations manually (Important!):
   ```bash
   npm run migrate
   ```
   *Note: Migrations are not run automatically in `postinstall` because serverless DBs like Neon may not be reachable during standard build steps.*
4. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```
5. Build the project:
   ```bash
   npm run build
   ```
6. Start the API Server and Worker (in separate terminals):
   ```bash
   npm run start:api
   npm run start:worker
   ```

## GraphQL Example Query
```graphql
query {
  historicalPrices(
    coin: "bitcoin",
    from: "2023-01-01",
    to: "2023-01-31",
    interval: DAILY
  ) {
    date
    priceUsd
    marketCap
    volume
  }
}
```

## Deployment on Render
This project includes a `render.yaml` file for one-click deployment to Render.
- Deploy the Web Service (`coingecko-graphql-api`) and Background Worker (`coingecko-sync-worker`).
- Fill in the required environment variables (`DATABASE_URL`, `REDIS_URL`, `COINGECKO_API_KEY`).
- **Health-check**: Since the API is deployed on Render's Free tier, it will sleep after 15 minutes of inactivity. The `/health` endpoint is extremely fast and skips heavy operations. Setup a ping via [cron-job.org](https://cron-job.org/) to ping `https://your-app-url.onrender.com/health` every 10 minutes to prevent the app from sleeping.
