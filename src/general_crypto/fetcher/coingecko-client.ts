import axios, { Axios, AxiosResponse } from 'axios';
import { CryptoPrice, CryptoDataOptions, RateLimitConfig } from '../types/crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('CoinGeckoClient');

export class CoinGeckoClient {
  private readonly api: Axios;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private readonly rateLimitConfig: RateLimitConfig;

  constructor(rateLimitConfig: RateLimitConfig) {
    this.api = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 10000,
    });
    this.rateLimitConfig = rateLimitConfig;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinute = 60 * 1000;
    
    if (now - this.lastRequestTime >= oneMinute) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }

    if (this.requestCount >= this.rateLimitConfig.maxRequestsPerMinute - this.rateLimitConfig.buffer) {
      const waitTime = oneMinute - (now - this.lastRequestTime);
      logger.info(`Rate limit approaching, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastRequestTime = Date.now();
    }

    this.requestCount++;
  }

  async getTopCoins(limit: number = 50): Promise<string[]> {
    try {
      await this.enforceRateLimit();
      const response = await this.api.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: limit,
          page: 1,
          sparkline: false
        }
      });
      return response.data.map((coin: any) => coin.id);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Failed to fetch top coins', { error: error.message });
      }
      throw new Error('Failed to fetch top coins list');
    }
  }

  async getPrices(options: CryptoDataOptions): Promise<CryptoPrice[]> {
    try {
      await this.enforceRateLimit();

      // Use markets endpoint for more detailed data
      const response = await this.api.get('/coins/markets', {
        params: {
          vs_currency: options.currencies[0],
          ids: options.coins.join(','),
          order: 'market_cap_desc',
          per_page: 100,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h'
        }
      });
      
      return response.data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        current_price: coin.current_price,
        market_cap: coin.market_cap,
        market_cap_rank: coin.market_cap_rank,
        total_volume: coin.total_volume,
        high_24h: coin.high_24h,
        low_24h: coin.low_24h,
        price_change_24h: coin.price_change_24h,
        price_change_percentage_24h: coin.price_change_percentage_24h,
        last_updated: coin.last_updated
      }));
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(`API request failed: ${error.message}`);
        if (error.response?.status === 429) {
          logger.warn('Rate limit exceeded, implementing longer delay');
          await new Promise(resolve => setTimeout(resolve, 60000));
          return this.getPrices(options);
        }
      }
      throw new Error('Failed to fetch prices from CoinGecko');
    }
  }

  async getDetailedCoinData(coinId: string): Promise<any> {
    try {
      await this.enforceRateLimit();
      const response = await this.api.get(`/coins/${coinId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Failed to fetch detailed data for ${coinId}`, { error: error.message });
      }
      throw new Error(`Failed to fetch detailed data for ${coinId}`);
    }
  }

  async getMarketChart(coinId: string, currency: string, days: number): Promise<any> {
    try {
      await this.enforceRateLimit();
      const response = await this.api.get(
        `/coins/${coinId}/market_chart`, {
          params: {
            vs_currency: currency,
            days: days,
            interval: 'daily'
          }
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Failed to fetch market chart for ${coinId}`, { error: error.message });
      }
      throw new Error(`Failed to fetch market chart for ${coinId}`);
    }
  }

  // Added method to fetch OHLC data
  async getOhlcData(coinId: string, currency: string, days: number): Promise<Array<[number, number, number, number, number]>> {
    try {
      await this.enforceRateLimit();
      const response = await this.api.get(
        `/coins/${coinId}/ohlc`, {
          params: {
            vs_currency: currency,
            days: days,
          }
        }
      );
      // Return the OHLC data array
      // Expected format: [ [timestamp, open, high, low, close], [...] ]
      return response.data as Array<[number, number, number, number, number]>;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Failed to fetch OHLC data for ${coinId}`, { error: error.message });
      }
      throw new Error(`Failed to fetch OHLC data for ${coinId}`);
    }
  }

  // Added method to get the full list of coins
  async getCoinsList(): Promise<{ id: string; symbol: string; name: string }[]> {
    try {
      await this.enforceRateLimit(); // Apply rate limiting here too
      // The '/coins/list' endpoint doesn't seem to require parameters
      const response = await this.api.get('/coins/list');
      // Expected format: [ { id: "bitcoin", symbol: "btc", name: "Bitcoin" }, ... ]
      return response.data as { id: string; symbol: string; name: string }[];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Failed to fetch coins list', { error: error.message });
      }
      throw new Error('Failed to fetch coins list from CoinGecko');
    }
  }
}
