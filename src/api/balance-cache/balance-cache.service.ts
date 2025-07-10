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