import { Module } from '@nestjs/common';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { DatabaseModule } from '../modules/database.module';
import { PnlAnalysisModule } from './pnl-analysis.module'; // Import PnlAnalysisModule to use its exported PnlAnalysisService
import { TokenInfoModule } from '../integrations/token-info.module';
import { HeliusModule } from '../integrations/helius.module'; // Import HeliusModule to use global singleton
import { DexscreenerModule } from '../integrations/dexscreener.module';

@Module({
  imports: [
    DatabaseModule,
    TokenInfoModule,
    HeliusModule, // Import HeliusModule to get the global HeliusApiClient singleton
    DexscreenerModule, // Import DexscreenerModule to get DexscreenerService
    PnlAnalysisModule, // Import PnlAnalysisModule to use the shared PnlAnalysisService singleton
  ],
  providers: [
    PnlOverviewService,
    // PnlAnalysisService is now imported from PnlAnalysisModule (not duplicated)
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 