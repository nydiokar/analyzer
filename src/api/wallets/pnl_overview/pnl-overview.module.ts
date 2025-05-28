import { Module } from '@nestjs/common';
import { PnlOverviewService } from './pnl-overview.service';
import { DatabaseModule } from '../../database/database.module';
import { PnlAnalysisService as CorePnlAnalysisService } from '../../../core/services/pnl-analysis-service';
import { DatabaseService as NestDatabaseService } from '../../database/database.service';
import { HeliusApiClient } from '@/core/services/helius-api-client';

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PnlOverviewService,
    {
      provide: CorePnlAnalysisService,
      useFactory: (nestDbService: NestDatabaseService, heliusApiClient: HeliusApiClient) => {
        return new CorePnlAnalysisService(nestDbService, heliusApiClient);
      },
      inject: [NestDatabaseService, HeliusApiClient],
    },
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 