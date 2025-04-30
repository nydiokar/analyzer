import { SQLiteManager } from '../general_crypto/storage/sqlite-manager';
import { CryptoAnalyzer } from '../general_crypto/analysis/analyzer';
import { createLogger } from './logger';

const logger = createLogger('TestDataPopulator');

/**
 * Utility to populate the database with realistic test data
 * This helps diagnose and fix issues with zero values in analysis records
 */
async function populateTestData() {
  try {
    const storage = new SQLiteManager();
    const analyzer = new CryptoAnalyzer();
    
    // Reset tables for clean testing (optional)
    const db = (storage as any).db; // Access the internal db object
    db.exec('DELETE FROM analysis');
    db.exec('DELETE FROM prices');
    
    logger.info('Deleted existing data from database for clean testing');
    
    // Sample coin data with realistic values
    const sampleCoins = [
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        current_price: 81500,
        market_cap: 1600000000000,
        market_cap_rank: 1,
        total_volume: 25000000000,
        high_24h: 82500,
        low_24h: 80500,
        price_change_24h: 950,
        price_change_percentage_24h: 4.78,
        market_cap_change_percentage_24h: 4.25,
        last_updated: new Date().toISOString()
      },
      {
        id: 'ethereum',
        symbol: 'eth',
        name: 'Ethereum',
        current_price: 1580,
        market_cap: 190000000000,
        market_cap_rank: 2,
        total_volume: 12000000000,
        high_24h: 1610,
        low_24h: 1560,
        price_change_24h: 45,
        price_change_percentage_24h: 5.92,
        market_cap_change_percentage_24h: 5.45,
        last_updated: new Date().toISOString()
      },
      {
        id: 'ripple',
        symbol: 'xrp',
        name: 'XRP',
        current_price: 2.0,
        market_cap: 4300000000,
        market_cap_rank: 4,
        total_volume: 1200000000,
        high_24h: 2.1,
        low_24h: 1.9,
        price_change_24h: 0.18,
        price_change_percentage_24h: 9.40,
        market_cap_change_percentage_24h: 9.15,
        last_updated: new Date().toISOString()
      },
      {
        id: 'binancecoin',
        symbol: 'bnb',
        name: 'Binance Coin',
        current_price: 575,
        market_cap: 82000000000,
        market_cap_rank: 5,
        total_volume: 800000000,
        high_24h: 580,
        low_24h: 570,
        price_change_24h: 13.5,
        price_change_percentage_24h: 2.42,
        market_cap_change_percentage_24h: 2.35,
        last_updated: new Date().toISOString()
      },
      {
        id: 'hedera-hashgraph',
        symbol: 'hbar',
        name: 'Hedera',
        current_price: 0.17,
        market_cap: 5600000000,
        market_cap_rank: 15,
        total_volume: 45000000,
        high_24h: 0.18,
        low_24h: 0.165,
        price_change_24h: 0.025,
        price_change_percentage_24h: 17.03,
        market_cap_change_percentage_24h: 16.85,
        last_updated: new Date().toISOString()
      },
      {
        id: 'ondo-finance',
        symbol: 'ondo',
        name: 'Ondo Finance',
        current_price: 0.84,
        market_cap: 150000000,
        market_cap_rank: 120,
        total_volume: 8000000,
        high_24h: 0.85,
        low_24h: 0.73,
        price_change_24h: 0.11,
        price_change_percentage_24h: 14.28,
        market_cap_change_percentage_24h: 14.1,
        last_updated: new Date().toISOString()
      },
      {
        id: 'tokenize-xchange',
        symbol: 'tkx',
        name: 'Tokenize Xchange',
        current_price: 31.9,
        market_cap: 250000000,
        market_cap_rank: 95,
        total_volume: 12000000,
        high_24h: 32.4,
        low_24h: 27.8,
        price_change_24h: 4.0,
        price_change_percentage_24h: 14.24,
        market_cap_change_percentage_24h: 14.0,
        last_updated: new Date().toISOString()
      },
      {
        id: 'the-open-network',
        symbol: 'ton',
        name: 'The Open Network',
        current_price: 2.95,
        market_cap: 6000000000,
        market_cap_rank: 14,
        total_volume: 35000000,
        high_24h: 2.98,
        low_24h: 2.92,
        price_change_24h: -0.024,
        price_change_percentage_24h: -0.81,
        market_cap_change_percentage_24h: -0.85,
        last_updated: new Date().toISOString()
      }
    ];
    
    // Store prices and generate analysis for each coin
    for (const coin of sampleCoins) {
      // Store initial price data
      await storage.storePrice(coin);
      
      // Initialize price for analyzer
      analyzer.setInitialPrice(coin.id, coin.current_price);
      
      // Generate analysis data
      const analysis = analyzer.analyzeData(coin);
      
      // Store the analysis
      await storage.storeAnalysis(analysis);
      
      logger.info(`Added test data for ${coin.id} with price_change ${coin.price_change_percentage_24h}% and volatility ${analysis.metrics.volatility24h}%`);
    }
    
    logger.info('Successfully populated test data');
    logger.info('You can now run the "market" command to see actual data in the summary');
    
  } catch (error) {
    logger.error('Error populating test data', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

// Run the population script
populateTestData(); 