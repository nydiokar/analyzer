import { Injectable, Logger } from '@nestjs/common';
import { IPriceProvider } from '../../types/price-provider.interface';
import { DexscreenerService as CoreDexscreenerService } from '../../core/services/dexscreener-service';
import { DatabaseService } from './database.service';
import { HttpService } from '@nestjs/axios';

/**
 * Dexscreener implementation of the IPriceProvider interface.
 * 
 * This provider fetches price data from Dexscreener API.
 * It's a thin adapter that implements the standard interface,
 * making it easy to swap out for other providers (Bird.io, CoinGecko, etc.)
 */
@Injectable()
export class DexscreenerPriceProvider implements IPriceProvider {
  private readonly logger = new Logger(DexscreenerPriceProvider.name);
  private coreDexscreenerService: CoreDexscreenerService;

  constructor(
    private databaseService: DatabaseService,
    private httpService: HttpService,
  ) {
    this.coreDexscreenerService = new CoreDexscreenerService(
      this.databaseService,
      this.httpService,
    );
    this.logger.log('DexscreenerPriceProvider initialized');
  }

  async fetchSolPrice(): Promise<number> {
    this.logger.debug('[Provider] Fetching SOL price from Dexscreener');
    return this.coreDexscreenerService.getSolPrice();
  }

  async fetchTokenPrices(tokenMints: string[]): Promise<Map<string, number>> {
    this.logger.debug(`[Provider] Fetching prices for ${tokenMints.length} tokens from Dexscreener`);
    return this.coreDexscreenerService.getTokenPrices(tokenMints);
  }

  async fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void> {
    this.logger.debug(`[Provider] Fetching and saving info for ${tokenAddresses.length} tokens from Dexscreener`);
    return this.coreDexscreenerService.fetchAndSaveTokenInfo(tokenAddresses);
  }
}

