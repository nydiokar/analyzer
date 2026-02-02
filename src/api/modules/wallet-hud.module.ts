import { Module } from '@nestjs/common';
import { TokenInfoModule } from '../integrations/token-info.module';
import { RedisModule } from '../../queues/config/redis.module';
import { WalletHudController } from '../controllers/wallet-hud.controller';
import { WalletHudService } from '../services/wallet-hud.service';

/**
 * Module for Wallet HUD (Heads-Up Display) functionality.
 *
 * Provides high-signal, at-a-glance wallet metrics for:
 * - Trackers page (batch fetching for favorite wallets)
 * - Wallet profiles (expanded view with detailed metrics)
 * - Discovery and search results (compact inline display)
 * - Holder analysis tools (quick evaluation)
 *
 * Design Philosophy: Like a poker HUD - show only the most critical signals
 * that let you evaluate a wallet at a glance. No clutter, maximum signal density.
 *
 * Caching: 24-hour Redis cache, invalidated immediately on wallet analysis completion
 */
@Module({
  imports: [
    TokenInfoModule,  // Required for SOL price (USD conversion)
    RedisModule,      // Required for caching
  ],
  controllers: [WalletHudController],
  providers: [WalletHudService],
  exports: [WalletHudService], // Export service for potential use in other modules
})
export class WalletHudModule {}
