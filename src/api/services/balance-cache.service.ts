import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../services/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { WalletBalance } from '../../types/wallet';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';
import { BALANCE_CACHE_CONFIG } from '../../config/constants';


@Injectable()
export class BalanceCacheService {
  private readonly logger = new Logger(BalanceCacheService.name);
  private redis: Redis;
  private walletBalanceService: WalletBalanceService;
  private readonly MIN_UI_BALANCE = BALANCE_CACHE_CONFIG.MIN_UI_BALANCE;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusApiClient: HeliusApiClient,
    @Inject(REDIS_CLIENT) redisClient: Redis,
  ) {
    this.redis = redisClient;
    // The service is manually instantiated here, following the existing pattern in the codebase.
    this.walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService);
  }

  /**
   * Get balances for a wallet, using Redis cache or fetching from Helius if needed.
   * This is the corrected, authoritative method for getting balances.
   */
  async getBalances(walletAddress: string): Promise<WalletBalance | null> {
    const cacheKey = `balance:${walletAddress}`;
    const filterKey = 'program:spl-token'; // Standard SPL token program filter

    // Try to get from cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for wallet ${walletAddress}`);
      const cachedBalance = JSON.parse(cached) as WalletBalance | null;

      // Get watermark from database (persistent storage)
      const cachedSlot = await this.databaseService.getTokenAccountWatermark(walletAddress, filterKey);

      if (cachedBalance && Number.isFinite(cachedSlot)) {
        try {
          const slotByAddress: Record<string, number> = {};
          const deltaMap = await this.walletBalanceService.fetchWalletBalancesRaw(
            [walletAddress],
            undefined,
            undefined,
            undefined,
            {
              changedSinceSlotByAddress: { [walletAddress]: cachedSlot as number },
              includeLowBalances: true,
              slotByAddress,
            }
          );

          const delta = deltaMap.get(walletAddress);
          const merged = delta ? this.mergeBalances(cachedBalance, delta) : cachedBalance;
          if (delta) {
            this.logger.debug(
              `Incremental balance update for ${walletAddress}: delta tokens=${delta.tokenBalances.length}, slot=${slotByAddress[walletAddress] || cachedSlot}`
            );
          }

          // Update watermark in database if new slot received
          if (slotByAddress[walletAddress]) {
            await this.databaseService.setTokenAccountWatermark(walletAddress, filterKey, slotByAddress[walletAddress]);
          }

          const ttlSeconds = this.getTtlSeconds(merged);
          await this.redis.set(cacheKey, JSON.stringify(merged), 'EX', ttlSeconds);
          return merged;
        } catch (error) {
          this.logger.warn(`Incremental balance fetch failed for ${walletAddress}, using cached value.`, getErrorMessage(error));
          return cachedBalance;
        }
      }

      return cachedBalance;
    }

    // Not in cache, fetch from the source of truth (Helius)
    this.logger.debug(`Cache miss for wallet ${walletAddress}, fetching from Helius via WalletBalanceService.`);

    try {
      const slotByAddress: Record<string, number> = {};
      const balancesMap = await this.walletBalanceService.fetchWalletBalancesRaw(
        [walletAddress],
        undefined,
        undefined,
        undefined,
        { slotByAddress }
      );
      const balances = balancesMap.get(walletAddress);

      if (!balances) {
        this.logger.warn(`Failed to fetch balances for ${walletAddress} from Helius.`);
        // Cache a null/empty indicator to prevent re-fetching constantly on failures for a short period
        await this.redis.set(cacheKey, JSON.stringify(null), 'EX', 60);
        return null;
      }

      const ttlSeconds = this.getTtlSeconds(balances);
      // Cache the fresh result with an adaptive TTL
      await this.redis.set(cacheKey, JSON.stringify(balances), 'EX', ttlSeconds);

      // Store watermark in database (persistent)
      if (slotByAddress[walletAddress]) {
        await this.databaseService.setTokenAccountWatermark(walletAddress, filterKey, slotByAddress[walletAddress]);
      }

      return balances;
    } catch (error) {
      this.logger.error(`Error fetching balances for ${walletAddress} in BalanceCacheService:`, getErrorMessage(error));
      return null;
    }
  }

  /**
   * Get balances for multiple wallets, efficiently using Redis `mget` and a single backend fetch for misses.
   * @param walletAddresses Array of wallet addresses to fetch balances for
   * @param preFetchedTokenCounts Optional pre-fetched token counts to avoid double RPC calls
   */
  async getManyBalances(walletAddresses: string[], preFetchedTokenCounts?: Record<string, number>, preFetchedTokenData?: Record<string, any[]>): Promise<Record<string, WalletBalance | null>> {
    if (walletAddresses.length === 0) {
      return {};
    }

    const filterKey = 'program:spl-token'; // Standard SPL token program filter
    const cacheKeys = walletAddresses.map(addr => `balance:${addr}`);
    const cachedResults = await this.redis.mget(cacheKeys);

    // Fetch watermarks from database for all addresses (batch query)
    const watermarkPromises = walletAddresses.map(addr =>
      this.databaseService.getTokenAccountWatermark(addr, filterKey)
    );
    const watermarks = await Promise.all(watermarkPromises);

    const balances: Record<string, WalletBalance | null> = {};
    const missedAddresses: string[] = [];
    const incrementalAddresses: string[] = [];
    const incrementalSlots: Record<string, number> = {};

    const now = Date.now();
    const minAgeForRefresh = BALANCE_CACHE_CONFIG.INCREMENTAL_FETCH_MIN_AGE_MS;

    cachedResults.forEach((cached, index) => {
      const address = walletAddresses[index];
      const slot = watermarks[index]; // Get slot from database watermark

      if (cached) {
        const balance = JSON.parse(cached);
        balances[address] = balance;

        // ✅ SMART INCREMENTAL FETCH: Only refresh if cache is older than threshold (default: 30sec)
        // This prevents wasteful API calls for rapid successive requests (holder profiles → similarity)
        // while still keeping data fresh for longer-lived cache entries
        const cacheAge = now - new Date(balance.fetchedAt).getTime();

        if (cacheAge > minAgeForRefresh && Number.isFinite(slot)) {
          // Cache is old enough - do incremental refresh
          incrementalAddresses.push(address);
          incrementalSlots[address] = slot as number;
        }
        // If cache is fresh (< threshold), just return it without incremental fetch
      } else {
        // Redis cache miss - full fetch required since we have no baseline to merge into.
        // Even if a DB watermark exists, changedSinceSlot only returns changed accounts
        // and we need the full balance set to build a valid WalletBalance.
        missedAddresses.push(address);
      }
    });

    const cacheHits = walletAddresses.length - missedAddresses.length;
    this.logger.debug(
      `Cache status: ${cacheHits} hits, ${missedAddresses.length} misses, ${incrementalAddresses.length} incremental refreshes`
    );

    if (incrementalAddresses.length > 0) {
      try {
        const slotByAddress: Record<string, number> = {};
        const deltaMap = await this.walletBalanceService.fetchWalletBalancesRaw(
          incrementalAddresses,
          undefined,
          preFetchedTokenCounts,
          preFetchedTokenData,
          {
            changedSinceSlotByAddress: incrementalSlots,
            includeLowBalances: true,
            slotByAddress,
          }
        );

        const cachePipeline = this.redis.pipeline();
        const watermarkUpdates: Promise<void>[] = [];
        let deltaTokensTotal = 0;

        for (const address of incrementalAddresses) {
          const existing = balances[address];
          const delta = deltaMap.get(address);
          if (existing && delta) {
            deltaTokensTotal += delta.tokenBalances.length;
            const merged = this.mergeBalances(existing, delta);
            balances[address] = merged;
            const ttlSeconds = this.getTtlSeconds(merged);
            cachePipeline.set(`balance:${address}`, JSON.stringify(merged), 'EX', ttlSeconds);
          }

          // Update watermark in database if new slot received
          if (slotByAddress[address]) {
            watermarkUpdates.push(
              this.databaseService.setTokenAccountWatermark(address, filterKey, slotByAddress[address])
            );
          }
        }

        await Promise.all([cachePipeline.exec(), ...watermarkUpdates]);
        this.logger.debug(
          `Incremental balance updates: wallets=${incrementalAddresses.length}, deltaTokens=${deltaTokensTotal}`
        );
      } catch (error) {
        this.logger.warn(`Incremental balance fetch failed for batch: ${getErrorMessage(error)}`);
      }
    }

    if (missedAddresses.length > 0) {
      try {
        const slotByAddress: Record<string, number> = {};
        const fetchedBalancesMap = await this.walletBalanceService.fetchWalletBalancesRaw(
          missedAddresses,
          undefined,
          preFetchedTokenCounts,
          preFetchedTokenData,
          { slotByAddress }
        );
        
        const cachePipeline = this.redis.pipeline();
        const watermarkUpdates: Promise<void>[] = [];

        for (const address of missedAddresses) {
          const fetchedBalance = fetchedBalancesMap.get(address) || null;
          balances[address] = fetchedBalance;
          const ttlSeconds = this.getTtlSeconds(fetchedBalance);
          cachePipeline.set(`balance:${address}`, JSON.stringify(fetchedBalance), 'EX', ttlSeconds);

          // Store watermark in database
          if (slotByAddress[address]) {
            watermarkUpdates.push(
              this.databaseService.setTokenAccountWatermark(address, filterKey, slotByAddress[address])
            );
          }
        }

        await Promise.all([cachePipeline.exec(), ...watermarkUpdates]);
        this.logger.debug(`Fetched and cached ${missedAddresses.length} missing balances.`);

      } catch (error) {
        this.logger.error(`Error fetching batch balances for ${missedAddresses.join(', ')}:`, error);
        // Fill missed addresses with null to indicate failure
        missedAddresses.forEach(addr => balances[addr] = null);
      }
    }

    return balances;
  }

  /**
   * Cache balance data for a wallet.
   * Ensures the TTL is consistent.
   * @param ttlSeconds Optional TTL in seconds (default: 30). Use longer TTL for dashboard analysis chains.
   */
  async cacheBalances(walletAddress: string, balances: any, ttlSeconds?: number): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
    const resolvedTtl = typeof ttlSeconds === 'number' ? ttlSeconds : this.getTtlSeconds(balances);
    await this.redis.set(cacheKey, JSON.stringify(balances), 'EX', resolvedTtl);
    this.logger.debug(`Cached balances for wallet ${walletAddress} (TTL: ${resolvedTtl}s)`);
  }

  /**
   * Clear cache for a specific wallet (both Redis cache and database watermarks)
   */
  async clearCache(walletAddress: string): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
    await this.redis.del(cacheKey);
    // Clear all watermarks for this wallet from database
    await this.databaseService.deleteTokenAccountWatermark(walletAddress);
  }

  /**
   * Clear all balance caches
   */
  async clearAllCaches(): Promise<void> {
    const keys = await this.redis.keys('balance:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  private mergeBalances(existing: WalletBalance, delta: WalletBalance): WalletBalance {
    const byTokenAccount = new Map<string, typeof existing.tokenBalances[number]>();
    existing.tokenBalances.forEach(token => {
      byTokenAccount.set(token.tokenAccountAddress, token);
    });

    delta.tokenBalances.forEach(token => {
      if (token.uiBalance < this.MIN_UI_BALANCE) {
        byTokenAccount.delete(token.tokenAccountAddress);
      } else {
        byTokenAccount.set(token.tokenAccountAddress, token);
      }
    });

    return {
      ...existing,
      solBalance: delta.solBalance ?? existing.solBalance,
      tokenBalances: Array.from(byTokenAccount.values()),
      fetchedAt: delta.fetchedAt ?? existing.fetchedAt,
    };
  }

  private getTtlSeconds(balance: WalletBalance | null): number {
    if (!balance) return BALANCE_CACHE_CONFIG.DEFAULT_TTL_SECONDS;
    const tokenCount = balance.tokenBalances?.length || 0;
    if (tokenCount >= BALANCE_CACHE_CONFIG.WHALE_TOKEN_THRESHOLD) return BALANCE_CACHE_CONFIG.WHALE_TTL_SECONDS;
    if (tokenCount >= BALANCE_CACHE_CONFIG.MEDIUM_TOKEN_THRESHOLD) return BALANCE_CACHE_CONFIG.MEDIUM_TTL_SECONDS;
    return BALANCE_CACHE_CONFIG.DEFAULT_TTL_SECONDS;
  }
}
