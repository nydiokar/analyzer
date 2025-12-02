#!/usr/bin/env node
/**
 * Analyze Hold Time Distribution with Granular Time Buckets
 *
 * @description
 * Analyzes holder risk test results and provides granular breakdown of holding times.
 * Shows exactly how many wallets/exits fall into each time bucket.
 *
 * @timeBuckets
 * - <1 min         : Ultra-fast bot/MEV traders
 * - 1-3 min        : Very fast scalpers
 * - 3-5 min        : Fast scalpers
 * - 5-10 min       : Quick flippers
 * - 10-30 min      : Fast traders
 * - 30-60 min      : Sub-hour traders
 * - 1-24 hours     : Intraday traders
 * - 1-7 days       : Swing traders
 * - >7 days        : Position holders
 *
 * @usage
 * Analyze default results file:
 * ```bash
 * npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts
 * ```
 *
 * Analyze custom results file:
 * ```bash
 * npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
 *   --resultsFile my-test-results.json
 * ```
 *
 * @workflow
 * Step 1: Test wallets
 * ```bash
 * npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
 *   --wallet YOUR_WALLET \
 *   --outputFile my-results.json
 * ```
 *
 * Step 2: Analyze distribution
 * ```bash
 * npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
 *   --resultsFile my-results.json
 * ```
 *
 * @output
 * Displays:
 * 1. Summary table by time bucket (wallets, exits, % of total, avg/median hold times)
 * 2. Detailed wallet breakdown per bucket
 * 3. Key insights (% in each category)
 *
 * @example
 * # Test a wallet you observed
 * npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
 *   --wallet ABC123... \
 *   --outputFile my-observation.json
 *
 * # See which bucket it falls into
 * npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
 *   --resultsFile my-observation.json
 *
 * # Expected output will show:
 * # Time Bucket | Wallets | Exits | % of Total | Avg Hold | Examples
 * # 10-30 min   | 1       | 150   | 100%       | 18.5m    | ABC123...(150)
 *
 * @realExample
 * From our validation test (19 wallets, 4,007 exits):
 * - 10-30 min:   650 exits (16.2%)  - Ultra-fast traders
 * - 30-60 min:   1,138 exits (28.4%) - Sub-hour traders
 * - 1-24 hours:  2,219 exits (55.4%) - Intraday traders
 * - No wallets found in <10min (likely due to wallet selection bias)
 *
 * @see test-holder-risk-sampled.ts - To generate test results
 * @see find-active-wallets.ts - To discover wallet candidates
 */

import * as fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface WalletResult {
  walletAddress: string;
  pattern: {
    avgHoldTimeHours: number;
    medianHoldTimeHours: number;
  } | null;
  exitedTokens: number;
  completedCycles: number;
}

interface TestResults {
  summary: {
    totalCompletedCycles: number;
  };
  results: WalletResult[];
}

// Define granular time buckets
interface TimeBucket {
  label: string;
  minMinutes: number;
  maxMinutes: number;
  wallets: WalletResult[];
  totalExits: number;
}

/**
 * Classify a wallet's average hold time into a granular time bucket
 *
 * @param avgHoldTimeHours - Average holding time in hours
 * @returns Bucket key (e.g., "10-30min", "1-24h")
 *
 * @example
 * classifyIntoBucket(0.3) // Returns "10-30min" (18 minutes)
 * classifyIntoBucket(2.5) // Returns "1-24h" (2.5 hours)
 */
function classifyIntoBucket(avgHoldTimeHours: number): string {
  const minutes = avgHoldTimeHours * 60;

  // Ultra-fast: <1 minute (bot/MEV traders)
  if (minutes < 1) return '<1min';

  // Very fast: 1-3 minutes (fast scalpers)
  if (minutes < 3) return '1-3min';

  // Fast: 3-5 minutes (scalpers)
  if (minutes < 5) return '3-5min';

  // Quick: 5-10 minutes (quick flippers)
  if (minutes < 10) return '5-10min';

  // Fast traders: 10-30 minutes
  if (minutes < 30) return '10-30min';

  // Sub-hour: 30-60 minutes
  if (avgHoldTimeHours < 1) return '30-60min';

  // Intraday: 1-24 hours
  if (avgHoldTimeHours < 24) return '1-24h';

  // Swing: 1-7 days
  if (avgHoldTimeHours < 168) return '1-7d';

  // Position holders: 7+ days
  return '>7d';
}

