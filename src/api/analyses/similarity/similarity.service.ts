import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { createLogger } from '@/core/utils/logger';
import { DatabaseService } from '../../database/database.service';
import { SimilarityService } from '@/core/analysis/similarity/similarity-service';
import { SimilarityAnalysisRequestDto } from './similarity-analysis.dto';
import { SimilarityAnalysisConfig } from '@/types/analysis';

const logger = createLogger('SimilarityApiService');

@Injectable()
export class SimilarityApiService {
    constructor(private readonly databaseService: DatabaseService) {}

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
                timeRange: { startTs: 0, endTs: 0 }, // This can be parameterized in the DTO in the future
                excludedMints: [], // This can be parameterized in the DTO in the future
            };

            // Manually instantiate the core service with the required dependencies
            const similarityAnalyzer = new SimilarityService(this.databaseService, config);
            
            const results = await similarityAnalyzer.calculateWalletSimilarity(dto.walletAddresses, dto.vectorType);

            if (!results) {
                logger.warn(`Similarity analysis for wallets returned no results.`, { wallets: dto.walletAddresses });
                return {};
            }

            return results;
        } catch (error) {
            logger.error(`Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`, { error });
            throw new InternalServerErrorException('An error occurred while running the similarity analysis.');
        }
    }
} 