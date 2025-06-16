import { Module } from '@nestjs/common';
import { AnalysesController } from './analyses.controller';

import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module'; 
import { PnlAnalysisModule } from 'api/pnl_analysis/pnl-analysis.module';
import { BehaviorModule } from '../wallets/behavior/behavior.module';
import { SimilarityModule } from './similarity/similarity.module';
// HeliusModule is now global, so AnalysesModule does not need to import it directly
// PnlAnalysisModule and BehaviorModule are still removed from the previous test step

@Module({
  imports: [
    ConfigModule,      // In case any provider in AnalysesModule itself needs it directly
    DatabaseModule,    // In case any provider in AnalysesModule itself needs it directly
    PnlAnalysisModule, // Ensures PnlAnalysisService is available
    BehaviorModule,    // Ensures BehaviorService is available
    SimilarityModule,  // Provides SimilarityApiService
                       // HeliusModule is global and provides HeliusSyncService
                       // PnlAnalysisModule and BehaviorModule still omitted for this test run
  ],
  controllers: [AnalysesController],
  providers: [], 
})
export class AnalysesModule {} 