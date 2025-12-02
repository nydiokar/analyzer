import { Module } from '@nestjs/common';
import { HolderProfilesCacheService } from '../services/holder-profiles-cache.service';

@Module({
  providers: [HolderProfilesCacheService],
  exports: [HolderProfilesCacheService],
})
export class HolderProfilesCacheModule {}
