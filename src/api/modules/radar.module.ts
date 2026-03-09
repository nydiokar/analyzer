import { Module } from '@nestjs/common';
import { RadarController } from '../controllers/radar.controller';
import { RadarSnapshotService } from '../services/radar-snapshot.service';
import { BalanceCacheModule } from './balance-cache.module';
import { TokenInfoModule } from '../integrations/token-info.module';

@Module({
  imports: [BalanceCacheModule, TokenInfoModule],
  controllers: [RadarController],
  providers: [RadarSnapshotService],
})
export class RadarModule {}
