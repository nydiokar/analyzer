import { Module } from '@nestjs/common';
import { HolderProfilesCacheService } from '../services/holder-profiles-cache.service';
import { DatabaseModule } from './database.module';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [HolderProfilesCacheService],
  exports: [HolderProfilesCacheService],
})
export class HolderProfilesCacheModule {}
