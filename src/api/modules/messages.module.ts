import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { WebSocketModule } from './websocket.module';
import { MessagesService } from '../services/messages.service';
import { MessagesController } from '../controllers/messages.controller';

@Module({
  imports: [DatabaseModule, WebSocketModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}


