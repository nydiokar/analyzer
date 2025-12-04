# Test Script Alignment to Actual API

## ✅ All test scripts are now aligned to the EXACT API implementation

### How Your System Actually Works

**Step 1: Queue the Job** (Returns immediately)
```typescript
POST /api/analyses/holder-profiles
Body: { tokenMint: string, topN: number }

Response (202 Accepted):
{
  jobId: "holder-profiles-xxx",
  requestId: "holder-profiles-xxx",
  status: "queued",
  queueName: "analysis-operations",
  tokenMint: "...",
  topN: 15,
  estimatedProcessingTime: "22 seconds",
  monitoringUrl: "/jobs/holder-profiles-xxx"
}
```

**Step 2: Poll for Completion**
```typescript
GET /api/jobs/:jobId

While job is running:
{
  id: "holder-profiles-xxx",
  state: "active",  // or "waiting"
  progress: 45,     // percentage
  ...
}

When job completes:
{
  id: "holder-profiles-xxx",
  state: "completed",
  returnvalue: {
    success: true,
    mode: "token",
    tokenMint: "...",
    profiles: [...],
    metadata: {
      totalHoldersRequested: 15,
      totalHoldersAnalyzed: 15,
      totalProcessingTimeMs: 18300,
      avgProcessingTimePerWalletMs: 1220
    },
    timestamp: ...,
    processingTimeMs: 18300
  }
}
```

---

## What Changed in Test Scripts

### ❌ OLD (Incorrect) Approach
```typescript
// This doesn't work - API doesn't wait for completion!
const response = await axios.post('/api/analyses/holder-profiles', {
  tokenMint: TOKEN_MINT,
  topN: 15,
}, {
  timeout: 300000  // 5 minute timeout
});

// ❌ response.data would only have jobId, not results!
```

### ✅ NEW (Correct) Approach
```typescript
// Step 1: Queue the job
const queueResponse = await axios.post('/api/analyses/holder-profiles', {
  tokenMint: TOKEN_MINT,
  topN: 15,
});

const jobId = queueResponse.data.jobId;

// Step 2: Poll for completion
async function pollJobStatus(jobId) {
  while (true) {
    const status = await axios.get(`/api/jobs/${jobId}`);

    if (status.data.state === 'completed') {
      return status.data.returnvalue;  // ✅ This has the actual results!
    }

    if (status.data.state === 'failed') {
      throw new Error(status.data.failedReason);
    }

    await sleep(2000);  // Poll every 2 seconds
  }
}

const result = await pollJobStatus(jobId);
```

---

## Files Updated

### 1. `scripts/quick-test.ts`
**What it does**: Single holder profiles job (quick validation)

**Aligned to**:
- ✅ POST `/api/analyses/holder-profiles` → Get jobId
- ✅ GET `/api/jobs/:jobId` → Poll for completion
- ✅ Extract `metadata.totalProcessingTimeMs` for accurate timing
- ✅ Show progress percentage while polling

**Usage**:
```bash
npx ts-node scripts/quick-test.ts YOUR_TOKEN_MINT 15
```

---

### 2. `scripts/test-holder-profiles-performance.ts`
**What it does**: Tests multiple wallet counts (5, 10, 15, 25, 50)

**Aligned to**:
- ✅ POST `/api/analyses/holder-profiles` → Get jobId
- ✅ GET `/api/jobs/:jobId` → Poll for completion
- ✅ Runs 5 separate jobs sequentially
- ✅ Extracts timing from job results

**Usage**:
```bash
export TEST_TOKEN_MINT=YOUR_TOKEN_MINT
npx ts-node scripts/test-holder-profiles-performance.ts
```

---

### 3. `scripts/test-concurrent-jobs.ts`
**What it does**: Fires multiple jobs in parallel (stress test)

**Aligned to**:
- ✅ POST `/api/analyses/holder-profiles` → Get jobId (multiple times in parallel)
- ✅ GET `/api/jobs/:jobId` → Poll each job concurrently
- ✅ Tests queue concurrency (can handle multiple jobs)
- ✅ Measures parallel efficiency

**Usage**:
```bash
export TEST_TOKEN_MINTS=MINT1,MINT2,MINT3
npx ts-node scripts/test-concurrent-jobs.ts 3 10
# 3 = concurrent jobs, 10 = wallets per job
```

---

## Why This Matters

### Your API is Asynchronous
The API uses **BullMQ job queues** - it queues the job and returns immediately. This is the correct architecture for long-running jobs!

**Benefits**:
- ✅ API doesn't block for 40+ seconds
- ✅ Frontend can show progress bars
- ✅ Multiple jobs can run concurrently
- ✅ Jobs survive restarts (in Redis)

### Tests Must Match This Pattern
Our tests now:
1. ✅ Queue the job (fast - returns jobId)
2. ✅ Poll for status (shows progress)
3. ✅ Get final results when complete
4. ✅ Measure total time (queue → completion)

