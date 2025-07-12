import { Module } from '@nestjs/common';
import { JobProgressGateway } from './job-progress.gateway';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [RedisModule],
  providers: [JobProgressGateway],
  exports: [JobProgressGateway], // Export so other modules can inject it
})
export class WebSocketModule {} 