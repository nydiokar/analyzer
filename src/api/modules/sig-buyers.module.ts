import { Module } from '@nestjs/common';
import { SigBuyersController } from '../controllers/sig-buyers.controller';
import { SigBuyersService } from '../services/sig-buyers.service';

@Module({
  controllers: [SigBuyersController],
  providers: [SigBuyersService],
  exports: [SigBuyersService],
})
export class SigBuyersModule {}
