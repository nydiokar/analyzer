import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { WalletAnalysisCommands } from './commands';
import { createLogger } from '../../utils/logger';
import axios from 'axios';
import Papa from 'papaparse';
import { DEFAULT_RECENT_TRANSACTION_COUNT } from '../../config/constants';

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
      if (!heliusApiKey) {
        logger.warn('HELIUS_API_KEY is not configured. RPC fallback for transactions will not work.');
        // Potentially throw an error if Helius key is absolutely mandatory for core functions
        // throw new Error('HELIUS_API_KEY is required for bot operation.');
      }
      this.bot = new Telegraf(telegramToken);
      this.commands = new WalletAnalysisCommands(heliusApiKey);
      
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
          '  /analyze <wallet1> [w2] .. [tx_count] - Analyzes addresses. Optional tx count (default: 300, max: 1000).\n\n' +
          '  You can also upload a CSV file with wallet addresses (one per line or in the first column) to analyze multiple wallets (max 100 from file).\n' +
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
          const args = text.split(/\s+/).filter(arg => arg.length > 0);

          if (args.length === 0) {
            await ctx.reply('Please provide at least one wallet address after /analyze. Usage: /analyze <wallet1> [wallet2] ... [tx_count]');
            return;
          }

          let walletAddresses: string[] = [];
          let transactionCount: number | undefined = undefined;
          const MAX_ALLOWED_TX_COUNT = 1000; // Max allowed transactions by user

          // Check if the last argument is a number (potential transaction count)
          const lastArg = args[args.length - 1];
          const potentialTxCount = parseInt(lastArg, 10);

          if (!isNaN(potentialTxCount) && potentialTxCount > 0) {
            // It's a number. Is it a wallet address or a tx_count?
            // If there's only one arg and it's a number, it's ambiguous.
            // Let's assume if it's numeric and there are other args, or if it's clearly not a typical wallet address length, it's a tx_count.
            // A simple heuristic: if it's a number and there are other non-numeric args, it's a count.
            // Or, if it's the ONLY arg and it's a number, treat it as an error for now or assume it's a count if no wallets given.
            // For now, let's assume if the last arg is numeric and args.length > 1, it's a count.
            // If args.length is 1 and it's numeric, it could be a numerical wallet ID (unlikely for Solana) or a tx count for 0 wallets.
            
            // Revised logic: If last arg is numeric, assume it's tx_count. The rest are wallets.
            // If after taking it as tx_count, no wallets remain, then it's an error.
            if (args.length > 1 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lastArg)) { // if lastArg is not a valid wallet format and there are multiple args
                 transactionCount = potentialTxCount;
                 walletAddresses = args.slice(0, -1);
            } else if (args.length === 1 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lastArg) && potentialTxCount > 0 && potentialTxCount <= MAX_ALLOWED_TX_COUNT){
                // Special case: /analyze 500 (intending to analyze 0 wallets with 500 tx count which is not useful)
                // Or it could be a very short (invalid) wallet address that happens to be numeric.
                // Let's require at least one wallet if a tx_count is specified this way.
                await ctx.reply('Please provide wallet addresses before specifying a transaction count. Usage: /analyze <wallet1> [tx_count]');
                return;
            }
             else { // Assume all are wallet addresses
                walletAddresses = [...args];
            }

            if (transactionCount !== undefined) {
                if (transactionCount > MAX_ALLOWED_TX_COUNT) {
                    await ctx.reply(`Transaction count cannot exceed ${MAX_ALLOWED_TX_COUNT}. Using ${MAX_ALLOWED_TX_COUNT}.`);
                    transactionCount = MAX_ALLOWED_TX_COUNT;
                } else if (transactionCount <= 0) {
                    await ctx.reply(`Transaction count must be positive. Using default.`);
                    transactionCount = undefined; // Will use default in commands.ts
                }
            }


          } else { // Last argument is not a number, so all arguments are wallet addresses
            walletAddresses = [...args];
          }
          
          if (walletAddresses.length === 0) {
            await ctx.reply('Please provide at least one wallet address. Usage: /analyze <wallet1> [wallet2] ... [tx_count]');
            return;
          }

          // Max wallets check (e.g., 20) to prevent abuse or overly long processing
          const MAX_WALLETS_PER_REQUEST = 30;
          if (walletAddresses.length > MAX_WALLETS_PER_REQUEST) {
            await ctx.reply(`Too many wallets. Please provide no more than ${MAX_WALLETS_PER_REQUEST} addresses at a time.`);
            return;
          }
          // Pass undefined if user didn't specify, so commands.ts can use default
          await this.commands.analyzeWallets(ctx, walletAddresses, transactionCount);
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
          '  /analyze <wallet1> [w2] .. [tx_count] - Analyzes one or more Solana wallet addresses.\n' +
          '    Optionally, specify transaction count (default: 300, max: 1000). Ex: /analyze ADDR1 ADDR2 500\n\n' +
          'File Upload:\n' +
          '  You can upload a CSV file containing Solana wallet addresses. \n' +
          '  - The bot will look for addresses in the first column, or assume one address per line if only one column exists.\n' +
          '  - A maximum of 100 wallets will be processed from the file.\n' +
          '  - The default transaction count (300) will be used for analysis from files.\n\n' +
          '  /start - Shows the welcome message.\n' +
          '  /help - Shows this help message.'
        );
      });

      // Handler for document uploads
      this.bot.on('document', async (ctx) => {
        if (!ctx.message || !('document' in ctx.message)) return;
        const userId = ctx.from.id;
        const document = ctx.message.document;

        logger.info(`Document received from user ID: ${userId}, Filename: ${document.file_name}, MIME: ${document.mime_type}`);

        if (document.mime_type !== 'text/csv' && document.mime_type !== 'application/vnd.ms-excel' && !document.file_name?.endsWith('.csv')) {
          await ctx.reply('Invalid file type. Please upload a CSV file with wallet addresses.');
          return;
        }

        // Add a check for file size if desired, e.g., Telegram typically allows up to 20MB or 50MB for bots
        // For CSV of wallets, even 1MB is huge. Let's cap at 1MB for safety.
        const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
        if (document.file_size && document.file_size > MAX_FILE_SIZE_BYTES) {
            await ctx.reply(`File is too large (max ${MAX_FILE_SIZE_BYTES / (1024*1024)}MB). Please upload a smaller CSV file.`);
            return;
        }

        try {
          await ctx.reply('🔄 Processing your CSV file...');
          const fileLink = await ctx.telegram.getFileLink(document.file_id);
          const response = await axios.get(fileLink.href, { responseType: 'text' });
          const csvData = response.data;

          const parsed = Papa.parse<string[]>(csvData.trim(), {
            skipEmptyLines: true,
          });

          let extractedWallets: string[] = [];
          if (parsed.errors.length > 0) {
            logger.warn('CSV parsing errors:', parsed.errors);
            // Attempt to extract from first column anyway if some data exists
          }

          if (parsed.data && parsed.data.length > 0) {
            parsed.data.forEach(row => {
              if (row && row.length > 0 && typeof row[0] === 'string') {
                const potentialWallet = row[0].trim();
                if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(potentialWallet)) { // Basic Solana address validation
                  extractedWallets.push(potentialWallet);
                }
              }
            });
          }
          
          extractedWallets = [...new Set(extractedWallets)]; // Remove duplicates

          if (extractedWallets.length === 0) {
            await ctx.reply('No valid Solana wallet addresses found in the first column of your CSV file.');
            return;
          }

          const MAX_WALLETS_FROM_FILE = 100;
          let walletsToProcess = extractedWallets;
          if (extractedWallets.length > MAX_WALLETS_FROM_FILE) {
            walletsToProcess = extractedWallets.slice(0, MAX_WALLETS_FROM_FILE);
            await ctx.reply(
              `Your file contained ${extractedWallets.length} wallets. Processing the first ${MAX_WALLETS_FROM_FILE} wallets. ` +
              `The transaction count for this analysis will be the default (${DEFAULT_RECENT_TRANSACTION_COUNT}).`
            );
          } else {
            await ctx.reply(
                `Found ${walletsToProcess.length} wallets in your file. Processing with default transaction count (${DEFAULT_RECENT_TRANSACTION_COUNT}).`
            );
          }
          
          // Use the default transaction count from constants for file uploads for now
          await this.commands.analyzeWallets(ctx, walletsToProcess, DEFAULT_RECENT_TRANSACTION_COUNT);

        } catch (error) {
          const err = error as Error;
          logger.error('Error processing uploaded CSV file:', err);
          await ctx.reply(`Sorry, there was an error processing your file: ${err.message}`);
        }
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