import { Module } from '@nestjs/common';
import { JobProgressGateway } from './job-progress.gateway';

@Module({
  providers: [JobProgressGateway],
  exports: [JobProgressGateway], // Export so other modules can inject it
})
export class WebSocketModule {} 