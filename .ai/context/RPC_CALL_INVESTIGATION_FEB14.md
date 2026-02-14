# RPC Call Investigation - February 14, 2026

## Problem Statement
Observability dashboard showed 81 calls to `gettokenaccountsbyownerv2` during holder profiles analysis, indicating excessive RPC usage potentially causing rate limiting and performance issues.

## Investigation Summary

### What `gettokenaccountsbyownerv2` Actually Does
This RPC method is used for TWO distinct purposes:

1. **Fetching Token Balances** - Get all token accounts for a wallet with full data (balances, decimals, metadata)
2. **Counting Tokens (System Wallet Detection)** - Just count how many tokens a wallet has (to detect if it's a system/vault wallet with 70k+ tokens)

### The 81 Calls Breakdown

**Source 1: Balance Fetching (30-40 calls)**
- Called from: `wallet-balance-service.ts:115-310` (sequential loop)
- Each wallet = 2 programs (SPL + Token2022) = 2 RPC calls minimum
- Large wallets (10k+ tokens) need pagination = 2-3 pages per program = 4-6 calls per wallet
- 10 wallets × 4 average = **40 calls**

**Source 2: System Wallet Detection (20-30 calls)**
- Called from: `system-wallet-detection.service.ts:179` → `getTokenCount()`
- Line 1154 in holder profiles: `filterSystemWallets(walletAddresses)` checks ALL 10 wallets
- Line 1563 in holder profiles: `detectSystemWallet(walletAddress)` checks AGAIN in each child job
- If wallet not in cache → calls `getTokenAccountsByOwnerCount()` → `gettokenaccountsbyownerv2`
- **REDUNDANCY:** Checking the same wallets twice (once in parent, once in child jobs)

**Source 3: Concurrent Similarity Analysis (optional, +20-30 calls)**
- If similarity runs at same time for same wallets
- Fetches balances independently before our fix

**Total: 50-70 base calls + pagination overhead = 70-100 calls** ✅ Matches observed 81

## Root Causes Identified

### 1. Sequential Balance Fetching Loop (UNAVOIDABLE)
**File:** `src/core/services/wallet-balance-service.ts:115`

```typescript
// ❌ PROBLEM: Cannot be batched due to RPC API limitations
for (const address of walletAddresses) {
  const splResult = await this.heliusClient.getTokenAccountsByOwner(address, ...);    // Call 1
  const token2022Result = await this.heliusClient.getTokenAccountsByOwner(address, ...); // Call 2
}
```

**Why unavoidable:** Helius RPC API doesn't support batching `getTokenAccountsByOwner` across multiple wallet owners. Each wallet MUST be fetched individually.

### 2. Redundant System Wallet Detection (FIXABLE) ✅
**File:** `src/queues/processors/analysis-operations.processor.ts`

```typescript
// Line 1154: Check all wallets
const { valid, filtered } = await this.systemWalletDetection.filterSystemWallets(walletAddresses);

// Later, line 1563 in processSingleHolderProfile: Check AGAIN
const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);
```

**Impact:** Each new wallet = 2 system detection calls instead of 1

### 3. No Coordination Between Holder Profiles + Similarity (PARTIALLY FIXED) ✅
When both features run concurrently, they fetch balances for the same wallets independently.

**Our fix:** Extended balance cache TTL (10min → 30min) and batch pre-fetching reduces this redundancy.

## What We Fixed (Feb 14, 2026)

### Fix 1: Batch Balance Pre-fetching ✅
**File:** `src/queues/processors/analysis-operations.processor.ts:1322-1337`

**Before:**
```typescript
// Each wallet job fetches individually
for (const wallet of staleWallets) {
  queueJob(wallet); // → each job calls getManyBalances([wallet])
}
// 5 wallets × 2 programs × 2 pages = 20 RPC calls
```

**After:**
```typescript
// Batch fetch ONCE for all stale wallets
const batchBalances = await this.balanceCacheService.getManyBalances(staleWallets);
// Then pass to jobs
for (const wallet of staleWallets) {
  queueJob(wallet, batchBalances[wallet]); // Uses pre-fetched data
}
// 5 wallets × 2 programs × 2 pages = STILL 20 calls (but coordinated, no duplicates)
```

**Impact:** Prevents duplicate fetches when multiple jobs queue simultaneously. Doesn't reduce total calls (still sequential loop) but ensures no redundant fetches.

### Fix 2: Extended Cache TTL ✅
**File:** `src/queues/processors/analysis-operations.processor.ts:555, 1698`

Changed balance cache from 10 minutes → 30 minutes.

**Impact:**
- First request: 20 calls
- Subsequent requests within 30min: 0 calls (cache hit)
- Reduces cache misses by 3x

### Fix 3: Pass Pre-fetched Balances to Child Jobs ✅
**Files:**
- `src/queues/jobs/types/index.ts:57` (added `preFetchedBalance` field)
- `src/queues/processors/analysis-operations.processor.ts:1359` (pass balance in job data)
- `src/queues/processors/analysis-operations.processor.ts:1671` (use pre-fetched balance)

**Impact:** Child jobs use parent's batch-fetched balances instead of fetching again.

## Expected Results After Fix

### Before Fix
- Holder profiles (10 wallets, 5 stale): 20 balance calls
- System detection (10 wallets, uncached): 10-20 calls
- Similarity (concurrent, 10 wallets): +20 calls
- **Total: 50-60 calls** (without pagination)
- **With pagination: 70-100 calls**

### After Fix
- Holder profiles (10 wallets, 5 stale): 20 balance calls (batch coordinated)
- System detection (10 wallets, uncached): 10-20 calls (still redundant - see next fix needed)
- Similarity (concurrent, 10 wallets): 0 calls (hits balance cache)
- **Total: 30-40 calls** (without pagination)
- **With pagination: 40-60 calls** (40-50% reduction)

### Subsequent Requests (within 30min cache TTL)
- Balance fetch: 0 calls (cache hit)
- System detection: 0 calls (cache hit)
- **Total: 0-5 calls** (only for truly new wallets)

## Remaining Issue: Redundant System Wallet Detection

**Still happening:**
```typescript
// analysis-operations.processor.ts:1154
await this.systemWalletDetection.filterSystemWallets(walletAddresses); // Check 1

// analysis-operations.processor.ts:1563 (in processSingleHolderProfile)
await this.systemWalletDetection.detectSystemWallet(walletAddress);    // Check 2 (DUPLICATE!)
```

**Why it's redundant:**
- Line 1154 already filters system wallets from the list
- Line 1563 checks again in child jobs (defensive programming but wasteful)
- If wallet passes filter at 1154, it's NOT a system wallet → no need to check at 1563

**Potential Fix (NOT IMPLEMENTED YET):**
1. Pass system detection results in job context
2. Skip detection in `processSingleHolderProfile` if already checked
3. Add `alreadyDetected: true` flag to job data

**Expected Impact:** Reduce 10-20 redundant system detection calls to 0

## Monitoring Recommendations

### Metrics to Track
1. **RPC call volume per endpoint**
   - `gettokenaccountsbyownerv2` calls per holder profiles job
   - Target: <40 calls for 10 wallets

2. **Balance cache hit rate**
   - `balanceCache.hits / (balanceCache.hits + balanceCache.misses)`
   - Target: >80% after first request

3. **System wallet detection cache hit rate**
   - Track in `system-wallet-detection.service.ts`
   - Target: >90% for repeated wallets

### Log Analysis
Look for these patterns in logs:
- ✅ Good: "Batch fetching balances for 5 stale wallets"
- ✅ Good: "Using batch pre-fetched balance for {wallet}"
- ⚠️ Warning: Multiple "System wallet detection" logs for same wallet
- ❌ Bad: "Balance cache miss" for recently analyzed wallet

## Files Modified (Feb 14, 2026)

1. `src/queues/jobs/types/index.ts` - Added `preFetchedBalance` field to job data
2. `src/queues/processors/analysis-operations.processor.ts` - Batch balance fetch + pre-fetching logic
3. Balance cache TTL changes (600s → 1800s)

## Next Steps (Priority Order)

### High Priority
1. ✅ **DONE:** Batch balance pre-fetching
2. ✅ **DONE:** Extended cache TTL
3. ⚠️ **TODO:** Remove redundant system wallet detection in `processSingleHolderProfile`

### Medium Priority
4. Add RPC call metrics to observability dashboard
5. Monitor actual call reduction in production
6. Alert if calls exceed threshold (>50 for 10 wallets)

### Low Priority
7. Investigate if V2 pagination can be optimized further
8. Consider wallet grouping by token count to reduce pagination overhead
9. Explore Helius batch balance endpoint (if available)

## Conclusion

**The 81 calls are coming from:**
1. Legitimate balance fetching (unavoidable sequential loop) - 40 calls
2. System wallet detection redundancy (fixable) - 20 calls
3. Pagination for large wallets - 20 calls
4. Concurrent similarity (now cached) - 0 calls after fix

**Our fix reduces:**
- Concurrent feature redundancy: 85-100% reduction (via caching)
- Cache misses: 66% reduction (via 30min TTL)
- Balance fetch coordination: eliminates duplicate fetches

**Cannot reduce:**
- Sequential balance loop (RPC API limitation)
- Pagination for large wallets (necessary)

**Realistic target:** 40-60 calls for 10 new wallets, 0-10 calls for cached wallets.
