# RPS Tuning Guide - Finding Your Sweet Spot (25-50 RPS)

## 🎯 Goal
Find optimal RPS configuration that:
- ✅ Maximizes throughput (wallets/second)
- ✅ Minimizes 429 rate limit errors (<2%)
- ✅ Stays between 25-50 RPS (your current capacity)

---

## 🚨 Current Situation

**You jumped from 25 RPS → 50 RPS and hit 21% 429 error rate!**

This means you're severely exceeding API capacity and wasting API calls on retries.

---

## 📊 The Math Behind the Problem

Your current config (50 RPS):
```
ANALYSIS_OPERATIONS: 14 concurrent workers
WALLET_SYNC_CONCURRENCY: 6 wallets in parallel per job

Maximum concurrent wallet syncs: 14 × 6 = 84 wallets
API calls per wallet sync: ~10-20 calls
Potential burst: 84 × 10 = 840 API calls

Even with rate limiting, bursts exceed 50 RPS → 429 errors
```

**The issue:** Concurrency multiplies faster than RPS can handle!

---

## 🛠️ Workflow: How to Find Your Sweet Spot

### Step 1: Establish Baseline (First Run)

```bash
# This will analyze ALL historical logs and save the timestamp
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts
```

**Output:**
- Shows current 429 error rate from all recent activity
- Saves timestamp to `.last-rps-analysis-time.txt`
- Gives initial recommendations

---

### Step 2: Apply Recommended Configuration

**Recommended starting point (40 RPS):**

Edit `src/config/constants.ts`:
```typescript
export const HELIUS_CONFIG = {
  DEFAULT_RPS: 40,  // Down from 50 (80% of max capacity)
  // ...
}

export const PROCESSING_CONFIG = {
  WALLET_SYNC_CONCURRENCY: 5,  // Down from 6
  // ...
}
```

Edit `src/queues/config/queue.config.ts`:
```typescript
export const QueueConfigs: Record<QueueNames, ...> = {
  [QueueNames.ANALYSIS_OPERATIONS]: {
    workerOptions: {
      concurrency: 12,  // Down from 14
    }
  },
  [QueueNames.SIMILARITY_OPERATIONS]: {
    workerOptions: {
      concurrency: 6,  // Down from 7
    }
  },
  [QueueNames.WALLET_OPERATIONS]: {
    workerOptions: {
      concurrency: 4,  // Down from 5
    }
  },
  [QueueNames.ENRICHMENT_OPERATIONS]: {
    workerOptions: {
      concurrency: 5,  // Keep at 5
    }
  }
}
```

**Restart backend:**
```bash
npm run start:dev
```

---

### Step 3: Run Concurrent Jobs Test

```bash
# Test with 3 concurrent jobs, 10 wallets each
npx ts-node -r tsconfig-paths/register scripts/test-concurrent-jobs.ts 3 10
```

**This will:**
- Fire off 3 holder profiles jobs in parallel
- Process 30 total wallets
- Stress-test your queue concurrency
- Take 1-2 minutes

---

### Step 4: Analyze Results (ONLY from this test!)

```bash
# Analyze logs from last 5 minutes ONLY
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 5
```

**Why 5 minutes?**
- Filters out old contaminated logs
- Only shows 429s from your test run
- Clean, isolated results

**Or use automatic tracking:**
```bash
# Analyzes logs since last run (using saved timestamp)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts
```

---

### Step 5: Interpret Results

#### ✅ Target: <2% 429 Error Rate

**If 429 rate is 0-2%:**
```
🎉 PERFECT! You found the sweet spot.
✅ Keep this configuration
✅ Optional: Try increasing RPS by 5 and re-test
```

**If 429 rate is 2-5%:**
```
✅ ACCEPTABLE - retry logic will handle it
💡 Can tune down slightly if you want near-zero 429s
   Reduce RPS by 5 (e.g., 40 → 35)
```

**If 429 rate is 5-10%:**
```
⚠️  TOO HIGH - reduce RPS
❌ Reduce RPS by 10 (e.g., 40 → 30)
❌ Reduce WALLET_SYNC_CONCURRENCY by 1
❌ Reduce queue concurrency by 2
```

**If 429 rate is >10%:**
```
🚨 CRITICAL - major reduction needed
❌ Reduce RPS to 30
❌ Reduce WALLET_SYNC_CONCURRENCY to 4
❌ Reduce ANALYSIS_OPERATIONS to 10
```

---

## 📈 Configuration Quick Reference

### RPS 50 (Maximum - Too Aggressive)
```typescript
DEFAULT_RPS: 50
WALLET_SYNC_CONCURRENCY: 6
ANALYSIS_OPERATIONS concurrency: 14
```
**Expected:** 21% 429 rate (AVOID!)

---

### RPS 45 (Aggressive)
```typescript
DEFAULT_RPS: 45
WALLET_SYNC_CONCURRENCY: 5
ANALYSIS_OPERATIONS concurrency: 14
```
**Expected:** 5-10% 429 rate

---

### RPS 40 (Recommended - Sweet Spot)
```typescript
DEFAULT_RPS: 40
WALLET_SYNC_CONCURRENCY: 5
ANALYSIS_OPERATIONS concurrency: 12
SIMILARITY_OPERATIONS concurrency: 6
WALLET_OPERATIONS concurrency: 4
ENRICHMENT_OPERATIONS concurrency: 5
```
**Expected:** <2% 429 rate, 1.6x faster than 25 RPS

---

### RPS 35 (Conservative)
```typescript
DEFAULT_RPS: 35
WALLET_SYNC_CONCURRENCY: 4
ANALYSIS_OPERATIONS concurrency: 10
SIMILARITY_OPERATIONS concurrency: 5
WALLET_OPERATIONS concurrency: 4
ENRICHMENT_OPERATIONS concurrency: 4
```
**Expected:** <1% 429 rate, 1.4x faster than 25 RPS

