import { Module } from '@nestjs/common';
import { PnlAnalysisService } from './pnl-analysis.service';
import { DatabaseModule } from '../database/database.module';
import { HeliusModule } from '../helius/helius.module'; // For HeliusApiClient

@Module({
  imports: [
    DatabaseModule, // To make DatabaseService available for injection into PnlAnalysisService
    HeliusModule,   // To make HeliusApiClient available for injection into PnlAnalysisService
  ],
  providers: [PnlAnalysisService],
  exports: [PnlAnalysisService], // Export for other modules (like AnalysesModule) to use
})
export class PnlAnalysisModule {} 