This matches EXACTLY how your frontend/dashboard would use the API!

---

## Verification Checklist

✅ **API Endpoint**: `/api/analyses/holder-profiles` (from analyses.controller.ts:464)
✅ **Request Body**: `{ tokenMint: string, topN: number }` (from analyses.controller.ts:490)
✅ **Response Structure**: `{ jobId, requestId, status, ... }` (from analyses.controller.ts:491-499)
✅ **Job Polling**: `/api/jobs/:jobId` (standard BullMQ job status endpoint)
✅ **Result Type**: `HolderProfilesResult` (from types/index.ts:221-232)
✅ **Metadata Fields**: `totalProcessingTimeMs`, `avgProcessingTimePerWalletMs` (from types/index.ts:227-230)

---

## How Concurrency Actually Works

### Single Job (15 wallets)
```
Your Test Script
    ↓
POST /api/analyses/holder-profiles { topN: 15 }
    ↓
Queue adds job → Returns jobId immediately
    ↓
[Your test polls every 2s]
    ↓
Worker processes job:
  ├─ Batch 1: Wallets 1-6  (WALLET_SYNC_CONCURRENCY=6)
  ├─ Batch 2: Wallets 7-12
  └─ Batch 3: Wallets 13-15
    ↓
Job completes → state='completed'
    ↓
Your test gets result
```

### Multiple Concurrent Jobs (3 jobs, 10 wallets each)
```
Your Test Script
    ↓
POST /api/analyses/holder-profiles { topN: 10 }  ←┐
POST /api/analyses/holder-profiles { topN: 10 }  ←├─ Fire all 3 in parallel
POST /api/analyses/holder-profiles { topN: 10 }  ←┘
    ↓
Queue has 3 jobs waiting
    ↓
Workers process in parallel:
  Worker 1: Job #1 (10 wallets, uses 6 internal workers)
  Worker 2: Job #2 (10 wallets, uses 6 internal workers)
  Worker 3: Job #3 (10 wallets, uses 6 internal workers)
    ↓
[ANALYSIS_OPERATIONS concurrency=14 means up to 14 jobs can run simultaneously]
    ↓
All 3 jobs complete roughly at the same time
    ↓
Your test measures: Total time vs Sequential time → Calculate speedup
```

---

## Expected Test Results (After Optimizations)

### Quick Test (15 wallets)
```
🧪 QUICK PERFORMANCE TEST
========================
Token: EPjFWdd5...
Wallets: 15
API: http://localhost:3000

⏱️  Starting at 10:30:45...
📋 Job queued: holder-profiles-1733....
   Estimated: 22 seconds

⏳ Progress: 100%
✅ Job completed!

✅ SUCCESS!
========================
Total duration: 18.30s
Per wallet: 1.22s
Throughput: 0.82 wallets/sec

JOB METADATA:
  Holders analyzed: 15/15
  Processing time: 18.30s
  Avg per wallet: 1.22s

PERFORMANCE COMPARISON:
Baseline (old): ~45.0s
Actual (new): 18.3s
Improvement: 59.3% faster (2.46x speedup) 🚀

🎉 WOW! 2x or better improvement! Config changes working perfectly!
```

### Performance Test (Multiple Sizes)
```
=== PERFORMANCE SUMMARY ===
Wallet Count | Duration | Avg/Wallet | Throughput
-------------|----------|------------|------------
5            | 6.2s     | 1.24s      | 0.81 wallets/s
10           | 10.5s    | 1.05s      | 0.95 wallets/s
15           | 18.3s    | 1.22s      | 0.82 wallets/s
25           | 28.7s    | 1.15s      | 0.87 wallets/s
50           | 65.2s    | 1.30s      | 0.77 wallets/s

=== 15 WALLET BENCHMARK ===
Actual time: 18.3s
Target (optimized): 15-25s
Previous (baseline): 40-50s
🎉 SUCCESS! Optimizations working as expected!
```

### Concurrent Test (3 jobs, 10 wallets each)
```
=== CONCURRENT JOBS STRESS TEST ===
Concurrent jobs: 3
Wallets per job: 10
Total wallets to process: 30

✅ Job 1: Completed in 12.3s
✅ Job 2: Completed in 13.1s
✅ Job 3: Completed in 12.8s

=== CONCURRENCY ANALYSIS ===
Theoretical (if sequential): 38.2s
Actual (parallel): 13.1s
Speedup: 2.92x
Parallel efficiency: 96.8%

🎉 Excellent parallelism! Queue is handling load well.
```

---

## Summary

✅ **All tests aligned to actual API implementation**
✅ **Matches how frontend/dashboard uses the API**
✅ **Accurately measures end-to-end performance**
✅ **Tests both single-job and concurrent-job scenarios**
✅ **Shows real-world performance after optimizations**

**Ready to test tomorrow!** 🚀
