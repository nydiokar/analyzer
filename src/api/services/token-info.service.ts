import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../services/database.service';
import { Prisma } from '@prisma/client';
import { DexscreenerService } from '../services/dexscreener.service';
import { IPriceProvider } from '../../types/price-provider.interface';
import { ITokenInfoService } from '../../types/token-info-service.interface';
import { OnchainMetadataService, BasicTokenMetadata, SocialLinks } from '../../core/services/onchain-metadata.service';
import { prisma } from '../../core/services/database-service';

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
    private readonly onchainMetadataService: OnchainMetadataService, // NEW: Onchain metadata enrichment
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    this.logger.log('TokenInfoService initialized with price caching (30s TTL) and onchain metadata enrichment');
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

    // Deduplicate input to avoid processing same token multiple times
    tokenAddresses = [...new Set(tokenAddresses)];

    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
    });

    const existingTokens = await this.findMany(tokenAddresses);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour for metadata staleness
    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));

    // Determine which tokens need enrichment
    const needsEnrichment = tokenAddresses.filter(address => {
      const existing = existingTokenMap.get(address);

      // If no data at all, needs enrichment
      if (!existing) return true;

      // If "Unknown Token" with no onchain data, needs enrichment
      if (existing.name === 'Unknown Token' && !existing.onchainName) {
        return true;
      }

      // If stale data (both dex and onchain old), needs refresh
      const dexStale = !existing.dexscreenerUpdatedAt || existing.dexscreenerUpdatedAt < oneHourAgo;
      const onchainStale = !existing.onchainBasicFetchedAt || existing.onchainBasicFetchedAt < oneHourAgo;

      return dexStale && onchainStale;
    });

    if (needsEnrichment.length === 0) {
      this.logger.log('All tokens already have recent metadata');
      return;
    }

    this.logger.log(`Enriching ${needsEnrichment.length} tokens with 3-stage enrichment (onchain-first)`);

    // ═══════════════════════════════════════════════════════════
    // STAGE 1: Helius DAS API (FAST - WAIT FOR THIS)
    // ═══════════════════════════════════════════════════════════
    let onchainMetadata: BasicTokenMetadata[] = [];
    try {
      onchainMetadata = await this.onchainMetadataService.fetchBasicMetadataBatch(needsEnrichment);

      if (onchainMetadata.length > 0) {
        await this.saveOnchainBasicMetadata(onchainMetadata);
        this.logger.log(`✅ Stage 1: Saved basic metadata for ${onchainMetadata.length} tokens`);
      }
    } catch (error) {
      this.logger.error('Stage 1 (DAS) failed:', error);
      // Continue anyway - DexScreener might still work
    }

    // ═══════════════════════════════════════════════════════════
    // STAGE 2: DexScreener (PARALLEL - DON'T WAIT)
    // ═══════════════════════════════════════════════════════════
    this.priceProvider
      .fetchAndSaveTokenInfo(needsEnrichment)
      .then(() => {
        this.logger.log(`✅ Stage 2: DexScreener enrichment completed`);
      })
      .catch(err => {
        this.logger.error('Stage 2 (DexScreener) failed:', err);
      });

    // ═══════════════════════════════════════════════════════════
    // STAGE 3: URI Social Links (BACKGROUND - DON'T WAIT)
    // ═══════════════════════════════════════════════════════════
    // Extract URIs from Stage 1 results (no DB query needed!)
    const tokensWithUris = onchainMetadata
      .filter(m => m.metadataUri)
      .map(m => ({ mint: m.mint, uri: m.metadataUri! }));

    if (tokensWithUris.length > 0) {
      this.fetchAndSaveSocialLinks(tokensWithUris)
        .then(() => {
          this.logger.log(`✅ Stage 3: Social links fetched for ${tokensWithUris.length} tokens`);
        })
        .catch(err => {
          this.logger.error('Stage 3 (Social links) failed:', err);
        });
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Token enrichment triggered in ${duration}ms (DAS completed, DexScreener and socials in background)`);

    // Log success status
    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
      needsEnrichment: needsEnrichment.length,
      onchainMetadataFetched: onchainMetadata.length,
    }, 'SUCCESS', duration);
  }

  /**
   * Save basic onchain metadata to database
   * Uses batched operations to avoid N+1 queries
   */
  private async saveOnchainBasicMetadata(metadata: BasicTokenMetadata[]): Promise<void> {
    if (metadata.length === 0) return;

    // Deduplicate by mint address
    const uniqueMetadata = Array.from(
      new Map(metadata.map(m => [m.mint, m])).values()
    );

    // Separate into new vs existing tokens (1 query for all)
    const existingAddresses = await prisma.tokenInfo.findMany({
      where: { tokenAddress: { in: uniqueMetadata.map(m => m.mint) } },
      select: { tokenAddress: true },
    });

    const existingSet = new Set(existingAddresses.map(t => t.tokenAddress));
    const newTokens = uniqueMetadata.filter(m => !existingSet.has(m.mint));
    const existingTokens = uniqueMetadata.filter(m => existingSet.has(m.mint));

    // Use transaction for atomic updates (1 transaction instead of N queries)
    const operations = [];

    // Bulk create new tokens
    if (newTokens.length > 0) {
      operations.push(
        prisma.tokenInfo.createMany({
          data: newTokens.map(m => ({
            tokenAddress: m.mint,
            onchainName: m.name,
            onchainSymbol: m.symbol,
            onchainDescription: m.description,
            onchainImageUrl: m.imageUrl,
            onchainCreator: m.creator,
            onchainMetadataUri: m.metadataUri,
            onchainBasicFetchedAt: new Date(),
            metadataSource: 'onchain',
          })),
          skipDuplicates: true,
        })
      );
    }

    // Update existing tokens (batched in transaction)
    operations.push(
      ...existingTokens.map(m =>
        prisma.tokenInfo.update({
          where: { tokenAddress: m.mint },
          data: {
            onchainName: m.name,
            onchainSymbol: m.symbol,
            onchainDescription: m.description,
            onchainImageUrl: m.imageUrl,
            onchainCreator: m.creator,
            onchainMetadataUri: m.metadataUri,
            onchainBasicFetchedAt: new Date(),
            // Keep existing metadataSource if already 'hybrid'
          },
        })
      )
    );

    await prisma.$transaction(operations);
    this.logger.log(`Batch saved ${newTokens.length} new + ${existingTokens.length} updated tokens`);
  }

  /**
   * Fetch and save social links from metadata URIs
   * Uses batched operations to avoid N+1 queries
   */
  private async fetchAndSaveSocialLinks(
    tokens: Array<{ mint: string; uri: string }>
  ): Promise<number> {
    const socialLinks = await this.onchainMetadataService.fetchSocialLinksBatch(tokens);

    if (socialLinks.length === 0) return 0;

    // Deduplicate
    const uniqueLinks = Array.from(
      new Map(socialLinks.map(s => [s.mint, s])).values()
    );

    // Batch update - use Promise.allSettled to handle individual failures gracefully
    const updatePromises = uniqueLinks.map(s =>
      prisma.tokenInfo.update({
        where: { tokenAddress: s.mint },
        data: {
          onchainTwitterUrl: s.twitter,
          onchainWebsiteUrl: s.website,
          onchainTelegramUrl: s.telegram,
          onchainDiscordUrl: s.discord,
          onchainSocialsFetchedAt: new Date(),
        },
      })
    );

    // Execute all updates, handle failures individually
    const results = await Promise.allSettled(updatePromises);

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;

    if (failureCount > 0) {
      this.logger.debug(`Social links: ${successCount} succeeded, ${failureCount} failed (tokens might not exist)`);
    }

    return successCount;
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