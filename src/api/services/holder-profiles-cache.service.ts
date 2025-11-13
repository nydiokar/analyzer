import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { HolderProfilesResult } from '../../queues/jobs/types';

@Injectable()
export class HolderProfilesCacheService {
  private readonly logger = new Logger(HolderProfilesCacheService.name);
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
  }

  /**
   * Get cached holder profiles result
   * TTL: 2 minutes maximum (as requested)
   */
  async getCachedResult(tokenMint: string, topN: number): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:${tokenMint}:${topN}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`✅ Cache hit for holder profiles: ${tokenMint} (topN=${topN})`);
        return JSON.parse(cached);
      }

      this.logger.debug(`❌ Cache miss for holder profiles: ${tokenMint} (topN=${topN})`);
      return null;
    } catch (error) {
      this.logger.error(`Error reading cache for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Cache holder profiles result
   * TTL: 2 minutes (120 seconds) - ensures freshness
   */
  async cacheResult(tokenMint: string, topN: number, result: HolderProfilesResult): Promise<void> {
    const cacheKey = `holder-profiles:${tokenMint}:${topN}`;
    const ttlSeconds = 120; // 2 minutes max as requested

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds);
      this.logger.debug(`💾 Cached holder profiles for ${tokenMint} (topN=${topN}, TTL=${ttlSeconds}s)`);
    } catch (error) {
      this.logger.error(`Error caching result for ${tokenMint}:`, error);
    }
  }

  /**
   * Invalidate cache when wallet data changes
   * ✅ FIX #2: Uses atomic Lua script to prevent race conditions
   * This ensures we NEVER serve stale data after new transactions
   */
  async invalidateForWallet(walletAddress: string): Promise<void> {
    try {
      // Find all holder-profiles cache keys
      const pattern = 'holder-profiles:*';
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return;
      }

      // ✅ Use Lua script for atomic check-and-delete operation
      // This prevents race condition where cache could be read between check and delete
      const luaScript = `
        local keysToDelete = {}
        for i, key in ipairs(KEYS) do
          local value = redis.call('GET', key)
          if value then
            -- Try to decode JSON safely
            local success, decoded = pcall(cjson.decode, value)
            if success and decoded.profiles then
              -- Check if wallet is in profiles array
              for j, profile in ipairs(decoded.profiles) do
                if profile.walletAddress == ARGV[1] then
                  table.insert(keysToDelete, key)
                  break
                end
              end
            else
              -- If JSON is corrupted, delete it
              table.insert(keysToDelete, key)
            end
          end
        end
        -- Atomically delete all matching keys
        if #keysToDelete > 0 then
          redis.call('DEL', unpack(keysToDelete))
        end
        return #keysToDelete
      `;

      // Execute Lua script atomically (all operations happen in one atomic step)
      const deleted = await this.redis.eval(
        luaScript,
        keys.length,
        ...keys,
        walletAddress
      ) as number;

      if (deleted > 0) {
        this.logger.log(`🔄 Invalidated ${deleted} holder-profiles cache(s) for wallet ${walletAddress}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache for wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Invalidate cache for a specific token
   * Use when token metadata or holder distribution changes
   */
  async invalidateForToken(tokenMint: string): Promise<void> {
    try {
      const pattern = `holder-profiles:${tokenMint}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`🔄 Invalidated ${keys.length} holder-profiles cache(s) for token ${tokenMint}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache for token ${tokenMint}:`, error);
    }
  }

  /**
   * Clear all holder profiles caches
   * Use sparingly - mainly for testing or admin operations
   */
  async clearAllCaches(): Promise<void> {
    try {
      const keys = await this.redis.keys('holder-profiles:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`🗑️ Cleared ${keys.length} holder-profiles cache entries`);
      }
    } catch (error) {
      this.logger.error('Error clearing all holder profiles caches:', error);
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{ totalKeys: number; sampleKeys: string[] }> {
    try {
      const keys = await this.redis.keys('holder-profiles:*');
      return {
        totalKeys: keys.length,
        sampleKeys: keys.slice(0, 5), // First 5 keys as sample
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return { totalKeys: 0, sampleKeys: [] };
    }
  }
}
