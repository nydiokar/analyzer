import { Module } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { DatabaseModule } from '../modules/database.module';
import { DexscreenerModule } from './dexscreener.module';
import { TokenInfoController } from '../controllers/token-info.controller';
import { RedisModule } from '../../queues/config/redis.module';
import { SparklineService } from '../services/sparkline.service';

@Module({
  imports: [DatabaseModule, DexscreenerModule, RedisModule],
  controllers: [TokenInfoController],
  providers: [TokenInfoService, SparklineService],
  exports: [TokenInfoService, SparklineService],
})
export class TokenInfoModule {} 