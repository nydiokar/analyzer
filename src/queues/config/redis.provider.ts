import { FactoryProvider, Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { redisConfig } from './redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisProvider');

export const redisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const client = new Redis(redisConfig as RedisOptions);

    client.on('connect', () => logger.log('Redis client connected successfully.'));
    client.on('ready', () => logger.log('Redis client is ready.'));
    client.on('error', (err) => logger.error('Redis client error:', err.stack));
    client.on('close', () => logger.warn('Redis client connection closed.'));
    client.on('reconnecting', () => logger.log('Redis client is reconnecting...'));
    client.on('end', () => logger.log('Redis client connection has ended.'));

    return client;
  },
}; 