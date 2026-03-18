import { Module } from '@nestjs/common';
import { JobProgressGateway } from '../shared/job-progress.gateway';
import { MessageGateway } from '../shared/message.gateway';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [RedisModule],
  providers: [JobProgressGateway, MessageGateway],
  exports: [JobProgressGateway, MessageGateway],
})
export class WebSocketModule {} 