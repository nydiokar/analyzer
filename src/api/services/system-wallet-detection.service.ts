import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { DatabaseService } from './database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import {
  WALLET_CLASSIFICATIONS,
  SYSTEM_WALLET_DETECTION_CONFIG,
  KNOWN_SYSTEM_WALLETS,
  SPL_TOKEN_PROGRAM_ID,
} from '../../config/constants';

export interface SystemWalletDetectionResult {
  address: string;
  isSystemWallet: boolean;      // Is this a system wallet (INVALID)?
  isLargeWallet: boolean;       // Is this a large wallet (LARGE)?
  shouldBlock: boolean;         // Should we skip processing?
  shouldLog: boolean;           // Should we log this?
  tokenCount?: number;          // Token count if detected dynamically
  reason: string;               // Human-readable reason
  method: string;               // Detection method
  confidence: number;           // 0.0-1.0 confidence
}

export interface FilterResult {
  valid: string[];              // Wallets safe to process
  filtered: Map<string, string>; // Filtered wallets → reason
  largeWallets: string[];        // Large wallets (processed but monitored)
}

/**
 * System Wallet Detection Service
 *
 * Centralized service for detecting and filtering system wallets (vaults, AMM accounts, etc.)
 * Uses a 3-tier detection strategy:
 *
 * Tier 1: Memory cache (O(1), ultra-fast)
 * Tier 2: Redis cache (50ms, fast)
 * Tier 3: Database + Dynamic detection (500ms, thorough)
 *
 * Thresholds:
 * - 15k tokens: Mark as LARGE, process anyway (gray zone)
 * - 35k tokens: Mark as INVALID, skip processing (certain system wallet)
 *
 * All detections are automatically cached and stored in the database.
 */
