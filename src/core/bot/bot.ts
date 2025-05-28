import { Telegraf, Context } from 'telegraf';
import { WalletAnalysisCommands } from './commands';
import { createLogger } from 'core/utils/logger';
import axios from 'axios';
import Papa from 'papaparse';
import { DEFAULT_RECENT_TRANSACTION_COUNT } from '../../config/constants';
import { commandList } from './commandRegistry';

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

/**
 * @class WalletAnalysisBot
 * @description Main class for the Telegram bot. Handles initialization, authorization, command setup, and lifecycle management.
 */
export class WalletAnalysisBot {
  private bot: Telegraf<Context>;
  private commands: WalletAnalysisCommands;

  /**
   * Creates an instance of WalletAnalysisBot.
   * @param {string} telegramToken - The Telegram bot token.
   * @param {string} heliusApiKey - The API key for Helius services, used by WalletAnalysisCommands.
   * @throws {Error} If there's an issue initializing Telegraf or WalletAnalysisCommands.
   */
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

  /**
   * Sets up authorization middleware for the bot.
   * Only allows users listed in `ALLOWED_USER_IDS` to interact with the bot.
   * Sends a notification to `ADMIN_TELEGRAM_ID` if an unauthorized user attempts access.
   * @private
   */
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

  /**
   * Sets up command handlers for the bot.
   * This includes /start, /analyze, /help, and document (CSV file) uploads.
   * @private
   */
  private setupCommands() {
    try {
      this.bot.start(async (ctx) => {
        logger.info(`/start command received from user ID: ${ctx.from.id}`);
        await ctx.reply(generateHelpOrStartMessage('start'), { parse_mode: 'HTML' });
      });

      // Use telegraf/filters to ensure message is of type text for /correlation_analysis
      this.bot.command('correlation_analysis', async (ctx) => {
        const userId = ctx.from.id;
        // Check if the message is a text message before accessing ctx.message.text
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/correlation_analysis command from user ID: ${userId}, message: ${ctx.message.text}`);
          const text = ctx.message.text.replace('/correlation_analysis', '').trim();
          const args = text.split(/\s+/).filter(arg => arg.length > 0);

          if (args.length === 0) {
            await ctx.reply('Please provide at least one wallet address after /correlation_analysis. Usage: /correlation_analysis <wallet1> [wallet2] ... [tx_count]');
            return;
          }

          let walletAddresses: string[] = [];
          let transactionCount: number | undefined = undefined;
          const MAX_ALLOWED_TX_COUNT = 1500; // Max allowed transactions by user

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
                // Special case: /correlation_analysis 500 (intending to analyze 0 wallets with 500 tx count which is not useful)
                // Or it could be a very short (invalid) wallet address that happens to be numeric.
                // Let's require at least one wallet if a tx_count is specified this way.
                await ctx.reply('Please provide wallet addresses before specifying a transaction count. Usage: /correlation_analysis <wallet1> [tx_count]');
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
            await ctx.reply('Please provide at least one wallet address. Usage: /correlation_analysis <wallet1> [wallet2] ... [tx_count]');
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
          // This case might be triggered if /correlation_analysis is sent via a non-text method or by a channel post if bot is in a channel
          logger.warn(`/correlation_analysis command received without text content from user ID: ${userId} or in unsupported context.`);
          await ctx.reply("Invalid /correlation_analysis command. Please provide wallet addresses as text after the command.");
        }
      });

      this.bot.command('analyze_behavior', async (ctx) => {
        const userId = ctx.from.id;
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/analyze_behavior command from user ID: ${userId}, message: ${ctx.message.text}`);
          const text = ctx.message.text.replace('/analyze_behavior', '').trim();
          const args = text.split(/\s+/).filter(arg => arg.length > 0);

          let walletAddresses: string[] = [];
          let transactionCount: number | undefined = undefined;
          const MAX_ALLOWED_TX_COUNT = 5000;

          if (args.length === 0) {
            await ctx.reply('Please provide at least one wallet address. Usage: /analyze_behavior <wallet1> [wallet2...] [tx_count]');
            return;
          }

          const lastArg = args[args.length - 1];
          const potentialTxCount = parseInt(lastArg, 10);

          if (!isNaN(potentialTxCount) && potentialTxCount > 0 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lastArg)) {
            if (args.length > 1) { // Ensure there's at least one wallet address before tx_count
                transactionCount = Math.min(potentialTxCount, MAX_ALLOWED_TX_COUNT);
                walletAddresses = args.slice(0, -1).filter(arg => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg));
            } else { // Only arg is a number, treat as error or prompt for wallet
                await ctx.reply('Please provide wallet addresses before specifying a transaction count.');
                return;
            }
          } else { // All args are wallet addresses
            walletAddresses = args.filter(arg => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg));
          }

