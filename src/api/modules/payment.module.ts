import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from '../services/payment.service';
import { PaymentController, UserCreditsController } from '../controllers/payment.controller';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentController, UserCreditsController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
