import { Module } from '@nestjs/common';
import { TokenPerformanceService } from './token-performance.service';
import { DatabaseModule } from '../../database/database.module'; // Adjusted path
import { TokenInfoModule } from '../../token-info/token-info.module';
import { DexscreenerModule } from '../../dexscreener/dexscreener.module';

@Module({
  imports: [DatabaseModule, TokenInfoModule, DexscreenerModule],
  providers: [TokenPerformanceService],
  exports: [TokenPerformanceService],
})
export class TokenPerformanceModule {}