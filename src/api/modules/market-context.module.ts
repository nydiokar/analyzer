import { Module } from '@nestjs/common';
import { MarketContextService } from '../services/market-context.service';
import { WalletPreparationService } from '../services/wallet-preparation.service';
import { TokenInfoModule } from '../integrations/token-info.module';
import { DatabaseModule } from './database.module';
import { MarketContextController } from '../controllers/market-context.controller';

@Module({
  imports: [
    DatabaseModule,  // Provides DatabaseService (TokenInfo DB reads/writes)
    TokenInfoModule, // Provides TokenInfoService (Redis → DB → Helius supply cache)
    // HeliusSyncService is provided by HeliusModule (@Global) — no explicit import needed
  ],
  controllers: [MarketContextController],
  providers: [MarketContextService, WalletPreparationService],
  exports: [MarketContextService, WalletPreparationService],
})
export class MarketContextModule {}
