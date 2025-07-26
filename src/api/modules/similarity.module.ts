import { Module } from '@nestjs/common';
import { DatabaseModule } from '../modules/database.module';
import { SimilarityApiService } from '../services/similarity.service';
import { HeliusModule } from '../integrations/helius.module';
import { TokenInfoModule } from '../integrations/token-info.module';
import { DexscreenerModule } from '../integrations/dexscreener.module';
import { BalanceCacheModule } from '../modules/balance-cache.module';

@Module({
  imports: [DatabaseModule, HeliusModule, TokenInfoModule, DexscreenerModule, BalanceCacheModule],
  providers: [SimilarityApiService],
  exports: [SimilarityApiService],
})
export class SimilarityModule {} 