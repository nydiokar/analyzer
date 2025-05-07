/**
 * @fileoverview KPI Comparison Report Generator
 * 
 * Generates comparative reports across multiple Solana wallets, analyzing their
 * trading behaviors and presenting key performance indicators (KPIs) side-by-side.
 * This script enables cross-wallet comparison to identify patterns and differences
 * in trading strategies.
 * 
 * Key features:
 * - Generates individual wallet behavior reports 
 * - Creates side-by-side comparison tables for all metrics
 * - Identifies and highlights specific trading types (True Flippers, Accumulators, etc.)
 * - Calculates trading style distribution across wallet groups
 * - Presents formatted markdown-style tables for easy viewing
 * 
 * The comparative analysis focuses on token-level metrics rather than wallet-level
 * aggregates, providing more accurate insights into real trading behavior patterns.
 * 
 * Usage:
 * ```
 * npx ts-node src/scripts/kpi-comparison-report.ts --wallets "addr1,addr2,addr3"
 * ```
 * Or using a JSON file:
 * ```
 * npx ts-node src/scripts/kpi-comparison-report.ts --walletsFile "./wallets-example.json"
 * ```
 * 
 * @module KpiComparisonReport
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { analyzeTradingBehavior, generateBehaviorReport } from './wallet-behavior-analyzer';
import { prisma } from '../services/database-service';

// Create logger
const logger = createLogger('KpiComparisonReport');

interface WalletInfo {
  address: string;
  label?: string; // Optional friendly name
}

/**
 * Generate a comparative report for multiple wallets.
 * 
 * This function serves as the main entry point for comparative analysis.
 * It processes multiple wallets in sequence, analyzing each one's trading behavior, 
 * then generates both individual reports and a unified comparison report 
 * highlighting differences and similarities.
 * 
 * @param wallets - Array of wallet information objects containing addresses and optional labels
 * @returns Promise that resolves when all reports have been generated and saved
 */
async function generateComparativeReport(wallets: WalletInfo[]): Promise<void> {
  if (wallets.length === 0) {
    logger.warn('No wallets provided for comparison');
    return;
  }

  logger.info(`Generating comparative report for ${wallets.length} wallets`);
  
  // Collect metrics for all wallets
  const walletMetrics = [];
  
  for (const wallet of wallets) {
    logger.info(`Analyzing wallet: ${wallet.address} ${wallet.label ? `(${wallet.label})` : ''}`);
    try {
      const metrics = await analyzeTradingBehavior(wallet.address);
      walletMetrics.push({
        wallet,
        metrics,
      });
    } catch (error) {
      logger.error(`Error analyzing wallet ${wallet.address}:`, error);
    }
  }
  
  if (walletMetrics.length === 0) {
    logger.warn('Failed to collect metrics for any wallets');
    return;
  }
  
  // Generate individual reports
  for (const { wallet, metrics } of walletMetrics) {
    const report = generateBehaviorReport(wallet.address, metrics);
    const reportPath = saveReport(wallet.address, report, 'individual');
    logger.info(`Saved individual report for ${wallet.address} to ${reportPath}`);
  }
  
  // Generate comparative report
  const compReport = generateComparisonReport(walletMetrics);
  const compReportPath = saveReport('comparative', compReport, 'comparison');
  logger.info(`Saved comparative report to ${compReportPath}`);
  
  logger.info('Report generation complete');
}

/**
 * Generate a report comparing multiple wallets' trading metrics.
 * 
 * Creates a formatted report with markdown-style tables comparing all 
 * major trading KPIs across wallets. Includes sections for:
 * - Trading style classification
 * - Buy/sell patterns with token-level symmetry
 * - Trading time distribution
 * - Activity summary
 * - Key insights with automated identification of notable patterns
 * 
 * @param walletMetrics - Array of objects containing wallet info and calculated metrics
 * @returns Formatted string containing the complete comparative report
 */
