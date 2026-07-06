import { Queue } from 'bullmq';
import { redis } from './redis.js';

export const syncQueueName = 'sync-max-range';

export const syncQueue = new Queue(syncQueueName, {
  connection: redis as any,
});
