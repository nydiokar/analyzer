import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SimilarityApiService } from './similarity.service';
import { HeliusModule } from '../../helius/helius.module';
import { TokenInfoModule } from '../../token-info/token-info.module';
import { DexscreenerModule } from '../../dexscreener/dexscreener.module';
import { BalanceCacheModule } from '../../balance-cache/balance-cache.module';

@Module({
  imports: [DatabaseModule, HeliusModule, TokenInfoModule, DexscreenerModule, BalanceCacheModule],
  providers: [SimilarityApiService],
  exports: [SimilarityApiService],
})
export class SimilarityModule {} 