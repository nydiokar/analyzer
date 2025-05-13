// This script is used to analyze the price changes of a cryptocurrency over a given number of days
// It calculates technical indicators and generates basic report of potential buy and sell signals on % change

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { CoinGeckoClient } from '../fetcher/coingecko-client';
import { RateLimitConfig } from '../types/crypto';
import { createLogger } from '@/utils/logger';
import { calculateSMA, calculateRSI } from '../utils/technical-indicators';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('PriceChangeReporter');

const REPORT_DIR = './analysis_reports';
const SUMMARY_FILE = path.join(REPORT_DIR, 'analysis_summary.md');

const OPPORTUNITY_THRESHOLD = 5; // +/- 5% change for daily change
const SMA_SHORT_PERIOD = 20;
const SMA_LONG_PERIOD = 50;
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70; // Standard levels
const RSI_OVERSOLD = 30;   // Standard levels

// Maximum recommended days to request from CoinGecko for proper daily OHLC data
const MAX_RECOMMENDED_DAYS = 30;

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequestsPerMinute: parseInt(process.env.COINGECKO_RATE_LIMIT_MAX_REQ ?? '30', 10),
  buffer: parseInt(process.env.COINGECKO_RATE_LIMIT_BUFFER ?? '5', 10),
};

interface ReportData {
  Date: string;
  'Coin ID': string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  'Daily Change %': number;
  'Opportunity Highlight': string;
  'SMA Short': number | string;
  'SMA Long': number | string;
  'RSI': number | string;
  'Interpretation Notes': string;
}

// Interface to track signals with dates
interface SignalEvent {
  date: string;
  price: number;
  change: number;
  type: 'Buy' | 'Sell';
}

