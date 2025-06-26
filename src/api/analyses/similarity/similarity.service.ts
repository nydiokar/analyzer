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

// Re-using existing constant to avoid new dependencies
const LAMPORTS_PER_SOL = 1e9;

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
            const walletBalancesMap = await this.walletBalanceService.fetchWalletBalances(dto.walletAddresses);
            
            const [binaryResults, capitalResults] = await Promise.all([
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'binary', walletBalancesMap),
                similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, 'capital', walletBalancesMap)
            ]);

            if (!binaryResults || !capitalResults) {
                logger.warn(`Similarity analysis for wallets returned no results.`, { wallets: dto.walletAddresses });
                throw new InternalServerErrorException('Analysis produced no results.');
            }

            const combinedResults: CombinedSimilarityResult = {
                vectorTypeUsed: 'combined',
                pairwiseSimilarities: binaryResults.pairwiseSimilarities.map(binaryPair => {
                    const capitalPair = capitalResults.pairwiseSimilarities.find(p => 
                        (p.walletA === binaryPair.walletA && p.walletB === binaryPair.walletB) ||
                        (p.walletA === binaryPair.walletB && p.walletB === binaryPair.walletA)
                    );
                    return {
                        walletA: binaryPair.walletA,
                        walletB: binaryPair.walletB,
                        binaryScore: binaryPair.similarityScore,
                        capitalScore: capitalPair?.similarityScore || 0,
                        sharedTokens: binaryPair.sharedTokens, 
                    };
                }),
                walletVectorsUsed: capitalResults.walletVectorsUsed, // Use capital vectors as the reference
                uniqueTokensPerWallet: capitalResults.uniqueTokensPerWallet,
            };

            const balancesRecord: Record<string, any> = {};
            walletBalancesMap.forEach((value, key) => {
                balancesRecord[key] = value;
            });
            combinedResults.walletBalances = balancesRecord;

            return combinedResults;
        } catch (error) {
            logger.error(`Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`, { error });
            throw new InternalServerErrorException('An error occurred while running the similarity analysis.');
        }
    }
} 