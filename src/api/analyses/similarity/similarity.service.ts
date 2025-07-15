import { Injectable, InternalServerErrorException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { createLogger } from '@/core/utils/logger';
import { DatabaseService } from '../../database/database.service';
import { SimilarityService } from '@/core/analysis/similarity/similarity-service';
import { SimilarityAnalysisRequestDto } from './similarity-analysis.dto';
import { SimilarityAnalysisConfig } from '@/types/analysis';
import { DEFAULT_EXCLUDED_MINTS } from '../../../config/constants';
import { TokenInfoService } from '../../token-info/token-info.service';
import { CombinedSimilarityResult } from '@/types/similarity';
import { BalanceCacheService } from '../../balance-cache/balance-cache.service';
import { WalletBalance } from '@/types/wallet';

const logger = createLogger('SimilarityApiService');

@Injectable()
export class SimilarityApiService {
    private readonly logger = new Logger(SimilarityApiService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly tokenInfoService: TokenInfoService,
    ) {}

    async runAnalysis(
        dto: SimilarityAnalysisRequestDto, 
        balancesMap: Map<string, WalletBalance>
    ): Promise<CombinedSimilarityResult> {
        this.logger.log(`Received request to run comprehensive similarity analysis for ${dto.walletAddresses.length} wallets.`);

        if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
            throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
        }

        try {
            const config: SimilarityAnalysisConfig = {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
            };

            const similarityAnalyzer = new SimilarityService(this.databaseService, config);
            
            // --- Balances are now pre-fetched and passed in ---

            // --- Pre-enrich balances with existing metadata ---
            const uniqueMints = Array.from(new Set(
                [...balancesMap.values()].flatMap(balance => balance.tokenBalances.map(tb => tb.mint))
            ));

            const tokenInfo = await this.tokenInfoService.findManyPartial(uniqueMints);
            const tokenInfoMap = new Map(tokenInfo.map(info => [info.tokenAddress, info]));

            for (const [walletAddress, balance] of balancesMap) {
                for (const tokenBalance of balance.tokenBalances) {
                    const info = tokenInfoMap.get(tokenBalance.mint);
                    if (info) {
                        tokenBalance.name = info.name;
                        tokenBalance.symbol = info.symbol;
                        tokenBalance.imageUrl = info.imageUrl;

                        if (info.priceUsd) {
                            const price = parseFloat(info.priceUsd);
                            const rawBalance = BigInt(tokenBalance.balance);
                            const divisor = BigInt(10 ** tokenBalance.decimals);
                            const numericBalance = Number(rawBalance) / Number(divisor);
                            
                            tokenBalance.priceUsd = price;
                            tokenBalance.valueUsd = numericBalance * price;
                        }
                    }
                }
            }
            
            // Kick off the core analysis.
            const analysisPromise = Promise.all([
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'binary', balancesMap),
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'capital', balancesMap)
            ]);
            
            const [binaryResults, capitalResults] = await analysisPromise;
            
            if (!binaryResults || !capitalResults) {
                throw new UnprocessableEntityException('Insufficient valid wallets for similarity analysis. Some wallets may be invalid or have no transaction data.');
            }

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
                        
                        binarySharedTokenCount: binaryPair.sharedTokenCount,
                        binaryUniqueTokenCountA: binaryPair.uniqueTokenCountA,
                        binaryUniqueTokenCountB: binaryPair.uniqueTokenCountB,

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
                holdingsPresenceJaccardMatrix: capitalResults['holdingsPresenceFilteredJaccardMatrix'] || capitalResults.holdingsPresenceJaccardMatrix,
                holdingsPresenceCosineMatrix: capitalResults.holdingsPresenceCosineMatrix,
                holdingsPresenceJaccardMatrixAllTokens: capitalResults.holdingsPresenceJaccardMatrix,
            };

            return combinedResults;
        } catch (error) {
            logger.error(`Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`, { error });
            
            if (error instanceof BadRequestException || error instanceof InternalServerErrorException || error instanceof UnprocessableEntityException) {
                throw error;
            }
            
            throw new InternalServerErrorException('An unexpected error occurred while running the similarity analysis.');
        }
    }
} 