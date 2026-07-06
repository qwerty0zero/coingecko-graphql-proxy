import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { syncQueueName } from '../lib/queue.js';
import { processSyncMaxRange } from './syncMaxRange.js';

const worker = new Worker(syncQueueName, async job => {
  if (job.name === 'sync-max-range') {
    await processSyncMaxRange(job);
  }
}, { connection: redis as any });

worker.on('failed', (job, err) => {
  console.error(`Worker job ${job?.id} failed:`, err);
});

console.log('👷 Background worker started successfully');