function generateComparisonReport(walletMetrics: Array<{ wallet: WalletInfo, metrics: any }>): string {
  const lines = [
    '=== COMPARATIVE WALLET BEHAVIOR ANALYSIS ===',
    `Generated on: ${new Date().toISOString()}`,
    `Wallets analyzed: ${walletMetrics.length}`,
    '',
    '=== TRADING STYLE CLASSIFICATION ===',
    '',
  ];
  
  // Table header for trading styles
  lines.push('| Wallet | Trading Style | Confidence | Flipper Score | Avg Hold Time | Median Hold Time | % Under 1h |');
  lines.push('|--------|--------------|------------|---------------|---------------|-----------------|------------|');
  
  // Table rows for each wallet
  for (const { wallet, metrics } of walletMetrics) {
    const walletId = wallet.label || wallet.address.substring(0, 8);
    lines.push(
      `| ${walletId} | ${metrics.tradingStyle} | ${(metrics.confidenceScore * 100).toFixed(1)}% | ` +
      `${metrics.flipperScore.toFixed(3)} | ${metrics.averageFlipDurationHours.toFixed(1)}h | ` +
      `${metrics.medianHoldTime.toFixed(1)}h | ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}% |`
    );
  }
  
  lines.push('');
  
  // === BUY/SELL PATTERNS ===
  lines.push('=== BUY/SELL PATTERNS ===');
  lines.push('');
  
  // Table for buy/sell patterns
  lines.push('| Wallet | Token-Level Symmetry | Buy:Sell Ratio | Sequence Consistency | Complete Pairs |');
  lines.push('|--------|----------------------|----------------|----------------------|----------------|');
  
  for (const { wallet, metrics } of walletMetrics) {
    const walletId = wallet.label || wallet.address.substring(0, 8);
    lines.push(
      `| ${walletId} | ${(metrics.buySellSymmetry * 100).toFixed(1)}% | ` +
      `${metrics.buySellRatio.toFixed(2)}:1 | ` +
      `${(metrics.sequenceConsistency * 100).toFixed(1)}% | ` +
      `${metrics.completePairsCount}/${metrics.tokensWithBothBuyAndSell} |`
    );
  }
  
  lines.push('');
  
  // === TRADING TIME DISTRIBUTION ===
  lines.push('=== TRADING TIME DISTRIBUTION ===');
  lines.push('');
  
  // Table for trading windows (more granular now)
  lines.push('| Wallet | <30min | 30-60min | 1-4h | 4-8h | 8-24h | 1-7d | >7d |');
  lines.push('|--------|--------|----------|------|------|-------|------|-----|');
  
  for (const { wallet, metrics } of walletMetrics) {
    const walletId = wallet.label || wallet.address.substring(0, 8);
    lines.push(
      `| ${walletId} | ${(metrics.tradingTimeDistribution.ultraFast * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.veryFast * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.fast * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.moderate * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.dayTrader * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.swing * 100).toFixed(1)}% | ` +
      `${(metrics.tradingTimeDistribution.position * 100).toFixed(1)}% |`
    );
  }
  
  lines.push('');
  
  // === ACTIVITY SUMMARY ===
  lines.push('=== ACTIVITY SUMMARY ===');
  lines.push('');
  
  // Table for activity metrics
  lines.push('| Wallet | Unique Tokens | Tokens w/ Both | Total Buys | Total Sells | Total Trades |');
  lines.push('|--------|---------------|----------------|------------|-------------|--------------|');
  
  for (const { wallet, metrics } of walletMetrics) {
    const walletId = wallet.label || wallet.address.substring(0, 8);
    lines.push(
      `| ${walletId} | ${metrics.uniqueTokensTraded} | ${metrics.tokensWithBothBuyAndSell} | ` +
      `${metrics.totalBuyCount} | ${metrics.totalSellCount} | ${metrics.totalTradeCount} |`
    );
  }
  
  lines.push('');
  
  // === KEY INSIGHTS ===
  lines.push('=== KEY INSIGHTS ===');
  lines.push('');
  
  // Look for True Flippers
  const trueFlippers = walletMetrics.filter(({ metrics }) => 
    metrics.tradingStyle === 'True Flipper' && metrics.confidenceScore > 0.7
  );
  
  if (trueFlippers.length > 0) {
    lines.push('TRUE FLIPPERS:');
    for (const { wallet, metrics } of trueFlippers) {
      const walletId = wallet.label || wallet.address;
      lines.push(`- ${walletId}: ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}% of trades under 1h, ` + 
        `${(metrics.buySellSymmetry * 100).toFixed(1)}% token-level symmetry (balanced token-by-token)`);
    }
    lines.push('');
  }
  
  // Look for Fast Traders
  const fastTraders = walletMetrics.filter(({ metrics }) => 
    metrics.tradingStyle === 'Fast Trader' && metrics.confidenceScore > 0.6
  );
  
  if (fastTraders.length > 0) {
    lines.push('FAST TRADERS:');
    for (const { wallet, metrics } of fastTraders) {
      const walletId = wallet.label || wallet.address;
      lines.push(`- ${walletId}: ${(metrics.percentTradesUnder4Hours * 100).toFixed(1)}% of trades under 4h, avg hold time ${metrics.averageFlipDurationHours.toFixed(1)}h`);
    }
    lines.push('');
  }
  
  // Look for Accumulators
  const accumulators = walletMetrics.filter(({ metrics }) => 
    metrics.tradingStyle === 'Accumulator' && metrics.confidenceScore > 0.6
  );
  
  if (accumulators.length > 0) {
    lines.push('ACCUMULATORS:');
    for (const { wallet, metrics } of accumulators) {
      const walletId = wallet.label || wallet.address;
      lines.push(`- ${walletId}: Buy/Sell ratio ${metrics.buySellRatio.toFixed(2)}:1, ${metrics.tokensWithBothBuyAndSell}/${metrics.uniqueTokensTraded} tokens with both buys & sells`);
    }
    lines.push('');
  }
  
  // Look for Distributors
  const distributors = walletMetrics.filter(({ metrics }) => 
    metrics.tradingStyle === 'Distributor' && metrics.confidenceScore > 0.6
  );
  
  if (distributors.length > 0) {
    lines.push('DISTRIBUTORS:');
    for (const { wallet, metrics } of distributors) {
      const walletId = wallet.label || wallet.address;
      lines.push(`- ${walletId}: Sell/Buy ratio ${(1/metrics.buySellRatio).toFixed(2)}:1, ${metrics.totalSellCount} sells vs ${metrics.totalBuyCount} buys`);
    }
    lines.push('');
  }
  
  // Compare trading speeds
  if (walletMetrics.length > 1) {
    const sorted = [...walletMetrics].sort((a, b) => 
      a.metrics.medianHoldTime - b.metrics.medianHoldTime
    );
    
    const fastest = sorted[0];
    const slowest = sorted[sorted.length - 1];
    
    lines.push('TRADING SPEED COMPARISON:');
    lines.push(`- Fastest trader: ${fastest.wallet.label || fastest.wallet.address.substring(0, 8)} (${fastest.metrics.medianHoldTime.toFixed(1)}h median hold time)`);
    lines.push(`- Slowest trader: ${slowest.wallet.label || slowest.wallet.address.substring(0, 8)} (${slowest.metrics.medianHoldTime.toFixed(1)}h median hold time)`);
    lines.push('');
  }
  
  // Overall conclusion
  lines.push('TRADING STYLE DISTRIBUTION:');
  
  // Count by trading style
  const styleCount: Record<string, number> = {};
  for (const { metrics } of walletMetrics) {
    styleCount[metrics.tradingStyle] = (styleCount[metrics.tradingStyle] || 0) + 1;
  }
  
  for (const [style, count] of Object.entries(styleCount)) {
    const percentage = (count / walletMetrics.length * 100).toFixed(1);
    lines.push(`- ${style}: ${count} wallets (${percentage}%)`);
  }
  
  return lines.join('\n');
}

