import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DexscreenerService } from './dexscreener.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000, // 10 seconds
      maxRedirects: 5,
    }),
  ],
  providers: [DexscreenerService],
  exports: [DexscreenerService],
})
export class DexscreenerModule {}
