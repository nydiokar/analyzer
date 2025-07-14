import { Module } from '@nestjs/common';
import { PnlOverviewService } from './pnl-overview.service';
import { DatabaseModule } from '../../database/database.module';
import { PnlAnalysisService as CorePnlAnalysisService } from '../../../core/services/pnl-analysis-service';
import { DatabaseService as NestDatabaseService } from '../../database/database.service';
import { HeliusApiClient } from '@/core/services/helius-api-client';
import { HeliusApiConfig } from '@/types/helius-api';
import { TokenInfoModule } from '../../token-info/token-info.module';
import { TokenInfoService } from '../../token-info/token-info.service';

@Module({
  imports: [
    DatabaseModule,
    TokenInfoModule,
  ],
  providers: [
    PnlOverviewService,
    {
      provide: HeliusApiClient,
      useFactory: (databaseService: NestDatabaseService): HeliusApiClient => {
        const apiKey = process.env.HELIUS_API_KEY;
        if (!apiKey) {
          throw new Error('HELIUS_API_KEY environment variable is required for PnL analysis');
        }
        
        const heliusConfig: HeliusApiConfig = {
          apiKey,
          network: 'mainnet',
        };
        return new HeliusApiClient(heliusConfig, databaseService);
      },
      inject: [NestDatabaseService],
    },
    {
      provide: CorePnlAnalysisService,
      useFactory: (nestDbService: NestDatabaseService, heliusApiClient: HeliusApiClient, tokenInfoService: TokenInfoService) => {
        return new CorePnlAnalysisService(nestDbService, heliusApiClient, tokenInfoService);
      },
      inject: [NestDatabaseService, HeliusApiClient, TokenInfoService],
    },
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 