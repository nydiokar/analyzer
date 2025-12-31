import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { HolderProfilesResult, HolderProfile } from '../../queues/jobs/types';
import { DatabaseService } from './database.service';
import type { HolderProfileSnapshot, Wallet as PrismaWallet } from '@prisma/client';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { WALLET_STALENESS_CONFIG } from '../../config/constants';

/**
 * TWO-TIER CACHE SERVICE: Manages both Redis (Tier 1) and PostgreSQL (Tier 2) caching
 * for holder profile analysis results.
 *
 * ARCHITECTURE OVERVIEW:
 * =====================
 * This service implements a complete two-tier caching strategy:
 *
 * TIER 1 (Redis - Hot Cache):
 *   - Stores: Complete HolderProfilesResult objects
 *   - TTL: 1 hour (automatic eviction)
 *   - Use case: Repeated queries for same token/topN within short time
 *   - Tradeoff: Memory-intensive but ultra-fast (<50ms)
 *   - Methods: getTokenResult(), cacheTokenResult(), getWalletResult(), cacheWalletResult()
 *
 * TIER 2 (PostgreSQL - Persistent Cache):
 *   - Stores: Individual HolderProfile records as JSONB
 *   - TTL: Until wallet re-syncs (smart freshness check via wallet.lastSuccessfulFetchTimestamp)
 *   - Use case: Progressive streaming of cached profiles (serve 7 instantly, compute 3)
 *   - Tradeoff: Disk-based but survives Redis eviction, slower (~100-200ms)
 *   - Methods: getTokenSnapshots(), getWalletSnapshot(), saveSnapshot(), hydrateSnapshot()
 *
 * CACHE FLOW:
 * ===========
 * Request for top 10 holders:
 * 1. Check Tier 1 (Redis) → Full result available? Return immediately ⚡
 * 2. Check Tier 2 (PostgreSQL) → Fetch all 10 snapshots
 *    ├─ 7 snapshots fresh → Stream to frontend immediately
 *    └─ 3 snapshots stale → Trigger re-analysis
 * 3. Compute missing 3 profiles → Save to Tier 2 → Stream to frontend
 * 4. Cache complete result in Tier 1 for next request
 *
 * FRESHNESS LOGIC:
 * ================
 * Snapshot considered fresh if:
 *   PRIMARY: snapshot.computedAt >= wallet.lastSuccessfulFetchTimestamp
 *            (Profile computed AFTER wallet's last sync → safe to reuse)
 *   FALLBACK: snapshot.computedAt within last 1 hour
 *            (Conservative TTL when wallet record unavailable)
 *
 * MEMORY MANAGEMENT:
 * ==================
 * - Tier 1: ~5MB for 100 cached results (auto-evicts after 1 hour)
 * - Tier 2: Grows indefinitely (TODO: implement cleanup job for snapshots >7 days old)
 * - Can disable Tier 2 with env var: DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE=true
 *
 * INVALIDATION STRATEGY:
 * ======================
 * - Wallet behavior changes → invalidateForWallet() clears both tiers
 * - Token-level → invalidateForToken() clears all topN variations
 * - No proactive invalidation on wallet sync → Freshness check handles staleness
 *
 * @see HolderProfileSnapshot (Tier 2 database model in Prisma schema)
 * @see AnalysisOperationsProcessor.processAnalyzeHolderProfiles (orchestration)
 */
