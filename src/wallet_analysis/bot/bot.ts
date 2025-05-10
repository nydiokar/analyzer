import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { WalletAnalysisCommands } from './commands';
import { createLogger } from '../../utils/logger';

const logger = createLogger('WalletAnalysisBot');

// Load allowed User IDs and Admin ID from environment variables
const allowedUserIdsString = process.env.ALLOWED_TELEGRAM_USER_IDS || '';
const ALLOWED_USER_IDS: number[] = allowedUserIdsString.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id) && id !== 0);

const adminTelegramIdString = process.env.ADMIN_TELEGRAM_ID || '';
const ADMIN_TELEGRAM_ID: number | null = adminTelegramIdString ? parseInt(adminTelegramIdString.trim(), 10) : null;

if (ALLOWED_USER_IDS.length === 0) {
    logger.warn(
        'WARN: ALLOWED_TELEGRAM_USER_IDS is not configured or empty in .env. ' +
        'The bot will not respond to any users unless this is intended for extreme lockdown. ' +
        'For development, you might want to add your own Telegram User ID.'
    );
} else {
    logger.info(`Bot access restricted to User IDs: ${ALLOWED_USER_IDS.join(', ')}`);
}

if (ADMIN_TELEGRAM_ID) {
    logger.info(`Admin notifications for unauthorized attempts will be sent to User ID: ${ADMIN_TELEGRAM_ID}`);
}

export class WalletAnalysisBot {
  private bot: Telegraf<Context>;
  private commands: WalletAnalysisCommands;

  constructor(telegramToken: string, heliusApiKey: string) {
    try {
      logger.info('Initializing bot with token prefix:', telegramToken.substring(0, 10) + '...');
      this.bot = new Telegraf(telegramToken);
      // Assuming WalletAnalysisCommands constructor does not require heliusApiKey if all calls are Prisma-based
      this.commands = new WalletAnalysisCommands();
      
      // Apply authorization middleware BEFORE command setup
      this.setupAuthorization();
      this.setupCommands();

    } catch (error) {
      logger.error('Error in bot constructor:', error);
      throw error; // Rethrow to be caught by main index.ts
    }
  }

  private setupAuthorization() {
    this.bot.use(async (ctx, next) => {
      if (ctx.from && ALLOWED_USER_IDS.includes(ctx.from.id)) {
        logger.debug(`Authorized access by user: ${ctx.from.id} (${ctx.from.username})`);
        await next(); // User is allowed, proceed to command handling
      } else {
        const userId = ctx.from?.id || 'UnknownID';
        const username = ctx.from?.username || 'NoUsername';
        logger.warn(`Unauthorized access attempt by User ID: ${userId} (${username})`);
        await ctx.reply("Sorry, you are not authorized to use this bot.");
        
        if (ADMIN_TELEGRAM_ID && ctx.from) {
          try {
            let commandText = 'N/A';
            // Type guard for message text
            if (ctx.message && 'text' in ctx.message) {
              commandText = ctx.message.text;
            }
            await this.bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
              `Unauthorized access attempt: 
User: ${username} (ID: ${userId}) 
Chat ID: ${ctx.chat?.id}
Command: ${commandText}`);
          } catch (e) {
            logger.error("Failed to send unauthorized access notification to admin:", e);
          }
        }
      }
    });
  }

  private setupCommands() {
    try {
      this.bot.start(async (ctx) => {
        logger.info(`/start command received from user ID: ${ctx.from.id}`);
        await ctx.reply(
          'Welcome to the Wallet Analysis Bot!\n\n' +
          'Available commands:\n' +
          '  /analyze <wallet1> [wallet2] ... - Analyzes wallet addresses.\n' +
          '  /help - Shows this help message.'
        );
      });

      // Use telegraf/filters to ensure message is of type text for /analyze
      this.bot.command('analyze', async (ctx) => {
        const userId = ctx.from.id;
        // Check if the message is a text message before accessing ctx.message.text
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/analyze command from user ID: ${userId}, message: ${ctx.message.text}`);
          const text = ctx.message.text.replace('/analyze', '').trim();
          const walletAddresses = text.split(/\s+/).filter(addr => addr.length > 0);

          if (walletAddresses.length === 0) {
            await ctx.reply('Please provide at least one wallet address after /analyze.');
            return;
          }
          // Max wallets check (e.g., 20) to prevent abuse or overly long processing
          const MAX_WALLETS_PER_REQUEST = 20;
          if (walletAddresses.length > MAX_WALLETS_PER_REQUEST) {
            await ctx.reply(`Too many wallets. Please provide no more than ${MAX_WALLETS_PER_REQUEST} addresses at a time.`);
            return;
          }

          await this.commands.analyzeWallets(ctx, walletAddresses);
        } else {
          // This case might be triggered if /analyze is sent via a non-text method or by a channel post if bot is in a channel
          logger.warn(`/analyze command received without text content from user ID: ${userId} or in unsupported context.`);
          await ctx.reply("Invalid /analyze command. Please provide wallet addresses as text after the command.");
        }
      });

      this.bot.help(async (ctx) => {
        logger.info(`/help command received from user ID: ${ctx.from.id}`);
        await ctx.reply(
          'Wallet Analysis Bot Help:\n\n' +
          'Available commands:\n' +
          '  /analyze <wallet1> [wallet2] ... - Analyzes one or more Solana wallet addresses.\n' +
          '    Example: /analyze SOL_ADDRESS_1 SOL_ADDRESS_2\n\n' +
          '  /start - Shows the welcome message.\n' +
          '  /help - Shows this help message.'
        );
      });
      logger.info('Bot commands setup completed.');
    } catch (error) {
      logger.error('Error setting up bot commands:', error);
      throw error;
    }
  }

  public start() {
    logger.info('Starting Wallet Analysis Bot...');
    this.bot.launch({
        dropPendingUpdates: true, // Optional: drops pending updates while bot was offline
    }).then(() => {
        logger.info('Wallet Analysis Bot successfully launched and connected to Telegram.');
    }).catch(error => {
        logger.error('Failed to launch the bot:', error);
        // Specific check for common polling conflict error
        if (error.message && error.message.includes('409: Conflict')) {
            logger.error('Error 409 Conflict: Another instance of the bot might be running with the same token.');
        }
        // process.exit(1); // Consider if you want to exit or try to recover
    });

    // Enable graceful stop
    process.once('SIGINT', () => this.stop('SIGINT'));
    process.once('SIGTERM', () => this.stop('SIGTERM'));
  }

  public stop(signal: string) {
    logger.info(`Stopping bot due to ${signal} signal...`);
    this.bot.stop(signal);
    logger.info('Bot stopped gracefully.');
    process.exit(0);
  }
} 