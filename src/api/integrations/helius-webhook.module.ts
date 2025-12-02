import { Module } from '@nestjs/common';
import { HeliusWebhookController } from '../controllers/helius-webhook.controller';

@Module({
  imports: [
    // No imports needed - HeliusModule, QueueModule, and ConfigModule are all global from AppModule
  ],
  controllers: [HeliusWebhookController],
  providers: [],
  exports: [],
})
export class HeliusWebhookModule {}
