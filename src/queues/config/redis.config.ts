import { ConnectionOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';

export const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // Required by BullMQ - allows jobs to wait indefinitely for Redis
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true, // Let BullMQ handle connection timing
  // Enhanced reconnection strategy
  retryStrategy: (times: number) => {
    // Exponential backoff with max 3 second delay (similar to Stripe/Shopify patterns)
    const delay = Math.min(times * 50, 3000);
    return delay;
  },
  // REMOVED: reconnectOnError was preventing reconnection on connection failures
  // Let ioredis use its default behavior: always attempt to reconnect unless connection is explicitly closed
  // The retryStrategy above controls the reconnection timing
  // Connection timeout
  connectTimeout: 10000, // 10 seconds
  // Keep connection alive
  keepAlive: 30000, // 30 seconds
  // Enable offline queue for BullMQ workers to survive brief disconnections
  // Workers need persistent connections; buffering prevents crashes during transient network issues
  enableOfflineQueue: true,
};

export const redisConnection = redisConfig; 