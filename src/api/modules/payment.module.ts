import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from '../services/payment.service';
import { PaymentController, UserCreditsController } from '../controllers/payment.controller';
import { PricingController } from '../controllers/pricing.controller';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentController, UserCreditsController, PricingController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
