import { Module } from '@nestjs/common';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { DatabaseModule } from '../modules/database.module';
import { PnlAnalysisModule } from './pnl-analysis.module'; // Import PnlAnalysisModule to use its exported PnlAnalysisService
import { TokenInfoModule } from '../integrations/token-info.module';
import { HeliusModule } from '../integrations/helius.module'; // Import HeliusModule to use global singleton
import { DexscreenerModule } from '../integrations/dexscreener.module';
import { BalanceCacheModule } from './balance-cache.module'; // Import for fresh balance fetching

@Module({
  imports: [
    DatabaseModule,
    TokenInfoModule,
    HeliusModule, // Import HeliusModule to get the global HeliusApiClient singleton
    DexscreenerModule, // Import DexscreenerModule to get DexscreenerService
    PnlAnalysisModule, // Import PnlAnalysisModule to use the shared PnlAnalysisService singleton
    BalanceCacheModule, // Import BalanceCacheModule to get fresh balances for unrealized PnL
  ],
  providers: [
    PnlOverviewService,
    // PnlAnalysisService is now imported from PnlAnalysisModule (not duplicated)
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 