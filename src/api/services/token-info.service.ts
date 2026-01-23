import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../services/database.service';
import { Prisma, TokenInfo } from '@prisma/client';
import { DexscreenerService } from '../services/dexscreener.service';
import { IPriceProvider } from '../../types/price-provider.interface';
import { ITokenInfoService, TokenEnrichmentPlan } from '../../types/token-info-service.interface';
import { OnchainMetadataService, BasicTokenMetadata, SocialLinks } from '../../core/services/onchain-metadata.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { TOKEN_INFO_REFRESH_CONFIG } from '../../config/constants';
import { getErrorMessage } from 'core/utils/error-utils';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

/**
 * TokenInfoService - Unified Token Information & Price Management
 *
 * This service is the single source of truth for:
 * - Live token & SOL prices (cached in Redis, 30s TTL)
 * - Token supply (cached permanently - immutable data)
 * - Token metadata persistence (database)
 * - Token enrichment operations
 *
 * Price fetching is abstracted through IPriceProvider, making it easy
 * to swap data sources (Dexscreener, Bird.io, CoinGecko, etc.)
 */
@Injectable()
export class TokenInfoService implements ITokenInfoService, OnModuleDestroy {
  private readonly logger = new Logger(TokenInfoService.name);
  private redis: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly dexscreenerService: DexscreenerService, // Legacy, for backwards compatibility
    @Inject('IPriceProvider') private readonly priceProvider: IPriceProvider,
    private readonly onchainMetadataService: OnchainMetadataService, // NEW: Onchain metadata enrichment
    private readonly heliusApiClient: HeliusApiClient, // For fetching token supply
    @Inject(REDIS_CLIENT) redisClient: Redis,
  ) {
    this.redis = redisClient;
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
      return parseFloat(cached);
    }

    // Cache miss - fetch from provider
    let price: number;
    try {
      price = await this.priceProvider.fetchSolPrice();
    } catch (err) {
      this.logger.error(`[SOL Price] Provider fetch failed: ${getErrorMessage(err)}`);
      throw err;
    }
    
    // Cache with 30-second TTL
    await this.redis.set(cacheKey, price.toString(), 'EX', 30);
    // this.logger.log(`[SOL Price] Fetched and cached: $${price} (TTL: 30s)`);
    
    return price;
  }

  /**
   * Get SOL price from cache only (no network call).
   * Returns null if not cached or parse fails.
   */
  async getCachedSolPrice(): Promise<number | null> {
    const cacheKey = 'sol_price_usd';
    const cached = await this.redis.get(cacheKey);
    if (!cached) return null;
    const price = parseFloat(cached);
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  /**
   * Get token supply (cached permanently - supply doesn't change for immutable tokens)
   * Token supply is immutable blockchain data, so we cache it indefinitely
   *
   * @param tokenMint The token mint address
   * @returns Promise resolving to token supply (uiAmount), or undefined if not available
   */
  async getTokenSupply(tokenMint: string): Promise<number | undefined> {
    const cacheKey = `token_supply:${tokenMint}`;

    // Try cache first (no TTL - supply is immutable)
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const supply = parseFloat(cached);
      this.logger.debug(`[Token Supply] Cache hit for ${tokenMint}: ${supply}`);
      return supply;
    }

    // Cache miss - fetch from Helius RPC
    this.logger.debug(`[Token Supply] Cache miss for ${tokenMint}, fetching from RPC`);
    try {
      const supplyResult = await this.heliusApiClient.getTokenSupply(tokenMint);
      const supply = supplyResult.value.uiAmount;

      if (supply !== null && supply !== undefined) {
        // Cache WITHOUT TTL (supply is immutable for most tokens)
        await this.redis.set(cacheKey, supply.toString());
        this.logger.log(`[Token Supply] Fetched and cached ${tokenMint}: ${supply} (permanent cache)`);
        return supply;
      }

      this.logger.warn(`[Token Supply] No supply data for ${tokenMint}`);
      return undefined;
    } catch (error) {
      this.logger.error(`[Token Supply] Failed to fetch for ${tokenMint}: ${getErrorMessage(error)}`);
      return undefined;
    }
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
    tokenAddresses = tokenAddresses.filter(isValidSolanaAddress);
    if (tokenAddresses.length === 0) {
      return;
    }
    const plan = await this.getTokenEnrichmentPlan(tokenAddresses);
    if (plan.needsEnrichment.length === 0) {
      return;
    }
    this.logger.debug(`[Background] Enriching ${plan.needsEnrichment.length} tokens`);
    await this.priceProvider.fetchAndSaveTokenInfo(plan.needsEnrichment);
  }

  async getTokenEnrichmentPlan(tokenAddresses: string[]): Promise<TokenEnrichmentPlan> {
    const deduped = [...new Set(tokenAddresses)].filter(isValidSolanaAddress);
    const existingTokens = await this.findMany(deduped);
    return this.buildTokenEnrichmentPlan(deduped, existingTokens);
  }

  private buildTokenEnrichmentPlan(tokenAddresses: string[], existingTokens: TokenInfo[]): TokenEnrichmentPlan {
    const metadataStaleBefore = new Date(Date.now() - TOKEN_INFO_REFRESH_CONFIG.metadataStaleMs);
    const priceStaleBefore = new Date(Date.now() - TOKEN_INFO_REFRESH_CONFIG.priceStaleMs);
    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    const needsEnrichment = new Set<string>();
    const needsOnchainData = new Set<string>();
    const needsPriceData = new Set<string>();
    const newTokens: string[] = [];
    const staleTokens: string[] = [];

    tokenAddresses.forEach(address => {
      const existing = existingTokenMap.get(address);
      if (!existing) {
        newTokens.push(address);
        needsEnrichment.add(address);
        needsOnchainData.add(address);
        needsPriceData.add(address);
        return;
      }

      const hasOnchainData = !!existing.onchainBasicFetchedAt;
      const dexUpdatedAt = existing.dexscreenerUpdatedAt;
      const metadataStale = !dexUpdatedAt || dexUpdatedAt < metadataStaleBefore;
      const priceStale = !existing.priceUsd || !dexUpdatedAt || dexUpdatedAt < priceStaleBefore;
      const isPlaceholder =
        existing.name === 'Unknown Token' &&
        !existing.onchainName &&
        !existing.priceUsd &&
        !existing.marketCapUsd;

      let needsRefresh = false;

      if (!hasOnchainData) {
        needsOnchainData.add(address);
        needsRefresh = true;
      }

      if (isPlaceholder) {
        if (metadataStale) {
          needsPriceData.add(address);
          needsRefresh = true;
        }
      } else if (metadataStale || priceStale) {
        needsPriceData.add(address);
        needsRefresh = true;
      }

      if (needsRefresh) {
        needsEnrichment.add(address);
        staleTokens.push(address);
      }
    });

    this.logger.warn(
      `Token enrichment plan: total=${tokenAddresses.length}, new=${newTokens.length}, stale=${staleTokens.length}, refresh=${needsEnrichment.size}`
    );

    return {
      tokenAddresses,
      existingTokens,
      needsEnrichment: [...needsEnrichment],
      needsOnchainData: [...needsOnchainData],
      needsPriceData: [...needsPriceData],
      newTokens,
      staleTokens,
    };
  }

  async triggerTokenInfoEnrichment(
    tokenAddresses: string[],
    userId: string,
    plan?: TokenEnrichmentPlan,
  ): Promise<void> {
    const startTime = Date.now();

    // Deduplicate input to avoid processing same token multiple times
    tokenAddresses = [...new Set(tokenAddresses)].filter(isValidSolanaAddress);
    if (tokenAddresses.length === 0) {
      return;
    }

    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
    });

    const enrichmentPlan = plan ?? await this.getTokenEnrichmentPlan(tokenAddresses);
    const needsEnrichment = enrichmentPlan.needsEnrichment;
    if (needsEnrichment.length === 0) {
      this.logger.log('All tokens already have recent metadata');
      return;
    }

    // Split enrichment needs: onchain metadata vs price data
    const needsOnchainData = enrichmentPlan.needsOnchainData;
    const needsPriceData = enrichmentPlan.needsPriceData;

    this.logger.log(`Enriching ${needsEnrichment.length} tokens (onchain: ${needsOnchainData.length}, prices: ${needsPriceData.length})`);

    // ═══════════════════════════════════════════════════════════
    // STAGE 1: Helius DAS API (FAST - WAIT FOR THIS)
    // Only fetch onchain data for tokens that don't have it yet
    // ═══════════════════════════════════════════════════════════
    let onchainMetadata: BasicTokenMetadata[] = [];
    if (needsOnchainData.length > 0) {
      try {
        onchainMetadata = await this.onchainMetadataService.fetchBasicMetadataBatch(needsOnchainData);

        if (onchainMetadata.length > 0) {
          await this.saveOnchainBasicMetadata(onchainMetadata);
          // this.logger.log(`DAS Stage complete: ${onchainMetadata.length} tokens enriched with onchain data - FRONTEND CAN NOW SHOW RELIABLE BLOCKCHAIN DATA`);
        }
      } catch (error) {
        this.logger.error(`Stage 1 (DAS) failed: ${getErrorMessage(error)}`);
        // Continue anyway - DexScreener might still work
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STAGE 2: DexScreener (FIRE-AND-FORGET - DON'T WAIT)
    // Fetch fresh prices in background - frontend will show DAS data immediately
    // ═══════════════════════════════════════════════════════════
    if (needsPriceData.length > 0) {
      // Fire-and-forget DexScreener enrichment
      setImmediate(async () => {
        try {
          await this.priceProvider.fetchAndSaveTokenInfo(needsPriceData);
          this.logger.log(`DexScreener Stage complete: ${needsPriceData.length} tokens processed - Frontend can refresh to see updated images`);
        } catch (err) {
          this.logger.error(`Stage 2 (DexScreener) failed: ${getErrorMessage(err)}`);
        }
      });
    }

    // ═══════════════════════════════════════════════════════════
    // STAGE 3: URI Social Links (BACKGROUND - DON'T WAIT)
    // ═══════════════════════════════════════════════════════════
    // Extract URIs from Stage 1 results (no DB query needed!)
    const tokensWithUris = onchainMetadata
      .filter(m => m.metadataUri)
      .map(m => ({ mint: m.mint, uri: m.metadataUri! }));

    if (tokensWithUris.length > 0) {
      this.fetchAndSaveSocialLinks(tokensWithUris)
        .catch(err => {
          this.logger.error(`Stage 3 (Social links) failed: ${getErrorMessage(err)}`);
        });
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Token enrichment INITIATED in ${duration}ms - Frontend has onchain data, DexScreener updating in background`);

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
    const existingTokens = await this.db.findManyTokenInfo(uniqueMetadata.map(m => m.mint));
    const existingSet = new Set(existingTokens.map(t => t.tokenAddress));

    const newTokens = uniqueMetadata
      .filter(m => !existingSet.has(m.mint))
      .map(m => ({
        tokenAddress: m.mint,
        onchainName: m.name,
        onchainSymbol: m.symbol,
        onchainDescription: m.description,
        onchainImageUrl: m.imageUrl,
        onchainCreator: m.creator,
        onchainMetadataUri: m.metadataUri,
      }));

    const existingTokenUpdates = uniqueMetadata
      .filter(m => existingSet.has(m.mint))
      .map(m => ({
        tokenAddress: m.mint,
        onchainName: m.name,
        onchainSymbol: m.symbol,
        onchainDescription: m.description,
        onchainImageUrl: m.imageUrl,
        onchainCreator: m.creator,
        onchainMetadataUri: m.metadataUri,
      }));

    // Use DatabaseService method for batched operation
    await this.db.saveOnchainMetadataBatch(newTokens, existingTokenUpdates);
    this.logger.log(`Batch saved ${newTokens.length} new + ${existingTokenUpdates.length} updated tokens`);
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
      this.db.updateTokenSocialLinks(s.mint, {
        twitter: s.twitter,
        website: s.website,
        telegram: s.telegram,
        discord: s.discord,
        imageUrl: s.imageUrl, // Save image from metadata JSON (fallback for tokens where DAS doesn't provide it)
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
        this.logger.error(`An unknown error occurred during bulk upsert of token info: ${getErrorMessage(error)}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Shared Redis connection managed centrally
    return;
  }
} 
