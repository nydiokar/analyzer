import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { HolderProfilesResult } from '../../queues/jobs/types';

/**
 * TIER 1 CACHE: Redis-based hot cache for holder profile analysis results.
 *
 * ARCHITECTURE OVERVIEW:
 * =====================
 * This service implements TIER 1 of a two-tier caching strategy:
 *
 * TIER 1 (THIS SERVICE - Redis):
 *   - Stores: Complete HolderProfilesResult objects
 *   - TTL: 1 hour (hot cache)
 *   - Use case: Repeated queries for same token/topN within short time
 *   - Tradeoff: Memory-intensive but ultra-fast
 *
 * TIER 2 (PostgreSQL HolderProfileSnapshot table):
 *   - Stores: Individual HolderProfile records as JSON
 *   - TTL: Until wallet re-syncs (smart freshness check)
 *   - Use case: Progressive streaming of cached profiles
 *   - Tradeoff: Disk-based but survives Redis eviction
 *
 * WHY TIER 1 EXISTS:
 * ==================
 * Without this Redis cache, every request would:
 * 1. Query PostgreSQL for 10+ snapshots
 * 2. Check freshness for each
 * 3. Stream partial results
 * 4. Compute missing profiles
 *
 * With Redis (this cache):
 * - Same request within 1 hour → Instant return of full result (50ms)
 * - Different topN or token → Fall through to Tier 2 + computation
 *
 * MEMORY MANAGEMENT:
 * ==================
 * - Keys expire after 1 hour (automatic eviction)
 * - Typical size: ~50KB per result (10 profiles × ~5KB each)
 * - Expected memory: ~5MB for 100 cached results
 * - If memory pressure: Reduce TTL or rely solely on Tier 2
 *
 * INVALIDATION STRATEGY:
 * ======================
 * - Wallet behavior changes → Invalidate all caches containing that wallet
 * - Token-level invalidation → Clear all topN variations for that token
 * - No proactive invalidation → Let TTL handle it (simpler, safer)
 *
 * @see HolderProfileSnapshot (Tier 2 cache in PostgreSQL)
 * @see AnalysisOperationsProcessor.processAnalyzeHolderProfiles (orchestration)
 */
