import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import dotenv from 'dotenv';

dotenv.config();

async function startServer() {
  const app = express();
  
  // Health check endpoint - MUST BE FAST
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(server)
  );

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`🚀 API Server ready at http://localhost:${port}/graphql`);
    console.log(`🚀 Health check at http://localhost:${port}/health`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
