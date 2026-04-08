import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SolanaTrackerService } from '../services/solana-tracker.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
  ],
  providers: [SolanaTrackerService],
  exports: [SolanaTrackerService],
})
export class SolanaTrackerModule {}
