import { Module } from '@nestjs/common';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { DatabaseModule } from '../modules/database.module';
import { PnlAnalysisService } from '../services/pnl-analysis.service';
import { DatabaseService as NestDatabaseService } from '../services/database.service';
import { HeliusApiClient } from '@/core/services/helius-api-client';
import { HeliusApiConfig } from '@/types/helius-api';
import { TokenInfoModule } from '../integrations/token-info.module';
import { TokenInfoService } from '../services/token-info.service';

@Module({
  imports: [
    DatabaseModule,
    TokenInfoModule,
  ],
  providers: [
    PnlOverviewService,
    PnlAnalysisService,
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
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 