import { Module } from '@nestjs/common';
import { HeliusWebhookController } from '../controllers/helius-webhook.controller';

@Module({
  imports: [
    // PaymentConfirmationService is exported from the global QueueModule — no import needed.
    // CreditsService is exported from the global CreditsModule — no import needed.
    // JobProgressGateway is exported from the global QueueModule — no import needed.
  ],
  controllers: [HeliusWebhookController],
  providers: [],
  exports: [],
})
export class HeliusWebhookModule {}
