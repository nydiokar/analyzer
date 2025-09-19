import { Module } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { TokenHoldersService } from '../services/token-holders.service';
import { DatabaseModule } from '../modules/database.module';
import { DexscreenerModule } from './dexscreener.module';
import { HeliusModule } from './helius.module';
import { TokenInfoController } from '../controllers/token-info.controller';

@Module({
  imports: [DatabaseModule, DexscreenerModule, HeliusModule],
  controllers: [TokenInfoController],
  providers: [TokenInfoService, TokenHoldersService],
  exports: [TokenInfoService, TokenHoldersService],
})
export class TokenInfoModule {} 