import { Context } from 'telegraf';
import { CryptoAnalyzer } from '../core/analysis/analyzer';

export class BotCommands {
  constructor(private analyzer: CryptoAnalyzer) {}

  async addCoin(ctx: Context, coinId: string, percentage: number) {
    try {
      const isValid = await this.analyzer.isValidCoin(coinId.toLowerCase());
      if (!isValid) {
        await ctx.reply(`❌ Coin ${coinId} is not valid.`);
        return;
      }

      // Set alert threshold for the coin
      this.analyzer.setAlertThreshold(coinId.toLowerCase(), percentage);
      await ctx.reply(`✅ Alert set for ${coinId} at ${percentage}% threshold.`);
    } catch (error) {
      const err = error as Error;
      await ctx.reply(`❌ Error setting alert: ${err.message}`);
    }
  }

  async removeCoin(ctx: Context, coinId: string) {
    try {
      const currentThreshold = this.analyzer.getAlertThreshold(coinId.toLowerCase());
      if (currentThreshold === undefined) {
        await ctx.reply(`⚠️ No alert set for coin ${coinId}.`);
        return;
      }

      // Remove alert threshold for the coin
      this.analyzer.removeAlertThreshold(coinId.toLowerCase());
      await ctx.reply(`✅ Alert removed for ${coinId}.`);
    } catch (error) {
      const err = error as Error;
      await ctx.reply(`❌ Error removing alert: ${err.message}`);
    }
  }

  async listCoins(ctx: Context) {
    try {
      const alerts = this.analyzer.getAlertThresholds();
      const alertEntries = Object.entries(alerts);
      
      if (alertEntries.length === 0) {
        await ctx.reply('📝 No coins are currently being monitored.');
        return;
      }
      
      const message = `📝 Monitored Coins:\n${alertEntries.map(([coin, info]) => 
        `• ${coin}: ${info.percentage}% threshold (set at ${new Date(info.addedAt).toLocaleString()})`).join('\n')}`;
      await ctx.reply(message);
    } catch (error) {
      const err = error as Error;
      await ctx.reply(`❌ Error listing coins: ${err.message}`);
    }
  }
} 