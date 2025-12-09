#!/usr/bin/env ts-node
/**
 * Intelligent RPS Auto-Tuning Test
 *
 * This script helps you find the optimal RPS settings between 25-50 to:
 * - Maximize throughput (wallets/second)
 * - Minimize 429 rate limit errors
 * - Find the sweet spot for your Helius Developer tier (50 RPS max)
 *
 * HOW IT WORKS:
 * 1. Tests multiple RPS configurations (25, 30, 35, 40, 45, 50)
 * 2. For each RPS setting, runs a holder profiles job
 * 3. Monitors backend logs for 429 errors during execution
 * 4. Calculates performance score based on:
 *    - Speed (wallets/second)
 *    - 429 error rate (penalty)
 *    - Reliability (completion rate)
 *
 * REQUIREMENTS:
 * - Backend must be running (npm run start:dev)
 * - Need access to PM2 logs (for 429 detection)
 * - Set TEST_TOKEN_MINT in .env
 *
 * USAGE:
 * npx ts-node -r tsconfig-paths/register scripts/auto-tune-rps.ts [WALLETS_PER_TEST]
 *
 * Example:
 * npx ts-node -r tsconfig-paths/register scripts/auto-tune-rps.ts 15
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const API_KEY = process.env.TEST_API_KEY || process.env.API_KEY || '';
const TOKEN_MINT = process.env.TEST_TOKEN_MINT || '';
const WALLETS_PER_TEST = parseInt(process.argv[2] || '15', 10);

if (!API_KEY) {
  console.error('❌ ERROR: No API key found. Set TEST_API_KEY or API_KEY in .env');
  process.exit(1);
}

if (!TOKEN_MINT) {
  console.error('❌ ERROR: No token mint found. Set TEST_TOKEN_MINT in .env');
  process.exit(1);
}

// RPS configurations to test (conservative range: 25-50)
const RPS_CONFIGS = [
  { rps: 25, walletConcurrency: 3, queueWorkers: 10, description: 'Conservative (baseline)' },
  { rps: 30, walletConcurrency: 4, queueWorkers: 11, description: 'Moderate 1' },
  { rps: 35, walletConcurrency: 4, queueWorkers: 12, description: 'Moderate 2' },
  { rps: 40, walletConcurrency: 5, queueWorkers: 13, description: 'Aggressive 1' },
  { rps: 45, walletConcurrency: 5, queueWorkers: 14, description: 'Aggressive 2 (recommended max)' },
  { rps: 50, walletConcurrency: 6, queueWorkers: 14, description: 'Maximum (full capacity)' },
];

interface TestResult {
  rps: number;
  walletConcurrency: number;
  queueWorkers: number;
  description: string;
  duration: number;
  walletsProcessed: number;
  throughput: number;
  error429Count: number;
  totalApiCalls: number;
  error429Rate: number;
  performanceScore: number;
  success: boolean;
  errorMessage?: string;
}

async function pollJobStatus(jobId: string, maxWaitMs: number = 600000): Promise<any> {
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusResponse = await axios.get(`${API_BASE}/jobs/${jobId}`, {
        headers: { 'x-api-key': API_KEY },
      });
      const jobData = statusResponse.data;

      if (jobData.status === 'completed') {
        return jobData.result;
      }

      if (jobData.status === 'failed') {
        throw new Error(`Job failed: ${jobData.failedReason || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      if (error.response?.status === 404) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Job timeout after ${maxWaitMs / 1000}s`);
}

async function count429ErrorsInLogs(sinceTimestamp: number): Promise<{ count: number; totalCalls: number }> {
  try {
    // Get logs since the test started
    const { stdout } = await execAsync('pm2 logs --nostream --lines 5000 2>&1');

    const logLines = stdout.split('\n');
    let count429 = 0;
    let totalApiCalls = 0;

    // Filter logs to only those after our test started
    for (const line of logLines) {
      // Check if line has timestamp and is after our test start
      const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      if (timestampMatch) {
        const logTime = new Date(timestampMatch[1]).getTime();
        if (logTime < sinceTimestamp) continue;
      }

      // Count 429 errors
      if (line.includes('429') || line.toLowerCase().includes('too many requests') || line.toLowerCase().includes('rate limit')) {
        count429++;
      }

      // Estimate total API calls (look for Helius API client logs)
      if (line.includes('[HeliusApiClient]') && (line.includes('Successfully') || line.includes('fetched'))) {
        totalApiCalls++;
      }
    }

    return { count: count429, totalCalls: Math.max(totalApiCalls, 1) };
  } catch (error: any) {
    console.warn(`⚠️ Could not read PM2 logs: ${error.message}`);
    return { count: 0, totalCalls: 1 };
  }
}

function calculatePerformanceScore(result: TestResult): number {
  // Performance score formula:
  // Score = (Throughput × 100) - (429_Rate × 500) - (RPS_Penalty)
  //
  // Where:
  // - Throughput: wallets/second (higher is better)
  // - 429_Rate: percentage of API calls that hit rate limits (lower is better)
  // - RPS_Penalty: penalize higher RPS settings to prefer conservative configs

  const throughputScore = result.throughput * 100;
  const error429Penalty = result.error429Rate * 500; // Heavy penalty for rate limits
  const rpsPenalty = (result.rps - 25) * 0.5; // Slight penalty for higher RPS

  return Math.max(0, throughputScore - error429Penalty - rpsPenalty);
}

async function testRpsConfiguration(config: typeof RPS_CONFIGS[0]): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔧 Testing RPS Configuration: ${config.rps} RPS (${config.description})`);
  console.log(`   Wallet Concurrency: ${config.walletConcurrency}`);
  console.log(`   Queue Workers: ${config.queueWorkers}`);
  console.log(`${'='.repeat(80)}\n`);

  const testStartTime = Date.now();

  try {
    console.log(`⚙️  You need to manually update your configuration:`);
    console.log(`   1. Set DEFAULT_RPS=${config.rps} in src/config/constants.ts`);
    console.log(`   2. Set WALLET_SYNC_CONCURRENCY=${config.walletConcurrency} in src/config/constants.ts`);
    console.log(`   3. Set analysis-operations concurrency=${config.queueWorkers} in src/queues/config/queue.config.ts`);
    console.log(`   4. Restart your backend: npm run start:dev`);
    console.log(``);
    console.log(`⏸️  Press Ctrl+C to skip, or wait 10 seconds to continue...`);

    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(`\n🚀 Starting holder profiles job for ${WALLETS_PER_TEST} wallets...`);

    // Start the job
    const queueResponse = await axios.post(`${API_BASE}/analyses/holder-profiles`, {
      tokenMint: TOKEN_MINT,
      topN: WALLETS_PER_TEST,
    }, {
      headers: { 'x-api-key': API_KEY },
    });

    const jobId = queueResponse.data.jobId;
    console.log(`📋 Job queued: ${jobId}`);

    // Poll for completion
    await pollJobStatus(jobId);

    const testEndTime = Date.now();
    const duration = testEndTime - testStartTime;

    // Count 429 errors from logs
    console.log(`📊 Analyzing logs for 429 errors...`);
    const { count, totalCalls } = await count429ErrorsInLogs(testStartTime);

    const throughput = WALLETS_PER_TEST / (duration / 1000);
    const error429Rate = totalCalls > 0 ? (count / totalCalls) * 100 : 0;

    const result: TestResult = {
      rps: config.rps,
      walletConcurrency: config.walletConcurrency,
      queueWorkers: config.queueWorkers,
      description: config.description,
      duration,
      walletsProcessed: WALLETS_PER_TEST,
      throughput,
      error429Count: count,
      totalApiCalls: totalCalls,
      error429Rate,
      performanceScore: 0, // Will be calculated
      success: true,
    };

    result.performanceScore = calculatePerformanceScore(result);

    console.log(`\n✅ Test completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Throughput: ${throughput.toFixed(2)} wallets/sec`);
    console.log(`   429 Errors: ${count} (${error429Rate.toFixed(1)}% of ${totalCalls} API calls)`);
    console.log(`   Performance Score: ${result.performanceScore.toFixed(1)}`);

    return result;

  } catch (error: any) {
    console.error(`❌ Test failed: ${error.message}`);

    return {
      rps: config.rps,
      walletConcurrency: config.walletConcurrency,
      queueWorkers: config.queueWorkers,
      description: config.description,
      duration: 0,
      walletsProcessed: 0,
      throughput: 0,
      error429Count: 0,
      totalApiCalls: 0,
      error429Rate: 0,
      performanceScore: 0,
      success: false,
      errorMessage: error.message,
    };
  }
}

async function runAutoTuning() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     RPS AUTO-TUNING TEST SUITE                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📊 Configuration:`);
  console.log(`   Token: ${TOKEN_MINT.substring(0, 8)}...`);
  console.log(`   Wallets per test: ${WALLETS_PER_TEST}`);
  console.log(`   RPS configs to test: ${RPS_CONFIGS.length}`);
  console.log(`   API: ${API_BASE}`);
  console.log('');
  console.log(`⚠️  IMPORTANT: This test requires MANUAL configuration changes!`);
  console.log(`   You'll need to update constants.ts and queue.config.ts between tests.`);
  console.log(`   The script will pause for 10 seconds before each test.`);
  console.log('');
  console.log(`⏱️  Estimated total time: ${RPS_CONFIGS.length * 2} minutes`);
  console.log('');

  const results: TestResult[] = [];

  // Test each configuration
  for (const config of RPS_CONFIGS) {
    const result = await testRpsConfiguration(config);
    results.push(result);

    // Wait between tests to let the system stabilize
    if (result !== results[results.length - 1]) {
      console.log(`\n⏸️  Waiting 5 seconds before next test...\n`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Print summary
  console.log(`\n\n${'═'.repeat(120)}`);
  console.log(`📊 AUTO-TUNING RESULTS SUMMARY`);
  console.log(`${'═'.repeat(120)}\n`);

  console.log('RPS | Concur | Workers | Duration | Throughput | 429 Count | 429 Rate | Score  | Status');
  console.log('----|--------|---------|----------|------------|-----------|----------|--------|--------');

  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(
      `${String(r.rps).padEnd(3)} | ` +
      `${String(r.walletConcurrency).padEnd(6)} | ` +
      `${String(r.queueWorkers).padEnd(7)} | ` +
      `${(r.duration / 1000).toFixed(1)}s${' '.repeat(5 - (r.duration / 1000).toFixed(1).length)} | ` +
      `${r.throughput.toFixed(2)}/s${' '.repeat(6 - r.throughput.toFixed(2).length)} | ` +
      `${String(r.error429Count).padEnd(9)} | ` +
      `${r.error429Rate.toFixed(1)}%${' '.repeat(5 - r.error429Rate.toFixed(1).length)} | ` +
      `${r.performanceScore.toFixed(1).padEnd(6)} | ` +
      `${status}`
    );
  });

  // Find optimal configuration
  const successfulResults = results.filter(r => r.success);

  if (successfulResults.length === 0) {
    console.log(`\n❌ No successful tests! Check your backend and configuration.`);
    return;
  }

  const optimalByScore = [...successfulResults].sort((a, b) => b.performanceScore - a.performanceScore)[0];
  const optimalBySpeed = [...successfulResults].sort((a, b) => b.throughput - a.throughput)[0];
  const optimalBy429 = [...successfulResults].sort((a, b) => a.error429Rate - b.error429Rate)[0];

  console.log(`\n${'═'.repeat(120)}`);
  console.log(`🏆 RECOMMENDATIONS`);
  console.log(`${'═'.repeat(120)}\n`);

  console.log(`🥇 Best Overall (Performance Score):`);
  console.log(`   RPS: ${optimalByScore.rps}`);
  console.log(`   Wallet Concurrency: ${optimalByScore.walletConcurrency}`);
  console.log(`   Queue Workers: ${optimalByScore.queueWorkers}`);
  console.log(`   Throughput: ${optimalByScore.throughput.toFixed(2)} wallets/sec`);
  console.log(`   429 Rate: ${optimalByScore.error429Rate.toFixed(1)}%`);
  console.log(`   Score: ${optimalByScore.performanceScore.toFixed(1)}`);
  console.log('');

  console.log(`⚡ Fastest (Maximum Throughput):`);
  console.log(`   RPS: ${optimalBySpeed.rps}`);
  console.log(`   Throughput: ${optimalBySpeed.throughput.toFixed(2)} wallets/sec`);
  console.log(`   429 Rate: ${optimalBySpeed.error429Rate.toFixed(1)}%`);
  console.log('');

  console.log(`🛡️  Most Reliable (Fewest 429s):`);
  console.log(`   RPS: ${optimalBy429.rps}`);
  console.log(`   429 Rate: ${optimalBy429.error429Rate.toFixed(1)}%`);
  console.log(`   Throughput: ${optimalBy429.throughput.toFixed(2)} wallets/sec`);
  console.log('');

  // Generate configuration recommendations
  console.log(`${'═'.repeat(120)}`);
  console.log(`📝 RECOMMENDED CONFIGURATION`);
  console.log(`${'═'.repeat(120)}\n`);

  console.log(`Based on performance score, update your configuration to:`);
  console.log('');
  console.log(`src/config/constants.ts:`);
  console.log(`  DEFAULT_RPS: ${optimalByScore.rps}`);
  console.log(`  WALLET_SYNC_CONCURRENCY: ${optimalByScore.walletConcurrency}`);
  console.log('');
  console.log(`src/queues/config/queue.config.ts:`);
  console.log(`  [QueueNames.ANALYSIS_OPERATIONS].workerOptions.concurrency: ${optimalByScore.queueWorkers}`);
  console.log('');

  if (optimalByScore.error429Rate > 5) {
    console.log(`⚠️  WARNING: 429 error rate is ${optimalByScore.error429Rate.toFixed(1)}%`);
    console.log(`   Consider using a more conservative configuration:`);
    console.log(`   - Reduce RPS by 5-10`);
    console.log(`   - Reduce WALLET_SYNC_CONCURRENCY by 1`);
    console.log(`   - Reduce queue workers by 2`);
  } else if (optimalByScore.error429Rate < 1 && optimalByScore.rps < 50) {
    console.log(`✅ 429 error rate is very low (${optimalByScore.error429Rate.toFixed(1)}%)`);
    console.log(`   You may have headroom to push RPS higher!`);
    console.log(`   Try increasing RPS by 5 and re-test.`);
  } else {
    console.log(`✅ Configuration looks optimal! 429 rate: ${optimalByScore.error429Rate.toFixed(1)}%`);
  }
}

runAutoTuning().catch(console.error);
