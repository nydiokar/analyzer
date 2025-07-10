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


const logger = createLogger('SimilarityApiService');

@Injectable()
export class SimilarityApiService {
    private walletBalanceService: WalletBalanceService;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly heliusApiClient: HeliusApiClient,
        private readonly tokenInfoService: TokenInfoService,
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
            
            // Enhanced error handling for no transaction data scenarios
            if (!binaryResults || !capitalResults) {
                // Check if we have balance data that we can use for holdings-based similarity
                const hasBalanceData = balancesMap && balancesMap.size > 0;
                const totalTokensAcrossWallets = hasBalanceData ? 
                    Array.from(balancesMap.values()).reduce((sum, wallet) => sum + (wallet.tokenBalances?.length || 0), 0) : 0;
                
                logger.warn(`Similarity analysis for wallets returned no results.`, { 
                    wallets: dto.walletAddresses,
                    hasBalanceData,
                    totalTokensAcrossWallets,
                    binaryResultsNull: !binaryResults,
                    capitalResultsNull: !capitalResults
                });

                if (hasBalanceData && totalTokensAcrossWallets > 0) {
                    // We have balance data but no transaction data - this suggests the Helius API is failing
                    // Let's provide a more helpful error message
                    throw new InternalServerErrorException(
                        'Unable to fetch transaction data for similarity analysis. ' +
                        'This may be due to Helius API issues or network connectivity problems. ' +
                        'Please try again later or contact support if the issue persists.'
                    );
                } else {
                    // No transaction data and no balance data
                    throw new InternalServerErrorException(
                        'No transaction or balance data available for similarity analysis. ' +
                        'Please ensure the wallets have trading activity and try again.'
                    );
                }
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
            
            // If it's already a structured error, re-throw it
            if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
                throw error;
            }
            
            // Otherwise, wrap in a generic error
            throw new InternalServerErrorException('An unexpected error occurred while running the similarity analysis.');
        }
    }


} 