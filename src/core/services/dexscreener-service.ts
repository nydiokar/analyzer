import { createLogger } from 'core/utils/logger';
import { DatabaseService } from 'core/services/database-service';
import { Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { METADATA_FETCHING_CONFIG } from '@config/constants';
import { isWellKnownToken, getWellKnownTokenMetadata } from 'core/utils/token-metadata';

const logger = createLogger('DexscreenerService');

// A simple sleep helper function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
};

// Type definition for the expected DexScreener API response for a single pair
interface DexScreenerPair {
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken?: {
    address: string;
    name: string;
    symbol: string;
  };
  info?: {
    imageUrl?: string;
    websites?: { label?: string, url: string }[];
    socials?: { type: string; url: string }[];
  };
  // Market data fields
  marketCap?: number;
  fdv?: number;
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  pairCreatedAt?: number;
  volume?: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  priceUsd?: string;
}

export class DexscreenerService {
    private readonly baseUrl = 'https://api.dexscreener.com/latest';
    private httpService: HttpService;
    private solPriceCache: { price: number; timestamp: number } | null = null;
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

    constructor(
        private readonly databaseService: DatabaseService,
        httpService: HttpService,
    ) {
        this.httpService = httpService;
    }

    async fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void> {
        if (tokenAddresses.length === 0) {
            return;
        }

        // OPTIMIZATION 1: Intelligent pre-filtering to reduce API calls
        const filteredTokens = await this.preFilterTokensForDexScreener(tokenAddresses);
        const skippedCount = tokenAddresses.length - filteredTokens.length;
        
        
        if (skippedCount > 0) {
            logger.info(`Pre-filtered ${skippedCount} tokens likely not in DexScreener (${((skippedCount/tokenAddresses.length)*100).toFixed(1)}% reduction)`);
        }

        if (filteredTokens.length === 0) {
            logger.info('All tokens were pre-filtered as unlikely to be in DexScreener');
            return;
        }

        const chunks = this.chunkArray(filteredTokens, METADATA_FETCHING_CONFIG.dexscreener.chunkSize);

        // OPTIMIZATION 2: Parallel processing with controlled concurrency
        const maxConcurrentRequests = METADATA_FETCHING_CONFIG.dexscreener.maxConcurrentRequests;
        let processedCount = 0;
        let actualApiCalls = 0;
        
        for (let i = 0; i < chunks.length; i += maxConcurrentRequests) {
            // Process multiple chunks in parallel, but respect the concurrency limit
            const chunkBatch = chunks.slice(i, i + maxConcurrentRequests);
            
            const batchPromises = chunkBatch.map(async (chunk, batchIndex) => {
                const actualIndex = i + batchIndex;
                
                // Only log progress every 10 chunks to reduce noise
                if (actualIndex % 10 === 0) {
                    logger.debug(`Processing chunk ${actualIndex + 1}/${chunks.length} with ${chunk.length} tokens...`);
                }
                
                try {
                    actualApiCalls++;
                    const result = await this.fetchTokensFromDexScreener(chunk);
                    return result;
                } catch (error) {
                    logger.error(`❌ Chunk ${actualIndex + 1}/${chunks.length} failed:`, error);
                    return 0; // Return 0 on failure for counting
                }
            });
            
            // Wait for all chunks in this batch to complete
            const batchResults = await Promise.all(batchPromises);
            const batchProcessedCount = batchResults.reduce((sum, result) => sum + result, 0);
            processedCount += batchProcessedCount;
            
            // Log progress summary every batch
            if (i % (maxConcurrentRequests * 5) === 0) { // Every 5 batches
                const progress = ((i + maxConcurrentRequests) / chunks.length * 100).toFixed(1);
                logger.info(`DexScreener progress: ${progress}% (${processedCount}/${tokenAddresses.length} tokens)`);
            }
            
            // Wait between batches (not between individual chunks)
            if (i + maxConcurrentRequests < chunks.length) {
                const waitTime = await this.calculateOptimalWaitTime();
                await this.sleep(waitTime);
            }
        }

        logger.info(`🔍 DexScreener: Final results - ${actualApiCalls} API calls made, ${processedCount} tokens processed out of ${tokenAddresses.length} requested`);
    }

