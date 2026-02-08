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
    const slotKey = `balance:slot:${walletAddress}`;
    
    // Try to get from cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for wallet ${walletAddress}`);
      const cachedBalance = JSON.parse(cached) as WalletBalance | null;
      const cachedSlotRaw = await this.redis.get(slotKey);
      const cachedSlot = cachedSlotRaw ? Number(cachedSlotRaw) : undefined;

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
          if (slotByAddress[walletAddress]) {
            await this.redis.set(slotKey, String(slotByAddress[walletAddress]), 'EX', 30);
          }

          await this.redis.set(cacheKey, JSON.stringify(merged), 'EX', 30);
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
      if (slotByAddress[walletAddress]) {
        await this.redis.set(slotKey, String(slotByAddress[walletAddress]), 'EX', ttlSeconds);
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

    const cacheKeys = walletAddresses.map(addr => `balance:${addr}`);
    const slotKeys = walletAddresses.map(addr => `balance:slot:${addr}`);
    const cachedResults = await this.redis.mget(cacheKeys);
    const cachedSlots = await this.redis.mget(slotKeys);
    
    const balances: Record<string, WalletBalance | null> = {};
    const missedAddresses: string[] = [];
    const incrementalAddresses: string[] = [];
    const incrementalSlots: Record<string, number> = {};

    cachedResults.forEach((cached, index) => {
      const address = walletAddresses[index];
      if (cached) {
        balances[address] = JSON.parse(cached);
        const slotRaw = cachedSlots[index];
        const slot = slotRaw ? Number(slotRaw) : undefined;
        if (balances[address] && Number.isFinite(slot)) {
          incrementalAddresses.push(address);
          incrementalSlots[address] = slot as number;
        } else if (!balances[address]) {
          missedAddresses.push(address);
        }
      } else {
        missedAddresses.push(address);
      }
    });

    this.logger.debug(`Cache hit for ${walletAddresses.length - missedAddresses.length} wallets. Missed: ${missedAddresses.length}`);

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
          if (slotByAddress[address]) {
            const ttlSeconds = this.getTtlSeconds(balances[address] || null);
            cachePipeline.set(`balance:slot:${address}`, String(slotByAddress[address]), 'EX', ttlSeconds);
          }
        }
        await cachePipeline.exec();
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
        
        for (const address of missedAddresses) {
          const fetchedBalance = fetchedBalancesMap.get(address) || null;
          balances[address] = fetchedBalance;
          const ttlSeconds = this.getTtlSeconds(fetchedBalance);
          cachePipeline.set(`balance:${address}`, JSON.stringify(fetchedBalance), 'EX', ttlSeconds);
          if (slotByAddress[address]) {
            cachePipeline.set(`balance:slot:${address}`, String(slotByAddress[address]), 'EX', ttlSeconds);
          }
        }
        
        await cachePipeline.exec();
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
   * Clear cache for a specific wallet
   */
  async clearCache(walletAddress: string): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
    const slotKey = `balance:slot:${walletAddress}`;
    await this.redis.del(cacheKey);
    await this.redis.del(slotKey);
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
