#!/usr/bin/env ts-node
/**
 * Performance test for holder profiles analysis
 * Tests a single job with multiple wallets to measure improvements
 *
 * ALIGNED TO ACTUAL API:
 * - POST /api/analyses/holder-profiles (returns jobId immediately)
 * - GET /api/jobs/:jobId (poll for completion)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const API_KEY = process.env.TEST_API_KEY || '';

if (!API_KEY) {
  console.error('❌ ERROR: No API key found. Set TEST_API_KEY or API_KEY environment variable in .env file');
  process.exit(1);
}
const TOKEN_MINT = process.env.TEST_TOKEN_MINT || '66yi19iX3fR1Fi7yDdNpY1AF79vsAyatWwCCfsoppump';

interface TestResult {
  walletCount: number;
  startTime: number;
  endTime: number;
  duration: number;
  avgPerWallet: number;
}

async function pollJobStatus(jobId: string, maxWaitMs: number = 600000): Promise<any> {
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusResponse = await axios.get(`${API_BASE}/jobs/${jobId}`, {
        headers: {
          'x-api-key': API_KEY,
        },
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

async function testHolderProfiles(topN: number): Promise<TestResult> {
  console.log(`\n🧪 Testing holder profiles with ${topN} wallets...`);

  const startTime = Date.now();

  try {
    // Queue the job
    const queueResponse = await axios.post(`${API_BASE}/analyses/holder-profiles`, {
      tokenMint: TOKEN_MINT,
      topN: topN,
    }, {
      headers: {
        'x-api-key': API_KEY,
      },
    });

    const jobId = queueResponse.data.jobId;
    console.log(`   Job queued: ${jobId}`);

    // Poll for completion
    const result = await pollJobStatus(jobId);

    const endTime = Date.now();
    const duration = endTime - startTime;
    const avgPerWallet = duration / topN;

    console.log(`✅ Completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average per wallet: ${(avgPerWallet / 1000).toFixed(2)}s`);

    return {
      walletCount: topN,
      startTime,
      endTime,
      duration,
      avgPerWallet,
    };
  } catch (error: any) {
    console.error(`❌ Test failed:`, error.message);
    throw error;
  }
}

async function runPerformanceTests() {
  console.log('=== HOLDER PROFILES PERFORMANCE TEST ===');
  console.log(`Token: ${TOKEN_MINT}`);
  console.log(`API: ${API_BASE}`);
  console.log('');

  const results: TestResult[] = [];

  // Test different wallet counts
  const testSizes = [5, 10, 15, 25, 50];

  for (const size of testSizes) {
    try {
      const result = await testHolderProfiles(size);
      results.push(result);

      // Wait 5 seconds between tests to let queues settle
      console.log('⏳ Waiting 5 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Skipping remaining tests due to error`);
      break;
    }
  }

  // Summary
  console.log('\n=== PERFORMANCE SUMMARY ===');
  console.log('Wallet Count | Duration | Avg/Wallet | Throughput');
  console.log('-------------|----------|------------|------------');

  for (const result of results) {
    const durationSec = (result.duration / 1000).toFixed(1);
    const avgSec = (result.avgPerWallet / 1000).toFixed(2);
    const throughput = (result.walletCount / (result.duration / 1000)).toFixed(2);

    console.log(`${String(result.walletCount).padEnd(12)} | ${String(durationSec).padEnd(8)}s | ${String(avgSec).padEnd(10)}s | ${throughput} wallets/s`);
  }

  // Calculate scaling efficiency
  if (results.length >= 2) {
    console.log('\n=== SCALING ANALYSIS ===');
    const baseline = results[0];

    for (let i = 1; i < results.length; i++) {
      const current = results[i];
      const expectedDuration = baseline.avgPerWallet * current.walletCount;
      const actualDuration = current.duration;
      const efficiency = (expectedDuration / actualDuration) * 100;

      console.log(`${baseline.walletCount} → ${current.walletCount} wallets: ${efficiency.toFixed(1)}% efficient`);
      console.log(`  (Perfect parallelism would be ${(expectedDuration / 1000).toFixed(1)}s, actual: ${(actualDuration / 1000).toFixed(1)}s)`);
    }
  }

  // Expected vs Actual (with your new settings)
  const fifteenWalletResult = results.find(r => r.walletCount === 15);
  if (fifteenWalletResult) {
    console.log('\n=== 15 WALLET BENCHMARK ===');
    console.log(`Actual time: ${(fifteenWalletResult.duration / 1000).toFixed(1)}s`);
    console.log(`Target (optimized): 15-25s`);
    console.log(`Previous (baseline): 40-50s`);

    if (fifteenWalletResult.duration < 25000) {
      console.log('🎉 SUCCESS! Optimizations working as expected!');
    } else if (fifteenWalletResult.duration < 40000) {
      console.log('✅ IMPROVED! Faster than before, may need more tuning');
    } else {
      console.log('⚠️ NOT OPTIMAL: Investigate potential bottlenecks');
    }
  }
}

// Run tests
runPerformanceTests().catch(console.error);