    async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
        if (tokenAddresses.length === 0) {
            return new Map();
        }
        const prices = new Map<string, number>();
        const chunks = this.chunkArray(tokenAddresses, 30);

        for (const chunk of chunks) {
            await this.fetchWithRetry(async () => {
                const url = `${this.baseUrl}/dex/tokens/${chunk.join(',')}`;
                const response = await firstValueFrom(this.httpService.get(url));
                const pairs: DexScreenerPair[] = response.data?.pairs || [];

                for (const pair of pairs) {
                    if (pair.priceUsd && pair.baseToken.address && !prices.has(pair.baseToken.address)) {
                        prices.set(pair.baseToken.address, parseFloat(pair.priceUsd));
                    }
                }
            }, `price data for ${chunk.length} tokens`);
            
            await sleep(1000); // Rate limiting between chunks
        }
        return prices;
    }

    async getSolPrice(): Promise<number> {
        // Check if cached price is still valid
        if (this.solPriceCache && Date.now() - this.solPriceCache.timestamp < this.CACHE_DURATION) {
            logger.debug(`Using cached SOL price: $${this.solPriceCache.price}`);
            return this.solPriceCache.price;
        }

        // Multiple high-volume SOL pairs as backup sources - SOL is too liquid to not have price data
        const solPairSources = [
            {
                name: 'Meteora SOL/USDC DLMM',
                pairId: 'HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR',
                volume: '$13M+' 
            },
            {
                name: 'Raydium SOL/USDC CLMM', 
                pairId: 'CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq',
                volume: '$7M+'
            },
            {
                name: 'Orca SOL/USDC Whirlpool',
                pairId: '4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW', 
                volume: '$5.5M+'
            },
            {
                name: 'Meteora SOL/USDC Large Pool',
                pairId: 'BGm1tav58oGcsQJehL9WXBFXf7D27vZsKefj4xJKD5Y',
                volume: '$12M+'
            }
        ];

        for (const source of solPairSources) {
            try {
                const url = `${this.baseUrl}/dex/pairs/solana/${source.pairId}`;
                const response = await firstValueFrom(this.httpService.get(url));
                const pair = response.data?.pair;
                
                if (pair && pair.priceUsd) {
                    const solPrice = parseFloat(pair.priceUsd);
                    
                    // Sanity check: SOL price should be reasonable ($50-$500 range)
                    if (solPrice >= 50 && solPrice <= 500) {
                        // Cache the price
                        this.solPriceCache = {
                            price: solPrice,
                            timestamp: Date.now()
                        };
                        
                        logger.debug(`Successfully fetched SOL price from ${source.name}: $${solPrice}`);
                        return solPrice;
                    } else {
                        logger.warn(`${source.name} returned unreasonable SOL price: $${solPrice}, trying next source`);
                    }
                } else {
                    logger.warn(`${source.name} returned no price data, trying next source`);
                }
            } catch (error) {
                logger.warn(`Failed to fetch SOL price from ${source.name}: ${error instanceof Error ? error.message : error}, trying next source`);
            }
        }

        // If all sources fail, this is a critical system error
        const errorMsg = 'CRITICAL: All SOL price sources failed - this should never happen for such a liquid asset';
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    private transformPairsToTokenInfo(pairs: DexScreenerPair[], requestedAddresses: string[]): Prisma.TokenInfoCreateInput[] {
        const tokenInfoMap = new Map<string, Prisma.TokenInfoCreateInput>();

        for (const pair of pairs) {
            const tokensToProcess = [pair.baseToken, pair.quoteToken].filter(t => t && t.address);
            
            // Determine which token should receive the pair's metadata (if any)
            const metadataRecipient = this.determineMetadataRecipient(pair.baseToken, pair.quoteToken);

            for (const token of tokensToProcess) {
                if (!token) continue;
                const { address, name, symbol } = token;

                if (requestedAddresses.includes(address) && !tokenInfoMap.has(address)) {
                    const socials = pair.info?.socials;
                    const website = pair.info?.websites?.find(w => w.label?.toLowerCase() === 'website')?.url || pair.info?.websites?.[0]?.url;
                    const twitter = socials?.find(s => s.type === 'twitter')?.url;
                    const telegram = socials?.find(s => s.type === 'telegram')?.url;

                    // Check if this is a well-known token
                    const wellKnownMetadata = getWellKnownTokenMetadata(address);
                    const isWellKnown = !!wellKnownMetadata;
                    const shouldReceiveMetadata = metadataRecipient?.address === address;

                    tokenInfoMap.set(address, {
                        tokenAddress: address,
                        // Use well-known metadata if available, otherwise use DexScreener data
                        name: wellKnownMetadata?.name || name,
                        symbol: wellKnownMetadata?.symbol || symbol,
                        // Only apply pair metadata (image, social links) to the designated recipient
                        // Well-known tokens never receive pair metadata to prevent contamination
                        imageUrl: (!isWellKnown && shouldReceiveMetadata) ? pair.info?.imageUrl : null,
                        websiteUrl: (!isWellKnown && shouldReceiveMetadata) ? website : null,
                        twitterUrl: (!isWellKnown && shouldReceiveMetadata) ? twitter : null,
                        telegramUrl: (!isWellKnown && shouldReceiveMetadata) ? telegram : null,
                        // Market data from DexScreener (always update this for price tracking)
                        marketCapUsd: pair.marketCap,
                        liquidityUsd: pair.liquidity?.usd,
                        pairCreatedAt: pair.pairCreatedAt ? BigInt(pair.pairCreatedAt) : null,
                        fdv: pair.fdv,
                        volume24h: pair.volume?.h24,
                        priceUsd: pair.priceUsd ? pair.priceUsd.toString() : null,
                        dexscreenerUpdatedAt: new Date(),
                    });
                }
            }
        }

        return Array.from(tokenInfoMap.values());
    }

    /**
     * Intelligently determines which token in a pair should receive the pair's metadata
     * to prevent well-known tokens from being contaminated with incorrect metadata.
     * 
     * Rules:
     * 1. If one token is well-known and the other isn't: metadata goes to the unknown token
     * 2. If both tokens are well-known: no metadata assignment (both use their predefined data)
     * 3. If both tokens are unknown: metadata goes to the base token (convention)
     */
    private determineMetadataRecipient(baseToken: any, quoteToken: any): any | null {
        if (!baseToken?.address) return quoteToken;
        if (!quoteToken?.address) return baseToken;

        const baseIsWellKnown = isWellKnownToken(baseToken.address);
        const quoteIsWellKnown = isWellKnownToken(quoteToken.address);

        // Case 1: One well-known, one unknown -> unknown token gets metadata
        if (baseIsWellKnown && !quoteIsWellKnown) {
            return quoteToken;
        }
        
        if (!baseIsWellKnown && quoteIsWellKnown) {
            return baseToken;
        }

        // Case 2: Both well-known -> no metadata assignment (prevent contamination)
        if (baseIsWellKnown && quoteIsWellKnown) {
            return null;
        }

        // Case 3: Both unknown -> base token gets metadata (DexScreener convention)
        return baseToken;
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Calculate optimal wait time based on recent response times and error rates
     */
    private async calculateOptimalWaitTime(): Promise<number> {
        // Start with configured base wait time
        const baseWaitTime = METADATA_FETCHING_CONFIG.dexscreener.baseWaitTimeMs;
        
        // If adaptive rate limiting is disabled, return base wait time
        if (!METADATA_FETCHING_CONFIG.dexscreener.adaptiveRateLimiting) {
            return baseWaitTime;
        }
        
        // TODO: Implement adaptive rate limiting based on:
        // - Recent API response times
        // - Error rates (429 responses)
        // - Success rates
        
        // For now, return the configured base wait time
        return baseWaitTime;
    }

    /**
     * Fetch tokens from DexScreener API for a single chunk
     */
    private async fetchTokensFromDexScreener(chunk: string[]): Promise<number> {
        return await this.fetchWithRetry(async () => {
            const url = `${this.baseUrl}/dex/tokens/${chunk.join(',')}`;
            const response = await firstValueFrom(this.httpService.get(url));
            const pairs: DexScreenerPair[] = response.data?.pairs || [];

            const tokenInfoFromPairs = this.transformPairsToTokenInfo(pairs, chunk);
            
            // 1. Upsert all found tokens
            if (tokenInfoFromPairs.length > 0) {
                await this.databaseService.upsertManyTokenInfo(tokenInfoFromPairs);
                logger.debug(`Saved/updated ${tokenInfoFromPairs.length} token records from API.`);
            }

            // 2. Create placeholders for tokens not found
            const foundAddresses = new Set(tokenInfoFromPairs.map(t => t.tokenAddress));
            const notFoundAddresses = chunk.filter(addr => !foundAddresses.has(addr));

            if (notFoundAddresses.length > 0) {
                logger.debug(`${notFoundAddresses.length} tokens not found via API. Creating placeholders.`);
                
                const placeholderData = notFoundAddresses.map(addr => ({
                    tokenAddress: addr,
                    name: 'Unknown Token',
                    symbol: addr.slice(0, 4) + '...' + addr.slice(-4),
                    dexscreenerUpdatedAt: new Date(),
                }));
                await this.databaseService.upsertManyTokenInfo(placeholderData);
            }
            
            return chunk.length;
        }, `metadata for ${chunk.length} tokens`);
    }

    /**
     * Sleep for the specified number of milliseconds
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Pre-filter tokens to avoid wasted API calls on tokens unlikely to be in DexScreener
     * This can reduce API calls by 60-80% for wallets with many scam/new tokens
     */
    private async preFilterTokensForDexScreener(tokenAddresses: string[]): Promise<string[]> {
        
        // FILTER 1: Check database for recently checked tokens (within configured hours)
        // Use the shorter price TTL for recency to avoid serving stale prices
        const recentlyCheckedTokens = await this.databaseService.getRecentlyCheckedTokens(
            tokenAddresses,
            METADATA_FETCHING_CONFIG.dexscreener.priceCacheExpiryMinutes / 60
        );
        const recentlyCheckedSet = new Set(recentlyCheckedTokens);
        
        const uncheckedTokens = tokenAddresses.filter(addr => !recentlyCheckedSet.has(addr));        
        
        
        // FILTER 2: Skip known scam/spam patterns (if enabled)
        const validTokens = METADATA_FETCHING_CONFIG.filtering.enableScamTokenFilter 
            ? uncheckedTokens.filter(addr => {
                // Skip tokens that are clearly invalid or scam patterns
                if (!addr || addr.length !== 44) return false;
                
                // Skip tokens with configured scam patterns
                return !METADATA_FETCHING_CONFIG.filtering.scamPatterns.some(pattern => pattern.test(addr));
            })
            : uncheckedTokens;
        
        logger.info(`🔍 Pre-filter: After scam filter - ${validTokens.length} tokens remain (${uncheckedTokens.length - validTokens.length} filtered as scam)`);
        
        
        
        // FILTER 3: Prioritize tokens by wallet activity (if enabled)
        if (METADATA_FETCHING_CONFIG.filtering.enableActivityPrioritization) {
            const tokensWithActivity = await this.databaseService.getTokensWithRecentActivity(validTokens);
            const prioritizedTokens = [
                ...tokensWithActivity, // Tokens with recent trading activity first
                ...validTokens.filter(addr => !tokensWithActivity.includes(addr)) // Other tokens last
            ];
                        
            return prioritizedTokens;
        }
        
        return validTokens;
    }

    /**
     * Retry helper for DexScreener API calls with exponential backoff
     */
    private async fetchWithRetry<T>(
        operation: () => Promise<T>, 
        description: string
    ): Promise<T> {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                
                if (attempt === RETRY_CONFIG.maxRetries) {
                    logger.error(`Failed to fetch ${description} after ${RETRY_CONFIG.maxRetries} attempts:`, lastError);
                    throw lastError;
                }
                
                // Calculate exponential backoff delay
                const delay = Math.min(
                    RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
                    RETRY_CONFIG.maxDelay
                );
                
                logger.warn(`Attempt ${attempt}/${RETRY_CONFIG.maxRetries} failed for ${description}, retrying in ${delay}ms:`, lastError.message);
                await sleep(delay);
            }
        }
        
        throw lastError!;
    }
} 