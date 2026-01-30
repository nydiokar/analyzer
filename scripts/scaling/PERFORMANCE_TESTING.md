# Performance Testing Guide

After making concurrency optimizations, use these scripts to measure improvements.

## Quick Reference

| Test Type | Use When | Command |
|-----------|----------|---------|
| **Quick Test** | Just want to see if it's faster | `npm run test:quick` |
| **Performance Test** | Detailed metrics for different wallet counts | `npm run test:performance` |
| **Stress Test** | Test concurrent job handling | `npm run test:concurrent` |

---

## 1. Quick Smoke Test ⚡

**What it tests**: Single holder profiles job

**Best for**: Quick validation after config changes

### Usage:
```bash
# Test with 15 wallets (default)
npx ts-node scripts/quick-test.ts YOUR_TOKEN_MINT_ADDRESS

# Test with custom wallet count
npx ts-node scripts/quick-test.ts YOUR_TOKEN_MINT_ADDRESS 25

# Or set environment variable
export TEST_TOKEN_MINT=YOUR_TOKEN_MINT_ADDRESS
npx ts-node scripts/quick-test.ts
```

### What to expect:
```
✅ SUCCESS!
========================
Total duration: 18.3s
Per wallet: 1.22s
Throughput: 0.82 wallets/sec

PERFORMANCE COMPARISON:
Baseline (old): ~45.0s
Actual (new): 18.3s
Improvement: 59.3% faster (2.46x speedup) 🚀

🎉 WOW! 2x or better improvement! Config changes working perfectly!
```

---

## 2. Performance Test (Detailed) 📊

**What it tests**: Multiple wallet counts (5, 10, 15, 25, 50)

**Best for**: Understanding scaling behavior

### Usage:
```bash
export TEST_TOKEN_MINT=YOUR_TOKEN_MINT_ADDRESS
npx ts-node scripts/test-holder-profiles-performance.ts
```

### What it tests:
- ✅ How performance scales with wallet count
- ✅ Parallel efficiency (is concurrency helping?)
- ✅ Throughput (wallets/second)

### Sample output:
```
=== PERFORMANCE SUMMARY ===
Wallet Count | Duration | Avg/Wallet | Throughput
-------------|----------|------------|------------
5            | 6.2s     | 1.24s      | 0.81 wallets/s
10           | 10.5s    | 1.05s      | 0.95 wallets/s
15           | 18.3s    | 1.22s      | 0.82 wallets/s
25           | 28.7s    | 1.15s      | 0.87 wallets/s
50           | 65.2s    | 1.30s      | 0.77 wallets/s

=== SCALING ANALYSIS ===
5 → 10 wallets: 118.1% efficient
  (Perfect parallelism would be 12.4s, actual: 10.5s)
5 → 15 wallets: 101.6% efficient
  (Perfect parallelism would be 18.6s, actual: 18.3s)
```

**What "efficiency" means**:
- **>100%**: Super-linear scaling (caching kicking in!)
- **80-100%**: Excellent parallel efficiency
- **60-80%**: Good, some overhead
- **<60%**: Bottleneck detected

---

## 3. Concurrent Jobs Stress Test 🔥

**What it tests**: Multiple jobs running at the same time

**Best for**: Testing queue concurrency limits

### Usage:
```bash
# Test 3 concurrent jobs, 10 wallets each
export TEST_TOKEN_MINTS=MINT1,MINT2,MINT3
npx ts-node scripts/test-concurrent-jobs.ts 3 10

# Test 5 concurrent jobs, 15 wallets each
npx ts-node scripts/test-concurrent-jobs.ts 5 15
```

### What it tests:
- ✅ Can the queue handle multiple jobs?
- ✅ Does performance degrade with load?
- ✅ Are workers efficiently utilized?

### Sample output:
```
=== CONCURRENT JOBS STRESS TEST ===
Concurrent jobs: 3
Wallets per job: 10
Total wallets to process: 30

Job | Token | Wallets | Duration | Status
----|-------|---------|----------|--------
1   | EPjFWdd5... | 10      | 12.3s    | ✅ completed
2   | So111111... | 10      | 13.1s    | ✅ completed
3   | Es9vMFrz... | 10      | 12.8s    | ✅ completed

=== CONCURRENCY ANALYSIS ===
Theoretical (if sequential): 38.2s
Actual (parallel): 13.1s
Speedup: 2.92x
Parallel efficiency: 96.8%

🎉 Excellent parallelism! Queue is handling load well.
```

---

## Understanding the Results

### Good Signs ✅
- **Sub-20s for 15 wallets**: Config optimizations working!
- **>80% parallel efficiency**: Great concurrency utilization
- **>2x speedup**: You've doubled performance for free!

