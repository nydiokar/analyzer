import { Module } from '@nestjs/common';
import { SigBuyersController } from '../controllers/sig-buyers.controller';
import { SigBuyersService } from '../services/sig-buyers.service';

@Module({
  controllers: [SigBuyersController],
  providers: [SigBuyersService],
})
export class SigBuyersModule {}
