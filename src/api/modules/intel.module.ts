import { Module } from '@nestjs/common';
import { IntelController } from '../controllers/intel.controller';
import { WalletHudModule } from './wallet-hud.module';
import { DatabaseModule } from './database.module';
import { BehaviorModule } from './behavior.module';
import { PnlOverviewModule } from './pnl-overview.module';
import { TokenPerformanceModule } from './token-performance.module';
import { QueueModule } from '../../queues/queue.module';

/**
 * IntelModule — external product API for developers and agents.
 *
 * All endpoints are:
 * - Credit-gated via static @RequireCredits → X402 compatible automatically
 * - Stable public contracts — don't rename paths
 *
 * Reuses service modules already wired elsewhere in the app.
 * QueueModule provides AnalysisOperationsQueue + RedisLockService so
 * GET /intel/wallet/:addr can auto-queue flash analysis on cache miss.
 */
@Module({
  imports: [
    WalletHudModule,
    DatabaseModule,
    BehaviorModule,
    PnlOverviewModule,
    TokenPerformanceModule,
    QueueModule,
  ],
  controllers: [IntelController],
})
export class IntelModule {}
