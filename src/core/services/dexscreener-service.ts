import { createLogger } from 'core/utils/logger';
import { DatabaseService } from 'core/services/database-service';
import { Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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
        const chunks = this.chunkArray(tokenAddresses, 30);

        let processedCount = 0;
        for (const [index, chunk] of chunks.entries()) {
            try {
                const url = `${this.baseUrl}/dex/tokens/${chunk.join(',')}`;
                const response = await firstValueFrom(this.httpService.get(url));
                const pairs: DexScreenerPair[] = response.data?.pairs || [];

                const tokenInfoFromPairs = this.transformPairsToTokenInfo(pairs, chunk);
                
                // --- OPTIMIZATION: Bulk Upsert and Placeholder Creation ---

                // 1. Upsert all found tokens. This updates existing ones and creates new ones found via API.
                if (tokenInfoFromPairs.length > 0) {
                    await this.databaseService.upsertManyTokenInfo(tokenInfoFromPairs);
                    logger.info(`Saved/updated ${tokenInfoFromPairs.length} token records from API for chunk ${index + 1}.`);
                }

                // 2. Efficiently create placeholders for any tokens not found by the API.
                const foundAddresses = new Set(tokenInfoFromPairs.map(t => t.tokenAddress));
                const notFoundAddresses = chunk.filter(addr => !foundAddresses.has(addr));

                if (notFoundAddresses.length > 0) {
                    logger.warn(`Chunk ${index + 1}: ${notFoundAddresses.length} tokens not found via API. Creating placeholders.`);
                    const placeholderData = notFoundAddresses.map(addr => ({
                        tokenAddress: addr,
                        name: 'Unknown Token',
                        symbol: addr.slice(0, 4) + '...' + addr.slice(-4),
                        dexscreenerUpdatedAt: new Date(), // Mark as checked
                    }));
                    // Use the existing, robust upsertMany method for placeholders.
                    await this.databaseService.upsertManyTokenInfo(placeholderData);
                }
                
                processedCount += chunk.length;
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(`Failed to fetch or save token data for chunk. Error: ${error.message}`, error.stack);
                } else {
                    logger.error('An unknown error occurred while fetching token data for chunk.', error);
                }
            } finally {
                // Wait for 1000ms after each request to stay within the 300 requests/minute limit
                await sleep(1000);
            }
        }
        logger.info(`Finished DexScreener enrichment job. Processed approximately ${processedCount} out of ${tokenAddresses.length} requested tokens.`);
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
} 