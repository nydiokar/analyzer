import { FactoryProvider, Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { redisConfig } from './redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisProvider');

// Rate limiting for Redis errors to prevent log spam
let lastErrorLog = 0;
let errorCount = 0;
const ERROR_LOG_INTERVAL_MS = 30000; // Log once every 30 seconds

export const redisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const client = new Redis(redisConfig as RedisOptions);

    client.on('connect', () => {
      logger.log('✅ Redis connected successfully');
      errorCount = 0; // Reset error count on successful connection
    });

    client.on('ready', () => logger.log('Redis is ready'));

    client.on('error', (err) => {
      const isConnectionError = err.message?.includes('ECONNREFUSED') ||
                                err.message?.includes('ENOTFOUND') ||
                                err.message?.includes('connect');

      if (isConnectionError) {
        errorCount++;
        const now = Date.now();

        if (now - lastErrorLog > ERROR_LOG_INTERVAL_MS) {
          const config = redisConfig as { host?: string; port?: number };
          logger.error(
            `❌ Redis connection failed (${errorCount} attempts). ` +
            `Ensure Redis is running and accessible at ${config.host || 'localhost'}:${config.port || 6379}. ` +
            `Fix: docker run -d -p 6379:6379 redis:latest`
          );
          lastErrorLog = now;
          errorCount = 0;
        }
      } else {
        // Non-connection errors always logged
        logger.error('Redis error:', err.message);
      }
    });

    client.on('close', () => logger.warn('Redis connection closed'));

    client.on('reconnecting', (delay: number) => {
      logger.log(`Reconnecting to Redis in ${delay}ms...`);
    });

    return client;
  },
}; 