import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { WebSocketModule } from './websocket.module';
import { TokenInfoModule } from '../integrations/token-info.module';
import { MessagesService } from '../services/messages.service';
import { MessagesController } from '../controllers/messages.controller';
import { WatchedTokensService } from '../services/watched-tokens.service';
import { WatchedTokensController } from '../controllers/watched-tokens.controller';
import { AlertsService } from '../services/alerts.service';
import { AlertsController } from '../controllers/alerts.controller';
import { AlertEvaluatorJob } from '../../queues/jobs/alert-evaluator.job';

@Module({
  imports: [DatabaseModule, WebSocketModule, TokenInfoModule],
  controllers: [MessagesController, WatchedTokensController, AlertsController],
  providers: [MessagesService, WatchedTokensService, AlertsService, AlertEvaluatorJob],
  exports: [MessagesService, WatchedTokensService, AlertsService],
})
export class MessagesModule {}


