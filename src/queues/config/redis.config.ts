import { ConnectionOptions } from 'bullmq';

export const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // Required by BullMQ
  retryStrategy: (times: number) => {
    // Exponential backoff with max 30 seconds
    const delay = Math.min(times * 1000, 30000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true,
  enableOfflineQueue: true,
  // Reduce connection attempt spam
  connectTimeout: 10000,
  autoResubscribe: false,
  autoResendUnfulfilledCommands: false,
};

export const redisConnection = redisConfig; 