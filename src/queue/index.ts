import { Queue, QueueEvents, DefaultJobOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';

export const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisConnection.on('error', (err) => {
  // Gracefully log redis connection errors without crashing immediately in tests/dev
  if (config.NODE_ENV !== 'test') {
    console.warn('[Redis] Connection warning:', err.message);
  }
});

const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: {
    count: 5000,
  },
};

// Queue names
export const QUEUE_NAMES = {
  DEVICE_SYNC: 'device-sync-queue',
  PAYMENT_PROCESSING: 'payment-processing-queue',
  SOROBAN_INDEXER: 'soroban-indexer-queue',
  RECONCILIATION: 'reconciliation-queue',
} as const;

// BullMQ Queues
export const deviceSyncQueue = new Queue(QUEUE_NAMES.DEVICE_SYNC, {
  connection: redisConnection,
  defaultJobOptions,
});

export const paymentProcessingQueue = new Queue(QUEUE_NAMES.PAYMENT_PROCESSING, {
  connection: redisConnection,
  defaultJobOptions,
});

export const sorobanIndexerQueue = new Queue(QUEUE_NAMES.SOROBAN_INDEXER, {
  connection: redisConnection,
  defaultJobOptions,
});

export const reconciliationQueue = new Queue(QUEUE_NAMES.RECONCILIATION, {
  connection: redisConnection,
  defaultJobOptions,
});

export async function closeQueues(): Promise<void> {
  await Promise.all([
    deviceSyncQueue.close(),
    paymentProcessingQueue.close(),
    sorobanIndexerQueue.close(),
    reconciliationQueue.close(),
  ]);
  await redisConnection.quit();
}
