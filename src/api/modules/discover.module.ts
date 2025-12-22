import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { DiscoverController } from '../controllers/discover.controller';
import { DiscoverService } from '../services/discover.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DiscoverController],
  providers: [DiscoverService],
})
export class DiscoverModule {}