@Injectable()
export class HolderProfilesCacheService {
  private readonly logger = new Logger(HolderProfilesCacheService.name);
  private readonly TTL_SECONDS = 3600; // 1 hour - holder profiles don't change frequently
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (attempt) => {
        if (attempt > 3) {
          this.logger.error('Redis connection failed for holder profiles cache after 3 attempts');
          return null;
        }
        const delay = Math.min(attempt * 100, 3000);
        this.logger.warn(`Redis connection attempt ${attempt}/3, retrying in ${delay}ms...`);
        return delay;
      },
    });

    this.redis.on('error', (err) => this.logger.error('Redis connection error (holder profiles cache):', err.message));
    this.redis.on('connect', () => this.logger.log('Redis connected for holder profiles cache'));
    this.redis.on('ready', () => this.logger.log('Redis ready for holder profiles cache operations'));
    this.redis.on('close', () => this.logger.warn('Redis connection closed for holder profiles cache'));
    this.redis.on('reconnecting', () => this.logger.log('Redis reconnecting for holder profiles cache...'));
  }

  async getTokenResult(tokenMint: string, topN: number): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:token:${tokenMint}:${topN}`;
    return this.readResult(cacheKey);
  }

  async cacheTokenResult(tokenMint: string, topN: number, result: HolderProfilesResult): Promise<void> {
    const cacheKey = `holder-profiles:token:${tokenMint}:${topN}`;
    await this.writeResult(cacheKey, result);
  }

  async getWalletResult(walletAddress: string): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:wallet:${walletAddress}`;
    return this.readResult(cacheKey);
  }

  async cacheWalletResult(walletAddress: string, result: HolderProfilesResult): Promise<void> {
    const cacheKey = `holder-profiles:wallet:${walletAddress}`;
    await this.writeResult(cacheKey, result);
  }

  async invalidateForWallet(walletAddress: string): Promise<void> {
    const startTime = Date.now();
    try {
      const walletKey = `holder-profiles:wallet:${walletAddress}`;
      const walletDeleted = await this.redis.del(walletKey);
      if (walletDeleted > 0) {
        this.logger.log(`Invalidated wallet holder profile cache for ${walletAddress}`);
      }

      const tokenKeys = await this.redis.keys('holder-profiles:token:*');
      if (tokenKeys.length === 0) {
        this.logger.debug(`No token caches found while invalidating wallet ${walletAddress}`);
        return;
      }

      const luaScript = `
        local keysToDelete = {}
        for i, key in ipairs(KEYS) do
          local value = redis.call('GET', key)
          if value then
            local success, decoded = pcall(cjson.decode, value)
            if success and decoded.profiles then
              for _, profile in ipairs(decoded.profiles) do
                if profile.walletAddress == ARGV[1] then
                  table.insert(keysToDelete, key)
                  break
                end
              end
            end
          end
        end
        if #keysToDelete > 0 then
          redis.call('DEL', unpack(keysToDelete))
        end
        return #keysToDelete
      `;

      const deleted = tokenKeys.length > 0
        ? Number(await this.redis.eval(luaScript, tokenKeys.length, ...tokenKeys, walletAddress))
        : 0;

      const duration = Date.now() - startTime;
      if (deleted > 0) {
        this.logger.log(`Invalidated ${deleted} token holder profile cache(s) for wallet ${walletAddress} (${duration}ms)`);
      } else {
        this.logger.debug(`Wallet ${walletAddress} not found in cached token holder profiles (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`Cache invalidation failed for wallet ${walletAddress} (${duration}ms):`,
        error instanceof Error ? error.message : 'unknown error');
    }
  }

  async invalidateForToken(tokenMint: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`holder-profiles:token:${tokenMint}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Invalidated ${keys.length} holder profile cache(s) for token ${tokenMint}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache for token ${tokenMint}:`, error);
    }
  }

  async clearAllCaches(): Promise<void> {
    try {
      const keys = await this.redis.keys('holder-profiles:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} holder profile cache entries`);
      }
    } catch (error) {
      this.logger.error('Error clearing holder profile caches:', error);
    }
  }

  async getCacheStats(): Promise<{ totalKeys: number; sampleKeys: string[] }> {
    try {
      const keys = await this.redis.keys('holder-profiles:*');
      return {
        totalKeys: keys.length,
        sampleKeys: keys.slice(0, 5),
      };
    } catch (error) {
      this.logger.error('Error getting holder profile cache stats:', error);
      return { totalKeys: 0, sampleKeys: [] };
    }
  }

  private async readResult(cacheKey: string): Promise<HolderProfilesResult | null> {
    const startTime = Date.now();
    try {
      const cached = await this.redis.get(cacheKey);
      const duration = Date.now() - startTime;
      if (cached) {
        this.logger.debug(`Cache HIT: ${cacheKey} (${duration}ms)`);
        return JSON.parse(cached);
      }
      this.logger.debug(`Cache MISS: ${cacheKey} (${duration}ms)`);
      return null;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`Cache read failed for ${cacheKey} (${duration}ms):`,
        error instanceof Error ? error.message : 'unknown error');
      return null;
    }
  }

  private async writeResult(cacheKey: string, result: HolderProfilesResult): Promise<void> {
    const startTime = Date.now();
    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.TTL_SECONDS);
      const duration = Date.now() - startTime;
      this.logger.debug(`Cached holder profiles result ${cacheKey} (TTL=${this.TTL_SECONDS}s, ${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn(`Cache write failed for ${cacheKey} (${duration}ms):`,
        error instanceof Error ? error.message : 'unknown error');
    }
  }
}