### Warning Signs ⚠️
- **>30s for 15 wallets**: Something's wrong, investigate
- **<60% parallel efficiency**: Bottleneck detected
- **Failed jobs**: Check logs for errors

### Common Bottlenecks
1. **Helius rate limiting (429 errors)**
   - Solution: Reduce `DEFAULT_RPS` from 50 to 45

2. **Redis connection errors**
   - Solution: Reduce queue concurrency by 20-30%

3. **Database timeouts**
   - Solution: Reduce `WALLET_SYNC_CONCURRENCY`

4. **Memory issues**
   - Solution: Reduce all concurrency settings

---

## Interpreting Your Results

### Before Optimizations (Baseline)
- 15 wallets: **40-50 seconds**
- Per wallet: **~3 seconds**

### Target After Optimizations
- 15 wallets: **15-25 seconds** (2-3x faster)
- Per wallet: **~1-1.5 seconds**

### If You See 2x+ Improvement
**YOU DID IT!** 🎉

You just:
- Got a free performance boost equivalent to ~$40/month
- Doubled your throughput without paying for upgrades
- Can now handle 2x more load

### Next Steps After Testing

**If tests pass (2x improvement)**:
1. ✅ Celebrate! 🍾
2. ✅ Monitor production for a few days
3. ✅ Consider tuning up more (increase concurrency to 8-10)

**If tests show <1.5x improvement**:
1. Check logs for errors
2. Monitor Redis/PostgreSQL load
3. May need to dial back concurrency slightly

**If tests fail or slower**:
1. Roll back changes
2. Investigate bottlenecks
3. Share logs for debugging

---

## Monitoring During Tests

### Watch for these in logs:
```bash
# Terminal 1: Run test
npx ts-node scripts/quick-test.ts YOUR_TOKEN

# Terminal 2: Monitor logs
npm run start:dev

# Look for:
✅ "Holder profiles analysis for X completed in Yms"
✅ No Redis errors
✅ No rate limit errors (429)
⚠️ Any ERROR logs
⚠️ Database timeout warnings
```

### Redis monitoring (optional):
```bash
redis-cli
> INFO stats
> CLIENT LIST
```

Look for:
- `total_commands_processed`: Should be increasing rapidly
- `connected_clients`: Should match your concurrency settings

---

## Troubleshooting

### Test hangs/times out
**Possible causes**:
- Backend not running
- Token mint address doesn't exist
- Queue stuck

**Fix**: Check backend logs, restart queues

### "Rate limit exceeded" errors
**Cause**: Hitting Helius 50 RPS limit

**Fix**: Reduce `DEFAULT_RPS` to 45 in constants.ts

### Slower than baseline
**Possible causes**:
- Cold start (first test after restart)
- Database not optimized
- Other services using resources

**Fix**: Run test 2-3 times, use best result

---

## Adding Tests to package.json

Add these to your `package.json` scripts:

```json
{
  "scripts": {
    "test:quick": "ts-node scripts/quick-test.ts",
    "test:performance": "ts-node scripts/test-holder-profiles-performance.ts",
    "test:concurrent": "ts-node scripts/test-concurrent-jobs.ts"
  }
}
```

Then run with:
```bash
npm run test:quick
npm run test:performance
npm run test:concurrent 3 10
```

---

## What Each Test Measures

| Metric | What It Means | Good Value |
|--------|---------------|------------|
| **Total Duration** | How long the entire job took | <20s for 15 wallets |
| **Per Wallet** | Average time per wallet | <1.5s |
| **Throughput** | Wallets processed per second | >0.7 wallets/s |
| **Speedup** | How much faster vs baseline | >2x |
| **Parallel Efficiency** | How well concurrency helps | >80% |

---

## Example Test Sequence

### Day 1: Baseline (Before Changes)
```bash
# Record baseline
npx ts-node scripts/quick-test.ts YOUR_TOKEN 15
# Expected: 40-50 seconds
```

### Day 2: After Optimizations
```bash
# Quick test
npx ts-node scripts/quick-test.ts YOUR_TOKEN 15
# Expected: 15-25 seconds (2x faster!)

# Detailed performance test
npx ts-node scripts/test-holder-profiles-performance.ts
# Measure scaling

# Stress test
npx ts-node scripts/test-concurrent-jobs.ts 3 10
# Test queue handling
```

### Day 3: Production Validation
```bash
# Larger test
npx ts-node scripts/quick-test.ts YOUR_TOKEN 50
# Expected: 60-90 seconds

# Heavy load
npx ts-node scripts/test-concurrent-jobs.ts 5 15
# Ensure stability under load
```

---

Happy testing! 🚀
