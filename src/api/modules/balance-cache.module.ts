import { Module } from '@nestjs/common';
import { DatabaseModule } from '../modules/database.module';
import { BalanceCacheService } from '../services/balance-cache.service';
import { TokenInfoModule } from '../integrations/token-info.module';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [DatabaseModule, TokenInfoModule, RedisModule], // BalanceCacheService depends on DatabaseService, TokenInfoService, Redis
  providers: [BalanceCacheService],
  exports: [BalanceCacheService],
})
export class BalanceCacheModule {} 
