import { Module } from '@nestjs/common';
import { TokenInfoService } from './token-info.service';
import { DatabaseModule } from '../database/database.module';
import { DexscreenerModule } from '../dexscreener/dexscreener.module';

@Module({
  imports: [DatabaseModule, DexscreenerModule],
  providers: [TokenInfoService],
  exports: [TokenInfoService],
})
export class TokenInfoModule {} 