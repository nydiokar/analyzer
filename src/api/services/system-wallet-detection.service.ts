import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { DatabaseService } from './database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import {
  WALLET_CLASSIFICATIONS,
  SYSTEM_WALLET_DETECTION_CACHE_CONFIG,
  SYSTEM_WALLET_DETECTION_CONFIG,
  SPL_TOKEN_PROGRAM_ID,
} from '../../config/constants';
import {
  KNOWN_WALLETS,
  getKnownWallet,
  isKnownWallet,
  type KnownWalletType,
} from '../../config/known-wallets';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';

export interface SystemWalletDetectionResult {
  address: string;
  shouldLog: boolean;           // Should we log this?
  tokenCount?: number;          // Token count if detected dynamically
  reason: string;               // Human-readable reason
  method: string;               // Detection method
  confidence: number;           // 0.0-1.0 confidence
  knownType?: KnownWalletType;  // Registry type OR dynamic detection (70k+ tokens) → skip analysis
  knownLabel?: string;          // Display label for UI
  isLarge?: boolean;            // 15k-70k tokens → monitor but still analyze
}

export interface FilterResult {
  valid: string[];              // Wallets safe to process
  filtered: Map<string, string>; // Filtered wallets → reason
  filteredDetails: Map<string, SystemWalletDetectionResult>; // Filtered wallets → full detection result
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
 * Unified Classification:
 * - Registry wallets → knownType set → skip analysis (based on service exclusion sets)
 * - 70k+ tokens → knownType='SYSTEM' → skip analysis
 * - 15k-70k tokens → isLarge=true → monitor but analyze normally
 * - <15k tokens → normal wallet → analyze fully
 *
 * All detections are automatically cached and stored in the database.
 */
@Injectable()
export class SystemWalletDetectionService {
  private readonly logger = new Logger(SystemWalletDetectionService.name);
  private readonly memoryCache = new Map<string, { result: SystemWalletDetectionResult; expiresAt: number }>();
  private readonly knownWalletCount: number;

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.knownWalletCount = Object.keys(KNOWN_WALLETS).length;
    this.logger.log(`Initialized with ${this.knownWalletCount} known wallets from registry`);
  }

  /**
   * TIER 1: Fast check - is this a known wallet from the registry?
   * O(1) lookup, no I/O. Returns immediately.
   */
  isKnownSystemWallet(address: string): boolean {
    return isKnownWallet(address);
  }

  /**
   * TIER 2+3: Full detection with caching
   * Checks memory → redis → database → dynamic RPC detection
   *
   * Auto-tags wallets in database and caches results.
   */
  async detectSystemWallet(address: string): Promise<SystemWalletDetectionResult> {
    // Tier 1: Memory cache
    const cachedResult = this.getMemoryCache(address);
    if (cachedResult) {
      return cachedResult;
    }

    // Tier 1.5: Known wallet from registry
    const knownEntry = getKnownWallet(address);
    if (knownEntry) {
      const result: SystemWalletDetectionResult = {
        address,
        shouldLog: true,
        reason: `Known wallet: ${knownEntry.shortLabel} (${knownEntry.type})`,
        method: 'registry',
        confidence: 1.0,
        knownType: knownEntry.type,
        knownLabel: knownEntry.label,
      };

      // Auto-tag registry wallets in database (same as RPC-detected wallets)
      // This ensures DB has knownType/knownLabel for API responses
      if (SYSTEM_WALLET_DETECTION_CONFIG.AUTO_TAG_DATABASE) {
        await this.tagWallet(result);
      }

      this.cacheResult(result);
      return result;
    }

    // Tier 2: Redis cache
    try {
      const cacheKey = this.buildCacheKey(address);
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as SystemWalletDetectionResult;
        this.setMemoryCache(result);
        return result;
      }
    } catch (error) {
      this.logger.debug(`Redis cache lookup failed for ${address}:`, getErrorMessage(error));
    }

    // Tier 3: Database check
    try {
      const wallet = await this.databaseService.getWallet(address);

      // Check if wallet has knownType from registry
      if (wallet?.knownType) {
        const result: SystemWalletDetectionResult = {
          address,
          shouldLog: false, // Already tagged, don't spam logs
          reason: `Database knownType: ${wallet.knownType}`,
          method: wallet.classificationMethod || 'database',
          confidence: wallet.classificationConfidence || 0.9,
          knownType: wallet.knownType as KnownWalletType,
          knownLabel: wallet.knownLabel || undefined,
        };
        this.cacheResult(result);
        return result;
      }

      // Handle legacy INVALID classification (treat as SYSTEM)
      if (wallet?.classification === 'INVALID' || wallet?.classification === WALLET_CLASSIFICATIONS.SYSTEM) {
        const result: SystemWalletDetectionResult = {
          address,
          shouldLog: false, // Already tagged, don't spam logs
          reason: `Database classification: ${wallet.classification}`,
          method: wallet.classificationMethod || 'database',
          confidence: wallet.classificationConfidence || 0.9,
          knownType: 'SYSTEM',
          knownLabel: 'System Account ⚙️',
        };
        this.cacheResult(result);
        return result;
      }

      if (wallet?.classification === WALLET_CLASSIFICATIONS.LARGE) {
        const result: SystemWalletDetectionResult = {
          address,
          shouldLog: true,    // Log for monitoring
          reason: `Large wallet (database classification)`,
          method: wallet.classificationMethod || 'database',
          confidence: wallet.classificationConfidence || 0.8,
          isLarge: true,
        };
        this.cacheResult(result);
        return result;
      }
    } catch (error) {
      this.logger.debug(`Database lookup failed for ${address}:`, getErrorMessage(error));
    }

