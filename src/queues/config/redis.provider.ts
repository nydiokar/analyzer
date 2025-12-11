import { FactoryProvider, Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { redisConfig } from './redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisProvider');

// Track connection state to avoid repetitive logging
let lastConnectionError: string | null = null;
let connectionErrorCount = 0;
let lastConnectionState = 'disconnected';
let isFirstConnectionAttempt = true;

export const redisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    // Override a few defaults to match prior per-service settings (bounded retries) while keeping lazyConnect
    const lockServiceConfig: RedisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: true, // allow startup without immediate Redis
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 3000);
        return delay;
      },
    };
    const client = new Redis(lockServiceConfig);

    // Clear error tracking on successful connection
    client.on('connect', () => {
      logger.log('✅ Redis client connected successfully.');
      lastConnectionError = null;
      connectionErrorCount = 0;
      lastConnectionState = 'connected';
      isFirstConnectionAttempt = false;
    });

    client.on('ready', () => {
      logger.log('🚀 Redis client is ready and operational.');
      lastConnectionState = 'ready';
    });

    // Improved error handling - less noisy, more informative
    client.on('error', (err) => {
      const errorMessage = err.message || 'Unknown Redis error';
      const isConnectionError = errorMessage.includes('ECONNREFUSED') ||
                               errorMessage.includes('ECONNRESET') ||
                               errorMessage.includes('ECONNABORTED') ||
                               errorMessage.includes('ENOTFOUND');

      if (isConnectionError) {
        // Only log connection errors once every 30 seconds to avoid spam
        const now = Date.now();
        if (lastConnectionError !== errorMessage || connectionErrorCount === 0) {
          logger.error(`❌ Redis connection failed: ${errorMessage}`);
          logger.error('💡 Make sure Redis is running: docker-compose up -d redis');
          lastConnectionError = errorMessage;
          connectionErrorCount = 1;
        } else {
          connectionErrorCount++;
          // Log count every 10 occurrences
          if (connectionErrorCount % 10 === 0) {
            logger.warn(`🔄 Redis connection still failing (${connectionErrorCount} attempts): ${errorMessage}`);
          }
        }
      } else {
        // Non-connection errors should still be logged with full details
        logger.error(`🔥 Redis error: ${errorMessage}`, err.stack);
      }
    });

    client.on('close', () => {
      if (lastConnectionState !== 'disconnected') {
        logger.warn('⚠️  Redis connection closed unexpectedly.');
        lastConnectionState = 'disconnected';
      }
    });

    client.on('reconnecting', (delay: number) => {
      if (lastConnectionState !== 'reconnecting') {
        logger.log(`🔄 Redis reconnecting in ${delay}ms...`);
        lastConnectionState = 'reconnecting';
      }
    });

    client.on('end', () => {
      logger.log('🛑 Redis client connection has ended.');
      lastConnectionState = 'disconnected';
    });

    // Log initial connection attempt
    setTimeout(() => {
      if (isFirstConnectionAttempt) {
        logger.log('🔍 Attempting to connect to Redis...');
      }
    }, 100);

    return client;
  },
}; 
