import dotenv from 'dotenv';
import { DataFetcher } from './core/fetcher/data-fetcher';
import { StorageManager } from './core/storage/storage-manager';
import { DataAggregator } from './core/storage/data-aggregator';
import { CryptoAnalyzer } from './core/analysis/analyzer';
import { CoinGeckoClient } from './core/fetcher/coingecko-client';
import { CryptoDataOptions, RateLimitConfig, StorageConfig } from './types/crypto';
import { createLogger } from './utils/logger';

// Load environment variables
dotenv.config();

const logger = createLogger('Main');

// Configuration
const dataOptions: CryptoDataOptions = {
  coins: (process.env.COINS_TO_TRACK || 'bitcoin,ethereum').split(','),
  currencies: (process.env.CURRENCIES || 'usd,eur').split(','),
  includeMarketData: true
};

const rateLimitConfig: RateLimitConfig = {
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '50', 10),
  buffer: parseInt(process.env.RATE_LIMIT_BUFFER || '5', 10)
};

const storageConfig: StorageConfig = {
  format: (process.env.STORAGE_FORMAT || 'json') as 'json' | 'csv',
  directory: process.env.DATA_DIR || './data'
};

// Update interval in milliseconds
const updateInterval = parseInt(process.env.UPDATE_INTERVAL || '30000', 10);

async function main() {
  try {
    // Initialize components
    const fetcher = new DataFetcher(rateLimitConfig, dataOptions);
    const storage = new StorageManager(storageConfig);
    const analyzer = new CryptoAnalyzer();
    const aggregator = new DataAggregator(storageConfig.directory);
    
    // Ensure storage directories exist
    await storage.initialize();

    // Get top 50 coins by market cap
    const client = new CoinGeckoClient(rateLimitConfig);
    const topCoins = await client.getTopCoins(50);
    dataOptions.coins = topCoins; // Update coins list dynamically

    logger.info('Tracking top 50 cryptocurrencies', {
      coinsCount: topCoins.length,
      topCoins: topCoins.slice(0, 5).join(', ') + '...'
    });

    logger.info('Starting crypto data collection', {
      coinsTracked: dataOptions.coins.length,
      storage: storageConfig.format,
      updateInterval: `${updateInterval/1000}s`
    });
    
    async function collectAndAnalyze() {
      try {
        // Fetch data
        const data = await fetcher.fetchLatestData();
        const analyses = data.data.map(price => analyzer.analyzeData(price));
        
        // Create enriched data
        const enrichedData = {
          ...data,
          analysis: analyses
        };

        // Process and aggregate data
        await aggregator.addData(enrichedData);

        logger.info('Data collection and analysis completed', {
          timestamp: data.timestamp,
          coins: data.data.length,
          analyses: analyses.map(a => ({
            coin: a.coin,
            trend: a.signals.trendDirection,
            isVolatile: a.signals.isVolatile
          }))
        });

      } catch (error) {
        if (error instanceof Error) {
          logger.error('Error in data collection cycle', { error: error.message });
        }
      }
    }

    // Initial collection
    await collectAndAnalyze();

    // Set up periodic collection with coin list refresh
    const interval = setInterval(async () => {
      try {
        // Refresh top coins list every hour
        if (Date.now() % (60 * 60 * 1000) < updateInterval) {
          const updatedTopCoins = await client.getTopCoins(50);
          dataOptions.coins = updatedTopCoins;
          logger.info('Updated top coins list', {
            coinsCount: updatedTopCoins.length,
            topCoins: updatedTopCoins.slice(0, 5).join(', ') + '...'
          });
        }

        await collectAndAnalyze();
      } catch (error) {
        if (error instanceof Error) {
          logger.error('Collection cycle failed', { error: error.message });
        }
      }
    }, updateInterval);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      clearInterval(interval);
      logger.info('Shutting down...');
      process.exit(0);
    });

  } catch (error) {
    if (error instanceof Error) {
      logger.error('Application failed to start', { error: error.message });
    }
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  logger.error('Unhandled error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
