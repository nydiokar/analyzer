import { Module } from '@nestjs/common';
import { MarketContextService } from '../services/market-context.service';
import { TokenInfoModule } from '../integrations/token-info.module';
import { DatabaseModule } from './database.module';

@Module({
  imports: [
    DatabaseModule,  // Provides DatabaseService (TokenInfo DB reads/writes)
    TokenInfoModule, // Provides TokenInfoService (Redis → DB → Helius supply cache)
  ],
  providers: [MarketContextService],
  exports: [MarketContextService],
})
export class MarketContextModule {}