@Injectable()
export class SystemWalletDetectionService {
  private readonly logger = new Logger(SystemWalletDetectionService.name);
  private readonly memoryCache = new Map<string, SystemWalletDetectionResult>();
  private readonly knownSystemSet = new Set<string>(KNOWN_SYSTEM_WALLETS as readonly string[]);

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Load known system wallets into memory on startup
    this.logger.log(`Initialized with ${KNOWN_SYSTEM_WALLETS.length} known system wallets`);
  }

  /**
   * TIER 1: Fast check - is this a known system wallet?
   * O(1) lookup, no I/O. Returns immediately.
   */
  isKnownSystemWallet(address: string): boolean {
    return this.knownSystemSet.has(address);
  }

  /**
   * TIER 2+3: Full detection with caching
   * Checks memory → redis → database → dynamic RPC detection
   *
   * Auto-tags wallets in database and caches results.
   */
  async detectSystemWallet(address: string): Promise<SystemWalletDetectionResult> {
    // Tier 1: Memory cache
    if (SYSTEM_WALLET_DETECTION_CONFIG.ENABLE_MEMORY_CACHE && this.memoryCache.has(address)) {
      return this.memoryCache.get(address)!;
    }

    // Tier 1.5: Known static list
    if (this.isKnownSystemWallet(address)) {
      const result: SystemWalletDetectionResult = {
        address,
        isSystemWallet: true,
        isLargeWallet: false,
        shouldBlock: true,
        shouldLog: true,
        reason: 'Known system wallet (static list)',
        method: 'static_list',
        confidence: 1.0,
      };
      this.cacheResult(result);
      return result;
    }

    // Tier 2: Redis cache
    try {
      const cacheKey = this.buildCacheKey(address);
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as SystemWalletDetectionResult;
        this.memoryCache.set(address, result); // Populate memory cache
        return result;
      }
    } catch (error) {
      this.logger.debug(`Redis cache lookup failed for ${address}:`, error);
    }

    // Tier 3: Database check
    try {
      const wallet = await this.databaseService.getWallet(address);
      if (wallet?.classification === WALLET_CLASSIFICATIONS.INVALID) {
        const result: SystemWalletDetectionResult = {
          address,
          isSystemWallet: true,
          isLargeWallet: false,
          shouldBlock: true,
          shouldLog: false, // Already tagged, don't spam logs
          reason: `Database classification: ${wallet.classification}`,
          method: wallet.classificationMethod || 'database',
          confidence: wallet.classificationConfidence || 0.9,
        };
        this.cacheResult(result);
        return result;
      }

      if (wallet?.classification === WALLET_CLASSIFICATIONS.LARGE) {
        const result: SystemWalletDetectionResult = {
          address,
          isSystemWallet: false,
          isLargeWallet: true,
          shouldBlock: false, // Process anyway
          shouldLog: true,    // Log for monitoring
          reason: `Large wallet (database classification)`,
          method: wallet.classificationMethod || 'database',
          confidence: wallet.classificationConfidence || 0.8,
        };
        this.cacheResult(result);
        return result;
      }
    } catch (error) {
      this.logger.debug(`Database lookup failed for ${address}:`, error);
    }

    // Tier 4: Dynamic detection via RPC (token count)
    try {
      const tokenCount = await this.getTokenCount(address);
      const result = this.classifyByTokenCount(address, tokenCount);

      // Auto-tag in database if configured
      if (SYSTEM_WALLET_DETECTION_CONFIG.AUTO_TAG_DATABASE && (result.isSystemWallet || result.isLargeWallet)) {
        await this.tagWallet(result);
      }

      // Cache the result
      this.cacheResult(result);

      return result;
    } catch (error) {
      this.logger.warn(`Failed to detect system wallet ${address}:`, error);
      // Fail open - assume it's NOT a system wallet
      return {
        address,
        isSystemWallet: false,
        isLargeWallet: false,
        shouldBlock: false,
        shouldLog: false,
        reason: 'Detection failed, processing anyway',
        method: 'error_fallback',
        confidence: 0.0,
      };
    }
  }

  /**
   * Batch filter system wallets from a list
   * Optimized with batch DB lookup and parallel RPC checks
   *
   * Returns: {
   *   valid: wallets safe to process,
   *   filtered: system wallets → reason,
   *   largeWallets: large wallets (processed but logged)
   * }
   */
  async filterSystemWallets(
    addresses: string[],
    options?: { skipDynamic?: boolean }
  ): Promise<FilterResult> {
    if (addresses.length === 0) {
      return { valid: [], filtered: new Map(), largeWallets: [] };
    }

    const valid: string[] = [];
    const filtered = new Map<string, string>();
    const largeWallets: string[] = [];

    // Process in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < addresses.length; i += CONCURRENCY) {
      const batch = addresses.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(addr => options?.skipDynamic
          ? this.quickCheck(addr)
          : this.detectSystemWallet(addr)
        )
      );

      results.forEach(result => {
        if (result.isSystemWallet && result.shouldBlock) {
          filtered.set(result.address, result.reason);
        } else if (result.isLargeWallet) {
          largeWallets.push(result.address);
          valid.push(result.address); // Process large wallets
        } else {
          valid.push(result.address);
        }
      });
    }

    return { valid, filtered, largeWallets };
  }

  /**
   * Quick check without dynamic detection
   * Only checks memory, redis, and database
   */
  private async quickCheck(address: string): Promise<SystemWalletDetectionResult> {
    // Check memory
    if (this.memoryCache.has(address)) {
      return this.memoryCache.get(address)!;
    }

    // Check static list
    if (this.isKnownSystemWallet(address)) {
      return {
        address,
        isSystemWallet: true,
        isLargeWallet: false,
        shouldBlock: true,
        shouldLog: false,
        reason: 'Known system wallet',
        method: 'static_list',
        confidence: 1.0,
      };
    }

    // Check redis
    try {
      const cached = await this.redis.get(this.buildCacheKey(address));
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      // Ignore cache errors
    }

    // Check database
    try {
      const wallet = await this.databaseService.getWallet(address);
      if (wallet?.classification === WALLET_CLASSIFICATIONS.INVALID) {
        return {
          address,
          isSystemWallet: true,
          isLargeWallet: false,
          shouldBlock: true,
          shouldLog: false,
          reason: 'Database: INVALID',
          method: 'database',
          confidence: 0.9,
        };
      }
      if (wallet?.classification === WALLET_CLASSIFICATIONS.LARGE) {
        return {
          address,
          isSystemWallet: false,
          isLargeWallet: true,
          shouldBlock: false,
          shouldLog: true,
          reason: 'Database: LARGE',
          method: 'database',
          confidence: 0.8,
        };
      }
    } catch (error) {
      // Ignore DB errors
    }

    // Not found - assume valid
    return {
      address,
      isSystemWallet: false,
      isLargeWallet: false,
      shouldBlock: false,
      shouldLog: false,
      reason: 'No detection data, processing normally',
      method: 'none',
      confidence: 0.0,
    };
  }

  /**
   * Get token count for a wallet via RPC
   */
  private async getTokenCount(address: string): Promise<number> {
    try {
      const result = await this.heliusClient.getTokenAccountsByOwner(
        address,
        undefined, // All tokens
        SPL_TOKEN_PROGRAM_ID,
        undefined, // Default commitment
        'base64' // Lightweight - we only need count
      );
      return result.value.length;
    } catch (error) {
      this.logger.warn(`Failed to get token count for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Classify wallet based on token count
   */
  private classifyByTokenCount(address: string, tokenCount: number): SystemWalletDetectionResult {
    const { CERTAIN_SYSTEM_THRESHOLD, GRAY_ZONE_THRESHOLD } = SYSTEM_WALLET_DETECTION_CONFIG;

    if (tokenCount >= CERTAIN_SYSTEM_THRESHOLD) {
      // Definitely a system wallet
      return {
        address,
        isSystemWallet: true,
        isLargeWallet: false,
        shouldBlock: true,
        shouldLog: true,
        tokenCount,
        reason: `${tokenCount.toLocaleString()} tokens (threshold: ${CERTAIN_SYSTEM_THRESHOLD.toLocaleString()})`,
        method: 'token_count_dynamic',
        confidence: 0.95,
      };
    } else if (tokenCount >= GRAY_ZONE_THRESHOLD) {
      // Large wallet - process but monitor
      return {
        address,
        isSystemWallet: false,
        isLargeWallet: true,
        shouldBlock: false,
        shouldLog: true,
        tokenCount,
        reason: `${tokenCount.toLocaleString()} tokens (gray zone: ${GRAY_ZONE_THRESHOLD.toLocaleString()}-${CERTAIN_SYSTEM_THRESHOLD.toLocaleString()})`,
        method: 'token_count_dynamic',
        confidence: 0.7,
      };
    } else {
      // Normal wallet
      return {
        address,
        isSystemWallet: false,
        isLargeWallet: false,
        shouldBlock: false,
        shouldLog: false,
        tokenCount,
        reason: `Normal wallet (${tokenCount.toLocaleString()} tokens)`,
        method: 'token_count_dynamic',
        confidence: 0.9,
      };
    }
  }

  /**
   * Auto-tag wallet in database
   */
  private async tagWallet(result: SystemWalletDetectionResult): Promise<void> {
    try {
      const classification = result.isSystemWallet
        ? WALLET_CLASSIFICATIONS.INVALID
        : WALLET_CLASSIFICATIONS.LARGE;

      await this.databaseService.updateWalletClassification(result.address, {
        classification,
        classificationConfidence: result.confidence,
        classificationMethod: result.method,
        classificationUpdatedAt: new Date(),
      });

      const emoji = result.isSystemWallet ? '🚫' : '⚠️';
      this.logger.log(`${emoji} Auto-tagged ${result.address} as ${classification} (${result.reason})`);
    } catch (error) {
      this.logger.warn(`Failed to auto-tag ${result.address}:`, error);
    }
  }

  /**
   * Cache detection result in memory + redis
   */
  private cacheResult(result: SystemWalletDetectionResult): void {
    // Memory cache
    if (SYSTEM_WALLET_DETECTION_CONFIG.ENABLE_MEMORY_CACHE) {
      this.memoryCache.set(result.address, result);
    }

    // Redis cache (fire and forget)
    const cacheKey = this.buildCacheKey(result.address);
    const ttlSeconds = SYSTEM_WALLET_DETECTION_CONFIG.REDIS_TTL_DAYS * 24 * 60 * 60;
    this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds).catch(error => {
      this.logger.debug(`Failed to cache detection result for ${result.address}:`, error);
    });
  }

  /**
   * Build Redis cache key
   */
  private buildCacheKey(address: string): string {
    return `${SYSTEM_WALLET_DETECTION_CONFIG.REDIS_CACHE_KEY_PREFIX}${address}`;
  }

  /**
   * Invalidate cached detection for a wallet
   * Forces re-detection on next check
   */
  async invalidateCache(address: string): Promise<void> {
    this.memoryCache.delete(address);
    const cacheKey = this.buildCacheKey(address);
    await this.redis.del(cacheKey);
    this.logger.log(`Invalidated cache for ${address}`);
  }

  /**
   * Get detection stats (for debugging)
   */
  getStats(): { memoryCacheSize: number; knownSystemWallets: number } {
    return {
      memoryCacheSize: this.memoryCache.size,
      knownSystemWallets: this.knownSystemSet.size,
    };
  }
}
