# Whale Wallet Incident - Complete Root Cause Analysis

**Date:** 2026-01-27
**Incident:** Similarity analysis choked on 30k token wallet, caused lock expiry and system failure

---

## Executive Summary

A similarity analysis of 20 wallets failed when one wallet contained 30,040 tokens. The system correctly detected it as a "LARGE" wallet but still fetched all 30k tokens, passed them to enrichment, which took 2+ minutes to process. This caused:

1. **BullMQ lock expiry** (jobs marked as stalled while still running)
2. **Payload cache expiry** (enrichment couldn't retrieve balance data)
3. **9 MB result generation** (massive payload size)
4. **Complete pipeline failure** (both similarity and enrichment jobs failed)

---

## Timeline of Events

```
12:57:19 - Similarity analysis starts for 20 wallets
12:57:19 - Balance fetching completes for 18 addresses (including 30k whale)
12:57:19 - Payload stored in Redis: similarity:balances:similarity-1769511413627-piu7ag9dk (TTL: 15min)
12:57:20 - Enrichment job queued (enrich-parallel-151f89e59f00)
12:57:28 - Enrichment starts processing, detects 30k tokens
12:57:41 - After filtering: 29,225 tokens remain
12:57:59 - Capped to 5,000 tokens by balance
12:58:00 - ⚠️ FIRST LOCK RENEWAL FAILURE (both jobs)
12:59:30 - ⚠️ SECOND LOCK RENEWAL FAILURE (90 seconds later)
12:59:30 - 9.03 MB similarity result generated
12:59:31 - ❌ Payload cache lookup failed (expired/deleted)
12:59:32 - ❌ Both jobs marked as FAILED
```

---

## Root Causes

### 1. **BullMQ Lock Configuration Missing**

**Issue:** Worker options don't configure `lockDuration` or `lockRenewTime`.

**Current config** (`queue.config.ts:116-121`):
```typescript
workerOptions: {
  connection: redisConnection,
  concurrency: 6,
  // ❌ MISSING: lockDuration, lockRenewTime
}
```

**What happens:**
- BullMQ uses default lock duration (~30 seconds)
- Jobs taking >30s cause "could not renew lock" errors
- Job marked as stalled while still processing
- Duplicate processing or job failure

**Why this is BAD:**
- It's not that lock expired because job took too long
- **The worker doesn't know HOW to renew the lock** (no config)
- BullMQ's internal lock management gets confused

**The fix debate:**
- ❓ Should we set job-specific lock durations? (complex, requires estimating all job types)
- ❓ Should we set one universal lock duration? (may be too long for short jobs, too short for long jobs)
- ✅ **Better approach:** Self-healing workers that auto-detect and extend locks based on actual processing

---

### 2. **Token Count Data Lost in Translation**

**The disconnect:**

```
SystemWalletDetection Service
    ↓ (knows: 30k tokens, isLarge=true)
    ↓
    ✓ Returns: { valid: [address], largeWallets: [address], filteredDetails: Map }
    ↓
SimilarityOperationsProcessor
    ↓ (receives detection result)
    ↓
    ❌ DROPS tokenCount data on the floor
    ↓
    ❌ Calls: balanceCacheService.getManyBalances(validWallets) ← NO TOKEN COUNT HINT
    ↓
BalanceCacheService
    ↓
    ❌ Calls: walletBalanceService.fetchWalletBalancesRaw(addresses) ← NO TOKEN COUNT HINT
    ↓
WalletBalanceService
    ↓
    ❌ Fetches ALL 30k tokens via RPC (no early exit)
```

**The data IS available but never passed:**
```typescript
// similarity-operations.processor.ts:509
const { valid, filtered, largeWallets, filteredDetails } = await this.systemWalletDetection.filterSystemWallets(unknownWallets);

// filteredDetails contains SystemWalletDetectionResult with tokenCount!
// But we never use it when calling getManyBalances()
```

---

### 3. **What ARE Balances Used For?**

**CRITICAL FINDING:** Similarity calculation does NOT use live balances!

```typescript
// similarity-service.ts:61
transactionData = await this.databaseService.getTransactionsForAnalysis(walletAddresses, this.config);

// similarity-service.ts:106-111
const batchAnalysisResults = await this.databaseService.getAnalysisResults({
    where: {
        walletAddress: { in: walletsWithFetchedData },
        totalFeesPaidInSol: { gt: 0 } // Only tokens where wallet PAID FEES
    }
});
```

**Similarity uses the DATABASE (`AnalysisResult` table), not live balances!**

**So why fetch balances at all?**

Balances are used for:
1. **Current holdings display** (what tokens wallet holds NOW)
2. **Enrichment** (fetching metadata for display)
3. **"Holdings Context"** section in UI

**The problem:**
- Fetching 30k tokens for "current holdings display"
- But 29k of them are dust/airdrops/scams with no value
- Enrichment tries to process all 30k → system chokes

---

### 4. **Enrichment's 5000 Cap is Arbitrary**

**Current logic** (`enrichment-operations.processor.ts:279-339`):

```typescript
const MAX_TOKENS_PER_ENRICHMENT = 5000;

if (uniqueTokens.length > MAX_TOKENS_PER_ENRICHMENT) {
  // Filter by balance, cap at 5000
}
```

**Why 5000?**
- Magic number with no reasoning
- Still takes 2+ minutes to enrich 5000 tokens
- Doesn't solve the root issue (fetching 30k in the first place)

**What SHOULD we cap on?**

```
Smart filtering strategy:
├─ Actively traded tokens (in DB with fees paid) ← ~200-500 per wallet
├─ Currently held with meaningful balance (>$10 value) ← ~50-200 per wallet
└─ Total meaningful tokens: ~250-700 per wallet (not 30k!)
```

**The reality check:**
- A "whale" with 30k tokens likely has:
  - ~200-500 actively traded tokens (in AnalysisResult table)
  - ~50-100 meaningful current holdings (>$10 value)
  - ~29,300 dust/scam/airdrop tokens (<$1 value)

---

### 5. **Payload Cache Race Condition**

**The bug** (`enrichment-operations.processor.ts:75-80`):

```typescript
balancesPayload = await this.jobPayloadCache.retrievePayload(balancesKey);
if (!balancesPayload) {
  throw new Error(`Missing balances payload`);
}
// Best-effort cleanup once loaded
await this.jobPayloadCache.deletePayload(balancesKey); // ← RACE CONDITION
```

**What happens on retry:**
1. First attempt: Retrieves payload → deletes it → fails during processing
2. Second attempt: Tries to retrieve payload → ALREADY DELETED → fails immediately
3. Third attempt: Same as second

**The payload is gone after the first retrieval, preventing any retries.**

**Timeline in your logs:**
```
12:57:19 - Payload stored (TTL: 15min)
12:59:31 - Enrichment tries to fetch → NOT FOUND
```

**Why?**
- Either deleted by first retrieval attempt
- Or TTL expired (but 15min > 2min processing time, so unlikely)
- Most likely: deleted on first retrieval at 12:57:28, then retried at 12:59:31

---

## What We Know vs What We Thought

| Assumption | Reality |
|------------|---------|
| Similarity uses live balances | ❌ Uses DB (AnalysisResult) only |
| Detection prevents 30k fetch | ❌ Detection marks as LARGE but doesn't prevent fetch |
| 5000 cap is smart | ❌ Arbitrary magic number, still too high |
| Enrichment needs all tokens | ❌ Only needs actively traded + meaningful holdings |
| Lock duration needs per-job config | ❌ Better to have self-healing lock renewal |
| Payload deleted by TTL | ❌ Deleted immediately after retrieval |

---

## Where the 30k Tokens Come From

**Call chain:**

```
similarity-operations.processor.ts:173
└─ balanceCacheService.getManyBalances(validWallets)
   └─ walletBalanceService.fetchWalletBalancesRaw(missedAddresses)
      └─ heliusClient.getTokenAccountsByOwner(address, undefined, SPL_TOKEN_PROGRAM_ID)
         └─ RPC returns all 30,040 token accounts
            └─ Filters out dust (<200 tokens) → ~29,225 remain
               └─ All 29,225 passed to enrichment
                  └─ Enrichment caps at 5,000
                     └─ Takes 2+ minutes to process
                        └─ Lock expires, system fails
```

**The issue:**
- No token count hint passed to balance fetcher
- No early exit for large wallets
- No smart filtering before enrichment

---

## What Needs to Be Fixed

### **Priority 1: Payload Cache Race Condition** ✅ MUST FIX

**Problem:** Payload deleted on first retrieval, preventing retries.

**Fix:** Don't delete immediately, let TTL handle cleanup.

```typescript
// enrichment-operations.processor.ts:79-80
balancesPayload = await this.jobPayloadCache.retrievePayload(balancesKey);
if (!balancesPayload) {
  throw new Error(`Missing balances payload`);
}
// ❌ REMOVE THIS LINE:
// await this.jobPayloadCache.deletePayload(balancesKey);

// ✅ Let TTL handle cleanup (15 min is sufficient)
```

---

### **Priority 2: Smart Token Filtering** ✅ MUST FIX

**Problem:** Fetching all 30k tokens when only ~500 are meaningful.

**Fix:** Only fetch tokens that matter for display.

**Strategy:**
```typescript
async function getRelevantTokensForWallet(walletAddress: string): Promise<{
  shouldFetchAll: boolean;
  relevantMints?: string[];
}> {
  // 1. Get actively traded tokens from DB (MUST show these)
  const activelyTraded = await db.getAnalysisResults({
    where: {
      walletAddress,
      totalFeesPaidInSol: { gt: 0 }
    }
  });
  const activeMints = activelyTraded.map(r => r.tokenAddress);

  // 2. Check total token count
  const { count } = await heliusClient.getTokenAccountsByOwnerCount(walletAddress);

  // 3. Decision tree:
  if (count < 1000) {
    return { shouldFetchAll: true }; // Normal wallet, fetch everything
  } else if (count < 5000) {
    // Medium wallet: fetch all but we'll filter aggressively post-fetch
    return { shouldFetchAll: true };
  } else {
    // Whale wallet: only fetch actively traded tokens
    // For holdings display, show: "⚠️ Large wallet: showing X actively traded tokens out of Y total"
    return {
      shouldFetchAll: false,
      relevantMints: activeMints
    };
  }
}
```

**Where to implement:**
1. `similarity-operations.processor.ts:173` - Pass token count data to balance fetcher
2. `balance-cache.service.ts:94` - Accept and use pre-fetch token counts
3. `wallet-balance-service.ts:110-136` - Early exit for whales

---

### **Priority 3: Pass Token Count Data** ✅ MUST FIX

**Problem:** Detection knows token count, balance fetcher doesn't.

**Fix:** Build and pass token count map.

```typescript
// similarity-operations.processor.ts:509-173
const { valid, filtered, largeWallets, filteredDetails } =
  await this.systemWalletDetection.filterSystemWallets(unknownWallets);
const validWallets = [...knownAllowed, ...valid];

// ✅ NEW: Build token count map from detection results
const tokenCountMap: Record<string, number> = {};
for (const [walletAddr, detection] of filteredDetails.entries()) {
  if (detection.tokenCount) {
    tokenCountMap[walletAddr] = detection.tokenCount;
  }
}

// ✅ NEW: Pass token counts to balance fetcher
const balancePromise = this.balanceCacheService.getManyBalances(
  validWallets,
  tokenCountMap // ← NEW PARAMETER
);
```

---

### **Priority 4: BullMQ Lock Configuration** ⚠️ DEBATABLE

**Problem:** Lock duration not configured, workers can't renew.

**Option A: Universal Lock Config (Simple)**
```typescript
workerOptions: {
  concurrency: 6,
  lockDuration: 300000,    // 5 minutes (covers most jobs)
  lockRenewTime: 150000,   // Renew every 2.5 minutes
}
```

**Pros:** Simple, works for most cases
**Cons:** May be too short for very long jobs, too long for quick jobs

**Option B: Per-Job Lock Config (Complex)**
```typescript
// Would require changing job enqueueing to pass lock duration
await queue.add('job-name', data, {
  lockDuration: jobSpecificDuration,
});
```

**Pros:** Precise control
**Cons:** Requires estimating duration for every job type, complex

**Option C: Self-Healing Workers (Ideal)**
```typescript
// Worker monitors its own progress and extends lock automatically
// BullMQ ALREADY does this with lockRenewTime!
// We just need to configure it properly
```

**Recommendation:** Start with Option A (universal 5min lock), monitor, adjust if needed.

---

### **Priority 5: Result Size Limits** 🔶 NICE TO HAVE

**Problem:** 9 MB result generated (slow Redis write, slow client transfer).

**Fix:** Add hard cap on result size.

```typescript
// similarity-operations.processor.ts:327
const HARD_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

if (payloadSize > HARD_LIMIT_BYTES) {
  throw new Error(
    `Result too large: ${(payloadSize / 1024 / 1024).toFixed(2)} MB. ` +
    `This indicates too many wallets or tokens were analyzed. ` +
    `Please reduce wallet count or contact support.`
  );
}
```

---

## Impact Analysis

### **What This Affects**

| Feature | Impact | Fix Needed |
|---------|--------|------------|
| **Similarity Lab** | ✅ Directly affected | Smart filtering + lock config |
| **Dashboard Analysis** | ⚠️ Partially affected | Same balance fetching logic |
| **PnL Analysis** | ✅ Not affected | Uses DB only, no balance fetch |
| **Holder Profiles** | ✅ Has protection | Already filters at 15k threshold |
| **Contextual Holdings** | ❓ Unknown | May trigger large balance fetch |

### **Where to Apply Fixes**

1. **Payload cleanup**: `enrichment-operations.processor.ts:80` - Remove delete call
2. **Token count passing**: `similarity-operations.processor.ts:173` - Build and pass map
3. **Balance filtering**: `wallet-balance-service.ts:110` - Early exit for whales
4. **Lock config**: `queue.config.ts:119-120` - Add lockDuration/lockRenewTime
5. **Result size**: `similarity-operations.processor.ts:327` - Add hard cap

---

## Open Questions

1. **Lock Duration:** Universal 5min or per-job config?
2. **Token Value Filtering:** How to determine token value BEFORE fetching metadata?
3. **Contextual Holdings:** Does this trigger large balance fetches? Need to investigate.
4. **Enrichment Priority:** Should enrichment run at all for whale wallets?
5. **User Experience:** How to show "⚠️ Large wallet: partial data displayed" message?

---

## Next Steps

### Immediate (Must Do Now)
1. ✅ Fix payload cache race condition (remove delete call)
2. ✅ Configure BullMQ locks (5min duration, 2.5min renew)
3. ✅ Pass token count data through detection pipeline

### Short Term (This Week)
4. ✅ Implement smart token filtering in WalletBalanceService
5. ⚠️ Add result size hard limits
6. ⚠️ Test with whale wallets to verify fixes

### Medium Term (Next Sprint)
7. 🔶 Investigate Contextual Holdings behavior
8. 🔶 Add "Large Wallet" UI indicators
9. 🔶 Optimize enrichment to skip low-value tokens

---

## Conclusion

The system didn't fail because of the 30k tokens per se - it failed because:

1. **Missing lock renewal config** → Jobs marked stalled while running
2. **Token count data not passed** → Balance fetcher fetched everything
3. **Payload deleted too early** → Retries failed immediately
4. **No smart filtering** → Processed 5k tokens when only ~500 were meaningful

The fixes are straightforward and focused on:
- **Prevention:** Don't fetch 30k tokens in the first place
- **Resilience:** Configure locks properly so long jobs don't fail
- **Recovery:** Don't delete payloads immediately, allow retries

With these fixes, whale wallets will be handled gracefully without choking the system.
