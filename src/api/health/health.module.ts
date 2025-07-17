import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../../queues/queue.module';

@Module({
  imports: [
    TerminusModule,
    DatabaseModule,
    QueueModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {} 