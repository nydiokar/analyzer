import { Module } from '@nestjs/common';
import { ShareController } from '../controllers/share.controller';
import { HolderProfileShareService } from '../services/holder-profile-share.service';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [ShareController],
  providers: [HolderProfileShareService],
})
export class ShareModule {}
