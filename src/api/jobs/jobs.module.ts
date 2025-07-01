import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { QueueModule } from '../../queues/queue.module';

@Module({
  imports: [QueueModule], // Import QueueModule to access queue services
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {} 