async function runAnalysis(coinId: string, days: number) {
  // Warn if requested days exceed recommended maximum
  if (days > MAX_RECOMMENDED_DAYS) {
    logger.warn(`Requested ${days} days exceeds recommended maximum of ${MAX_RECOMMENDED_DAYS} days for proper daily OHLC data.`);
    logger.warn(`CoinGecko may return less granular data for longer periods. Consider using a shorter timeframe.`);
  }
  
  logger.info(`Starting OHLC analysis with indicators & interpretation for ${coinId} using CoinGecko API for the last ${days} days...`);
  const client = new CoinGeckoClient(DEFAULT_RATE_LIMIT);

  try {
    // Use standard client to fetch OHLC data
    const ohlcData = await client.getOhlcData(coinId, 'usd', days);

    if (!ohlcData || ohlcData.length === 0) {
      logger.error(`No OHLC data found for coin ID: "${coinId}".`);
      logger.info(`If you're unsure about the correct coin ID, try using the find-coin-id utility:`);
      logger.info(`  npm run find-coin-id <query>    (search by symbol or name)`);
      logger.info(`Example: npm run find-coin-id BTC`);
      return;
    }
    logger.info(`Fetched ${ohlcData.length} OHLC records from CoinGecko.`);

    // Validate OHLC data - check if we're getting valid varying prices
    const sampleSize = Math.min(5, ohlcData.length);
    const samples = ohlcData.slice(0, sampleSize);
    
    let invalidDataPoints = 0;
    for (const [_, open, high, low, close] of samples) {
      if (open === high && high === low && low === close) {
        invalidDataPoints++;
      }
    }
    
    if (invalidDataPoints > 0) {
      logger.warn(`Found ${invalidDataPoints}/${sampleSize} data points with identical OHLC values.`);
      logger.warn(`This suggests CoinGecko is providing single daily prices rather than proper OHLC.`);
      logger.warn(`For better results, try using a shorter timeframe (--days ${MAX_RECOMMENDED_DAYS} or lower).`);
    }

    // Log first few records to debug time intervals
    if (ohlcData.length >= 3) {
      const sample = ohlcData.slice(0, 3);
      const formattedSample = sample.map(([timestamp, open, high, low, close]) => {
        return `${new Date(timestamp).toISOString().split('T')[0]}: OHLC [${open.toFixed(2)}, ${high.toFixed(2)}, ${low.toFixed(2)}, ${close.toFixed(2)}]`;
      });
      logger.info(`Sample OHLC records: ${formattedSample.join(' | ')}`);
    }

    // Extract closing prices for technical indicators
    const closingPrices = ohlcData.map(entry => entry[4]); // Index 4 is Close price
    
    // Calculate technical indicators
    const smaShort = calculateSMA(closingPrices, SMA_SHORT_PERIOD);
    const smaLong = calculateSMA(closingPrices, SMA_LONG_PERIOD);
    const rsi = calculateRSI(closingPrices, RSI_PERIOD);
    
    logger.info(`Calculated technical indicators: SMA(${SMA_SHORT_PERIOD}), SMA(${SMA_LONG_PERIOD}), RSI(${RSI_PERIOD}).`);
    if (ohlcData.length < SMA_LONG_PERIOD) {
        logger.warn(`OHLC data length (${ohlcData.length}) is less than SMA_LONG_PERIOD (${SMA_LONG_PERIOD}). Long SMA and related interpretations may be unavailable initially.`);
    }

    // Initialize counters and data structures
    let opportunitiesBuy = 0;
    let opportunitiesSell = 0;
    const reportRows: ReportData[] = [];
    let latestInterpretation = "N/A";
    // Track signals with dates for summary
    const signals: SignalEvent[] = [];
    
    // Debug check for data length consistency
    logger.info(`Lengths - OHLC data: ${ohlcData.length}, SMA Short: ${smaShort.length}, SMA Long: ${smaLong.length}, RSI: ${rsi.length}`);

    // Process each OHLC data point individually
    for (let i = 0; i < ohlcData.length; i++) {
      const [timestamp, open, high, low, close] = ohlcData[i];
      
      // Format date consistently for reporting
      const dateStr = new Date(timestamp).toISOString().split('T')[0];
      
      // Skip data points with identical OHLC values if valid daily change can't be calculated
      const hasValidPriceData = !(open === high && high === low && low === close);
      
      // Get indicator values for this data point
      const currentSmaShort = smaShort[i];
      const currentSmaLong = smaLong[i];
      const currentRsi = rsi[i];

      // Calculate daily price change
      let dailyChange = 0;
      if (open !== 0) {
        dailyChange = ((close - open) / open) * 100;
      }

      // Determine opportunity highlight based on daily change
      let highlight = '';
      if (dailyChange > OPPORTUNITY_THRESHOLD) {
        highlight = 'Potential Buy Signal';
        opportunitiesBuy++;
        signals.push({
          date: dateStr,
          price: close,
          change: dailyChange,
          type: 'Buy'
        });
      } else if (dailyChange < -OPPORTUNITY_THRESHOLD) {
        highlight = 'Potential Sell Signal';
        opportunitiesSell++;
        signals.push({
          date: dateStr,
          price: close,
          change: dailyChange,
          type: 'Sell'
        });
      }

      // Generate interpretation notes
      const notes: string[] = [];
      if (currentRsi !== null) {
        if (currentRsi > RSI_OVERBOUGHT) notes.push('RSI Overbought (>70)');
        else if (currentRsi < RSI_OVERSOLD) notes.push('RSI Oversold (<30)');
        else notes.push('RSI Neutral');
      }
      
      if (currentSmaShort !== null && currentSmaLong !== null) {
        if (currentSmaShort > currentSmaLong) notes.push('Trend Up (SMA20>SMA50)');
        else if (currentSmaShort < currentSmaLong) notes.push('Trend Down (SMA20<SMA50)');
      } else if (currentSmaShort !== null) {
        notes.push('Trend N/A (SMA50 missing)');
      }
      
      const interpretation = notes.length > 0 ? notes.join('; ') : 'N/A';
      if (i === ohlcData.length - 1) { // Store the latest interpretation
        latestInterpretation = interpretation;
      }

      // Create the report row for this data point
      // Add a note if data appears to be single point rather than true OHLC
      let interpretationWithDataQuality = interpretation;
      if (!hasValidPriceData) {
        interpretationWithDataQuality += '; Warning: Single price point (not true OHLC)';
      }

      reportRows.push({
        'Date': dateStr,
        'Coin ID': coinId,
        Open: parseFloat(open.toFixed(4)),
        High: parseFloat(high.toFixed(4)),
        Low: parseFloat(low.toFixed(4)),
        Close: parseFloat(close.toFixed(4)),
        'Daily Change %': parseFloat(dailyChange.toFixed(2)),
        'Opportunity Highlight': highlight,
        'SMA Short': currentSmaShort !== null ? parseFloat(currentSmaShort.toFixed(2)) : 'N/A',
        'SMA Long': currentSmaLong !== null ? parseFloat(currentSmaLong.toFixed(2)) : 'N/A',
        'RSI': currentRsi !== null ? parseFloat(currentRsi.toFixed(2)) : 'N/A',
        'Interpretation Notes': interpretationWithDataQuality,
      });
    }

    // Sort by date, newest first
    reportRows.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());
    signals.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    logger.info(`Sorted ${reportRows.length} report rows by date (newest first).`);

    if (reportRows.length === 0) {
      logger.warn('Processing OHLC data resulted in zero report rows. Exiting.');
      return;
    }

    // Log data counts for debugging
    logger.info(`Generated ${reportRows.length} report rows from ${ohlcData.length} OHLC records.`);
    
    // Check for unexpected consolidation
    const uniqueDates = new Set(reportRows.map(row => row.Date)).size;
    if (uniqueDates !== reportRows.length) {
      logger.warn(`Warning: Found ${uniqueDates} unique dates in ${reportRows.length} report rows. Some dates may be duplicated.`);
    }

    // Configure CSV options
    const csvData = Papa.unparse(reportRows, {
      quotes: true // Ensure all fields are quoted to handle special characters
    });
    
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = path.join(REPORT_DIR, `price_change_report_${coinId}_${timestampStr}.csv`);

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    fs.writeFileSync(reportFilename, csvData);
    logger.info(`Analysis report saved to: ${reportFilename}`);

    const latestRecord = reportRows[0];
    // For summary display, ensure values are safely formatted
    const formatValue = (val: any): string => val === 'N/A' || val === null || val === undefined ? 'N/A' : val.toString();
    
    // Check if latest record shows a signal
    const hasCurrentSignal = latestRecord['Opportunity Highlight'] !== '';
    const currentSignalInfo = hasCurrentSignal
      ? `**CURRENT SIGNAL: ${latestRecord['Opportunity Highlight']}** with ${latestRecord['Daily Change %']}% change`
      : 'No signal on most recent data';
    
    // Format recent signals for summary (last 5 or less)
    const recentSignalsCount = Math.min(signals.length, 5);
    let recentSignalsText = '';
    
    if (recentSignalsCount > 0) {
      recentSignalsText = '\n*   **Recent Signals:**';
      for (let i = 0; i < recentSignalsCount; i++) {
        const signal = signals[i];
        recentSignalsText += `\n*     ${signal.date}: ${signal.type} signal at $${signal.price.toFixed(2)} (${signal.change.toFixed(2)}% change)`;
      }
    } else {
      recentSignalsText = '\n*   **Recent Signals:** None found in the analyzed period';
    }
    
    // Get actual date range of data
    const oldestDate = reportRows[reportRows.length - 1].Date;
    const newestDate = reportRows[0].Date;
    const dateRangeInfo = `${oldestDate} to ${newestDate}`;

    const summary = `
## Daily OHLC & Indicator Analysis (${new Date().toISOString()}) [Source: CoinGecko API]
*   **Coin:** ${coinId} (Requested period: ${days} days)
*   **Analysis Period:** ${dateRangeInfo} (${reportRows.length} data points)
*   **Latest Data (${latestRecord.Date}):**
*     OHLC: Open=$${latestRecord.Open}, High=$${latestRecord.High}, Low=$${latestRecord.Low}, Close=$${latestRecord.Close}
*     Indicators: SMA(${SMA_SHORT_PERIOD})=${formatValue(latestRecord['SMA Short'])}, SMA(${SMA_LONG_PERIOD})=${formatValue(latestRecord['SMA Long'])}, RSI(${RSI_PERIOD})=${formatValue(latestRecord.RSI)}
*     ${currentSignalInfo}
*   **Interpretation:** ${latestInterpretation}${recentSignalsText}
*   **Signal Summary:** Found ${opportunitiesBuy} Buy and ${opportunitiesSell} Sell signals during analyzed period
*   **Full Report:** ${path.basename(reportFilename)}
---
`;
    fs.appendFileSync(SUMMARY_FILE, summary);
    logger.info(`Summary appended to: ${SUMMARY_FILE}`);

  } catch (error) {
    logger.error(`Error analyzing price changes for "${coinId}":`, error instanceof Error ? error.message : error);
    // If the error might be related to invalid coin ID
    if (error instanceof Error && 
        (error.message.includes('not found') || 
         error.message.includes('invalid') || 
         error.message.includes('coin'))) {
      logger.info(`This error might be related to an invalid coin ID.`);
      logger.info(`Use the find-coin-id utility to find the correct CoinGecko ID:`);
      logger.info(`  npm run find-coin-id <query>    (search by symbol or name)`);
      logger.info(`Example: npm run find-coin-id BTC`);
    }
  } finally {
    logger.info(`Analysis finished for ${coinId}.`);
  }
}

yargs(hideBin(process.argv))
  .command(
    '$0 <coinId>',
    'Analyze recent daily OHLC data with indicators and interpretation using CoinGecko API',
    (yargs) => {
      return yargs
        .positional('coinId', {
          describe: 'Coin ID from CoinGecko (e.g., bitcoin, ethereum, solana)',
          type: 'string',
          demandOption: true,
        })
        .option('days', {
          alias: 'd',
          type: 'number',
          description: 'Number of past days to fetch data for',
          default: 30, // Changed from 90 to 30 for better data quality
        })
        .example('npm run analyze-changes bitcoin', 'Analyze Bitcoin price data for the last 30 days')
        .example('npm run analyze-changes ethereum --days 14', 'Analyze Ethereum price data for the last 14 days')
        .example('npm run find-coin-id BTC', 'Find the correct CoinGecko ID for BTC if you\'re unsure');
    },
    async (argv) => {
      const coinId = argv.coinId as string;
      const days = argv.days as number;
      await runAnalysis(coinId, days);
    }
  )
  .help()
  .alias('help', 'h')
  .epilogue('For more information, check the README.md file or visit the project homepage.')
  .parse();