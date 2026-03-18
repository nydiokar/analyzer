import { Module } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { TokenHoldersService } from '../services/token-holders.service';
import { DatabaseModule } from '../modules/database.module';
import { DexscreenerModule } from './dexscreener.module';
import { HeliusModule } from './helius.module';
import { TokenInfoController } from '../controllers/token-info.controller';
import { RedisModule } from '../../queues/config/redis.module';
import { SparklineService } from '../services/sparkline.service';

@Module({
  imports: [DatabaseModule, DexscreenerModule, HeliusModule, RedisModule],
  controllers: [TokenInfoController],
  providers: [TokenInfoService, TokenHoldersService, SparklineService],
  exports: [TokenInfoService, TokenHoldersService, SparklineService],
})
export class TokenInfoModule {} 
