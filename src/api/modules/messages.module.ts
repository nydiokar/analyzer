import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { WebSocketModule } from './websocket.module';
import { TokenInfoModule } from '../integrations/token-info.module';
import { MessagesService } from '../services/messages.service';
import { MessagesController } from '../controllers/messages.controller';
import { WatchedTokensService } from '../services/watched-tokens.service';
import { WatchedTokensController } from '../controllers/watched-tokens.controller';

@Module({
  imports: [DatabaseModule, WebSocketModule, TokenInfoModule],
  controllers: [MessagesController, WatchedTokensController],
  providers: [MessagesService, WatchedTokensService],
  exports: [MessagesService, WatchedTokensService],
})
export class MessagesModule {}


