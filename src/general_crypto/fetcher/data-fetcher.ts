import { CoinGeckoClient } from './coingecko-client';
import { CryptoPrice, CryptoDataOptions, StoredCryptoData, RateLimitConfig } from '../types/crypto';
import { createLogger } from '../../utils/logger';
import crypto from 'crypto-js';

const logger = createLogger('DataFetcher');

export class DataFetcher {
  private readonly client: CoinGeckoClient;
  private readonly options: CryptoDataOptions;

  constructor(rateLimitConfig: RateLimitConfig, options: CryptoDataOptions) {
    this.client = new CoinGeckoClient(rateLimitConfig);
    this.options = options;
  }

  private generateSignature(data: CryptoPrice[]): string {
    return crypto.SHA256(JSON.stringify(data)).toString();
  }

  async fetchLatestData(): Promise<StoredCryptoData> {
    try {
      const prices = await this.client.getPrices(this.options);
      const timestamp = new Date().toISOString();
      const signature = this.generateSignature(prices);

      const storedData: StoredCryptoData = {
        timestamp,
        data: prices,
        signature
      };

      logger.info('Successfully fetched latest crypto data', {
        coins: this.options.coins.length,
        timestamp
      });

      return storedData;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to fetch crypto data', {
          error: error.message,
          coins: this.options.coins
        });
      }
      throw error;
    }
  }

  async fetchHistoricalData(days: number = 7): Promise<Map<string, any>> {
    const historicalData = new Map();

    try {
      for (const coin of this.options.coins) {
        const data = await this.client.getMarketChart(coin, this.options.currencies[0], days);
        historicalData.set(coin, data);
        
        logger.info(`Fetched historical data for ${coin}`, {
          days,
          dataPoints: data.prices.length
        });
      }

      return historicalData;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to fetch historical data', {
          error: error.message,
          days
        });
      }
      throw error;
    }
  }

  async fetchDetailedData(): Promise<Map<string, any>> {
    const detailedData = new Map();

    try {
      for (const coin of this.options.coins) {
        const data = await this.client.getDetailedCoinData(coin);
        detailedData.set(coin, data);
        
        logger.info(`Fetched detailed data for ${coin}`);
      }

      return detailedData;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to fetch detailed data', {
          error: error.message
        });
      }
      throw error;
    }
  }
}
