import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.provider';

const truncate = (str: string, length = 64) => {
  if (str.length <= length) return str;
  return `${str.substring(0, length / 2)}...${str.substring(str.length - length / 2)}`;
}

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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
   * Cleanup orphaned locks on startup - locks that exist but have no corresponding active job
   * This handles the case where server restart causes jobs to be lost but locks remain
   * @returns Promise<number> - Number of orphaned locks cleaned up
   */
  async cleanupOrphanedLocksOnStartup(): Promise<number> {
    try {
      this.logger.log('Starting orphaned lock cleanup on startup...');
      let cleanedCount = 0;
      let scannedCount = 0;

      // Iteratively SCAN for keys to avoid blocking Redis with KEYS
      let cursor = '0';
      const pattern = 'lock:*';
      const countPerScan = 1000;

      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', countPerScan);
        cursor = nextCursor;
        scannedCount += keys.length;

        for (const lockKey of keys) {
          try {
            const lockValue = await this.redis.get(lockKey);
            if (!lockValue) continue; // Lock already expired

            const isOrphaned = await this.isLockOrphaned(lockKey, lockValue);
            if (isOrphaned) {
              const released = await this.forceReleaseLock(lockKey);
              if (released) {
                cleanedCount++;
                this.logger.warn(`🧹 Cleaned orphaned lock: ${truncate(lockKey)} (job: ${truncate(lockValue)})`);
              }
            }
          } catch (error) {
            this.logger.warn(`Error checking lock ${truncate(lockKey)}:`, error);
          }
        }
      } while (cursor !== '0');

      this.logger.log(`Startup orphaned lock cleanup completed. Cleaned ${cleanedCount} orphaned locks (scanned ${scannedCount} keys matching ${pattern})`);
      return cleanedCount;
    } catch (error) {
      this.logger.error('Error during startup orphaned lock cleanup:', error);
      return 0;
    }
  }

  /**
   * Check if a lock is orphaned (has no corresponding active job)
   * @param lockKey - The lock key
   * @param jobId - The job ID stored in the lock
   * @returns Promise<boolean> - true if the lock is orphaned
   */
  private async isLockOrphaned(lockKey: string, jobId: string): Promise<boolean> {
    try {
      // Extract queue name from lock key pattern
      const queueName = this.extractQueueNameFromLock(lockKey);
      if (!queueName) {
        this.logger.warn(`Cannot determine queue for lock: ${truncate(lockKey)}`);
        return false; // Conservative - don't clean if we can't determine
      }

      // Import Queue dynamically to check if job exists and is active
      const { Queue } = await import('bullmq');
      const { redisConfig } = await import('../config/redis.config');
      const queue = new Queue(queueName, { connection: redisConfig });

      try {
        const job = await queue.getJob(jobId);
        
        if (!job) {
          // Job doesn't exist - lock is orphaned
          return true;
        }

        // Check if job is in a finished state
        const isFinished = job.finishedOn !== undefined;
        const isFailed = job.failedReason !== undefined;
        
        if (isFinished || isFailed) {
          // Job is finished but lock still exists - orphaned
          return true;
        }

        // Job exists and is active - lock is not orphaned
        return false;
      } finally {
        await queue.close();
      }
    } catch (error) {
      this.logger.warn(`Error checking if lock is orphaned ${truncate(lockKey)}:`, error);
      return false; // Conservative - don't clean if we can't verify
    }
  }

  /**
   * Extract queue name from lock key to check the right queue
   * @param lockKey - The lock key (e.g., "lock:wallet:pnl:address" or "lock:similarity:requestId")
   * @returns string | null - The queue name or null if cannot determine
   */
  private extractQueueNameFromLock(lockKey: string): string | null {
    const parts = lockKey.split(':');
    
    if (parts.length < 3) return null;
    
    if (parts[1] === 'wallet') {
      // wallet locks: sync → wallet-operations, pnl/behavior/dashboard-analysis → analysis-operations  
      const operation = parts[2];
      if (operation === 'sync') {
        return 'wallet-operations';
      } else if (['pnl', 'behavior', 'dashboard-analysis'].includes(operation)) {
        return 'analysis-operations';
      }
    } else if (parts[1] === 'similarity') {
      return 'similarity-operations';
    } else if (parts[1] === 'enrichment') {
      return 'enrichment-operations';
    }
    
    return null;
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
} 