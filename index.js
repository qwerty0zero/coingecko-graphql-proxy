const express = require('express');
const app = express();

// Временная заглушка. Реальный GraphQL API будет реализован агентом
// согласно AGENT_PROMPT.md — этот файл он заменит.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.send('coingecko-graphql-proxy: скелет запущен, ждём реализации от агента');
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`stub server running on port ${port}`));
