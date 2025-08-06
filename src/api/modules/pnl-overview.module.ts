import { Module } from '@nestjs/common';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { DatabaseModule } from '../modules/database.module';
import { PnlAnalysisService } from '../services/pnl-analysis.service';
import { TokenInfoModule } from '../integrations/token-info.module';
import { HeliusModule } from '../integrations/helius.module'; // Import HeliusModule to use global singleton
import { DexscreenerModule } from '../integrations/dexscreener.module';

@Module({
  imports: [
    DatabaseModule,
    TokenInfoModule,
    HeliusModule, // Import HeliusModule to get the global HeliusApiClient singleton
    DexscreenerModule, // Import DexscreenerModule to get DexscreenerService
  ],
  providers: [
    PnlOverviewService,
    PnlAnalysisService,
    // Removed duplicate HeliusApiClient provider - now using the global singleton from HeliusModule
  ],
  exports: [PnlOverviewService],
})
export class PnlOverviewModule {} 