function formatDuration(hours: number): string {
  const minutes = hours * 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('resultsFile', {
      alias: 'f',
      type: 'string',
      description: 'Path to test results JSON file',
      default: './data/holding_time/holder-risk-test-results.json',
    })
    .parseAsync();

  const resultsFile = argv.resultsFile;

  if (!fs.existsSync(resultsFile)) {
    console.error(`❌ ${resultsFile} not found. Run test-holder-risk-sampled.ts first.`);
    process.exit(1);
  }

  const data: TestResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

  // Initialize buckets
  const buckets: Map<string, TimeBucket> = new Map([
    ['<1min', { label: '<1 min', minMinutes: 0, maxMinutes: 1, wallets: [], totalExits: 0 }],
    ['1-3min', { label: '1-3 min', minMinutes: 1, maxMinutes: 3, wallets: [], totalExits: 0 }],
    ['3-5min', { label: '3-5 min', minMinutes: 3, maxMinutes: 5, wallets: [], totalExits: 0 }],
    ['5-10min', { label: '5-10 min', minMinutes: 5, maxMinutes: 10, wallets: [], totalExits: 0 }],
    ['10-30min', { label: '10-30 min', minMinutes: 10, maxMinutes: 30, wallets: [], totalExits: 0 }],
    ['30-60min', { label: '30-60 min', minMinutes: 30, maxMinutes: 60, wallets: [], totalExits: 0 }],
    ['1-24h', { label: '1-24 hours', minMinutes: 60, maxMinutes: 1440, wallets: [], totalExits: 0 }],
    ['1-7d', { label: '1-7 days', minMinutes: 1440, maxMinutes: 10080, wallets: [], totalExits: 0 }],
    ['>7d', { label: '>7 days', minMinutes: 10080, maxMinutes: Infinity, wallets: [], totalExits: 0 }],
  ]);

  // Classify wallets into buckets
  data.results.forEach(wallet => {
    if (!wallet.pattern) return;

    const bucketKey = classifyIntoBucket(wallet.pattern.avgHoldTimeHours);
    const bucket = buckets.get(bucketKey);

    if (bucket) {
      bucket.wallets.push(wallet);
      bucket.totalExits += wallet.exitedTokens;
    }
  });

  // Display results
  console.log('\\n' + '='.repeat(100));
  console.log('HOLD TIME DISTRIBUTION ANALYSIS');
  console.log('='.repeat(100));
  console.log(`\\nTotal Wallets: ${data.results.length}`);
  console.log(`Total Exited Positions: ${data.summary.totalCompletedCycles}`);
  console.log('\\n');

  // Table header
  console.log('Time Bucket       | Wallets | Exits | % of Total | Avg Hold  | Median Hold | Examples');
  console.log('-'.repeat(100));

  buckets.forEach((bucket, key) => {
    if (bucket.wallets.length === 0) return;

    const percentage = ((bucket.totalExits / data.summary.totalCompletedCycles) * 100).toFixed(1);
    const avgOfAvgs = bucket.wallets.reduce((sum, w) => sum + w.pattern!.avgHoldTimeHours, 0) / bucket.wallets.length;
    const avgOfMedians = bucket.wallets.reduce((sum, w) => sum + w.pattern!.medianHoldTimeHours, 0) / bucket.wallets.length;

    // Get top 3 wallets by exit count
    const examples = bucket.wallets
      .sort((a, b) => b.exitedTokens - a.exitedTokens)
      .slice(0, 3)
      .map(w => `${w.walletAddress.substring(0, 8)}(${w.exitedTokens})`)
      .join(', ');

    console.log(
      `${bucket.label.padEnd(17)} | ${String(bucket.wallets.length).padEnd(7)} | ${String(bucket.totalExits).padEnd(5)} | ${percentage.padEnd(10)}% | ${formatDuration(avgOfAvgs).padEnd(9)} | ${formatDuration(avgOfMedians).padEnd(11)} | ${examples}`
    );
  });

  console.log('\\n');

  // Detailed breakdown by wallet
  console.log('='.repeat(100));
  console.log('DETAILED WALLET BREAKDOWN');
  console.log('='.repeat(100));
  console.log('\\n');

  buckets.forEach((bucket, key) => {
    if (bucket.wallets.length === 0) return;

    console.log(`\\n📊 ${bucket.label.toUpperCase()} (${bucket.wallets.length} wallets, ${bucket.totalExits} exits)`);
    console.log('-'.repeat(100));

    bucket.wallets
      .sort((a, b) => b.exitedTokens - a.exitedTokens)
      .forEach(wallet => {
        const avgHold = formatDuration(wallet.pattern!.avgHoldTimeHours);
        const medianHold = formatDuration(wallet.pattern!.medianHoldTimeHours);
        console.log(
          `  ${wallet.walletAddress.substring(0, 12)}... | ` +
          `Exits: ${String(wallet.exitedTokens).padEnd(3)} | ` +
          `Avg: ${avgHold.padEnd(8)} | ` +
          `Median: ${medianHold.padEnd(8)}`
        );
      });
  });

  console.log('\\n');

  // Key insights
  console.log('='.repeat(100));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(100));
  console.log('\\n');

  const ultraFast = ['<1min', '1-3min', '3-5min'].reduce((sum, key) => sum + (buckets.get(key)?.totalExits || 0), 0);
  const fast = ['5-10min', '10-30min'].reduce((sum, key) => sum + (buckets.get(key)?.totalExits || 0), 0);
  const subHour = buckets.get('30-60min')?.totalExits || 0;
  const intraday = buckets.get('1-24h')?.totalExits || 0;
  const multiDay = buckets.get('1-7d')?.totalExits || 0;

  console.log(`Ultra-Fast Traders (<5 min):     ${ultraFast} exits (${((ultraFast / data.summary.totalCompletedCycles) * 100).toFixed(1)}%)`);
  console.log(`Fast Traders (5-30 min):         ${fast} exits (${((fast / data.summary.totalCompletedCycles) * 100).toFixed(1)}%)`);
  console.log(`Sub-Hour Traders (30-60 min):    ${subHour} exits (${((subHour / data.summary.totalCompletedCycles) * 100).toFixed(1)}%)`);
  console.log(`Intraday Traders (1-24 hours):   ${intraday} exits (${((intraday / data.summary.totalCompletedCycles) * 100).toFixed(1)}%)`);
  console.log(`Multi-Day Traders (1-7 days):    ${multiDay} exits (${((multiDay / data.summary.totalCompletedCycles) * 100).toFixed(1)}%)`);

  console.log('\\n');
}

main().catch(console.error);
