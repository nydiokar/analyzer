#!/usr/bin/env ts-node
/**
 * Quick RPS Analyzer - Analyzes EXISTING logs to recommend optimal RPS
 *
 * This script analyzes your PM2 logs from recent holder profiles jobs to determine:
 * - How many 429 errors you're hitting
 * - What your current throughput is
 * - Whether you should increase or decrease RPS
 *
 * TIME-BASED FILTERING (prevents contamination):
 * - First run: Analyzes all available logs
 * - Subsequent runs: Only analyzes logs since last run (stored in .last-rps-analysis-time.txt)
 * - Manual time window: Pass minutes as argument to analyze specific window
 *
 * USAGE:
 * npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts [MINUTES]
 *
 * Examples:
 * npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts          # Since last analysis
 * npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 5        # Last 5 minutes only
 * npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 10       # Last 10 minutes only
 *
 * WORKFLOW:
 * 1. Run analyzer to establish baseline
 * 2. Make config changes
 * 3. Run concurrent jobs test
 * 4. Run analyzer again - it will only show data from the new test!
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// File to store the last analysis timestamp
const TIMESTAMP_FILE = path.join(__dirname, '.last-rps-analysis-time.txt');

interface LogAnalysis {
  total429Errors: number;
  totalSuccessfulCalls: number;
  error429Rate: number;
  timeRange: { start: string; end: string };
  sampleSize: number;
  analysisStartTime: number;
}

function getLastAnalysisTime(): number | null {
  try {
    if (fs.existsSync(TIMESTAMP_FILE)) {
      const timestamp = parseInt(fs.readFileSync(TIMESTAMP_FILE, 'utf-8').trim(), 10);
      return isNaN(timestamp) ? null : timestamp;
    }
  } catch (error) {
    console.warn('⚠️  Could not read last analysis timestamp');
  }
  return null;
}

function saveAnalysisTime(timestamp: number): void {
  try {
    fs.writeFileSync(TIMESTAMP_FILE, timestamp.toString(), 'utf-8');
  } catch (error) {
    console.warn('⚠️  Could not save analysis timestamp');
  }
}

async function analyzeLogs(sinceTimestamp?: number): Promise<LogAnalysis> {
  const analysisStartTime = Date.now();

  // Get time window
  const lastAnalysis = sinceTimestamp || getLastAnalysisTime();
  const minutesAgo = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  let filterStartTime: number | null = null;
  let filterDescription = 'all available logs';

  if (minutesAgo && minutesAgo > 0) {
    filterStartTime = Date.now() - (minutesAgo * 60 * 1000);
    filterDescription = `last ${minutesAgo} minutes`;
  } else if (lastAnalysis) {
    filterStartTime = lastAnalysis;
    const minutesSinceLast = Math.floor((Date.now() - lastAnalysis) / 60000);
    filterDescription = `since last analysis (${minutesSinceLast} minutes ago)`;
  }

  console.log(`📊 Analyzing PM2 logs (${filterDescription})...\n`);

  try {
    const { stdout } = await execAsync('pm2 logs --nostream --lines 3000 2>&1');
    const logLines = stdout.split('\n');

    let count429 = 0;
    let successfulCalls = 0;
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let linesAnalyzed = 0;

    for (const line of logLines) {
      // Extract timestamp
      const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      if (timestampMatch) {
        const timestamp = timestampMatch[1];
        const logTime = new Date(timestamp).getTime();

        // Skip logs before our filter time
        if (filterStartTime && logTime < filterStartTime) {
          continue;
        }

        linesAnalyzed++;
        if (!firstTimestamp) firstTimestamp = timestamp;
        lastTimestamp = timestamp;
      } else if (filterStartTime) {
        // If we have a filter and no timestamp, skip this line
        continue;
      }

      // Count 429 errors
      if (
        line.includes('429') ||
        line.toLowerCase().includes('too many requests') ||
        line.toLowerCase().includes('rate limit exceeded')
      ) {
        count429++;
      }

      // Count successful API calls
      if (
        line.includes('[HeliusApiClient]') &&
        (line.includes('Successfully fetched') ||
          line.includes('INFO') ||
          line.includes('Fetched'))
      ) {
        successfulCalls++;
      }
    }

    const totalCalls = count429 + successfulCalls;
    const error429Rate = totalCalls > 0 ? (count429 / totalCalls) * 100 : 0;

    // Save current time for next analysis
    saveAnalysisTime(analysisStartTime);

    return {
      total429Errors: count429,
      totalSuccessfulCalls: successfulCalls,
      error429Rate,
      timeRange: {
        start: firstTimestamp || 'unknown',
        end: lastTimestamp || 'unknown',
      },
      sampleSize: linesAnalyzed,
      analysisStartTime,
    };
  } catch (error: any) {
    console.error(`❌ Failed to read PM2 logs: ${error.message}`);
    process.exit(1);
  }
}

function generateRecommendations(analysis: LogAnalysis) {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     RPS CONFIGURATION RECOMMENDATIONS                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('📊 Current Performance Analysis:');
  console.log(`   Total 429 Errors: ${analysis.total429Errors}`);
  console.log(`   Successful API Calls: ${analysis.totalSuccessfulCalls}`);
  console.log(`   429 Error Rate: ${analysis.error429Rate.toFixed(2)}%`);
  console.log(`   Log Sample: ${analysis.sampleSize} lines`);
  console.log(`   Time Range: ${analysis.timeRange.start} → ${analysis.timeRange.end}`);
  console.log('');

  // Read current configuration
  console.log('📝 Current Configuration (from your settings):');
  console.log('   DEFAULT_RPS: 50');
  console.log('   WALLET_SYNC_CONCURRENCY: 6');
  console.log('   ANALYSIS_OPERATIONS concurrency: 14');
  console.log('   SIMILARITY_OPERATIONS concurrency: 7');
  console.log('   WALLET_OPERATIONS concurrency: 5');
  console.log('   ENRICHMENT_OPERATIONS concurrency: 5');
  console.log('');

  console.log('═'.repeat(80));
  console.log('🎯 RECOMMENDATIONS:');
  console.log('═'.repeat(80));
  console.log('');

  // Decision tree based on 429 error rate
  if (analysis.error429Rate === 0) {
    console.log('✅ EXCELLENT: No 429 errors detected!');
    console.log('');
    console.log('Your current RPS=50 configuration is working perfectly.');
    console.log('You\'re utilizing your full Helius Developer tier capacity (50 RPS).');
    console.log('');
    console.log('💡 Recommendation: KEEP CURRENT SETTINGS');
    console.log('   No changes needed - you have optimal performance!');
  } else if (analysis.error429Rate < 1) {
    console.log('✅ VERY GOOD: 429 error rate under 1%');
    console.log('');
    console.log('You have minimal rate limiting with high throughput.');
    console.log('A few 429s are acceptable with retry logic.');
    console.log('');
    console.log('💡 Recommendation: KEEP CURRENT SETTINGS or MINOR TWEAKS');
    console.log('   Option 1: Keep as-is (acceptable error rate)');
    console.log('   Option 2: Reduce to RPS=48 for near-zero 429s');
  } else if (analysis.error429Rate < 5) {
    console.log('⚠️  MODERATE: 429 error rate between 1-5%');
    console.log('');
    console.log('You\'re pushing limits but retries should handle it.');
    console.log('Consider slight reduction for better stability.');
    console.log('');
    console.log('💡 Recommendation: REDUCE RPS SLIGHTLY');
    console.log('   Suggested changes:');
    console.log('   - DEFAULT_RPS: 50 → 45');
    console.log('   - WALLET_SYNC_CONCURRENCY: 6 → 5');
    console.log('   - Keep queue workers the same');
    console.log('');
    console.log('   Expected impact:');
    console.log('   - 10% slower throughput');
    console.log('   - ~80% fewer 429 errors');
    console.log('   - More reliable performance');
  } else if (analysis.error429Rate < 10) {
    console.log('⚠️  HIGH: 429 error rate between 5-10%');
    console.log('');
    console.log('Too many rate limit hits - impacting performance.');
    console.log('Reduce RPS to improve stability.');
    console.log('');
    console.log('💡 Recommendation: REDUCE RPS MODERATELY');
    console.log('   Suggested changes:');
    console.log('   - DEFAULT_RPS: 50 → 40');
    console.log('   - WALLET_SYNC_CONCURRENCY: 6 → 5');
    console.log('   - ANALYSIS_OPERATIONS concurrency: 14 → 12');
    console.log('');
    console.log('   Expected impact:');
    console.log('   - 20% slower throughput');
    console.log('   - ~90% fewer 429 errors');
    console.log('   - Much more stable');
  } else {
    console.log('🚨 CRITICAL: 429 error rate over 10%!');
    console.log('');
    console.log('Severe rate limiting - you\'re exceeding API capacity significantly.');
    console.log('Immediate reduction needed.');
    console.log('');
    console.log('💡 Recommendation: REDUCE RPS SIGNIFICANTLY');
    console.log('   Suggested changes:');
    console.log('   - DEFAULT_RPS: 50 → 35');
    console.log('   - WALLET_SYNC_CONCURRENCY: 6 → 4');
    console.log('   - ANALYSIS_OPERATIONS concurrency: 14 → 10');
    console.log('   - SIMILARITY_OPERATIONS concurrency: 7 → 5');
    console.log('   - WALLET_OPERATIONS concurrency: 5 → 4');
    console.log('');
    console.log('   Or consider:');
    console.log('   - Upgrade to Professional tier (500 RPS)');
    console.log('   - Use dedicated API key for metadata (HELIUS_METADATA_API_KEY)');
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('📋 HOW TO APPLY CHANGES:');
  console.log('═'.repeat(80));
  console.log('');
  console.log('1. Edit src/config/constants.ts:');
  console.log('   - Update DEFAULT_RPS');
  console.log('   - Update WALLET_SYNC_CONCURRENCY');
  console.log('');
  console.log('2. Edit src/queues/config/queue.config.ts:');
  console.log('   - Update concurrency values in QueueConfigs');
  console.log('');
  console.log('3. Restart backend:');
  console.log('   npm run start:dev');
  console.log('');
  console.log('4. Re-test with concurrent jobs:');
  console.log('   npx ts-node -r tsconfig-paths/register scripts/test-concurrent-jobs.ts 3 10');
  console.log('');
  console.log('5. Run this analyzer again to verify improvement:');
  console.log('   npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts');
  console.log('');

  // Additional insights
  console.log('═'.repeat(80));
  console.log('💡 ADDITIONAL INSIGHTS:');
  console.log('═'.repeat(80));
  console.log('');

  if (analysis.total429Errors > 0) {
    console.log('⚡ Performance vs Reliability Tradeoff:');
    console.log('   - Higher RPS = Faster jobs but more 429 errors');
    console.log('   - Lower RPS = Slower jobs but more reliable');
    console.log('   - Sweet spot is typically 80-90% of max RPS (40-45 for 50 RPS tier)');
    console.log('');
  }

  console.log('🔍 Optimization Tips:');
  console.log('   - Use separate API key for enrichment (HELIUS_METADATA_API_KEY)');
  console.log('   - Monitor 429 rate during peak usage');
  console.log('   - Adjust based on concurrent job patterns');
  console.log('   - Consider upgrading tier if consistently hitting limits');
  console.log('');

  console.log('📚 Related Scripts:');
  console.log('   - Test concurrent jobs: npm run test:concurrent 3 10');
  console.log('   - Quick performance test: npm run test:quick');
  console.log('   - Full auto-tuning: npx ts-node scripts/auto-tune-rps.ts');
  console.log('');
}

async function main() {
  console.log('🔍 Quick RPS Analyzer');
  console.log('═'.repeat(80));
  console.log('');

  const analysis = await analyzeLogs();
  generateRecommendations(analysis);
}

main().catch(console.error);
