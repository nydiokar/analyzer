#!/usr/bin/env ts-node
/**
 * Quick smoke test - runs one holder profiles job and polls for completion
 * Perfect for testing after config changes
 *
 * ALIGNED TO ACTUAL API:
 * - POST /api/analyses/holder-profiles (returns jobId immediately)
 * - GET /api/jobs/:jobId (poll for completion)
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const TOKEN_MINT = process.argv[2] || process.env.TEST_TOKEN_MINT;
const TOP_N = parseInt(process.argv[3] || '15', 10);

if (!TOKEN_MINT) {
  console.error('❌ Usage: npx ts-node scripts/quick-test.ts <TOKEN_MINT> [TOP_N]');
  console.error('   Or set TEST_TOKEN_MINT environment variable');
  process.exit(1);
}

async function pollJobStatus(jobId: string, maxWaitMs: number = 300000): Promise<any> {
  const pollInterval = 2000; // Poll every 2 seconds
  const startTime = Date.now();
  let lastProgress = 0;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusResponse = await axios.get(`${API_BASE}/api/jobs/${jobId}`);
      const jobData = statusResponse.data;

      // Show progress if changed
      if (jobData.progress && jobData.progress !== lastProgress) {
        process.stdout.write(`\r⏳ Progress: ${jobData.progress}%`);
        lastProgress = jobData.progress;
      }

      // Check if completed
      if (jobData.state === 'completed') {
        console.log('\r✅ Job completed!                    ');
        return jobData.returnvalue;
      }

      // Check if failed
      if (jobData.state === 'failed') {
        throw new Error(`Job failed: ${jobData.failedReason || 'Unknown error'}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error: any) {
      if (error.response?.status === 404) {
        // Job not found yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Job timeout after ${maxWaitMs / 1000}s`);
}

async function quickTest() {
  console.log('🧪 QUICK PERFORMANCE TEST');
  console.log('========================');
  console.log(`Token: ${TOKEN_MINT}`);
  console.log(`Wallets: ${TOP_N}`);
  console.log(`API: ${API_BASE}`);
  console.log('');

  const startTime = Date.now();
  console.log(`⏱️  Starting at ${new Date().toLocaleTimeString()}...`);

  try {
    // Step 1: Queue the job (API returns immediately)
    const queueResponse = await axios.post(`${API_BASE}/api/analyses/holder-profiles`, {
      tokenMint: TOKEN_MINT,
      topN: TOP_N,
    });

    const jobId = queueResponse.data.jobId;
    console.log(`📋 Job queued: ${jobId}`);
    console.log(`   Estimated: ${queueResponse.data.estimatedProcessingTime}`);
    console.log('');

    // Step 2: Poll for completion
    const result = await pollJobStatus(jobId);

    const endTime = Date.now();
    const duration = endTime - startTime;
    const avgPerWallet = duration / TOP_N;

    console.log('');
    console.log('✅ SUCCESS!');
    console.log('========================');
    console.log(`Total duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Per wallet: ${(avgPerWallet / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${(TOP_N / (duration / 1000)).toFixed(2)} wallets/sec`);
    console.log('');

    // Result metadata
    if (result?.metadata) {
      console.log('JOB METADATA:');
      console.log(`  Holders analyzed: ${result.metadata.totalHoldersAnalyzed}/${result.metadata.totalHoldersRequested}`);
      console.log(`  Processing time: ${(result.metadata.totalProcessingTimeMs / 1000).toFixed(2)}s`);
      console.log(`  Avg per wallet: ${(result.metadata.avgProcessingTimePerWalletMs / 1000).toFixed(2)}s`);
      console.log('');
    }

    // Compare to baseline
    const baselineTime = 45; // seconds (midpoint of 40-50s)
    const baselineFor15 = (baselineTime / 15) * TOP_N;

    console.log('PERFORMANCE COMPARISON:');
    console.log(`Baseline (old): ~${baselineFor15.toFixed(1)}s`);
    console.log(`Actual (new): ${(duration / 1000).toFixed(1)}s`);

    const improvement = ((baselineFor15 - (duration / 1000)) / baselineFor15) * 100;
    const speedup = baselineFor15 / (duration / 1000);

    if (improvement > 0) {
      console.log(`Improvement: ${improvement.toFixed(1)}% faster (${speedup.toFixed(2)}x speedup) 🚀`);

      if (speedup >= 2) {
        console.log('\n🎉 WOW! 2x or better improvement! Config changes working perfectly!');
      } else if (speedup >= 1.5) {
        console.log('\n✅ Great! 1.5x improvement - solid gains!');
      } else {
        console.log('\n✅ Good improvement, but may have room for more tuning');
      }
    } else {
      console.log(`⚠️ Slower than baseline by ${Math.abs(improvement).toFixed(1)}%`);
      console.log('   Check for errors or bottlenecks');
    }

  } catch (error: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n');
    console.log('❌ FAILED');
    console.log('========================');
    console.log(`Failed after: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Error: ${error.message}`);

    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }

    process.exit(1);
  }
}

quickTest();
