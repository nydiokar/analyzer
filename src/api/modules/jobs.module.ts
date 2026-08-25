import { Module } from '@nestjs/common';
import { JobsController } from '../controllers/jobs.controller';
import { JobsService } from '../services/jobs.service';

// QueueModule and DatabaseModule are both @Global() — no explicit import needed.
// Removing the QueueModule import here breaks the 3-module cycle:
// QueueModule → WebSocketModule → (forwardRef) JobsModule → QueueModule
@Module({
  imports: [],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {} 