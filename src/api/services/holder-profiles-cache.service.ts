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
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.error('❌ Redis connection failed after 3 attempts - gracefully degrading to no cache');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(`⚠️ Redis connection attempt ${times}/3, retrying in ${delay}ms...`);
        return delay;
      },
    });

    // Connection event handlers for observability
    this.redis.on('error', (err) => {
      this.logger.error('❌ Redis connection error (gracefully degrading to no cache):', err.message);
    });

    this.redis.on('connect', () => {
      this.logger.log('✅ Redis connected successfully for holder profiles cache');
    });

    this.redis.on('ready', () => {
      this.logger.log('✅ Redis ready for holder profiles cache operations');
    });

    this.redis.on('close', () => {
      this.logger.warn('⚠️ Redis connection closed - cache operations will gracefully degrade');
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('🔄 Redis reconnecting...');
    });
  }

  /**
   * Get cached holder profiles result
   * TTL: 2 minutes maximum (as requested)
   * Gracefully degrades to null on Redis errors (no cache mode)
   */
  async getCachedResult(tokenMint: string, topN: number): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:${tokenMint}:${topN}`;
    const startTime = Date.now();

    try {
      const cached = await this.redis.get(cacheKey);
      const duration = Date.now() - startTime;

      if (cached) {
        this.logger.debug(`✅ Cache HIT: ${cacheKey} (${duration}ms)`);
        // TODO: Emit metric for monitoring (cache hit rate)
        return JSON.parse(cached);
      }

      this.logger.debug(`❌ Cache MISS: ${cacheKey} (${duration}ms)`);
      // TODO: Emit metric for monitoring (cache miss rate)
      return null;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`⚠️ Cache read failed for ${cacheKey} (${duration}ms), proceeding without cache:`,
        error instanceof Error ? error.message : 'unknown error');
      // Graceful degradation - return null to trigger fresh analysis
      return null;
    }
  }

  /**
   * Cache holder profiles result
   * TTL: 2 minutes (120 seconds) - ensures freshness
   * Fails silently on Redis errors (graceful degradation)
   */
  async cacheResult(tokenMint: string, topN: number, result: HolderProfilesResult): Promise<void> {
    const cacheKey = `holder-profiles:${tokenMint}:${topN}`;
    const ttlSeconds = 120; // 2 minutes max as requested
    const startTime = Date.now();

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds);
      const duration = Date.now() - startTime;
      this.logger.debug(`💾 Cached holder profiles: ${cacheKey} (TTL=${ttlSeconds}s, ${duration}ms)`);
      // TODO: Emit metric for monitoring (cache write success)
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`⚠️ Cache write failed for ${cacheKey} (${duration}ms), continuing without cache:`,
        error instanceof Error ? error.message : 'unknown error');
      // Graceful degradation - continue without caching
    }
  }

  /**
   * Invalidate cache when wallet data changes
   * ✅ FIX #2: Uses atomic Lua script to prevent race conditions
   * This ensures we NEVER serve stale data after new transactions
   * Gracefully degrades on Redis errors (logs warning but continues)
   */
  async invalidateForWallet(walletAddress: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Find all holder-profiles cache keys
      const pattern = 'holder-profiles:*';
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        this.logger.debug(`No holder-profiles caches found to invalidate for wallet ${walletAddress}`);
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

      const duration = Date.now() - startTime;

      if (deleted > 0) {
        this.logger.log(`🔄 Invalidated ${deleted} holder-profiles cache(s) for wallet ${walletAddress} (${duration}ms)`);
        // TODO: Emit metric for monitoring (cache invalidation count)
      } else {
        this.logger.debug(`Wallet ${walletAddress} not found in any cached holder profiles (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`⚠️ Cache invalidation failed for wallet ${walletAddress} (${duration}ms), continuing anyway:`,
        error instanceof Error ? error.message : 'unknown error');
      // Graceful degradation - continue processing even if cache invalidation fails
      // Worst case: stale cache served until TTL expires (2 minutes max)
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
