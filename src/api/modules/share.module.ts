import { Module } from '@nestjs/common';
import { ShareController } from '../controllers/share.controller';
import { HolderProfileShareService } from '../services/holder-profile-share.service';

@Module({
  controllers: [ShareController],
  providers: [HolderProfileShareService],
})
export class ShareModule {}
