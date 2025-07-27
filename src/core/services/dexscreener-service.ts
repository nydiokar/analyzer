import { createLogger } from 'core/utils/logger';
import { DatabaseService } from 'core/services/database-service';
import { Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { METADATA_FETCHING_CONFIG } from '@config/constants';

const logger = createLogger('DexscreenerService');

// A simple sleep helper function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

        logger.info(`🔍 DexScreener: Starting fetch for ${tokenAddresses.length} tokens`);

        // OPTIMIZATION 1: Intelligent pre-filtering to reduce API calls
        const filteredTokens = await this.preFilterTokensForDexScreener(tokenAddresses);
        const skippedCount = tokenAddresses.length - filteredTokens.length;
        
        logger.info(`🔍 DexScreener: Pre-filtering results - ${filteredTokens.length} tokens to fetch, ${skippedCount} skipped (${((skippedCount/tokenAddresses.length)*100).toFixed(1)}% reduction)`);
        
        if (skippedCount > 0) {
            logger.info(`Pre-filtered ${skippedCount} tokens likely not in DexScreener (${((skippedCount/tokenAddresses.length)*100).toFixed(1)}% reduction)`);
        }

        if (filteredTokens.length === 0) {
            logger.info('All tokens were pre-filtered as unlikely to be in DexScreener');
            return;
        }

        const chunks = this.chunkArray(filteredTokens, METADATA_FETCHING_CONFIG.dexscreener.chunkSize);
        logger.info(`🔍 DexScreener: Created ${chunks.length} chunks of ${METADATA_FETCHING_CONFIG.dexscreener.chunkSize} tokens each`);

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
        logger.info(`[DexScreener API] Completed all requests for ${tokenAddresses.length} tokens (${processedCount} processed).`);
    }

    async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
        if (tokenAddresses.length === 0) {
            return new Map();
        }
        const prices = new Map<string, number>();
        const chunks = this.chunkArray(tokenAddresses, 30);

        for (const chunk of chunks) {
            try {
                const url = `${this.baseUrl}/dex/tokens/${chunk.join(',')}`;
                const response = await firstValueFrom(this.httpService.get(url));
                const pairs: DexScreenerPair[] = response.data?.pairs || [];

                for (const pair of pairs) {
                    if (pair.priceUsd && pair.baseToken.address && !prices.has(pair.baseToken.address)) {
                        prices.set(pair.baseToken.address, parseFloat(pair.priceUsd));
                    }
                }
            } catch (error) {
                logger.error('Failed to fetch token prices for chunk.', error);
            } finally {
                await sleep(1000);
            }
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

            for (const token of tokensToProcess) {
                if (!token) continue;
                const { address, name, symbol } = token;

                if (requestedAddresses.includes(address) && !tokenInfoMap.has(address)) {
                    const socials = pair.info?.socials;
                    const website = pair.info?.websites?.find(w => w.label?.toLowerCase() === 'website')?.url || pair.info?.websites?.[0]?.url;
                    const twitter = socials?.find(s => s.type === 'twitter')?.url;
                    const telegram = socials?.find(s => s.type === 'telegram')?.url;

                    tokenInfoMap.set(address, {
                        tokenAddress: address,
                        name,
                        symbol,
                        imageUrl: pair.info?.imageUrl,
                        websiteUrl: website,
                        twitterUrl: twitter,
                        telegramUrl: telegram,
                        // Market data from DexScreener
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
        try {
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
        } catch (error) {
            if (error instanceof Error) {
                logger.error(`Failed to fetch or save token data for chunk. Error: ${error.message}`, error.stack);
            } else {
                logger.error(`An unknown error occurred while fetching token data for chunk.`, error);
            }
            return 0;
        }
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
        logger.info(`🔍 Pre-filter: Starting with ${tokenAddresses.length} tokens`);
        
        // FILTER 1: Check database for recently checked tokens (within configured hours)
        const recentlyCheckedTokens = await this.databaseService.getRecentlyCheckedTokens(
            tokenAddresses, 
            METADATA_FETCHING_CONFIG.dexscreener.cacheExpiryHours
        );
        const recentlyCheckedSet = new Set(recentlyCheckedTokens);
        
        const uncheckedTokens = tokenAddresses.filter(addr => !recentlyCheckedSet.has(addr));
        
        logger.info(`🔍 Pre-filter: After recently checked filter - ${uncheckedTokens.length} tokens remain (${recentlyCheckedTokens.length} were recently checked)`);
        logger.info(`🔍 Pre-filter: Cache expiry hours: ${METADATA_FETCHING_CONFIG.dexscreener.cacheExpiryHours} (${METADATA_FETCHING_CONFIG.dexscreener.cacheExpiryHours * 60} minutes)`);
        
        
        
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
            
            logger.info(`🔍 Pre-filter: After activity prioritization - ${prioritizedTokens.length} tokens (${tokensWithActivity.length} with recent activity)`);
            
            return prioritizedTokens;
        }
        
        logger.info(`🔍 Pre-filter: Final result - ${validTokens.length} tokens to fetch`);
        return validTokens;
    }
} 