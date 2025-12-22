import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DexscreenerService } from '../services/dexscreener.service';
import { DexscreenerPriceProvider } from '../services/dexscreener-price-provider';
import { AggregatedPriceProvider } from '../services/aggregated-price-provider';
import { DatabaseModule } from '../modules/database.module';
import { RedisModule } from '../../queues/config/redis.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000, // 10 seconds
      maxRedirects: 5,
    }),
    DatabaseModule,
    RedisModule,
  ],
  providers: [
    DexscreenerService, // Legacy service (backwards compatibility)
    DexscreenerPriceProvider, // New provider implementation
    AggregatedPriceProvider, // Aggregated provider with fallbacks
    {
      provide: 'IPriceProvider',
      useClass: AggregatedPriceProvider, // Default provider with fallback
    },
  ],
  exports: [
    DexscreenerService, // For existing code
    DexscreenerPriceProvider, // For new code
    'IPriceProvider', // Interface token
  ],
})
export class DexscreenerModule {}
