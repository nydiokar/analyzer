import { Injectable, InternalServerErrorException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { createLogger } from '@/core/utils/logger';
import { DatabaseService } from '../services/database.service';
import { SimilarityService } from '@/core/analysis/similarity/similarity-service';
import { SimilarityAnalysisRequestDto } from '../shared/dto/similarity-analysis.dto';
import { SimilarityAnalysisConfig } from '@/types/analysis';
import { DEFAULT_EXCLUDED_MINTS } from '../../config/constants';
import { TokenInfoService } from '../services/token-info.service';
import { CombinedSimilarityResult } from '@/types/similarity';
import { WalletBalance } from '@/types/wallet';
import { getKnownWallet } from '../../config/known-wallets';

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
        this.logger.debug(`Received request to run comprehensive similarity analysis for ${dto.walletAddresses.length} wallets.`);

        if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
            throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
        }

        try {
            const config: SimilarityAnalysisConfig = {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
            };

            const similarityAnalyzer = new SimilarityService(this.databaseService, config);

            const includeBalances = dto.includeBalances === true;
            const includeVectors = dto.includeVectors === true;
            
            // --- Balances are now pre-fetched and passed in ---

            if (includeBalances) {
                // --- Pre-enrich balances with existing metadata ---
                const uniqueMints = Array.from(new Set(
                    [...balancesMap.values()].flatMap(balance => balance.tokenBalances.map(tb => tb.mint))
                ));

                const tokenInfo = await this.tokenInfoService.findManyPartial(uniqueMints);
                const tokenInfoMap = new Map(tokenInfo.map(info => [info.tokenAddress, info]));

                for (const [, balance] of balancesMap) {
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
            }
            
            const transactionData = await this.databaseService.getTransactionsForAnalysis(dto.walletAddresses, config);
            const walletsWithData = Object.keys(transactionData).filter(w => (transactionData[w]?.length || 0) > 0);
            if (walletsWithData.length < 2) {
                throw new UnprocessableEntityException('Insufficient valid wallets for similarity analysis. Some wallets may be invalid or have no transaction data.');
            }

            // Run sequentially to reduce peak heap and to allow SimilarityService internal memoization
            // (binary + capital share expensive vectorType-independent computations).
            const binaryResults = await similarityAnalyzer.calculateWalletSimilarityFromTransactions(
                transactionData,
                'binary',
                balancesMap,
                { includeVectors }
            );
            const capitalResults = await similarityAnalyzer.calculateWalletSimilarityFromTransactions(
                transactionData,
                'capital',
                balancesMap,
                { includeVectors }
            );
            
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

            const walletRecords = await this.databaseService.getWallets(dto.walletAddresses, true) as Array<{ address: string; knownType?: string | null; knownLabel?: string | null }>;
            const walletRecordMap = new Map(walletRecords.map(wallet => [wallet.address, wallet]));
            const walletLabels: Record<string, { knownType?: string; knownLabel?: string }> = {};

            for (const address of dto.walletAddresses) {
                const walletRecord = walletRecordMap.get(address);
                const knownEntry = getKnownWallet(address);
                const knownType = walletRecord?.knownType ?? knownEntry?.type ?? undefined;
                const knownLabel = walletRecord?.knownLabel ?? knownEntry?.label ?? undefined;

                if (knownType || knownLabel) {
                    walletLabels[address] = {
                        knownType,
                        knownLabel: knownLabel ?? knownType,
                    };
                }
            }

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
                globalMetrics: binaryResults.globalMetrics,
                uniqueTokensPerWallet: combinedUniqueTokens,
                sharedTokenCountsMatrix: capitalResults.sharedTokenCountsMatrix,
                jaccardSimilarityMatrix: capitalResults.jaccardSimilarityMatrix,
                holdingsPresenceJaccardMatrix: capitalResults['holdingsPresenceFilteredJaccardMatrix'] || capitalResults.holdingsPresenceJaccardMatrix,
                holdingsPresenceCosineMatrix: capitalResults.holdingsPresenceCosineMatrix,
                holdingsPresenceJaccardMatrixAllTokens: capitalResults.holdingsPresenceJaccardMatrix,
                summary: capitalResults.summary,
                walletLabels: Object.keys(walletLabels).length > 0 ? walletLabels : undefined,
            };

            if (includeVectors && capitalResults.walletVectorsUsed) {
                combinedResults.walletVectorsUsed = capitalResults.walletVectorsUsed;
            }

            if (includeBalances) {
                combinedResults.walletBalances = Object.fromEntries(balancesMap);
            }

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
