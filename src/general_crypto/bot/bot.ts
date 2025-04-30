import { Telegraf } from 'telegraf';
import { BotCommands } from './commands';
import { CryptoAnalyzer } from '../general_crypto/analysis/analyzer';

export class CryptoBot {
  private bot: Telegraf;
  private commands: BotCommands;

  constructor(token: string, analyzer: CryptoAnalyzer) {
    this.bot = new Telegraf(token);
    this.commands = new BotCommands(analyzer);
    this.setupCommands();
  }

  private setupCommands() {
    // Add coin command
    this.bot.command('addcoin', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const coinId = parts[1];
      const percentage = parseFloat(parts[2]);

      if (!coinId || isNaN(percentage)) {
        await ctx.reply('❌ Please provide a valid coin ID and percentage. Usage: /addcoin <coin_id> <percentage>');
        return;
      }

      await this.commands.addCoin(ctx, coinId, percentage);
    });

    // Remove coin command
    this.bot.command('removecoin', async (ctx) => {
      const coinId = ctx.message.text.split(' ')[1];
      if (!coinId) {
        await ctx.reply('❌ Please provide a coin ID. Usage: /removecoin <coin_id>');
        return;
      }
      await this.commands.removeCoin(ctx, coinId);
    });

    // List coins command
    this.bot.command('listcoins', async (ctx) => {
      await this.commands.listCoins(ctx);
    });

    // Market summary command
    this.bot.command('market', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const hours = parts.length > 1 ? parseInt(parts[1]) : 24;
      
      if (isNaN(hours) || hours <= 0) {
        await ctx.reply('❌ Please provide a valid number of hours. Usage: /market [hours]');
        return;
      }
      
      await this.commands.showMarketSummary(ctx, hours);
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      const helpMessage = `
🤖 Available Commands:
/addcoin <coin_id> <percentage> - Add an alert for a coin with threshold
/removecoin <coin_id> - Remove an alert for a coin
/listcoins - List all monitored coins with their thresholds
/market [hours] - Show market summary for the last N hours (default: 24)
/help - Show this help message
      `;
      await ctx.reply(helpMessage);
    });
  }

  start() {
    // Add a handler for polling errors
    this.bot.catch((err: any) => {
      console.error('Telegram bot error:', err);
      
      // If we get a conflict error, stop the bot
      if (err.message && err.message.includes('terminated by other getUpdates request')) {
        console.log('Conflict detected, stopping bot...');
        this.stop();
      }
    });

    // Launch the bot with specific settings to avoid conflicts
    this.bot.launch({
      dropPendingUpdates: true
    }).then(() => {
      console.log('Bot started successfully!');
    }).catch((err: Error) => {
      console.error('Failed to start bot:', err.message);
    });

    // Handle graceful shutdown
    process.once('SIGINT', () => this.stop());
    process.once('SIGTERM', () => this.stop());
  }

  stop() {
    // Close the bot gracefully
    this.bot.stop('SIGINT');
    console.log('Bot stopped gracefully');
  }
} 