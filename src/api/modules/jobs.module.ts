import { Module } from '@nestjs/common';
import { JobsController } from '../controllers/jobs.controller';
import { JobsService } from '../services/jobs.service';
import { QueueModule } from '../../queues/queue.module';
import { EvmModule } from '../integrations/evm.module';

@Module({
  imports: [
    QueueModule, // Import QueueModule to access queue services + REDIS_CLIENT (globally available)
    EvmModule,   // Provides EvmSyncService for the evm-sync endpoint
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService], // Export JobsService for use in other modules (C3 task)
})
export class JobsModule {} 