import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DexscreenerService } from '../services/dexscreener.service';
import { DexscreenerPriceProvider } from '../services/dexscreener-price-provider';
import { DatabaseModule } from '../modules/database.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000, // 10 seconds
      maxRedirects: 5,
    }),
    DatabaseModule,
  ],
  providers: [
    DexscreenerService, // Legacy service (backwards compatibility)
    DexscreenerPriceProvider, // New provider implementation
    {
      provide: 'IPriceProvider',
      useClass: DexscreenerPriceProvider, // Default provider
    },
  ],
  exports: [
    DexscreenerService, // For existing code
    DexscreenerPriceProvider, // For new code
    'IPriceProvider', // Interface token
  ],
})
export class DexscreenerModule {}
