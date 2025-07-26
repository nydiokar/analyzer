import { Module } from '@nestjs/common';
import { WalletsController } from '../controllers/wallets.controller';
import { TokenPerformanceModule } from './token-performance.module';
import { BehaviorModule } from './behavior.module';
// Removed: import { AggregatedMetricsModule } from './aggregated_metrics/aggregated-metrics.module';
import { PnlOverviewModule } from './pnl-overview.module';
// DatabaseModule is imported by TokenPerformanceModule and BehaviorModule if they need it.
// No need to import it here again unless WalletsController itself directly needs DatabaseService,
// which it does for the summary endpoint's activity logging and direct data fetches.
import { DatabaseModule } from '../modules/database.module';
import { TokenInfoModule } from '../integrations/token-info.module';
import { DexscreenerModule } from '../integrations/dexscreener.module';

@Module({
  imports: [
    DatabaseModule, // For WalletsController direct use
    PnlOverviewModule,
    BehaviorModule,
    TokenPerformanceModule,
    // Removed: AggregatedMetricsModule,
    TokenInfoModule,
    DexscreenerModule, // For SOL price fetching
  ],
  controllers: [WalletsController],
  providers: [],
  // Services are provided within their respective feature modules (TokenPerformanceService, BehaviorService)
  // and made available through exports if needed, or used by the controller via DI.
}) 
export class WalletsModule {} 