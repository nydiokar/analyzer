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

    async runAnalysis(dto: SimilarityAnalysisRequestDto) {
        logger.info(`Received request to run similarity analysis for ${dto.walletAddresses.length} wallets.`, {
            wallets: dto.walletAddresses,
            vectorType: dto.vectorType,
        });

        if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
            throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
        }

        try {
            const config: SimilarityAnalysisConfig = {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
            };

            const similarityAnalyzer = new SimilarityService(this.databaseService, config);
            
            // Fetch live wallet balances using the restored service
            const walletBalancesMap = await this.walletBalanceService.fetchWalletBalances(dto.walletAddresses);
            
            const results = await similarityAnalyzer.calculateWalletSimilarity(
                dto.walletAddresses, 
                dto.vectorType,
                walletBalancesMap
            );

            if (!results) {
                logger.warn(`Similarity analysis for wallets returned no results.`, { wallets: dto.walletAddresses });
                return {};
            }

            // Convert Map to Record for JSON serialization
            const balancesRecord: Record<string, any> = {};
            walletBalancesMap.forEach((value, key) => {
                balancesRecord[key] = value;
            });
            results.walletBalances = balancesRecord;

            return results;
        } catch (error) {
            logger.error(`Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`, { error });
            throw new InternalServerErrorException('An error occurred while running the similarity analysis.');
        }
    }
} 