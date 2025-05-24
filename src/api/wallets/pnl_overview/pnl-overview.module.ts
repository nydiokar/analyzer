import { Module } from '@nestjs/common';
import { PnlOverviewService } from './pnl-overview.service';
import { DatabaseModule } from '../../database/database.module';
import { PnlAnalysisService as CorePnlAnalysisService } from '../../../core/services/pnl-analysis-service';
import { DatabaseService as NestDatabaseService } from '../../database/database.service';

@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    PnlOverviewService,
    {
      provide: CorePnlAnalysisService,
      useFactory: (nestDbService: NestDatabaseService) => {
        return new CorePnlAnalysisService(nestDbService);
      },
      inject: [NestDatabaseService],
    },
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 