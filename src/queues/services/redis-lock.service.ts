import { Injectable, Logger } from '@nestjs/common';
import { Redis, RedisOptions } from 'ioredis';
import { redisConfig } from '../config/redis.config';

const truncate = (str: string, length = 64) => {
  if (str.length <= length) return str;
  return `${str.substring(0, length / 2)}...${str.substring(str.length - length / 2)}`;
}

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConfig as RedisOptions);
  }

  /**
   * Acquire a distributed lock using Redis NX (SET IF NOT EXISTS)
   * @param lockKey - The key to lock on
   * @param lockValue - Unique identifier for this lock (usually job ID)
   * @param ttlMs - Time to live in milliseconds (default: 5 minutes)
   * @returns Promise<boolean> - true if lock acquired, false if already locked
   */
  async acquireLock(lockKey: string, lockValue: string, ttlMs = 5 * 60 * 1000): Promise<boolean> {
    try {
      // Use SET with NX (Not eXist) and PX (Expire in milliseconds)
      const result = await this.redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
      
      if (result === 'OK') {
        this.logger.debug(`Lock acquired: ${truncate(lockKey)} with value: ${truncate(lockValue)}`);
        return true;
      } else {
        this.logger.debug(`Lock already exists: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Release a distributed lock safely (only if we own it)
   * @param lockKey - The key to unlock
   * @param lockValue - The unique identifier that was used to acquire the lock
   * @returns Promise<boolean> - true if lock was released, false otherwise
   */
  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    try {
      // Lua script to atomically check and delete the lock
      // This ensures we only delete the lock if we own it
      const luaScript = `
        local current = redis.call('GET', KEYS[1])
        if current == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(luaScript, 1, lockKey, lockValue) as number;
      
      if (result === 1) {
        this.logger.debug(`Lock released: ${truncate(lockKey)}`);
        return true;
      } else {
        this.logger.debug(`Lock not owned or doesn't exist: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to release lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Check if a lock exists and optionally verify ownership
   * @param lockKey - The key to check
   * @param lockValue - Optional: verify if we own this lock
   * @returns Promise<boolean> - true if lock exists (and we own it if lockValue provided)
   */
  async checkLock(lockKey: string, lockValue?: string): Promise<boolean> {
    try {
      const currentValue = await this.redis.get(lockKey);
      
      if (!currentValue) {
        return false;
      }

      if (lockValue) {
        return currentValue === lockValue;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to check lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Extend the TTL of an existing lock (if we own it)
   * @param lockKey - The key to extend
   * @param lockValue - The unique identifier that was used to acquire the lock
   * @param ttlMs - New TTL in milliseconds
   * @returns Promise<boolean> - true if TTL was extended, false otherwise
   */
  async extendLock(lockKey: string, lockValue: string, ttlMs: number): Promise<boolean> {
    try {
      // Lua script to atomically check ownership and extend TTL
      const luaScript = `
        local current = redis.call('GET', KEYS[1])
        if current == ARGV[1] then
          return redis.call('PEXPIRE', KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(luaScript, 1, lockKey, lockValue, ttlMs.toString()) as number;
      
      if (result === 1) {
        this.logger.debug(`Lock TTL extended: ${truncate(lockKey)} for ${ttlMs}ms`);
        return true;
      } else {
        this.logger.debug(`Lock not owned or doesn't exist: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to extend lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Get the remaining TTL of a lock
   * @param lockKey - The key to check
   * @returns Promise<number> - TTL in milliseconds, -1 if no expiry, -2 if key doesn't exist
   */
  async getLockTTL(lockKey: string): Promise<number> {
    try {
      return await this.redis.pttl(lockKey);
    } catch (error) {
      this.logger.error(`Failed to get TTL for lock ${truncate(lockKey)}:`, error);
      return -2;
    }
  }

  /**
   * Force release a lock (emergency cleanup - use with caution)
   * @param lockKey - The key to force unlock
   * @returns Promise<boolean> - true if lock was deleted
   */
  async forceReleaseLock(lockKey: string): Promise<boolean> {
    try {
      const result = await this.redis.del(lockKey);
      
      if (result === 1) {
        this.logger.warn(`Lock force released: ${truncate(lockKey)}`);
        return true;
      } else {
        this.logger.debug(`Lock didn't exist: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to force release lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Utility method to create a lock key for wallet operations
   * @param walletAddress - The wallet address
   * @param operation - The operation type (e.g., 'sync', 'pnl', 'behavior')
   * @returns string - Formatted lock key
   */
  static createWalletLockKey(walletAddress: string, operation: string): string {
    return `lock:wallet:${operation}:${walletAddress}`;
  }

  /**
   * Utility method to create a lock key for similarity operations
   * @param requestId - The similarity request ID
   * @returns string - Formatted lock key
   */
  static createSimilarityLockKey(requestId: string): string {
    return `lock:similarity:${requestId}`;
  }

  /**
   * Utility method to create a lock key for wallet sync operations
   * @param walletAddress - The wallet address to sync
   * @returns string - Formatted lock key
   */
  static createSyncLockKey(walletAddress: string): string {
    return `lock:wallet:sync:${walletAddress}`;
  }

  /**
   * Utility method to create a lock key for enrichment operations
   * @param identifier - Token address or batch identifier
   * @returns string - Formatted lock key
   */
  static createEnrichmentLockKey(identifier: string): string {
    return `lock:enrichment:${identifier}`;
  }

  /**
   * Cleanup method to be called on application shutdown
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    } catch (error) {
      this.logger.error('Error closing Redis connection:', error);
    }
  }
} 