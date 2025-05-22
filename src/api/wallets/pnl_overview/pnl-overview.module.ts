import { Module } from '@nestjs/common';
import { PnlOverviewService } from './pnl-overview.service';
import { DatabaseModule } from '../../database/database.module';
import { PnlAnalysisService as CorePnlAnalysisService } from '../../../core/services/pnl-analysis-service';
import { DatabaseService as CoreDatabaseService } from '../../../core/services/database-service';

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PnlOverviewService,
    {
      provide: CorePnlAnalysisService,
      useFactory: () => {
        const coreDbService = new CoreDatabaseService();
        return new CorePnlAnalysisService(coreDbService);
      },
      inject: [],
    },
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 