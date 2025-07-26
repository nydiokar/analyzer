import { Module } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { DatabaseModule } from '../modules/database.module';
import { DexscreenerModule } from './dexscreener.module';
import { TokenInfoController } from '../controllers/token-info.controller';

@Module({
  imports: [DatabaseModule, DexscreenerModule],
  controllers: [TokenInfoController],
  providers: [TokenInfoService],
  exports: [TokenInfoService],
})
export class TokenInfoModule {} 