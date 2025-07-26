import { Module } from '@nestjs/common';
import { PnlAnalysisService } from '../services/pnl-analysis.service';
import { DatabaseModule } from '../modules/database.module';
import { HeliusModule } from '../integrations/helius.module'; // For HeliusApiClient
import { TokenInfoModule } from '../integrations/token-info.module';

@Module({
  imports: [
    DatabaseModule, // To make DatabaseService available for injection into PnlAnalysisService
    HeliusModule,   // To make HeliusApiClient available for injection into PnlAnalysisService
    TokenInfoModule, // To make TokenInfoService available for injection
  ],
  providers: [PnlAnalysisService],
  exports: [PnlAnalysisService], // Export for other modules (like AnalysesModule) to use
})
export class PnlAnalysisModule {} 