          if (walletAddresses.length === 0) {
            await ctx.reply('No valid Solana wallet addresses provided. Usage: /analyze_behavior <wallet1> [wallet2...] [tx_count]');
            return;
          }
          // TODO: Later, add logic for N > 10 wallets -> file output
          await this.commands.analyzeWalletBehavior(ctx, walletAddresses, transactionCount);
        }
      });

      this.bot.command('analyze_advanced', async (ctx) => {
        const userId = ctx.from.id;
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/analyze_advanced command from user ID: ${userId}, message: ${ctx.message.text}`);
          const rawInputText = ctx.message.text.replace('/analyze_advanced', '').trim();
          
          // Enhanced address parsing
          // 1. Replace <br> tags (case-insensitive) with a common separator (e.g., space)
          const textWithoutBr = rawInputText.replace(/<br\s*\/?\>/gi, ' ');

          // 2. Split by a regex that includes spaces, commas, semicolons, newlines
          // Also, trim each part and filter out empty strings resulting from multiple separators.
          const potentialAddresses: string[] = textWithoutBr
            .split(/[\\s,;\\n\"']+/) // Split by spaces, commas, semicolons, newlines, quotes
            .map(arg => arg.trim())
            .filter(arg => arg.length > 0);

          let walletAddresses: string[] = [];
          const invalidInputs: { input: string; reason: string }[] = [];
          let transactionCount: number | undefined = undefined;
          const MAX_ALLOWED_TX_COUNT = 5000;

          if (potentialAddresses.length === 0) {
            await ctx.reply('Please provide at least one wallet address. Usage: /analyze_advanced <wallet1> [wallet2...] [tx_count]');
            return;
          }

          // Check if the last argument is a transaction count
          const lastArg = potentialAddresses[potentialAddresses.length - 1];
          const potentialTxCount = parseInt(lastArg, 10);
          let addressesToProcess = potentialAddresses;

          if (!isNaN(potentialTxCount) && potentialTxCount > 0 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lastArg)) {
            if (potentialAddresses.length > 1) { // Ensure there's at least one wallet address before tx_count
                transactionCount = Math.min(potentialTxCount, MAX_ALLOWED_TX_COUNT);
                addressesToProcess = potentialAddresses.slice(0, -1);
            } else { // Only arg is a number, treat as error
                await ctx.reply('Please provide wallet addresses before specifying a transaction count. Usage: /analyze_advanced <wallet1> [wallet2...] [tx_count]');
                return;
            }
          }

          // Validate each potential address
          const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
          addressesToProcess.forEach(input => {
            // Further clean each input: remove any remaining quotes just in case
            const cleanedInput = input.replace(/['"]+/g, '');
            if (solanaAddressRegex.test(cleanedInput)) {
              if (!walletAddresses.includes(cleanedInput)) { // Add if valid and not already added
                walletAddresses.push(cleanedInput);
              }
            } else {
              invalidInputs.push({ input: input, reason: 'Invalid Solana address format or characters.' });
            }
          });
          
          // Deduplicate walletAddresses (already handled by pushing only if not includes, but good as a safeguard)
          walletAddresses = Array.from(new Set(walletAddresses));


          let feedbackMessage = "";
          if (invalidInputs.length > 0) {
            feedbackMessage += "<b>⚠️ Encountered issues with some inputs:</b>\\n";
            invalidInputs.forEach(invalid => {
              // Ensure user-provided input is escaped for HTML
              const escapedInput = invalid.input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              feedbackMessage += `• <code>${escapedInput}</code>: ${invalid.reason}\\n`;
            });
            feedbackMessage += "\\n";
          }

          if (walletAddresses.length === 0) {
            feedbackMessage += "No valid Solana wallet addresses to process after filtering. Please check your input.";
            await ctx.replyWithHTML(feedbackMessage);
            return;
          }

          feedbackMessage += `✅ Processing ${walletAddresses.length} valid wallet address(es).`;
          if (transactionCount) {
            feedbackMessage += ` (Transaction count set to: ${transactionCount})`;
          }
          await ctx.replyWithHTML(feedbackMessage);
          
          // Proceed with analysis if valid addresses exist
          await this.commands.analyzeAdvancedStats(ctx, walletAddresses, transactionCount);
        }
      });

      this.bot.command('pnl_overview', async (ctx) => {
        const userId = ctx.from.id;
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/pnl_overview command from user ID: ${userId}, message: ${ctx.message.text}`);
          const text = ctx.message.text.replace('/pnl_overview', '').trim();
          const walletAddresses = text.split(/\s+/).filter(arg => arg.length > 0 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg));

          if (walletAddresses.length === 0) {
            await ctx.reply('Please provide at least one valid Solana wallet address. Usage: /pnl_overview <wallet1> [wallet2] ...');
            return;
          }
          // TODO: Later, add logic for N > 10 wallets -> file output
          await this.commands.getPnlOverview(ctx, walletAddresses); // Pass array
        } else {
          logger.warn(`/pnl_overview command received without text content from user ID: ${userId} or in unsupported context.`);
          await ctx.reply('This command requires text input. Please try again with /pnl_overview <wallet_address1> [wallet_address2] ...');
        }
      });

      this.bot.command('behavior_summary', async (ctx) => {
        const userId = ctx.from.id;
        if (ctx.message && 'text' in ctx.message) {
          logger.info(`/behavior_summary command from user ID: ${userId}, message: ${ctx.message.text}`);
          const text = ctx.message.text.replace('/behavior_summary', '').trim();
          const walletAddresses = text.split(/\s+/).filter(arg => arg.length > 0 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg));

          if (walletAddresses.length === 0) {
            await ctx.reply('Please provide at least one valid Solana wallet address. Usage: /behavior_summary <wallet1> [wallet2] ...');
            return;
          }
          // TODO: Later, add logic for N > 10 wallets -> file output
          await this.commands.getBehaviorSummary(ctx, walletAddresses); // Pass array
        } else {
          logger.warn(`/behavior_summary command received without text content from user ID: ${userId} or in unsupported context.`);
          await ctx.reply('This command requires text input. Please try again with /behavior_summary <wallet_address1> [wallet_address2] ...');
        }
      });

      this.bot.help(async (ctx) => {
        logger.info(`/help command received from user ID: ${ctx.from.id}`);
        await ctx.reply(generateHelpOrStartMessage('help'), { parse_mode: 'HTML' });
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

          const MAX_WALLETS_FROM_FILE = 300;
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

  /**
   * Starts the bot and begins polling for updates from Telegram.
   * Logs successful launch or any errors encountered.
   * @public
   */
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

  /**
   * Stops the bot gracefully.
   * @param {string} signal - The signal that triggered the stop (e.g., 'SIGINT', 'SIGTERM').
   * @public
   */
  public stop(signal: string) {
    logger.info(`Stopping bot due to ${signal} signal...`);
    this.bot.stop(signal);
    logger.info('Bot stopped gracefully.');
    process.exit(0);
  }
}

// --- Helper to generate grouped, styled help/start message ---
function generateHelpOrStartMessage(type: 'help' | 'start'): string {
  if (type === 'start') {
    let msg = '🚀 <b>Welcome to the Wallet Analysis Bot!</b>\n\n';
    msg += 'Quickly analyze wallet behavior, discover advanced stats, or find correlations.\n\n';
    msg += '<b>Try these commands:</b>\n';

    const exampleCommands = commandList.filter(cmd => cmd.name === '/analyze_behavior' || cmd.name === '/correlation_analysis');
    for (const cmd of exampleCommands) {
      msg += `${cmd.emoji} <b>${cmd.name}</b> — ${cmd.description}\n`;
      msg += `  <i>Usage:</i> <code>${cmd.usage}</code>\n`;
    }
    msg += '\nYou can also upload a CSV file with wallet addresses.\n\n';
    msg += 'Type /help for a full list of commands and more details.';
    return msg.trim();
  }

  // Help message generation (full list)
  const groupOrder = ['Analysis', 'Reporting', 'General']; // File Upload is handled separately
  const groupTitles: Record<string, string> = {
    'Analysis': '📊 <b>Reporting Commands</b>',
    'Reporting': '🧠 <b>Overview Commands</b>',
    'General': '⚙️ <b>General Commands</b>'
  };
  let msg = '🤖 <b>Wallet Analysis Bot Help</b>\n\n';

  const grouped: Record<string, typeof commandList> = {};
  for (const cmd of commandList) {
    if (!grouped[cmd.group]) grouped[cmd.group] = [];
    grouped[cmd.group].push(cmd);
  }

  for (const group of groupOrder) {
    if (grouped[group] && grouped[group].length > 0) {
      msg += `${groupTitles[group]}\n`;
      for (const cmd of grouped[group]) {
        // For /help, exclude /start from the detailed list if it's in 'General'
        if (cmd.name === '/start' && group === 'General') continue;
        
        msg += `${cmd.emoji} <b>${cmd.name}</b> — ${cmd.description}\n`;
        msg += `  <i>Usage:</i> <code>${cmd.usage}</code>\n`;
        if (cmd.example && cmd.name !== '/start') { // Don't show example for /start in /help
             msg += `  <i>Example:</i> <code>${cmd.example}</code>\n`;
        }
      }
      msg += '\n';
    }
  }

  msg += '📂 <b>File Upload</b>\n';
  msg += 'Upload a CSV file with wallet addresses for Correlation Analysis (one per line or in the first column) to analyze multiple wallets (max 300 from file).\n\n';

  return msg.trim();
} 