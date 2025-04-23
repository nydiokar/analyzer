import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { CoinGeckoClient } from '../core/fetcher/coingecko-client';
import { RateLimitConfig } from '../types/crypto';
import { createLogger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('PriceChangeReporter');

const REPORT_DIR = './analysis_reports';
const SUMMARY_FILE = path.join(REPORT_DIR, 'analysis_summary.md');

const OPPORTUNITY_THRESHOLD = 5; // +/- 5% change for daily change

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
}

async function runAnalysis(coinId: string, days: number) {
  logger.info(`Starting analysis for ${coinId} using CoinGecko API OHLC for the last ${days} days...`);
  const client = new CoinGeckoClient(DEFAULT_RATE_LIMIT);

  try {
    const ohlcData = await client.getOhlcData(coinId, 'usd', days);

    if (!ohlcData || ohlcData.length === 0) {
      logger.warn(`No OHLC data found for ${coinId} from CoinGecko API. Exiting.`);
      return;
    }
    logger.info(`Fetched ${ohlcData.length} daily OHLC records from CoinGecko.`);

    let opportunitiesBuy = 0;
    let opportunitiesSell = 0;
    const reportRows: ReportData[] = [];

    for (const entry of ohlcData) {
      const [timestamp, open, high, low, close] = entry;

      let dailyChange = 0;
      if (open !== 0) {
        dailyChange = ((close - open) / open) * 100;
      }

      let highlight = '';
      if (dailyChange > OPPORTUNITY_THRESHOLD) {
        highlight = 'Potential Buy Signal';
        opportunitiesBuy++;
      } else if (dailyChange < -OPPORTUNITY_THRESHOLD) {
        highlight = 'Potential Sell Signal';
        opportunitiesSell++;
      }

      reportRows.push({
        'Date': new Date(timestamp).toISOString().split('T')[0],
        'Coin ID': coinId,
        Open: parseFloat(open.toFixed(4)),
        High: parseFloat(high.toFixed(4)),
        Low: parseFloat(low.toFixed(4)),
        Close: parseFloat(close.toFixed(4)),
        'Daily Change %': parseFloat(dailyChange.toFixed(2)),
        'Opportunity Highlight': highlight,
      });
    }

    reportRows.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());

    if (reportRows.length === 0) {
      logger.warn('Processing OHLC data resulted in zero report rows. Exiting.');
      return;
    }

    const csvData = Papa.unparse(reportRows);
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = path.join(REPORT_DIR, `price_change_report_${coinId}_${timestampStr}.csv`);

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    fs.writeFileSync(reportFilename, csvData);
    logger.info(`Analysis report saved to: ${reportFilename}`);

    const latestRecord = reportRows[0];
    const summary = `
## Daily OHLC Analysis (${new Date().toISOString()}) [Source: CoinGecko API]
*   **Coin:** ${coinId}
*   **Days Analyzed:** ${reportRows.length} (Target: ${days})
*   **Latest Day Reported:** ${latestRecord.Date}
*     Open: $${latestRecord.Open}, High: $${latestRecord.High}, Low: $${latestRecord.Low}, Close: $${latestRecord.Close}
*   **Potential Buy Signals (> +${OPPORTUNITY_THRESHOLD}% daily change):** ${opportunitiesBuy}
*   **Potential Sell Signals (< -${OPPORTUNITY_THRESHOLD}% daily change):** ${opportunitiesSell}
*   **Full Report:** ${path.basename(reportFilename)}
---
`;
    fs.appendFileSync(SUMMARY_FILE, summary);
    logger.info(`Summary appended to: ${SUMMARY_FILE}`);

  } catch (error) {
    logger.error(`Error during analysis for ${coinId}:`, error instanceof Error ? error.message : error);
    if (error instanceof Error && (error as any).response) {
        logger.error('API Response Error Data:', (error as any).response.data);
    }
  } finally {
    logger.info(`Analysis finished for ${coinId}.`);
  }
}

yargs(hideBin(process.argv))
  .command(
    '$0 <coinId>',
    'Analyze recent daily price changes for a specific coin ID using CoinGecko API',
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
          default: 30,
        });
    },
    async (argv) => {
      const coinId = argv.coinId as string;
      const days = argv.days as number;
      await runAnalysis(coinId, days);
    }
  )
  .help()
  .alias('help', 'h')
  .parse();