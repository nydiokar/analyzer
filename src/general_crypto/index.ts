import dotenv from 'dotenv';
import { DataFetcher } from './fetcher/data-fetcher';
import { SQLiteManager } from './storage/sqlite-manager';
import { CryptoAnalyzer } from './analysis/analyzer';
import { CoinGeckoClient } from './fetcher/coingecko-client';
import { AlertManager } from './alerts/alert-manager';
import { CryptoDataOptions, RateLimitConfig } from '../types/crypto';
import { createLogger } from '../utils/logger';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CryptoBot } from './bot/bot';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const logger = createLogger('Main');
const LOCK_FILE = path.join(__dirname, '..', 'app.lock');

// Check if another instance is running
function checkForRunningInstance() {
  try {
    // Check if lock file exists
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      
      // Check if process is still running
      try {
        // On Linux/macOS, this would throw if process doesn't exist
        process.kill(pid, 0);
        logger.error(`Another instance is already running with PID ${pid}. Exiting.`);
        return true;
      } catch (e) {
        // Process doesn't exist, we can continue
        logger.info(`Stale lock file found. Previous instance (PID ${pid}) is not running.`);
        // Clean up stale lock file
        fs.unlinkSync(LOCK_FILE);
      }
    }
    
    // Create lock file with current PID
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
    return false;
  } catch (error) {
    logger.error('Error checking for running instance', { error });
    return false;
  }
}

// Clean up lock file on exit
function cleanupLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      logger.info('Lock file removed');
    }
  } catch (error) {
    logger.error('Error cleaning up lock file', { error });
  }
}

// Configuration
const dataOptions: CryptoDataOptions = {
  coins: process.env.COINS_TO_TRACK ? process.env.COINS_TO_TRACK.split(',') : [],
  currencies: (process.env.CURRENCIES || 'usd').split(','),
  includeMarketData: true
};

const rateLimitConfig: RateLimitConfig = {
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '50', 10),
  buffer: parseInt(process.env.RATE_LIMIT_BUFFER || '5', 10)
};

// Update interval in milliseconds
const updateInterval = parseInt(process.env.UPDATE_INTERVAL || '30000', 10);

async function main() {
  try {
    // Check if another instance is running
    if (checkForRunningInstance()) {
      process.exit(1);
    }

    // Register basic cleanup handlers
    process.on('exit', cleanupLockFile);
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      cleanupLockFile();
      process.exit(1);
    });

    // Initialize components
    const fetcher = new DataFetcher(rateLimitConfig, dataOptions);
    const storage = new SQLiteManager();
    const analyzer = new CryptoAnalyzer();
    const alertManager = new AlertManager(
      './alerts',
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID
    );
    
    // Ensure the bot token is available
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    // Initialize and start the bot with error handling
    let bot: CryptoBot | undefined;
    try {
      bot = new CryptoBot(botToken, analyzer);
      bot.start();
      logger.info('Telegram bot started successfully');
    } catch (error) {
      logger.error('Failed to start Telegram bot', { error });
      // Continue without the bot functionality
      logger.info('Continuing without Telegram bot functionality');
    }

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
      updateInterval: `${updateInterval/1000}s`
    });
    
    // Start listening for commands
    alertManager.listenForCommands(analyzer);

    // CLI command handling
    yargs(hideBin(process.argv))
      .command('setalert <coin> <threshold>', 'Set a price alert', (yargs) => {
        yargs
          .positional('coin', {
            describe: 'The coin to set an alert for',
            type: 'string'
          })
          .positional('threshold', {
            describe: 'The price change threshold (%)',
            type: 'number'
          });
      }, (argv) => {
        const { coin, threshold } = argv;
        analyzer.setAlertThreshold(coin as string, threshold as number);
        console.log(`Alert set for ${coin} at ${threshold}%`);
      })
      .help()
      .argv;

    async function collectAndAnalyze() {
      try {
        // Fetch data
        const data = await fetcher.fetchLatestData();
        
        data.data.forEach(price => {
          if (!analyzer.getInitialPrice(price.id)) {
            analyzer.setInitialPrice(price.id, price.current_price);
          }
        });

        // Store prices and perform analysis
        for (const price of data.data) {
          await storage.storePrice(price);
          
          // Get previous day data for better analysis
          const previousDayData = storage.getPreviousDayPrice(price.id);
          
          // Analyze price data
          const analysis = analyzer.analyzeData(price, previousDayData);
          
          // Store analysis results
          await storage.storeAnalysis(analysis);
          
          // Check for volatility alerts
          const threshold = analyzer.getAlertThreshold(price.id);
          if (threshold !== undefined && analysis.signals.isVolatile) {
            await storage.storeAlert(
              price.id,
              price.current_price,
              threshold,
              'volatility'
            );
            await alertManager.sendTelegramMessage(
              `🚨 Alert for ${price.id}: Price change exceeded ${threshold}% threshold!\n` +
              `Current price: $${price.current_price.toFixed(2)}\n` +
              `24h change: ${analysis.metrics.priceChange24h.toFixed(2)}%\n` +
              `Trend: ${analysis.signals.trendDirection === 'up' ? '📈' : analysis.signals.trendDirection === 'down' ? '📉' : '➡️'}`
            );
          }
          
          // Check for volume alerts
          if (analysis.signals.volumeAlert) {
            await storage.storeAlert(
              price.id,
              price.current_price,
              0, // No specific threshold for volume alerts
              'volume'
            );
            await alertManager.sendTelegramMessage(
              `📊 Volume Alert for ${price.id}!\n` +
              `Volume increased by ${analysis.metrics.volumeChange24h.toFixed(2)}%\n` +
              `Current price: $${price.current_price.toFixed(2)}`
            );
          }
        }

        logger.info('Data collection and analysis completed', {
          timestamp: data.timestamp,
          coins: data.data.length
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

    // Update the SIGINT and SIGTERM handlers to check if bot exists
    const shutdownHandler = () => {
      clearInterval(interval);
      storage.close();
      if (bot) {
        bot.stop(); // Stop the bot if it exists
      }
      logger.info('Shutting down...');
      cleanupLockFile();
      process.exit(0);
    };

    // Register the shutdown handlers after the interval is defined
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

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
