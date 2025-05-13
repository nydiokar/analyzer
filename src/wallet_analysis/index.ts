import dotenv from 'dotenv';
import { WalletAnalysisBot } from './bot/bot';
import { createLogger } from '@/utils/logger';

// Initialize environment variables
dotenv.config();
console.log(`[index.ts] LOG_LEVEL from process.env after dotenv.config(): ${process.env.LOG_LEVEL}`);

const logger = createLogger('WalletAnalysisBot');

async function main() {
  try {
    // Get required environment variables 
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const heliusApiKey = process.env.HELIUS_API_KEY;

    if (!telegramToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
    }
    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required');
    }

    // Initialize and start the bot
    const bot = new WalletAnalysisBot(telegramToken, heliusApiKey);
    bot.start();

    logger.info('Wallet Analysis Bot initialized and started');
  } catch (error) {
    logger.error('Failed to start Wallet Analysis Bot:', error);
    process.exit(1);
  }
}

// Run the bot if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
} 