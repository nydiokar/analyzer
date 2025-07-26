import { Module } from '@nestjs/common';
import { JobsController } from '../controllers/jobs.controller';
import { JobsService } from '../services/jobs.service';
import { QueueModule } from '../../queues/queue.module';

@Module({
  imports: [QueueModule], // Import QueueModule to access queue services
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService], // Export JobsService for use in other modules (C3 task)
})
export class JobsModule {} 