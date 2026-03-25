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

    // Layer 1: Redis (hot, no TTL — supply is immutable)
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return parseFloat(cached);
    }

    // Layer 2: TokenInfo DB row (survives restarts, already written during any prior fetch)
    const dbRow = await this.db.findManyTokenInfo([tokenMint]);
    if (dbRow.length > 0 && dbRow[0].totalSupply != null) {
      const supply = dbRow[0].totalSupply;
      // Warm Redis so next call is free
      await this.redis.set(cacheKey, supply.toString());
      return supply;
    }

    // Layer 3: Helius RPC — one call per mint, ever
    this.logger.debug(`[Token Supply] Fetching from RPC for ${tokenMint}`);
    try {
      const supplyResult = await this.heliusApiClient.getTokenSupply(tokenMint);
      const supply = supplyResult.value.uiAmount;

      if (supply !== null && supply !== undefined) {
        // Persist to Redis and DB in parallel — never hits Helius again for this mint
        await Promise.all([
          this.redis.set(cacheKey, supply.toString()),
          this.db.updateTokenSupply(tokenMint, supply),
        ]);
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
    const waitForInflightMints: string[] = [];

    // Check cache and in-flight status for each mint
    for (const mint of tokenMints) {
      const cacheKey = `token_price:${mint}`;
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        result.set(mint, parseFloat(cached));
      } else {
        // Check if another process is already fetching this token
        const inFlight = await this.redis.get(`token:in-flight:${mint}`);
        if (inFlight) {
          waitForInflightMints.push(mint);
        } else {
          uncachedMints.push(mint);
        }
      }
    }

    // Wait briefly for in-flight tokens to complete (max 2 seconds)
    if (waitForInflightMints.length > 0) {
      this.logger.debug(`[Token Prices] Waiting for ${waitForInflightMints.length} in-flight tokens`);
      const maxRetries = 20; // 20 × 100ms = 2 seconds max wait
      for (let i = 0; i < maxRetries; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const stillWaiting: string[] = [];
        for (const mint of waitForInflightMints) {
          const cached = await this.redis.get(`token_price:${mint}`);
          if (cached) {
            result.set(mint, parseFloat(cached));
          } else {
            stillWaiting.push(mint);
          }
        }

        if (stillWaiting.length === 0) break;
        waitForInflightMints.length = 0;
        waitForInflightMints.push(...stillWaiting);
      }

      // If still waiting after timeout, fetch ourselves
      if (waitForInflightMints.length > 0) {
        this.logger.debug(`[Token Prices] Timeout waiting for in-flight, fetching ${waitForInflightMints.length} ourselves`);
        uncachedMints.push(...waitForInflightMints);
      }
    }

    // Fetch uncached mints from provider
    if (uncachedMints.length > 0) {
      this.logger.debug(`[Token Prices] Cache miss for ${uncachedMints.length}/${tokenMints.length} tokens`);

      // Mark as in-flight BEFORE fetching
      const pipeline = this.redis.pipeline();
      for (const mint of uncachedMints) {
        pipeline.setex(`token:in-flight:${mint}`, 30, Date.now().toString());
      }
      await pipeline.exec();

      try {
        const fetchedPrices = await this.priceProvider.fetchTokenPrices(uncachedMints);

        // Cache and add to result
        const cachePipeline = this.redis.pipeline();
        for (const [mint, price] of fetchedPrices.entries()) {
          const cacheKey = `token_price:${mint}`;
          cachePipeline.setex(cacheKey, 30, price.toString());
          result.set(mint, price);
        }
        await cachePipeline.exec();
      } finally {
        // Clear in-flight markers
        await this.clearInFlightMarkers(uncachedMints);
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

    // Mark tokens as in-flight BEFORE fetching
    if (plan.needsEnrichment.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const token of plan.needsEnrichment) {
        pipeline.setex(`token:in-flight:${token}`, 30, Date.now().toString());
      }
      await pipeline.exec();
    }

    try {
      await this.priceProvider.fetchAndSaveTokenInfo(plan.needsEnrichment);
    } finally {
      // 🔥 CLEAR IN-FLIGHT MARKERS: Clean up after background enrichment
      await this.clearInFlightMarkers(plan.needsEnrichment);
    }
  }

  async getTokenEnrichmentPlan(tokenAddresses: string[]): Promise<TokenEnrichmentPlan> {
    const deduped = [...new Set(tokenAddresses)].filter(isValidSolanaAddress);
    const existingTokens = await this.findMany(deduped);
    return await this.buildTokenEnrichmentPlan(deduped, existingTokens);
  }

  private async buildTokenEnrichmentPlan(tokenAddresses: string[], existingTokens: TokenInfo[]): Promise<TokenEnrichmentPlan> {
    const metadataStaleBefore = new Date(Date.now() - TOKEN_INFO_REFRESH_CONFIG.metadataStaleMs);
    const priceStaleBefore = new Date(Date.now() - TOKEN_INFO_REFRESH_CONFIG.priceStaleMs);
    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    const needsEnrichment = new Set<string>();
    const needsOnchainData = new Set<string>();
    const needsPriceData = new Set<string>();
    const newTokens: string[] = [];
    const staleTokens: string[] = [];

    // 🔥 IN-FLIGHT TRACKING: Check which tokens are currently being fetched by other jobs
    const inFlightChecks = await Promise.all(
      tokenAddresses.map(async (address) => {
        const inFlight = await this.redis.get(`token:in-flight:${address}`);
        return { address, inFlight: !!inFlight };
      })
    );
    const inFlightMap = new Map(inFlightChecks.map(({ address, inFlight }) => [address, inFlight]));

    tokenAddresses.forEach(address => {
      const existing = existingTokenMap.get(address);

      // 🔥 Skip tokens that are currently being fetched by another job
      if (inFlightMap.get(address)) {
        this.logger.debug(`Token ${address} is being fetched by another job, skipping`);
        return;
      }

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

    // DON'T mark as in-flight here - let the actual fetch methods handle that
    // This prevents deadlocks when multiple calls check the plan

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
      this.logger.debug('All tokens already have recent metadata');
      return;
    }

    // Split enrichment needs: onchain metadata vs price data
    const needsOnchainData = enrichmentPlan.needsOnchainData;
    const needsPriceData = enrichmentPlan.needsPriceData;

    this.logger.debug(`Enriching ${needsEnrichment.length} tokens (onchain: ${needsOnchainData.length}, prices: ${needsPriceData.length})`);

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
      } finally {
        // 🔥 CLEAR IN-FLIGHT MARKERS: For tokens that only needed onchain data (not price data)
        const onlyOnchainTokens = needsOnchainData.filter(t => !needsPriceData.includes(t));
        if (onlyOnchainTokens.length > 0) {
          await this.clearInFlightMarkers(onlyOnchainTokens);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STAGE 2: DexScreener (AWAIT COMPLETION)
    // Fetch fresh prices and wait for completion to ensure data consistency
    // ═══════════════════════════════════════════════════════════
    if (needsPriceData.length > 0) {
      try {
        // CHANGED: Now waits for DexScreener to complete before returning
        // This ensures downstream code (like P/L calculation) uses fresh prices
        await this.priceProvider.fetchAndSaveTokenInfo(needsPriceData);
        this.logger.debug(`DexScreener Stage complete: ${needsPriceData.length} tokens processed with fresh prices`);
      } catch (err) {
        this.logger.error(`Stage 2 (DexScreener) failed: ${getErrorMessage(err)}`);
      } finally {
        // 🔥 CLEAR IN-FLIGHT MARKERS: Remove Redis keys after enrichment completes
        await this.clearInFlightMarkers(needsPriceData);
      }
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
    this.logger.debug(`Token enrichment INITIATED in ${duration}ms - Frontend has onchain data, DexScreener updating in background`);

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
    this.logger.debug(`Batch saved ${newTokens.length} new + ${existingTokenUpdates.length} updated tokens`);
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

    this.logger.debug(`Upserting ${data.length} token info records.`);

    try {
      await this.db.upsertManyTokenInfo(data);
      this.logger.debug(`Successfully upserted ${data.length} token info records.`);
    } catch (error) {
      this.logger.error(`Error during bulk upsert of token info: ${getErrorMessage(error)}`);
    }
  }

  /**
   * 🔥 Clear in-flight markers for tokens after enrichment completes
   * This allows other jobs to fetch these tokens if they become stale again
   */
  private async clearInFlightMarkers(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();
      for (const token of tokens) {
        pipeline.del(`token:in-flight:${token}`);
      }
      await pipeline.exec();
      this.logger.debug(`Cleared in-flight markers for ${tokens.length} tokens`);
    } catch (error) {
      // Non-critical error - markers will auto-expire via TTL anyway
      this.logger.warn(`Failed to clear in-flight markers: ${getErrorMessage(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Shared Redis connection managed centrally
    return;
  }
} 
