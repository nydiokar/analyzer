import { ConnectionOptions } from 'bullmq';

export const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // Required by BullMQ - allows jobs to wait indefinitely for Redis
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  // lazyConnect removed - BullMQ will handle connection lifecycle
  // Connections are established immediately on Queue/Worker instantiation
  enableOfflineQueue: false, // Fail fast if Redis is down (big players approach)
  retryStrategy: (times: number) => {
    // Exponential backoff with max 3 second delay (similar to Stripe/Shopify patterns)
    const delay = Math.min(times * 50, 3000);
    return delay;
  },
};

export const redisConnection = redisConfig; 