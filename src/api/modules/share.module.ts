import { Module } from '@nestjs/common';
import { ShareController } from '../controllers/share.controller';
import { HolderProfileShareService } from '../services/holder-profile-share.service';
import { HolderProfilesCacheModule } from './holder-profiles-cache.module';

@Module({
  imports: [HolderProfilesCacheModule],
  controllers: [ShareController],
  providers: [HolderProfileShareService],
})
export class ShareModule {}
