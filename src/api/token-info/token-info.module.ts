import { Module } from '@nestjs/common';
import { TokenInfoService } from './token-info.service';
import { DatabaseModule } from '../database/database.module';
import { DexscreenerModule } from '../dexscreener/dexscreener.module';
import { TokenInfoController } from './token-info.controller';

@Module({
  imports: [DatabaseModule, DexscreenerModule],
  controllers: [TokenInfoController],
  providers: [TokenInfoService],
  exports: [TokenInfoService],
})
export class TokenInfoModule {} 