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
}

export class DexscreenerService {
    private readonly baseUrl = 'https://api.dexscreener.com/latest';
    private httpService: HttpService;

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
                const foundAddresses = new Set(tokenInfoFromPairs.map(t => t.tokenAddress));
                
                const notFoundAddresses = chunk.filter(addr => !foundAddresses.has(addr));

                const finalUpserts: Prisma.TokenInfoCreateInput[] = [...tokenInfoFromPairs];

                if (notFoundAddresses.length > 0) {
                    logger.warn(`Chunk ${index + 1}: Could not find metadata for ${notFoundAddresses.length} tokens. Creating placeholders to prevent re-fetching.`);
                    for (const addr of notFoundAddresses) {
                        finalUpserts.push({
                            tokenAddress: addr,
                            name: 'Unknown Token',
                            symbol: addr.slice(0, 4) + '...' + addr.slice(-4),
                        });
                    }
                }

                if (finalUpserts.length > 0) {
                    await this.databaseService.upsertManyTokenInfo(finalUpserts);
                    logger.info(`Saved/updated ${finalUpserts.length} token records for chunk ${index + 1}.`);
                }
                
                processedCount += chunk.length;
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(`Failed to fetch or save token data for chunk. Error: ${error.message}`, error.stack);
                } else {
                    logger.error('An unknown error occurred while fetching token data for chunk.', error);
                }
            } finally {
                // Wait for 200ms after each request to stay within the 300 requests/minute limit
                await sleep(200);
            }
        }
        logger.info(`Finished DexScreener enrichment job. Processed approximately ${processedCount} out of ${tokenAddresses.length} requested tokens.`);
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