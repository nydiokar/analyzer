import { Module } from '@nestjs/common';
import { PnlOverviewService } from './pnl-overview.service';
import { DatabaseModule } from '../../database/database.module';
import { DatabaseService as ApiDatabaseService } from '../../database/database.service';
import { PnlAnalysisService as CorePnlAnalysisService } from '../../../core/services/pnl-analysis-service';

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PnlOverviewService,
    {
      provide: CorePnlAnalysisService,
      useFactory: (apiDatabaseService: ApiDatabaseService) => {
        return new CorePnlAnalysisService(apiDatabaseService);
      },
      inject: [ApiDatabaseService],
    },
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 