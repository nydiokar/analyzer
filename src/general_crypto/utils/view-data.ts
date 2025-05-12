import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '@/utils/logger';

const logger = createLogger('DataViewer');

async function viewLatestData() {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = await fs.readdir(dataDir);
    
    // Get the latest file for each timeframe
    const timeframes = ['1h', '4h', '24h'];
    for (const timeframe of timeframes) {
      const relevantFiles = files
        .filter(f => f.startsWith(`aggregated_${timeframe}_`))
        .sort()
        .reverse();

      if (relevantFiles.length > 0) {
        const latestFile = relevantFiles[0];
        const content = JSON.parse(
          await fs.readFile(path.join(dataDir, latestFile), 'utf-8')
        );

        console.log(`\n=== Latest ${timeframe} Data ===`);
        console.log(`Timestamp: ${content.timestamp}`);
        console.log('\nTop 10 Cryptocurrencies Analysis:');
        
        // Display top 10 coins analysis
        Object.entries(content.data)
          .slice(0, 10)
          .forEach(([coin, data]: [string, any]) => {
            console.log(`\n${coin.toUpperCase()}:`);
            console.log(`  Price Range: ${data.prices[data.prices.length - 1].low} - ${data.prices[data.prices.length - 1].high}`);
            console.log(`  Current: ${data.prices[data.prices.length - 1].close}`);
            console.log(`  Volatility: ${data.analysis.volatility.toFixed(2)}%`);
            console.log(`  Trend: ${data.signals.trend}`);
            console.log(`  Support/Resistance: ${data.analysis.support}/${data.analysis.resistance}`);
            
            if (data.signals.breakout) console.log('  ⚠️ Breakout detected');
            if (data.signals.volumeSpike) console.log('  📈 Volume spike detected');
            if (data.signals.momentumShift) console.log('  🔄 Momentum shift detected');
          });
      }
    }
  } catch (error) {
    logger.error('Failed to view data', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

viewLatestData();
