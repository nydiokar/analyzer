import { Context } from 'telegraf';
import { CryptoAnalyzer } from '../core/analysis/analyzer';
import { SQLiteManager } from '../core/storage/sqlite-manager';

export class BotCommands {
  private storage: SQLiteManager;

  constructor(private analyzer: CryptoAnalyzer) {
    this.storage = new SQLiteManager();
  }

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

  async showMarketSummary(ctx: Context, hours: number = 24) {
    try {
      const message = [`📊 Market Summary (Last ${hours} hours):`];
      
      // Define stablecoins to filter out - expanded list with various formats
      const stablecoins = [
        'usdt', 'tether', 
        'usdc', 'usd-coin', 'usd-c', 'usdcoin',
        'busd', 'binance-usd', 
        'dai', 
        'tusd', 'true-usd', 
        'usdp', 'pax-dollar',
        'usdd', 
        'gusd', 'gemini-dollar',
        'susd', 'nusd', 'susds', 'sai', 
        'frax', 
        'lusd', 
        'usdb',
        'usdx', 
        'ethena-usde'
      ];
      
      // Helper function to check if a coin is a stablecoin
      const isStablecoin = (coinId: string) => {
        coinId = coinId.toLowerCase();
        // Direct match
        if (stablecoins.includes(coinId)) return true;
        // Contains stable names
        if (coinId.includes('usd') || coinId.includes('stable') || coinId.includes('peg')) return true;
        // Return false if no match
        return false;
      };
      
      // Get top gainers excluding stablecoins
      const topMovers = this.storage.getTopMovers(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id))
        .slice(0, 5);
      
      if (topMovers.length > 0) {
        message.push('\n📈 *Top Gainers:*');
        topMovers.forEach((coin: any) => {
          const priceChange = coin.price_change_24h !== undefined ? parseFloat(coin.price_change_24h).toFixed(2) : '0.00';
          const currentPrice = coin.current_price !== undefined ? parseFloat(coin.current_price).toFixed(2) : '0.00';
          const arrow = parseFloat(priceChange) > 0 ? '↗️' : parseFloat(priceChange) < 0 ? '↘️' : '➡️';
          message.push(`📈 *${coin.coin_id}*: ${arrow} ${priceChange}% ($${currentPrice})`);
        });
      } else {
        message.push('  No data available yet');
      }
      
      // Get top losers excluding stablecoins
      const topLosers = this.storage.getTopLosers(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id))
        .slice(0, 5);
      
      if (topLosers.length > 0) {
        message.push('\n📉 *Top Losers:*');
        topLosers.forEach((coin: any) => {
          // Ensure price change is negative for losers
          const rawPriceChange = coin.price_change_24h !== undefined ? parseFloat(coin.price_change_24h) : 0;
          // Make sure we display an absolute value with a minus sign for consistency
          const priceChange = Math.abs(rawPriceChange).toFixed(2);
          const currentPrice = coin.current_price !== undefined ? parseFloat(coin.current_price).toFixed(2) : '0.00';
          // Always use down arrow for losers regardless of the actual sign in the data
          message.push(`📉 *${coin.coin_id}*: ↘️ -${priceChange}% ($${currentPrice})`);
        });
      } else {
        message.push('  No data available yet');
      }
      
      // Get highest volatility excluding stablecoins
      const marketSummary = this.storage.getMarketSummary(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id))
        .slice(0, 5);
      
      if (marketSummary.length > 0) {
        message.push('\n🔄 *Highest Volatility:*');
        marketSummary.forEach((coin: any) => {
          const volatility = coin.volatility_24h !== undefined ? parseFloat(coin.volatility_24h).toFixed(2) : '0.00';
          const volumeChange = coin.volume_change_24h !== undefined ? parseFloat(coin.volume_change_24h).toFixed(2) : '0.00';
          const volTrend = parseFloat(volatility) > 5 ? '📊' : parseFloat(volatility) > 2 ? '📈' : '📉';
          message.push(`${volTrend} *${coin.coin_id}*: ${volatility}% volatility${volumeChange !== '0.00' ? `, volume: ${volumeChange}%` : ''}`);
        });
      } else {
        message.push('  No data available yet');
      }
      
      // Add time interval information
      const timeDisplay = hours === 1 ? '1 hour' : 
                         hours === 24 ? '24 hours (1 day)' : 
                         hours === 168 ? '168 hours (7 days)' : 
                         `${hours} hours`;
                         
      message.push(`\nℹ️ Data shown represents the last ${timeDisplay}.`);
      message.push(`To view different time intervals, use: /market <hours>`);
      message.push(`Examples: /market 1, /market 12, /market 168`);
      
      await ctx.reply(message.join('\n'));
    } catch (error) {
      const err = error as Error;
      await ctx.reply(`❌ Error showing market summary: ${err.message}`);
    }
  }
} 