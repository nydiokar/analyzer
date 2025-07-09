import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from './database-service';

@Injectable()
export class BalanceCacheService {
  private readonly logger = new Logger(BalanceCacheService.name);
  private redis: Redis;

  constructor(
    private readonly databaseService: DatabaseService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
  }

  /**
   * Get balances for a wallet, using Redis cache or database if needed
   * This is a simplified version for now
   */
  async getBalances(walletAddress: string): Promise<any> {
    const cacheKey = `balance:${walletAddress}`;
    
    // Try to get from cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for wallet ${walletAddress}`);
      return JSON.parse(cached);
    }

    // Not in cache, get from database
    this.logger.debug(`Cache miss for wallet ${walletAddress}, fetching from database`);
    const walletData = await this.databaseService.getWallet(walletAddress);
    
    if (!walletData) {
      throw new Error(`Wallet ${walletAddress} not found`);
    }

    // For now, create a simple balance structure
    // This will be enhanced when we integrate with the actual balance fetching
    const balances = {
      walletAddress,
      tokenBalances: [], // Will be populated by actual balance fetching
      lastSync: walletData.lastSuccessfulFetchTimestamp,
      syncStatus: 'cached',
      metadata: {
        source: 'database',
        timestamp: Date.now()
      }
    };

    // Cache the result with 30 second TTL
    await this.redis.set(cacheKey, JSON.stringify(balances), 'EX', 30);
    
    return balances;
  }

  /**
   * Cache balance data for a wallet
   */
  async cacheBalances(walletAddress: string, balances: any): Promise<void> {
    const cacheKey = `balance:${walletAddress}`;
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