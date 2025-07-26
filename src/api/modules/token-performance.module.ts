import { Module } from '@nestjs/common';
import { TokenPerformanceService } from '../services/token-performance.service';
import { DatabaseModule } from '../modules/database.module'; // Adjusted path
import { TokenInfoModule } from '../integrations/token-info.module';
import { DexscreenerModule } from '../integrations/dexscreener.module';

@Module({
  imports: [DatabaseModule, TokenInfoModule, DexscreenerModule],
  providers: [TokenPerformanceService],
  exports: [TokenPerformanceService],
})
export class TokenPerformanceModule {}