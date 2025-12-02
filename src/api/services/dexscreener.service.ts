import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DexscreenerService as CoreDexscreenerService } from '../../core/services/dexscreener-service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class DexscreenerService {
  private readonly logger = new Logger(DexscreenerService.name);
  private coreDexscreenerService: CoreDexscreenerService;
  private redis: Redis;

  constructor(
    private databaseService: DatabaseService,
    private httpService: HttpService,
  ) {
    this.coreDexscreenerService = new CoreDexscreenerService(this.databaseService, this.httpService);
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    this.logger.log('CoreDexscreenerService instantiated within NestJS DexscreenerService wrapper.');
  }

  async fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void> {
    this.logger.debug(`[NestWrapper] Passing ${tokenAddresses.length} tokens to core service for fetching.`);
    if (tokenAddresses.length === 0) {
      return;
    }
    // Await the core service to ensure completion.
    await this.coreDexscreenerService.fetchAndSaveTokenInfo(tokenAddresses);
  }

  async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    this.logger.debug(`[NestWrapper] Passing ${tokenAddresses.length} tokens to core service for price fetching.`);
    if (tokenAddresses.length === 0) {
      return new Map();
    }
    return this.coreDexscreenerService.getTokenPrices(tokenAddresses);
  }

  async getSolPrice(): Promise<number> {
    this.logger.debug('[NestWrapper] Fetching SOL price from DexScreener');
    return this.coreDexscreenerService.getSolPrice();
  }

  /**
   * Get SOL price with Redis caching (30-second TTL).
   * This is the preferred method to use across the application to reduce Dexscreener API calls.
   */
  async getSolPriceCached(): Promise<number> {
    const cacheKey = 'sol_price_usd';
    
    // Try to get from cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const price = parseFloat(cached);
      this.logger.debug(`[SOL Price] Cache hit: $${price}`);
      return price;
    }

    // Cache miss - fetch fresh price
    this.logger.log('[SOL Price] Cache miss, fetching from DexScreener');
    const price = await this.coreDexscreenerService.getSolPrice();
    
    // Cache with 30-second TTL
    await this.redis.set(cacheKey, price.toString(), 'EX', 30);
    this.logger.log(`[SOL Price] Fetched and cached: $${price} (TTL: 30s)`);
    
    return price;
  }
} 