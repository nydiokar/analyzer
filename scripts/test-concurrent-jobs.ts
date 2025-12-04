#!/usr/bin/env ts-node
/**
 * Concurrent job stress test
 * Fires off multiple jobs simultaneously to test queue concurrency
 *
 * ALIGNED TO ACTUAL API:
 * - POST /api/analyses/holder-profiles (returns jobId immediately)
 * - GET /api/jobs/:jobId (poll for completion)
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const TOKEN_MINTS = (process.env.TEST_TOKEN_MINTS || '').split(',').filter(Boolean);

interface JobResult {
  jobId: number;
  tokenMint: string;
  walletCount: number;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

async function pollJobStatus(jobId: string, maxWaitMs: number = 600000): Promise<any> {
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusResponse = await axios.get(`${API_BASE}/api/jobs/${jobId}`);
      const jobData = statusResponse.data;

      if (jobData.state === 'completed') {
        return jobData.returnvalue;
      }

      if (jobData.state === 'failed') {
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

async function startHolderProfilesJob(
  jobId: number,
  tokenMint: string,
  topN: number
): Promise<JobResult> {
  const startTime = Date.now();

  console.log(`🚀 Job ${jobId}: Starting holder profiles for ${tokenMint} (${topN} wallets)`);

  try {
    // Queue the job
    const queueResponse = await axios.post(`${API_BASE}/api/analyses/holder-profiles`, {
      tokenMint,
      topN,
    });

    const queuedJobId = queueResponse.data.jobId;
    console.log(`   Job ${jobId}: Queued as ${queuedJobId}`);

    // Poll for completion
    await pollJobStatus(queuedJobId);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`✅ Job ${jobId}: Completed in ${(duration / 1000).toFixed(2)}s`);

    return {
      jobId,
      tokenMint,
      walletCount: topN,
      startTime,
      endTime,
      duration,
      status: 'completed',
    };
  } catch (error: any) {
    console.error(`❌ Job ${jobId}: Failed - ${error.message}`);
    return {
      jobId,
      tokenMint,
      walletCount: topN,
      startTime,
      status: 'failed',
      error: error.message,
    };
  }
}

async function runConcurrentJobsTest(concurrentJobs: number, walletsPerJob: number) {
  console.log('=== CONCURRENT JOBS STRESS TEST ===');
  console.log(`Concurrent jobs: ${concurrentJobs}`);
  console.log(`Wallets per job: ${walletsPerJob}`);
  console.log(`Total wallets to process: ${concurrentJobs * walletsPerJob}`);
  console.log('');

  // If we don't have enough token mints, reuse the same one
  const tokens = TOKEN_MINTS.length >= concurrentJobs
    ? TOKEN_MINTS.slice(0, concurrentJobs)
    : Array(concurrentJobs).fill(TOKEN_MINTS[0] || 'YOUR_TOKEN_MINT_HERE');

  const testStartTime = Date.now();

  // Fire off all jobs simultaneously
  const jobPromises = tokens.map((mint, index) =>
    startHolderProfilesJob(index + 1, mint, walletsPerJob)
  );

  console.log(`⏳ Waiting for ${concurrentJobs} jobs to complete...`);
  console.log('');

  const results = await Promise.allSettled(jobPromises);

  const testEndTime = Date.now();
  const totalDuration = testEndTime - testStartTime;

  // Analyze results
  console.log('\n=== RESULTS ===');
  console.log(`Total test duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('');

  const jobResults: JobResult[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      jobResults.push(result.value);
    } else {
      jobResults.push({
        jobId: index + 1,
        tokenMint: tokens[index],
        walletCount: walletsPerJob,
        startTime: testStartTime,
        status: 'failed',
        error: result.reason?.message || 'Unknown error',
      });
    }
  });

  // Summary table
  console.log('Job | Token | Wallets | Duration | Status');
  console.log('----|-------|---------|----------|--------');

  jobResults.forEach(job => {
    const tokenShort = job.tokenMint.substring(0, 8) + '...';
    const durationStr = job.duration ? `${(job.duration / 1000).toFixed(1)}s` : 'N/A';
    const statusIcon = job.status === 'completed' ? '✅' : '❌';

    console.log(`${String(job.jobId).padEnd(3)} | ${tokenShort} | ${String(job.walletCount).padEnd(7)} | ${String(durationStr).padEnd(8)} | ${statusIcon} ${job.status}`);
  });

  // Statistics
  const completedJobs = jobResults.filter(j => j.status === 'completed');
  const failedJobs = jobResults.filter(j => j.status === 'failed');

  console.log('\n=== STATISTICS ===');
  console.log(`Completed: ${completedJobs.length}/${concurrentJobs}`);
  console.log(`Failed: ${failedJobs.length}/${concurrentJobs}`);
  console.log(`Success rate: ${((completedJobs.length / concurrentJobs) * 100).toFixed(1)}%`);

  if (completedJobs.length > 0) {
    const avgDuration = completedJobs.reduce((sum, job) => sum + (job.duration || 0), 0) / completedJobs.length;
    const minDuration = Math.min(...completedJobs.map(j => j.duration || Infinity));
    const maxDuration = Math.max(...completedJobs.map(j => j.duration || 0));

    console.log(`Average job duration: ${(avgDuration / 1000).toFixed(2)}s`);
    console.log(`Fastest job: ${(minDuration / 1000).toFixed(2)}s`);
    console.log(`Slowest job: ${(maxDuration / 1000).toFixed(2)}s`);

    // Calculate theoretical vs actual
    const theoreticalDuration = avgDuration; // If perfect parallelism
    const parallelEfficiency = (theoreticalDuration / totalDuration) * 100;

    console.log('\n=== CONCURRENCY ANALYSIS ===');
    console.log(`Theoretical (if sequential): ${(avgDuration * concurrentJobs / 1000).toFixed(1)}s`);
    console.log(`Actual (parallel): ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`Speedup: ${(avgDuration * concurrentJobs / totalDuration).toFixed(2)}x`);
    console.log(`Parallel efficiency: ${parallelEfficiency.toFixed(1)}%`);

    if (parallelEfficiency > 80) {
      console.log('🎉 Excellent parallelism! Queue is handling load well.');
    } else if (parallelEfficiency > 60) {
      console.log('✅ Good parallelism. Some overhead but acceptable.');
    } else {
      console.log('⚠️ Poor parallelism. Queue may be bottlenecked - consider increasing concurrency.');
    }
  }

  // Errors
  if (failedJobs.length > 0) {
    console.log('\n=== FAILED JOBS ===');
    failedJobs.forEach(job => {
      console.log(`Job ${job.jobId}: ${job.error}`);
    });
  }
}

// Parse command line args
const concurrentJobs = parseInt(process.argv[2] || '3', 10);
const walletsPerJob = parseInt(process.argv[3] || '10', 10);

runConcurrentJobsTest(concurrentJobs, walletsPerJob).catch(console.error);
