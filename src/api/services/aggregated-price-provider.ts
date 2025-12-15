import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { IPriceProvider } from '../../types/price-provider.interface';
import { DexscreenerPriceProvider } from './dexscreener-price-provider';

/**
 * AggregatedPriceProvider
 * - Primary: Dexscreener
 * - Fallback: CoinGecko (SOL price only)
 */
@Injectable()
export class AggregatedPriceProvider implements IPriceProvider {
  private readonly logger = new Logger(AggregatedPriceProvider.name);

  constructor(
    private readonly dexProvider: DexscreenerPriceProvider,
    private readonly http: HttpService,
  ) {}

  async fetchSolPrice(): Promise<number> {
    this.logger.log('[SOL Price] Aggregated provider invoked');
    // Primary: CoinGecko simple price API (stable and rate-limit friendly)
    try {
      const resp = await this.http.axiosRef.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { timeout: 5000 }
      );
      const price = resp?.data?.solana?.usd;
      if (Number.isFinite(price) && price > 0) {
        this.logger.log(`[SOL Price] CoinGecko success: $${price}`);
        return price;
      }
      this.logger.warn(`[SOL Price] CoinGecko returned invalid price: ${price}`);
    } catch (err) {
      this.logger.warn(`[SOL Price] CoinGecko fetch failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fallback: Dexscreener
    try {
      const price = await this.dexProvider.fetchSolPrice();
      if (Number.isFinite(price) && price > 0) {
        this.logger.log(`[SOL Price] Dexscreener fallback success: $${price}`);
        return price;
      }
      this.logger.warn(`[SOL Price] Dexscreener fallback returned invalid price: ${price}`);
    } catch (err) {
      this.logger.error(`[SOL Price] Dexscreener fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    throw new Error('Failed to fetch SOL price from all providers');
  }

  async fetchTokenPrices(tokenMints: string[]): Promise<Map<string, number>> {
    // For tokens, keep using Dexscreener path
    return this.dexProvider.fetchTokenPrices(tokenMints);
  }

  async fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void> {
    return this.dexProvider.fetchAndSaveTokenInfo(tokenAddresses);
  }
}
