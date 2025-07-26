import { Module } from '@nestjs/common';
import { AnalysesController } from '../controllers/analyses.controller';
import { EnrichmentStrategyService } from '../services/enrichment-strategy.service';

import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../modules/database.module'; 
import { PnlAnalysisModule } from '../modules/pnl-analysis.module';
import { BehaviorModule } from '../modules/behavior.module';
import { SimilarityModule } from '../modules/similarity.module';
import { QueueModule } from '../../queues/queue.module';
import { JobsModule } from '../modules/jobs.module';
// HeliusModule is now global, so AnalysesModule does not need to import it directly
// PnlAnalysisModule and BehaviorModule are still removed from the previous test step

@Module({
  imports: [
    ConfigModule,      // In case any provider in AnalysesModule itself needs it directly
    DatabaseModule,    // In case any provider in AnalysesModule itself needs it directly
    PnlAnalysisModule, // Ensures PnlAnalysisService is available
    BehaviorModule,    // Ensures BehaviorService is available
    SimilarityModule,  // Provides SimilarityApiService
    QueueModule,       // Provides SimilarityOperationsQueue for job queueing
    JobsModule,        // Provides JobsService for C3 backwards compatibility
                       // HeliusModule is global and provides HeliusSyncService
                       // PnlAnalysisModule and BehaviorModule still omitted for this test run
  ],
  controllers: [AnalysesController],
  providers: [EnrichmentStrategyService], 
})
export class AnalysesModule {} 