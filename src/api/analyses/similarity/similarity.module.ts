import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SimilarityApiService } from './similarity.service';
import { HeliusModule } from '../../helius/helius.module';
import { TokenInfoModule } from '../../token-info/token-info.module';
import { DexscreenerModule } from '../../dexscreener/dexscreener.module';

@Module({
  imports: [DatabaseModule, HeliusModule, TokenInfoModule, DexscreenerModule],
  providers: [SimilarityApiService],
  exports: [SimilarityApiService],
})
export class SimilarityModule {} 