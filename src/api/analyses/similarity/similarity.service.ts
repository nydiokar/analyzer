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

    async runAnalysis(dto: SimilarityAnalysisRequestDto, freshBalancesMap?: Map<string, any>): Promise<CombinedSimilarityResult> {
        logger.info(`Received request to run comprehensive similarity analysis for ${dto.walletAddresses.length} wallets.`, {
            wallets: dto.walletAddresses,
            usingProvidedBalances: !!freshBalancesMap
        });

        if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
            throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
        }

        try {
            const config: SimilarityAnalysisConfig = {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
            };

            const similarityAnalyzer = new SimilarityService(this.databaseService, config);
            // Use raw balance fetching for faster analysis - metadata will be enriched separately
            const balancesMap = freshBalancesMap || await this.walletBalanceService.fetchWalletBalancesRaw(dto.walletAddresses);

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

            // --- Return Raw Balances (UI will handle enrichment separately) ---
            // This allows the frontend to show results immediately while enriching metadata in parallel.

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


} 