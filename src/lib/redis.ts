import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isTLS = redisUrl.startsWith('rediss://');

export const redis = new Redis(redisUrl, {
  tls: isTLS ? {} : undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy(times) {
    return  Math.min(times * 50, 2000);
  },
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});