---

### RPS 30 (Safe)
```typescript
DEFAULT_RPS: 30
WALLET_SYNC_CONCURRENCY: 4
ANALYSIS_OPERATIONS concurrency: 10
SIMILARITY_OPERATIONS concurrency: 5
WALLET_OPERATIONS concurrency: 3
ENRICHMENT_OPERATIONS concurrency: 3
```
**Expected:** ~0% 429 rate, 1.2x faster than 25 RPS

---

### RPS 25 (Original Baseline)
```typescript
DEFAULT_RPS: 25
WALLET_SYNC_CONCURRENCY: 3
ANALYSIS_OPERATIONS concurrency: 10
```
**Expected:** 0% 429 rate (but slower)

---

## 🔄 Iterative Tuning Process

### If you want to push higher (chase speed):

1. Start at 40 RPS (recommended)
2. Run test → Analyze
3. If 429 rate <1%, increase RPS by 5
4. Repeat until 429 rate reaches 2-5%
5. Back off by 5 RPS
6. ✅ This is your maximum safe RPS

### If you want reliability (minimize 429s):

1. Start at 40 RPS (recommended)
2. Run test → Analyze
3. If 429 rate >1%, decrease RPS by 5
4. Repeat until 429 rate <1%
5. ✅ This is your safe RPS

---

## 🎓 Understanding the Tradeoffs

### Throughput vs Reliability

```
RPS 50: ████████████░░░░░░░░ 60% effective (40% wasted on retries)
RPS 45: ██████████████░░░░░░ 70% effective
RPS 40: ████████████████░░░░ 80% effective ← RECOMMENDED
RPS 35: ██████████████████░░ 90% effective
RPS 30: ███████████████████░ 95% effective
RPS 25: ████████████████████ 100% effective (but slower)
```

**40 RPS gives best balance:**
- Fast enough (1.6x faster than 25)
- Reliable enough (<2% 429s)
- Efficient (80% effective RPS)

---

## 📚 Advanced: Time-Window Analysis

### Analyzing specific time windows:

```bash
# Last 2 minutes (for quick tests)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 2

# Last 10 minutes (for longer tests)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 10

# Last 30 minutes (for production monitoring)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 30

# Since last analysis (automatic - uses saved timestamp)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts
```

### How the timestamp tracking works:

1. **First run:** Analyzes all logs, saves current time to `.last-rps-analysis-time.txt`
2. **Second run:** Only analyzes logs after saved timestamp
3. **Manual override:** Pass minutes argument to use specific window

This prevents contamination between different test runs!

---

## 🎯 Recommended Workflow (Complete Example)

```bash
# 1. Establish baseline
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts
# Output: 21% 429 rate at RPS 50

# 2. Apply recommended config (RPS 40)
# Edit constants.ts and queue.config.ts as shown above
npm run start:dev

# 3. Wait 30 seconds for startup
sleep 30

# 4. Run concurrent test
npx ts-node -r tsconfig-paths/register scripts/test-concurrent-jobs.ts 3 10
# Test completes in ~20 seconds

# 5. Analyze ONLY this test (last 5 minutes)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 5
# Output: 1.5% 429 rate at RPS 40 ✅

# 6. Success! Keep RPS 40 config
```

---

## 🛡️ Production Monitoring

Once you find your optimal config, monitor in production:

```bash
# Check last hour
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 60

# Check last 4 hours
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 240
```

**Set alerts:**
- If 429 rate >5%: Reduce RPS by 5
- If 429 rate <0.5% for 24h: Try increasing RPS by 5

---

## 💡 Pro Tips

1. **Use time windows:** Always specify minutes argument when testing to avoid contamination
2. **Test during peak load:** If you run multiple concurrent jobs, test with that workload
3. **Leave headroom:** Target 80-90% of max RPS (40-45 for 50 RPS tier)
4. **Monitor over time:** 429 rates can change with API server load
5. **Separate API keys:** Use `HELIUS_METADATA_API_KEY` for enrichment to split load

---

## 🚀 Quick Commands Cheat Sheet

```bash
# Run concurrent test
npx ts-node -r tsconfig-paths/register scripts/test-concurrent-jobs.ts 3 10

# Analyze last test (5 min window)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 5

# Check production (1 hour)
npx ts-node -r tsconfig-paths/register scripts/quick-rps-analyzer.ts 60

# Reset timestamp tracking
rm scripts/.last-rps-analysis-time.txt
```

---

## 📊 Expected Performance at Each RPS Level

| RPS | Speed vs 25 RPS | 429 Rate | Use Case |
|-----|-----------------|----------|----------|
| 50  | 2.0x faster | 20%+ | ❌ Too aggressive |
| 45  | 1.8x faster | 5-10% | ⚠️  For burst tolerance |
| 40  | 1.6x faster | 1-2% | ✅ **RECOMMENDED** |
| 35  | 1.4x faster | <1% | ✅ Very reliable |
| 30  | 1.2x faster | ~0% | ✅ Production safe |
| 25  | 1.0x (baseline) | 0% | Original (too slow) |

---

## 🎓 Summary

**Start with RPS 40**, test it, and adjust based on 429 error rate:

- **0-2% 429s:** Perfect! Keep it or try RPS 45
- **2-5% 429s:** Acceptable, or reduce to RPS 35 for safety
- **5-10% 429s:** Too high, reduce to RPS 30-35
- **>10% 429s:** Critical, reduce to RPS 30

**Your goal:** Find the highest RPS with <2% 429 error rate.

This gives you maximum performance while staying reliable! 🚀