@Injectable()
export class HolderProfilesCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(HolderProfilesCacheService.name);
  private readonly TTL_SECONDS = 3600; // 1 hour - holder profiles don't change frequently
  private redis: Redis;

  // Cache metrics (in-memory counters, reset on service restart)
  private metrics = {
    tier1: { hits: 0, misses: 0 },
    tier2: { hits: 0, misses: 0, partial: 0 },
    lastReset: new Date(),
  };

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) redisClient: Redis,
  ) {
    this.redis = redisClient;

    this.redis.on('error', (err) => this.logger.error('Redis connection error (holder profiles cache):', err.message));
    this.redis.on('connect', () => this.logger.log('Redis connected for holder profiles cache'));
    this.redis.on('ready', () => this.logger.log('Redis ready for holder profiles cache operations'));
    this.redis.on('close', () => this.logger.warn('Redis connection closed for holder profiles cache'));
    this.redis.on('reconnecting', () => this.logger.log('Redis reconnecting for holder profiles cache...'));
  }

  async getTokenResult(tokenMint: string, topN: number): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:token:${tokenMint}:${topN}`;
    const result = await this.readResult(cacheKey);
    if (result) {
      this.metrics.tier1.hits++;
    } else {
      this.metrics.tier1.misses++;
    }
    return result;
  }

  async cacheTokenResult(tokenMint: string, topN: number, result: HolderProfilesResult): Promise<void> {
    const cacheKey = `holder-profiles:token:${tokenMint}:${topN}`;
    await this.writeResult(cacheKey, result);
  }

  async getWalletResult(walletAddress: string): Promise<HolderProfilesResult | null> {
    const cacheKey = `holder-profiles:wallet:${walletAddress}`;
    const result = await this.readResult(cacheKey);
    if (result) {
      this.metrics.tier1.hits++;
    } else {
      this.metrics.tier1.misses++;
    }
    return result;
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

      const pattern = 'holder-profiles:token:*';
      let cursor = '0';
      const batchSize = 200;
      let deleted = 0;

      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
        cursor = nextCursor;

        if (keys.length === 0) {
          continue;
        }

        const batchDeleted = Number(await this.redis.eval(luaScript, keys.length, ...keys, walletAddress));
        deleted += batchDeleted;
      } while (cursor !== '0');

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

  async onModuleDestroy(): Promise<void> {
    // Shared Redis connection managed centrally
    return;
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

  // ============================================================================
  // TIER 2 CACHE: PostgreSQL Snapshot Management
  // ============================================================================

  /**
   * Check if a holder profile snapshot is still fresh (can be reused).
   *
   * A snapshot is fresh if the wallet's underlying data hasn't changed since the profile was computed.
   *
   * @param snapshot - The HolderProfileSnapshot to check
   * @param walletRecord - Optional wallet record with lastSuccessfulFetchTimestamp
   * @returns true if snapshot can be reused, false if needs recomputation
   */
  isSnapshotFresh(
    snapshot: HolderProfileSnapshot,
    walletRecord?: PrismaWallet | null,
  ): boolean {
    const computedAt =
      snapshot.computedAt instanceof Date
        ? snapshot.computedAt.getTime()
        : new Date(snapshot.computedAt).getTime();

    if (Number.isNaN(computedAt)) {
      return false;
    }

    // Check if wallet's analyzed data itself is stale (uses centralized threshold)
    const stalenessThresholdMs = Date.now() - WALLET_STALENESS_CONFIG.ANALYSIS_STALENESS_MS;
    if (walletRecord?.analyzedTimestampEnd) {
      const analyzedEndMs = walletRecord.analyzedTimestampEnd * 1000; // Convert seconds to ms
      if (analyzedEndMs < stalenessThresholdMs) {
        // Wallet's analysis is stale, regardless of snapshot age
        return false;
      }
    }

    // PRIMARY: Check if snapshot is fresher than wallet's last sync
    if (walletRecord?.lastSuccessfulFetchTimestamp instanceof Date) {
      return computedAt >= walletRecord.lastSuccessfulFetchTimestamp.getTime();
    }

    // FALLBACK: Use time-based TTL (conservative 1-hour expiration)
    return Date.now() - computedAt < 60 * 60 * 1000;
  }

  /**
   * Type guard to validate that a JSON value is a valid HolderProfile.
   * Provides runtime safety when deserializing from PostgreSQL JSONB.
   */
  private isHolderProfile(value: unknown): value is HolderProfile {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj.walletAddress === 'string' &&
      typeof obj.rank === 'number' &&
      typeof obj.supplyPercent === 'number'
    );
  }

  /**
   * Hydrate a snapshot profile with current holder metadata.
   *
   * Updates rank and supplyPercent (which can change as holders trade) while
   * preserving the expensive behavioral analysis from the snapshot.
   *
   * @param snapshot - The HolderProfileSnapshot from DB
   * @param metadata - Current rank and supply percentage
   * @returns Fresh HolderProfile with updated metadata
   */
  hydrateSnapshot(
    snapshot: HolderProfileSnapshot,
    metadata: { rank: number; supplyPercent: number },
  ): HolderProfile {
    if (!this.isHolderProfile(snapshot.profile)) {
      throw new Error(`Invalid HolderProfile structure in snapshot for wallet ${snapshot.walletAddress}`);
    }

    const raw = snapshot.profile;
    const cloned: HolderProfile = JSON.parse(JSON.stringify(raw));
    cloned.rank = metadata.rank;
    cloned.supplyPercent = metadata.supplyPercent;
    return cloned;
  }

  /**
   * Fetch and organize snapshots for token-mode analysis.
   * Returns Map of fresh snapshots + list of wallet addresses needing re-analysis.
   *
   * @param tokenMint - Token mint address
   * @param walletAddresses - List of wallet addresses to fetch snapshots for
   * @returns Object with snapshots map, ready wallets, and wallets needing analysis
   */
  async getTokenSnapshots(
    tokenMint: string,
    walletAddresses: string[],
  ): Promise<{
    snapshots: Map<string, HolderProfileSnapshot>;
    walletRecords: Map<string, PrismaWallet>;
    readyWallets: string[];      // Wallets with fresh snapshots
    staleWallets: string[];      // Wallets needing re-analysis
  }> {
    const snapshotCacheEnabled = this.isSnapshotCacheEnabled();

    if (!snapshotCacheEnabled || walletAddresses.length === 0) {
      return {
        snapshots: new Map(),
        walletRecords: new Map(),
        readyWallets: [],
        staleWallets: walletAddresses,
      };
    }

    // Batch fetch all snapshots for the requested wallets (single DB query)
    const snapshots = await this.databaseService.getLatestHolderProfileSnapshotsForToken(
      tokenMint,
      walletAddresses,
    );

    // Fetch wallet records to check freshness (needed for lastSuccessfulFetchTimestamp)
    const wallets = await this.databaseService.getWallets(walletAddresses, true) as PrismaWallet[];
    const walletRecords = new Map(wallets.map(wallet => [wallet.address, wallet]));

    // Split into ready (fresh) vs stale wallets
    const readyWallets: string[] = [];
    const staleWallets: string[] = [];

    for (const addr of walletAddresses) {
      const snapshot = snapshots.get(addr);
      const walletRecord = walletRecords.get(addr);

      if (snapshot && this.isSnapshotFresh(snapshot, walletRecord)) {
        readyWallets.push(addr);
      } else {
        staleWallets.push(addr);
      }
    }

    // Track Tier 2 metrics
    if (readyWallets.length > 0) {
      if (readyWallets.length === walletAddresses.length) {
        this.metrics.tier2.hits++; // Full hit - all wallets cached
      } else {
        this.metrics.tier2.partial++; // Partial hit - some wallets cached
      }
    } else {
      this.metrics.tier2.misses++; // Complete miss - no wallets cached
    }

    this.logger.log(
      `Snapshot check for ${tokenMint}: ${readyWallets.length} fresh, ${staleWallets.length} stale`,
    );

    return {
      snapshots,
      walletRecords,
      readyWallets,
      staleWallets,
    };
  }

  /**
   * Fetch snapshot for wallet-mode analysis.
   *
   * @param walletAddress - Wallet address
   * @returns Snapshot if fresh, null if needs recomputation
   */
  async getWalletSnapshot(walletAddress: string): Promise<HolderProfile | null> {
    const snapshotCacheEnabled = this.isSnapshotCacheEnabled();
    if (!snapshotCacheEnabled) {
      return null;
    }

    const walletRecord = await this.databaseService.getWallet(walletAddress);
    const latestSnapshot = await this.databaseService.getLatestHolderProfileSnapshot({
      walletAddress,
      tokenMint: null,
      analysisMode: 'wallet',
    });

    if (latestSnapshot && this.isSnapshotFresh(latestSnapshot, walletRecord)) {
      this.metrics.tier2.hits++; // Track hit
      this.logger.log(`Serving cached holder snapshot for wallet ${walletAddress}`);
      if (!this.isHolderProfile(latestSnapshot.profile)) {
        throw new Error(`Invalid HolderProfile structure in snapshot for wallet ${walletAddress}`);
      }
      return latestSnapshot.profile;
    }

    this.metrics.tier2.misses++; // Track miss
    return null;
  }

  /**
   * Save a holder profile snapshot to the database (Tier 2 cache).
   *
   * @param params - Snapshot parameters including profile data and metadata
   */
  async saveSnapshot(params: {
    walletAddress: string;
    tokenMint?: string | null;
    analysisMode: 'token' | 'wallet';
    holderRank?: number | null;
    supplyPercent?: number | null;
    topN?: number | null;
    jobId?: string | null;
    requestId?: string | null;
    profile: HolderProfile;
    metadata?: any;
  }): Promise<void> {
    const snapshotCacheEnabled = this.isSnapshotCacheEnabled();
    if (!snapshotCacheEnabled) {
      return;
    }

    await this.databaseService.saveHolderProfileSnapshot(params);
  }

  /**
   * Check if snapshot caching is enabled via environment variable.
   */
  private isSnapshotCacheEnabled(): boolean {
    return process.env.DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE !== 'true';
  }

  // ============================================================================
  // CACHE METRICS
  // ============================================================================

  /**
   * Get cache hit rate metrics for monitoring and optimization decisions.
   *
   * Tracks performance across both cache tiers:
   * - Tier 1 (Redis): Hot cache for complete results
   * - Tier 2 (PostgreSQL): Persistent cache for individual profiles
   *
   * Use this data to:
   * - Validate cache effectiveness over time
   * - Identify optimization opportunities (e.g., adjust TTLs)
   * - Monitor progressive streaming performance
   *
   * @returns Cache metrics including hit rates, counts, and uptime
   */
  getCacheMetrics() {
    const uptimeMs = Date.now() - this.metrics.lastReset.getTime();
    const uptimeHours = uptimeMs / (1000 * 60 * 60);

    return {
      tier1: {
        hits: this.metrics.tier1.hits,
        misses: this.metrics.tier1.misses,
        hitRate: this.calculateHitRate(this.metrics.tier1.hits, this.metrics.tier1.misses),
        total: this.metrics.tier1.hits + this.metrics.tier1.misses,
      },
      tier2: {
        hits: this.metrics.tier2.hits,
        misses: this.metrics.tier2.misses,
        partial: this.metrics.tier2.partial,
        hitRate: this.calculateHitRate(this.metrics.tier2.hits, this.metrics.tier2.misses),
        total: this.metrics.tier2.hits + this.metrics.tier2.misses + this.metrics.tier2.partial,
      },
      uptime: {
        milliseconds: uptimeMs,
        hours: uptimeHours,
        since: this.metrics.lastReset,
      },
    };
  }

  /**
   * Reset cache metrics counters (useful for starting fresh measurements).
   */
  resetMetrics(): void {
    this.metrics = {
      tier1: { hits: 0, misses: 0 },
      tier2: { hits: 0, misses: 0, partial: 0 },
      lastReset: new Date(),
    };
    this.logger.log('Cache metrics reset');
  }

  /**
   * Calculate hit rate percentage.
   * @param hits - Number of cache hits
   * @param misses - Number of cache misses
   * @returns Hit rate as percentage (0-100), or 0 if no requests
   */
  private calculateHitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 0;
  }
}