    // Tier 4: Dynamic detection via RPC (token count)
    try {
      const tokenCount = await this.getTokenCount(address);
      const result = this.classifyByTokenCount(address, tokenCount);

      // Auto-tag in database if configured
      if (SYSTEM_WALLET_DETECTION_CONFIG.AUTO_TAG_DATABASE && (result.knownType || result.isLarge)) {
        await this.tagWallet(result);
      }

      // Cache the result
      this.cacheResult(result);

      return result;
    } catch (error) {
      this.logger.warn(`Failed to detect system wallet ${address}:`, getErrorMessage(error));
      // Fail open - assume it's NOT a system wallet
      return {
        address,
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
      return { valid: [], filtered: new Map(), filteredDetails: new Map(), largeWallets: [] };
    }

    const valid: string[] = [];
    const filtered = new Map<string, string>();
    const filteredDetails = new Map<string, SystemWalletDetectionResult>();
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
        // ✅ ALWAYS store detection results (for passing to child jobs to avoid re-detection)
        filteredDetails.set(result.address, result);

        if (result.knownType) {
          // Wallet has knownType → skip based on service exclusion sets
          filtered.set(result.address, result.reason);
        } else if (result.isLarge) {
          // Large wallet (15k-70k tokens) → monitor but analyze
          largeWallets.push(result.address);
          valid.push(result.address);
        } else {
          // Normal wallet → analyze fully
          valid.push(result.address);
        }
      });
    }

    return { valid, filtered, filteredDetails, largeWallets };
  }

  /**
   * Quick check without dynamic detection
   * Only checks memory, redis, and database
   */
  private async quickCheck(address: string): Promise<SystemWalletDetectionResult> {
    // Check memory
    const cachedResult = this.getMemoryCache(address);
    if (cachedResult) {
      return cachedResult;
    }

    // Check registry
    const knownEntry = getKnownWallet(address);
    if (knownEntry) {
      return {
        address,
        shouldLog: false,
        reason: `Known wallet: ${knownEntry.shortLabel}`,
        method: 'registry',
        confidence: 1.0,
        knownType: knownEntry.type,
        knownLabel: knownEntry.label,
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

      // Check knownType from database
      if (wallet?.knownType) {
        return {
          address,
          shouldLog: false,
          reason: `Database knownType: ${wallet.knownType}`,
          method: 'database',
          confidence: 0.9,
          knownType: wallet.knownType as KnownWalletType,
          knownLabel: wallet.knownLabel || undefined,
        };
      }

      // Handle legacy INVALID or SYSTEM classification
      if (wallet?.classification === 'INVALID' || wallet?.classification === WALLET_CLASSIFICATIONS.SYSTEM) {
        return {
          address,
          shouldLog: false,
          reason: `Database: ${wallet.classification}`,
          method: 'database',
          confidence: 0.9,
          knownType: 'SYSTEM',
          knownLabel: 'System Account ⚙️',
        };
      }

      if (wallet?.classification === WALLET_CLASSIFICATIONS.LARGE) {
        return {
          address,
          shouldLog: true,
          reason: 'Database: LARGE',
          method: 'database',
          confidence: 0.8,
          isLarge: true,
        };
      }
    } catch (error) {
      // Ignore DB errors
    }

    // Not found - assume valid
    return {
      address,
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
      // Count-only path with early exit to avoid pulling full token account payloads.
      const { CERTAIN_SYSTEM_THRESHOLD } = SYSTEM_WALLET_DETECTION_CONFIG;
      const result = await this.heliusClient.getTokenAccountsByOwnerCount(
        address,
        SPL_TOKEN_PROGRAM_ID,
        undefined, // Default commitment
        CERTAIN_SYSTEM_THRESHOLD
      );
      return result.count;
    } catch (error) {
      this.logger.warn(`Failed to get token count for ${address}:`, getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Register a system wallet classification discovered by another heuristic
   * (e.g., program-owned LP/Protocol detection from top holders).
   * This persists to DB + cache so other flows can skip it consistently.
   */
  async registerExternalKnownWallet(
    address: string,
    knownType: KnownWalletType,
    knownLabel: string | undefined,
    reason: string,
    method: string = 'external_heuristic'
  ): Promise<SystemWalletDetectionResult> {
    const result: SystemWalletDetectionResult = {
      address,
      shouldLog: false,
      reason,
      method,
      confidence: 0.9,
      knownType,
      knownLabel,
    };

    if (SYSTEM_WALLET_DETECTION_CONFIG.AUTO_TAG_DATABASE) {
      await this.tagWallet(result);
    }
    this.cacheResult(result);
    return result;
  }

  /**
   * Classify wallet based on token count
   */
  private classifyByTokenCount(address: string, tokenCount: number): SystemWalletDetectionResult {
    const { CERTAIN_SYSTEM_THRESHOLD, GRAY_ZONE_THRESHOLD } = SYSTEM_WALLET_DETECTION_CONFIG;

    if (tokenCount >= CERTAIN_SYSTEM_THRESHOLD) {
      // 70k+ tokens → auto-tag as SYSTEM (skip analysis)
      return {
        address,
        shouldLog: true,
        tokenCount,
        reason: `${tokenCount.toLocaleString()} tokens (threshold: ${CERTAIN_SYSTEM_THRESHOLD.toLocaleString()})`,
        method: 'token_count_dynamic',
        confidence: 0.95,
        knownType: 'SYSTEM',
        knownLabel: 'System Account ⚙️',
      };
    } else if (tokenCount >= GRAY_ZONE_THRESHOLD) {
      // 15k-70k tokens → mark as LARGE (monitor but analyze)
      return {
        address,
        shouldLog: true,
        tokenCount,
        reason: `${tokenCount.toLocaleString()} tokens (gray zone: ${GRAY_ZONE_THRESHOLD.toLocaleString()}-${CERTAIN_SYSTEM_THRESHOLD.toLocaleString()})`,
        method: 'token_count_dynamic',
        confidence: 0.7,
        isLarge: true,
      };
    } else {
      // Normal wallet
      return {
        address,
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
      const classification = result.knownType
        ? WALLET_CLASSIFICATIONS.SYSTEM
        : WALLET_CLASSIFICATIONS.LARGE;

      await this.databaseService.updateWalletClassification(result.address, {
        classification,
        classificationConfidence: result.confidence,
        classificationMethod: result.method,
        classificationUpdatedAt: new Date(),
        knownType: result.knownType,
        knownLabel: result.knownLabel,
      });

      const emoji = result.knownType ? '🚫' : '⚠️';
      this.logger.log(`${emoji} Auto-tagged ${result.address} as ${classification} (${result.reason})`);
    } catch (error) {
      this.logger.warn(`Failed to auto-tag ${result.address}:`, getErrorMessage(error));
    }
  }

  /**
   * Cache detection result in memory + redis
   */
  private cacheResult(result: SystemWalletDetectionResult): void {
    // Memory cache
    if (SYSTEM_WALLET_DETECTION_CONFIG.ENABLE_MEMORY_CACHE) {
      this.setMemoryCache(result);
    }

    // Redis cache (fire and forget)
    const cacheKey = this.buildCacheKey(result.address);
    const ttlSeconds = SYSTEM_WALLET_DETECTION_CONFIG.REDIS_TTL_DAYS * 24 * 60 * 60;
    this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds).catch(error => {
      this.logger.debug(`Failed to cache detection result for ${result.address}:`, getErrorMessage(error));
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
  getStats(): { memoryCacheSize: number; knownWalletsInRegistry: number } {
    return {
      memoryCacheSize: this.memoryCache.size,
      knownWalletsInRegistry: this.knownWalletCount,
    };
  }

  private getMemoryCache(address: string): SystemWalletDetectionResult | null {
    if (!SYSTEM_WALLET_DETECTION_CONFIG.ENABLE_MEMORY_CACHE) {
      return null;
    }

    const entry = this.memoryCache.get(address);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(address);
      return null;
    }

    // Touch recency for simple LRU eviction using Map insertion order.
    this.memoryCache.delete(address);
    this.memoryCache.set(address, entry);
    return entry.result;
  }

  private setMemoryCache(result: SystemWalletDetectionResult): void {
    const expiresAt = Date.now() + SYSTEM_WALLET_DETECTION_CACHE_CONFIG.MEMORY_TTL_MS;
    this.memoryCache.delete(result.address);
    this.memoryCache.set(result.address, { result, expiresAt });

    while (this.memoryCache.size > SYSTEM_WALLET_DETECTION_CACHE_CONFIG.MEMORY_MAX_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.memoryCache.delete(oldestKey);
    }
  }
}
