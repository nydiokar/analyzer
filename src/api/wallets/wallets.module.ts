import { Module } from '@nestjs/common';
import { WalletsController } from '../controllers/wallets.controller';
import { TokenPerformanceModule } from './token_performance/token-performance.module';
import { BehaviorModule } from './behavior/behavior.module';
// DatabaseModule is imported by TokenPerformanceModule and BehaviorModule if they need it.
// No need to import it here again unless WalletsController itself directly needs DatabaseService,
// which it does for the summary endpoint's activity logging and direct data fetches.
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    DatabaseModule, // For WalletsController direct use
    TokenPerformanceModule,
    BehaviorModule,
  ],
  controllers: [WalletsController],
  // Services are provided within their respective feature modules (TokenPerformanceService, BehaviorService)
  // and made available through exports if needed, or used by the controller via DI.
}) 
export class WalletsModule {} 