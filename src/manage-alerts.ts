import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CryptoAnalyzer } from './core/analysis/analyzer';
import { SQLiteManager } from './core/storage/sqlite-manager';
import { CoinGeckoClient } from './core/fetcher/coingecko-client';

const analyzer = new CryptoAnalyzer();
analyzer.loadAlerts(); // Ensure alerts are loaded

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
  }, async (argv) => {
    const { coin, threshold } = argv;
    const isValid = await analyzer.isValidCoin(coin as string);
    if (!isValid) {
      console.error(`Coin ${coin} is not supported.`);
      return;
    }
    analyzer.setAlertThreshold(coin as string, threshold as number);
    console.log(`Alert set for ${coin} at ${threshold}%`);
  })
  .command('fetchall [limit]', 'Fetch all supported tokens and store in database', (yargs) => {
    yargs.positional('limit', {
      describe: 'Limit the number of top tokens to fetch (by market cap)',
      type: 'number',
      default: 250
    });
  }, async (argv) => {
    const limit = argv.limit as number;
    console.log(`Fetching top ${limit} tokens by market cap from CoinGecko...`);
    
    try {
      // Configure CoinGecko client with reasonable rate limits
      const rateLimitConfig = { maxRequestsPerMinute: 30, buffer: 5 };
      const client = new CoinGeckoClient(rateLimitConfig);
      const storage = new SQLiteManager();
      
      // Get top N coins by market cap
      const topCoins = await client.getTopCoins(limit);
      console.log(`Retrieved ${topCoins.length} coins from CoinGecko`);
      
      // Fetch detailed price data in batches to avoid rate limiting
      const batchSize = 50;
      let processed = 0;
      let stored = 0;
      
      for (let i = 0; i < topCoins.length; i += batchSize) {
        const batch = topCoins.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(topCoins.length/batchSize)}`);
        
        const cryptoData = await client.getPrices({
          coins: batch,
          currencies: ['usd'],
          includeMarketData: true
        });
        
        // Store each coin price in the database
        for (const coin of cryptoData) {
          try {
            await storage.storePrice(coin);
            stored++;
          } catch (error) {
            console.error(`Failed to store price for ${coin.id}:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
        
        processed += batch.length;
        console.log(`Progress: ${processed}/${topCoins.length} coins processed, ${stored} stored successfully`);
        
        // Add a small delay between batches to be kind to the API
        if (i + batchSize < topCoins.length) {
          console.log('Waiting before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`\n✅ Completed! Stored ${stored} out of ${topCoins.length} coins in the database.`);
      console.log('You can now use the /market command to view market data from your local database.');
      
    } catch (error) {
      console.error('❌ Error while fetching coins:', error instanceof Error ? error.message : 'Unknown error');
      console.log('Please try again later or check your network connection.');
    }
  })
  .command('listalerts', 'List all alerts', () => {}, () => {
    const alerts = analyzer.getAlertThresholds();
    if (Object.keys(alerts).length === 0) {
      console.log('No alerts set.');
      return;
    }
    
    console.log('Current Alerts:');
    Object.entries(alerts).forEach(([coin, info]) => {
      console.log(`• ${coin}: ${info.percentage}% threshold (set at ${new Date(info.addedAt).toLocaleString()})`);
    });
  })
  .command('removealert <coin>', 'Remove an alert', (yargs) => {
    yargs.positional('coin', {
      describe: 'The coin to remove the alert for',
      type: 'string'
    });
  }, (argv) => {
    const { coin } = argv;
    analyzer.removeAlertThreshold(coin as string);
    console.log(`Alert removed for ${coin}`);
  })
  .command('listsupported', 'List coins with alerts', () => {}, () => {
    const alerts = analyzer.getAlertThresholds();
    if (Object.keys(alerts).length === 0) {
      console.log('No coins with alerts.');
      return;
    }
    
    console.log('Coins with alerts:');
    Object.entries(alerts).forEach(([coin, info]) => {
      console.log(`• ${coin}: ${info.percentage}% threshold (set at ${new Date(info.addedAt).toLocaleString()})`);
    });
  })
  .command('market [hours]', 'Show market summary for the last N hours', (yargs) => {
    yargs.positional('hours', {
      describe: 'Hours to look back',
      type: 'number',
      default: 24
    });
  }, async (argv) => {
    const hours = argv.hours as number;
    const storage = new SQLiteManager();
    
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
    
    console.log(`\n📊 Market Summary (Last ${hours} hours):\n`);
    
    try {
      // Get top gainers excluding stablecoins
      let topMovers = storage.getTopMovers(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id));
      
      // Get top losers excluding stablecoins
      let topLosers = storage.getTopLosers(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id));
      
      // Get highest volatility coins excluding stablecoins
      let marketSummary = storage.getMarketSummary(hours, 15)
        .filter((coin: any) => !isStablecoin(coin.coin_id));
      
      // Always use the database data regardless of values
      displayDatabaseData(topMovers, topLosers, marketSummary);
      
      // Show time interval information
      const timeDisplay = hours === 1 ? '1 hour' : 
                         hours === 24 ? '24 hours (1 day)' : 
                         hours === 168 ? '168 hours (7 days)' : 
                         `${hours} hours`;
                         
      console.log(`\nℹ️ Data shown represents the last ${timeDisplay}.`);
      console.log(`To view different time intervals, use: /market <hours>`);
      console.log(`Examples: /market 1, /market 12, /market 168`);
      
    } catch (error) {
      console.error('\n❌ Error fetching market data:', error instanceof Error ? error.message : 'Unknown error');
      console.log('Please try again later or check the application logs for more details.');
    }
    
    // Helper function to display database data
    function displayDatabaseData(topMovers: any[], topLosers: any[], marketSummary: any[]) {
      // Display top gainers
      console.log(`📈 *Top Gainers:*`);
      if (topMovers && topMovers.length > 0) {
        // Only take top 5 after filtering
        topMovers.slice(0, 5).forEach((coin: any) => {
          const priceChange = coin.price_change_24h !== undefined ? parseFloat(coin.price_change_24h).toFixed(2) : '0.00';
          const currentPrice = coin.current_price !== undefined ? parseFloat(coin.current_price).toFixed(2) : '0.00';
          const arrow = parseFloat(priceChange) > 0 ? '↗️' : parseFloat(priceChange) < 0 ? '↘️' : '➡️';
          console.log(`📈 *${coin.coin_id}*: ${arrow} ${priceChange}% ($${currentPrice})`);
        });
      } else {
        console.log('  No data available yet');
      }
      
      // Display top losers
      console.log('\n📉 *Top Losers:*');
      if (topLosers && topLosers.length > 0) {
        // Only take top 5 after filtering
        topLosers.slice(0, 5).forEach((coin: any) => {
          // Ensure price change is negative for losers
          const rawPriceChange = coin.price_change_24h !== undefined ? parseFloat(coin.price_change_24h) : 0;
          // Make sure we display an absolute value with a minus sign for consistency
          const priceChange = Math.abs(rawPriceChange).toFixed(2);
          const currentPrice = coin.current_price !== undefined ? parseFloat(coin.current_price).toFixed(2) : '0.00';
          // Always use down arrow for losers regardless of the actual sign in the data
          console.log(`📉 *${coin.coin_id}*: ↘️ -${priceChange}% ($${currentPrice})`);
        });
      } else {
        console.log('  No data available yet');
      }
      
      // Display highest volatility
      console.log('\n🔄 *Highest Volatility:*');
      if (marketSummary && marketSummary.length > 0) {
        // Only take top 5 after filtering
        marketSummary.slice(0, 5).forEach((coin: any) => {
          const volatility = coin.volatility_24h !== undefined ? parseFloat(coin.volatility_24h).toFixed(2) : '0.00';
          const volumeChange = coin.volume_change_24h !== undefined ? parseFloat(coin.volume_change_24h).toFixed(2) : '0.00';
          const priceChange = coin.price_change_24h !== undefined ? parseFloat(coin.price_change_24h).toFixed(2) : '0.00';
          const volTrend = parseFloat(volatility) > 5 ? '📊' : parseFloat(volatility) > 2 ? '📈' : '📉';
          console.log(`${volTrend} *${coin.coin_id}*: ${volatility}% volatility${volumeChange !== '0.00' ? `, volume: ${volumeChange}%` : ''}`);
        });
      } else {
        console.log('  No data available yet');
      }
      
      const hasData = (topMovers && topMovers.length > 0) || 
                      (topLosers && topLosers.length > 0) || 
                      (marketSummary && marketSummary.length > 0);
                      
      if (!hasData) {
        console.log('\n⚠️ No market data available yet. Please wait for more data to be collected.');
        console.log('The system is currently collecting initial price data.');
      } else if ((topMovers && topMovers.length < 2) || 
                (topLosers && topLosers.length < 2) || 
                (marketSummary && marketSummary.length < 2)) {
        console.log('\n⚠️ Limited market data available. Analysis might not be comprehensive.');
        console.log('More data is being collected to improve insights.');
      }
    }
  })
  