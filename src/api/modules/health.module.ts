import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../controllers/health.controller';
import { DatabaseModule } from '../modules/database.module';
import { QueueModule } from '../../queues/queue.module';
import { HolderProfilesCacheModule } from '../modules/holder-profiles-cache.module';

@Module({
  imports: [
    TerminusModule,
    DatabaseModule,
    QueueModule,
    HolderProfilesCacheModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {} 