/**
 * Save a report to a file
 */
function saveReport(id: string, content: string, type: 'individual' | 'comparison'): string {
  const dir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${id.substring(0, 8)}_${type}_report_${timestamp}.txt`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, content);
  return filepath;
}

/**
 * CLI entry point
 */
if (require.main === module) {
  // Parse command line arguments
  const yargs = require('yargs/yargs');
  const { hideBin } = require('yargs/helpers');
  
  const argv = yargs(hideBin(process.argv))
    .usage('$0 [options]')
    .option('wallets', {
      alias: 'w',
      description: 'Comma-separated list of wallet addresses to compare',
      type: 'string',
    })
    .option('walletsFile', {
      alias: 'f',
      description: 'Path to JSON file containing wallet addresses',
      type: 'string',
    })
    .help()
    .version(false)
    .example('$0 --wallets "addr1,addr2,addr3"', 'Analyze three wallet addresses')
    .example('$0 --walletsFile "./wallets-example.json"', 'Analyze wallets from a JSON file')
    .parse();
  
  // Load wallets from arguments or file
  let wallets: WalletInfo[] = [];
  
  if (argv.wallets) {
    wallets = argv.wallets.split(',').map((address: string) => ({ address: address.trim() }));
  } else if (argv.walletsFile) {
    try {
      const fileContent = fs.readFileSync(argv.walletsFile, 'utf-8');
      const walletsData = JSON.parse(fileContent);
      
      if (Array.isArray(walletsData)) {
        wallets = walletsData.map((item: any) => {
          // Handle both simple address strings and objects with address/label
          if (typeof item === 'string') {
            return { address: item } as WalletInfo;
          } else if (item && typeof item === 'object' && item.address) {
            return { 
              address: item.address, 
              label: item.label || undefined 
            } as WalletInfo;
          }
          return null;
        }).filter((w): w is WalletInfo => w !== null); // Type guard to ensure non-null
      }
    } catch (error) {
      console.error(`Error loading wallets file: ${error}`);
      process.exit(1);
    }
  }
  
  // If no wallets provided, use example wallets
  if (wallets.length === 0) {
    console.log('No wallets provided. Using example wallets...');
    // These would be replaced with actual addresses for the real implementation
    wallets = [
      { address: '28825R3yfxFwQXTPxXxwe3K7mJRssRwXcNBtWArbJcJAhXc4r4', label: 'FastFlipper' },
      { address: 'So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk', label: 'HodlWallet' },
      { address: 'As7HjL7dzzvbRbaD3WCun47robib2kmAKRXMvjHkSMB5', label: 'TrueFlipper' }
    ];
  }
  
  // Run the analysis
  (async () => {
    try {
      await generateComparativeReport(wallets);
      console.log('Comparative analysis complete.');
    } catch (error) {
      console.error('Error during comparative analysis:', error);
    } finally {
      await prisma.$disconnect();
    }
  })();
} 