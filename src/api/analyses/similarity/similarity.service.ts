import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { createLogger } from '@/core/utils/logger';
import { DatabaseService } from '../../database/database.service';
import { SimilarityService } from '@/core/analysis/similarity/similarity-service';
import { SimilarityAnalysisRequestDto } from './similarity-analysis.dto';
import { SimilarityAnalysisConfig } from '@/types/analysis';
import { DEFAULT_EXCLUDED_MINTS } from '../../../config/constants';
import { HeliusApiClient } from '@/core/services/helius-api-client';
import { TokenInfoService } from '../../token-info/token-info.service';
import { WalletBalanceService } from '@/core/services/wallet-balance-service';
import { CombinedSimilarityResult } from '@/types/similarity';
import { DexscreenerService } from '../../dexscreener/dexscreener.service';
import { TokenBalanceDetails } from '@/types/wallet';
import { TokenInfo } from '@prisma/client';


const logger = createLogger('SimilarityApiService');

@Injectable()
export class SimilarityApiService {
    private walletBalanceService: WalletBalanceService;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly heliusApiClient: HeliusApiClient,
        private readonly tokenInfoService: TokenInfoService,
        private readonly dexscreenerService: DexscreenerService,
    ) {
        this.walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.tokenInfoService);
    }

    async runAnalysis(dto: SimilarityAnalysisRequestDto): Promise<CombinedSimilarityResult> {
        logger.info(`Received request to run comprehensive similarity analysis for ${dto.walletAddresses.length} wallets.`, {
            wallets: dto.walletAddresses,
        });

        if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
            throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
        }

        try {
            const config: SimilarityAnalysisConfig = {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
            };

            const similarityAnalyzer = new SimilarityService(this.databaseService, config);
            const balancesMap = await this.walletBalanceService.fetchWalletBalances(dto.walletAddresses);

            // --- Start: Parallel Execution ---
            // Kick off the core analysis.
            const analysisPromise = Promise.all([
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'binary', balancesMap),
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'capital', balancesMap)
            ]);
            // --- End: Parallel Execution ---

            // --- Await Core Analysis ---
            const [binaryResults, capitalResults] = await analysisPromise;
            
            if (!binaryResults || !capitalResults) {
                logger.warn(`Similarity analysis for wallets returned no results.`, { wallets: dto.walletAddresses });
                throw new InternalServerErrorException('Analysis produced no results.');
            }

            // --- Await Enrichment and Combine (if needed, but for now we send raw balances) ---
            // For this optimization, we will NOT wait for the enrichmentPromise here.
            // The frontend will be responsible for fetching enriched data separately.

            const combinedUniqueTokens: Record<string, { binary: number; capital: number }> = {};
            const allWallets = new Set([...Object.keys(binaryResults.uniqueTokensPerWallet), ...Object.keys(capitalResults.uniqueTokensPerWallet)]);
            allWallets.forEach(wallet => {
                combinedUniqueTokens[wallet] = {
                    binary: binaryResults.uniqueTokensPerWallet[wallet] || 0,
                    capital: capitalResults.uniqueTokensPerWallet[wallet] || 0,
                };
            });

            const combinedResults: CombinedSimilarityResult = {
                vectorTypeUsed: 'combined',
                pairwiseSimilarities: binaryResults.pairwiseSimilarities.map(binaryPair => {
                    const capitalPair = capitalResults.pairwiseSimilarities.find(p => 
                        (p.walletA === binaryPair.walletA && p.walletB === binaryPair.walletB) ||
                        (p.walletA === binaryPair.walletB && p.walletB === binaryPair.walletA)
                    );

                    const capitalAllocation = capitalPair?.sharedTokens.reduce((acc, token) => {
                        acc[token.mint] = { weightA: token.weightA, weightB: token.weightB };
                        return acc;
                    }, {} as Record<string, { weightA: number; weightB: number }>);

                    return {
                        walletA: binaryPair.walletA,
                        walletB: binaryPair.walletB,
                        binaryScore: binaryPair.similarityScore,
                        capitalScore: capitalPair?.similarityScore || 0,
                        sharedTokens: binaryPair.sharedTokens.map(t => ({ mint: t.mint })),
                        capitalAllocation: capitalAllocation || {},
                        
                        // From binary analysis
                        binarySharedTokenCount: binaryPair.sharedTokenCount,
                        binaryUniqueTokenCountA: binaryPair.uniqueTokenCountA,
                        binaryUniqueTokenCountB: binaryPair.uniqueTokenCountB,

                        // From capital analysis
                        capitalSharedTokenCount: capitalPair?.sharedTokenCount || 0,
                        capitalUniqueTokenCountA: capitalPair?.uniqueTokenCountA || 0,
                        capitalUniqueTokenCountB: capitalPair?.uniqueTokenCountB || 0,
                    };
                }),
                globalMetrics: capitalResults.globalMetrics,
                walletVectorsUsed: capitalResults.walletVectorsUsed,
                uniqueTokensPerWallet: combinedUniqueTokens,
                walletBalances: Object.fromEntries(balancesMap),
                sharedTokenCountsMatrix: capitalResults.sharedTokenCountsMatrix,
                jaccardSimilarityMatrix: capitalResults.jaccardSimilarityMatrix,
                // Use the filtered holdings matrix as the primary one (excludes spam/airdrops)
                holdingsPresenceJaccardMatrix: capitalResults['holdingsPresenceFilteredJaccardMatrix'] || capitalResults.holdingsPresenceJaccardMatrix,
                holdingsPresenceCosineMatrix: capitalResults.holdingsPresenceCosineMatrix,
                // Keep the original all-tokens matrix for transparency/debugging
                holdingsPresenceJaccardMatrixAllTokens: capitalResults.holdingsPresenceJaccardMatrix,
            };

            return combinedResults;
        } catch (error) {
            logger.error(`Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`, { error });
            throw new InternalServerErrorException('An error occurred while running the similarity analysis.');
        }
    }

    async enrichBalances(walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>): Promise<Record<string, any>> {
        logger.info(`Enriching balances for ${Object.keys(walletBalances).length} wallets.`);
        try {
            const allMints = Object.values(walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
            const uniqueMints = [...new Set(allMints)];

            // TODO: Add Redis caching here to fix 10-15k token performance bottleneck
            // const cacheKey = `token_metadata_${uniqueMints.sort().join('|')}`;
            // Check Redis cache first before hitting database/external APIs

            // Step 1: Find all existing metadata in our database.
            const existingMetadata = await this.tokenInfoService.findMany(uniqueMints);
            const existingMetadataMap = new Map(existingMetadata.map(t => [t.tokenAddress, t]));
            logger.info(`Found ${existingMetadataMap.size} existing token metadata records in the database.`);

            // Step 2: Identify mints that need fetching.
            const mintsNeedingMetadata = uniqueMints.filter(mint => !existingMetadataMap.has(mint));
            logger.info(`Identified ${mintsNeedingMetadata.length} new tokens requiring metadata fetch.`);

            // Step 3: Fetch prices and trigger metadata saving in parallel.
            // TODO: Implement batch processing and rate limiting for large token sets
            // For >1000 tokens, should use job queue instead of synchronous processing
            if (mintsNeedingMetadata.length > 1000) {
                logger.warn(`Large token set (${mintsNeedingMetadata.length}) detected. Consider using job queue for better performance.`);
            }

            const [pricesMap, _] = await Promise.all([
                this.dexscreenerService.getTokenPrices(uniqueMints),
                this.dexscreenerService.fetchAndSaveTokenInfo(mintsNeedingMetadata),
            ]);
            
            // Step 4: Re-query the database to get all metadata (including newly fetched).
            const allMetadata = await this.tokenInfoService.findMany(uniqueMints);
            const combinedMetadataMap = new Map(allMetadata.map(t => [t.tokenAddress, t]));

            // Step 5: Enrich the original balances object.
            const enrichedBalances = { ...walletBalances };
            for (const walletAddress in enrichedBalances) {
                const balanceData = enrichedBalances[walletAddress];
                balanceData.tokenBalances = balanceData.tokenBalances.map((tb: any) => {
                    const price = pricesMap.get(tb.mint);
                    const metadata: TokenInfo | undefined = combinedMetadataMap.get(tb.mint);
                    const valueUsd = (tb.uiBalance && price) ? tb.uiBalance * price : null;
                    
                    return { 
                        ...tb, 
                        valueUsd,
                        name: metadata?.name,
                        symbol: metadata?.symbol,
                        imageUrl: metadata?.imageUrl,
                    };
                });
            }

            // TODO: Cache the enriched result in Redis with TTL
            return enrichedBalances;
        } catch (error) {
            logger.error('Error enriching wallet balances', { error });
            throw new InternalServerErrorException('An error occurred while enriching balances.');
        }
    }
} 