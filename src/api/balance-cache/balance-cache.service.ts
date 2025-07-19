import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../database/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { WalletBalance } from '../../types/wallet';

@Injectable()
export class BalanceCacheService {
  private readonly logger = new Logger(BalanceCacheService.name);
  private redis: Redis;
  private walletBalanceService: WalletBalanceService;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusApiClient: HeliusApiClient,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    // The service is manually instantiated here, following the existing pattern in the codebase.
    this.walletBalanceService = new WalletBalanceService(this.heliusApiClient);
  }

  /**
   * Get balances for a wallet, using Redis cache or fetching from Helius if needed.
   * This is the corrected, authoritative method for getting balances.
   */
  async getBalances(walletAddress: string): Promise<WalletBalance | null> {
    const cacheKey = `balance:${walletAddress}`;
    
    // Try to get from cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for wallet ${walletAddress}`);
      return JSON.parse(cached);
    }

    // Not in cache, fetch from the source of truth (Helius)
    this.logger.debug(`Cache miss for wallet ${walletAddress}, fetching from Helius via WalletBalanceService.`);
    
    try {
      const balancesMap = await this.walletBalanceService.fetchWalletBalancesRaw([walletAddress]);
      const balances = balancesMap.get(walletAddress);

      if (!balances) {
        this.logger.warn(`Failed to fetch balances for ${walletAddress} from Helius.`);
        // Cache a null/empty indicator to prevent re-fetching constantly on failures for a short period
        await this.redis.set(cacheKey, JSON.stringify(null), 'EX', 60); 
        return null;
      }

      // Cache the fresh result with a 30-second TTL
      await this.redis.set(cacheKey, JSON.stringify(balances), 'EX', 30);
    
      return balances;
    } catch (error) {
      this.logger.error(`Error fetching balances for ${walletAddress} in BalanceCacheService:`, error);
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
    const cachedResults = await this.redis.mget(cacheKeys);
    
    const balances: Record<string, WalletBalance | null> = {};
    const missedAddresses: string[] = [];

    cachedResults.forEach((cached, index) => {
      const address = walletAddresses[index];
      if (cached) {
        balances[address] = JSON.parse(cached);
      } else {
        missedAddresses.push(address);
      }
    });

    this.logger.debug(`Cache hit for ${walletAddresses.length - missedAddresses.length} wallets. Missed: ${missedAddresses.length}`);

    if (missedAddresses.length > 0) {
      try {
        const fetchedBalancesMap = await this.walletBalanceService.fetchWalletBalancesRaw(missedAddresses, undefined, preFetchedTokenCounts, preFetchedTokenData);
        
        const cachePipeline = this.redis.pipeline();
        
        for (const address of missedAddresses) {
          const fetchedBalance = fetchedBalancesMap.get(address) || null;
          balances[address] = fetchedBalance;
          cachePipeline.set(`balance:${address}`, JSON.stringify(fetchedBalance), 'EX', 30);
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
   */
  async cacheBalances(walletAddress: string, balances: any): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
    // Use a consistent 30-second TTL for fresh data.
    await this.redis.set(cacheKey, JSON.stringify(balances), 'EX', 30);
    this.logger.debug(`Cached balances for wallet ${walletAddress}`);
  }

  /**
   * Clear cache for a specific wallet
   */
  async clearCache(walletAddress: string): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
    await this.redis.del(cacheKey);
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
} 