import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../services/database.service';
import { Prisma } from '@prisma/client';
import { DexscreenerService } from '../services/dexscreener.service';
import { IPriceProvider } from '../../types/price-provider.interface';
import { ITokenInfoService } from '../../types/token-info-service.interface';

/**
 * TokenInfoService - Unified Token Information & Price Management
 * 
 * This service is the single source of truth for:
 * - Live token & SOL prices (cached in Redis, 30s TTL)
 * - Token metadata persistence (database)
 * - Token enrichment operations
 * 
 * Price fetching is abstracted through IPriceProvider, making it easy
 * to swap data sources (Dexscreener, Bird.io, CoinGecko, etc.)
 */
@Injectable()
export class TokenInfoService implements ITokenInfoService {
  private readonly logger = new Logger(TokenInfoService.name);
  private redis: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly dexscreenerService: DexscreenerService, // Legacy, for backwards compatibility
    @Inject('IPriceProvider') private readonly priceProvider: IPriceProvider,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    this.logger.log('TokenInfoService initialized with price caching (30s TTL)');
  }

  /**
   * Get SOL price in USD (cached in Redis with 30s TTL)
   * This is the preferred method for getting SOL price across the application.
   * 
   * @returns Promise resolving to SOL price in USD
   */
  async getSolPrice(): Promise<number> {
    const cacheKey = 'sol_price_usd';
    
    // Try cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const price = parseFloat(cached);
      this.logger.debug(`[SOL Price] Cache hit: $${price}`);
      return price;
    }

    // Cache miss - fetch from provider
    this.logger.log('[SOL Price] Cache miss, fetching from provider');
    const price = await this.priceProvider.fetchSolPrice();
    
    // Cache with 30-second TTL
    await this.redis.set(cacheKey, price.toString(), 'EX', 30);
    this.logger.log(`[SOL Price] Fetched and cached: $${price} (TTL: 30s)`);
    
    return price;
  }

  /**
   * Get token price in USD (cached in Redis with 30s TTL)
   * 
   * @param tokenMint The token mint address
   * @returns Promise resolving to token price in USD, or undefined if not available
   */
  async getTokenPrice(tokenMint: string): Promise<number | undefined> {
    const cacheKey = `token_price:${tokenMint}`;
    
    // Try cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const price = parseFloat(cached);
      this.logger.debug(`[Token Price] Cache hit for ${tokenMint}: $${price}`);
      return price;
    }

    // Cache miss - fetch from provider
    this.logger.debug(`[Token Price] Cache miss for ${tokenMint}, fetching from provider`);
    const prices = await this.priceProvider.fetchTokenPrices([tokenMint]);
    const price = prices.get(tokenMint);
    
    if (price !== undefined) {
      // Cache with 30-second TTL
      await this.redis.set(cacheKey, price.toString(), 'EX', 30);
      this.logger.debug(`[Token Price] Fetched and cached ${tokenMint}: $${price} (TTL: 30s)`);
    }
    
    return price;
  }

  /**
   * Get multiple token prices in USD (cached in Redis with 30s TTL)
   * 
   * @param tokenMints Array of token mint addresses
   * @returns Promise resolving to Map of mint address to price in USD
   */
  async getTokenPrices(tokenMints: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const uncachedMints: string[] = [];

    // Check cache for each mint
    for (const mint of tokenMints) {
      const cacheKey = `token_price:${mint}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        result.set(mint, parseFloat(cached));
      } else {
        uncachedMints.push(mint);
      }
    }

    // Fetch uncached mints from provider
    if (uncachedMints.length > 0) {
      this.logger.debug(`[Token Prices] Cache miss for ${uncachedMints.length}/${tokenMints.length} tokens`);
      const fetchedPrices = await this.priceProvider.fetchTokenPrices(uncachedMints);
      
      // Cache and add to result
      for (const [mint, price] of fetchedPrices.entries()) {
        const cacheKey = `token_price:${mint}`;
        await this.redis.set(cacheKey, price.toString(), 'EX', 30);
        result.set(mint, price);
      }
    } else {
      this.logger.debug(`[Token Prices] All ${tokenMints.length} prices from cache`);
    }

    return result;
  }

  /**
   * Enrich token information in the background (no user activity logging)
   * Used by background workers and processors
   */
  async enrichTokensBackground(tokenAddresses: string[]): Promise<void> {
    if (tokenAddresses.length === 0) {
      return;
    }
    this.logger.debug(`[Background] Enriching ${tokenAddresses.length} tokens`);
    await this.priceProvider.fetchAndSaveTokenInfo(tokenAddresses);
  }

  async triggerTokenInfoEnrichment(
    tokenAddresses: string[],
    userId: string,
  ): Promise<void> {
    const startTime = Date.now();

    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
    });

    const existingTokens = await this.findMany(tokenAddresses);
    // FIXED: Use more reasonable cache expiry - 1 hour for metadata, 5 minutes for prices
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 1000); // 1 hour for metadata
    const fiveMinutesAgo = new Date(Date.now() - 1 * 60 * 1000); // 5 minutes for prices

    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    
    const newTokensToFetch = tokenAddresses.filter(address => {
      const existingToken = existingTokenMap.get(address);
      
      // Skip tokens that are clearly placeholders (Unknown Token with no real data)
      if (existingToken?.name === 'Unknown Token' && !existingToken.priceUsd && !existingToken.marketCapUsd) {
        // Only refresh placeholders if they're older than 1 hour
        return !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < oneHourAgo;
      }
      
      // For tokens with real data, check if metadata is stale (1 hour) or price is stale (5 minutes)
      if (existingToken) {
        const metadataStale = !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < oneHourAgo;
        const priceStale = !existingToken.priceUsd || !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < fiveMinutesAgo;
        
        // Only fetch if metadata is stale OR if we have price data but it's stale
        return metadataStale || (existingToken.priceUsd && priceStale);
      }
      
      // New token - always fetch
      return true;
    });

    // Use provider to fetch and save token info (abstracted, swappable)
    await this.priceProvider.fetchAndSaveTokenInfo(newTokensToFetch);
    
    // Log success status
    const durationMs = Date.now() - startTime;
    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
      newTokensFetched: newTokensToFetch.length,
    }, 'SUCCESS', durationMs);
  }

  async findMany(tokenAddresses: string[]) {
    return this.db.findManyTokenInfo(tokenAddresses);
  }

  /**
   * Finds multiple TokenInfo records but only returns a partial set of fields.
   * This is optimized for the similarity lab's "skeleton" load and does not
   * affect the ITokenInfoService interface.
   */
  async findManyPartial(tokenAddresses: string[]) {
    // This method is not part of the ITokenInfoService interface
    return this.db.findManyTokenInfoPartial(tokenAddresses);
  }

  async upsertMany(data: Prisma.TokenInfoCreateInput[]) {
    if (data.length === 0) {
      return;
    }

    this.logger.log(`Upserting ${data.length} token info records.`);

    try {
      await this.db.upsertManyTokenInfo(data);
      this.logger.log(`Successfully upserted ${data.length} token info records.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Error during bulk upsert of token info:', error.message, error.stack);
      } else {
        this.logger.error('An unknown error occurred during bulk upsert of token info:', error);
      }
    }
  }
} 