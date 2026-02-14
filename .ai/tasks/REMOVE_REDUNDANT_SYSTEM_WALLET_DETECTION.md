# Task: Remove Redundant System Wallet Detection in Holder Profiles

**Priority:** High
**Scope:** Small (1 file, <20 lines)
**Estimated Time:** 15-30 minutes
**Impact:** Reduces 20-30 unnecessary RPC calls per holder profiles analysis

## Context

During holder profiles analysis, system wallet detection runs TWICE for the same wallets:
1. **Line 1154** (parent job): `filterSystemWallets(walletAddresses)` - filters ALL 10 wallets
2. **Line 1563** (child job): `detectSystemWallet(walletAddress)` - checks AGAIN in each child job

This is redundant because if a wallet passes the filter at line 1154, it's already confirmed NOT a system wallet.

**Why this matters:**
- Each uncached wallet detection = 1-2 RPC calls to `getTokenAccountsByOwnerV2`
- 10 wallets × 2 checks = 20 unnecessary calls
- Adds latency and increases Helius API rate limit consumption

## Current Code Flow

**File:** `src/queues/processors/analysis-operations.processor.ts`

### Parent Job (Token Mode) - Line 1154
```typescript
// Check 1: Filter out system wallets from entire list
const { valid: validWallets, filtered: systemWallets, filteredDetails, largeWallets } =
  await this.systemWalletDetection.filterSystemWallets(walletAddresses);

// validWallets = wallets that are NOT system wallets
// systemWallets = wallets that ARE system wallets (excluded from analysis)
```

### Child Job (Wallet Mode) - Line 1563
```typescript
async processSingleHolderProfile(...) {
  // Check 2: REDUNDANT - already filtered in parent!
  const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);
  if (detection.knownType && SKIP_BEHAVIOR_ANALYSIS.has(detection.knownType)) {
    return this.createStubHolderProfile(...);
  }
  // ... rest of analysis
}
```

## The Fix

### Option 1: Pass Detection Results in Job Context (RECOMMENDED)
Add detection results to the job data so child jobs don't need to re-check.

**Changes:**

1. **Update job data type** (`src/queues/jobs/types/index.ts`)
```typescript
_holderContext?: {
  rank: number;
  supplyPercent: number;
  preFetchedBalance?: any;
  systemWalletDetection?: {        // ✅ NEW
    isSystemWallet: boolean;
    knownType?: KnownWalletType;
    knownLabel?: string;
  };
};
```

2. **Pass detection results when queueing jobs** (line ~1347)
```typescript
for (const wallet of walletsNeedingJobs) {
  const metadata = holderMetadataByWallet.get(wallet);
  const walletBalance = batchBalances[wallet];

  // ✅ NEW: Get detection result from parent's filter call
  const detection = filteredDetails.get(wallet); // Already filtered at line 1154!

  const childJob = await this.analysisQueueService.addHolderProfilesJob({
    mode: 'wallet',
    userId: job.data.userId,
    walletAddress: wallet,
    requestId: `${requestId}-wallet-${wallet}`,
    _holderContext: {
      rank: metadata?.rank ?? childJobIds.length + 1,
      supplyPercent: metadata?.supplyPercent ?? 0,
      preFetchedBalance: walletBalance || undefined,
      // ✅ NEW: Pass detection results
      systemWalletDetection: detection ? {
        isSystemWallet: !!detection.knownType,
        knownType: detection.knownType,
        knownLabel: detection.knownLabel,
      } : undefined,
    },
  }, {
    priority: jobPriority,
  });
}
```

3. **Use cached detection in child job** (line ~1563)
```typescript
async processSingleHolderProfile(...) {
  const holderContext = job.data._holderContext;

  // ✅ NEW: Use pre-computed detection if available
  const cachedDetection = holderContext?.systemWalletDetection;

  if (cachedDetection?.isSystemWallet && cachedDetection.knownType) {
    // Use cached result - no RPC call needed!
    return this.createStubHolderProfile(
      walletAddress,
      cachedDetection.knownType,
      cachedDetection.knownLabel,
      inferredRank,
      inferredSupplyPercent,
      'System wallet (pre-detected in parent job)',
      startTime,
      job
    );
  }

  // ❌ OLD: Only detect if not already done in parent
  // This path only runs for wallet-mode jobs NOT from holder profiles
  const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);
  if (detection.knownType && SKIP_BEHAVIOR_ANALYSIS.has(detection.knownType)) {
    return this.createStubHolderProfile(...);
  }
}
```

### Option 2: Skip Detection Entirely (SIMPLER BUT LESS SAFE)
Just remove the detection call in `processSingleHolderProfile` since parent already filtered.

**Downside:** Wallet-mode jobs called directly (not from holder profiles parent) would skip detection.

## Testing

### Before Fix
```bash
# Request holder profiles for 10 wallets
# Watch logs for:
grep "System wallet detection" logs.txt | wc -l
# Expected: 20-30 detection calls (10 in parent + 10 in children)
```

### After Fix
```bash
# Request holder profiles for 10 wallets
# Watch logs for:
grep "System wallet detection" logs.txt | wc -l
# Expected: 10 detection calls (only in parent)

grep "System wallet (pre-detected in parent job)" logs.txt | wc -l
# Expected: Count of system wallets found (using cached result)
```

### Metrics to Track
1. RPC call count for `gettokenaccountsbyownerv2` - should drop by 10-20 per job
2. System wallet detection service cache hit rate - should stay high
3. Holder profiles job completion time - should be slightly faster

## Expected Impact

**Before:**
- 10 wallets analyzed
- Parent: 10 detection calls
- Children: 10 detection calls
- **Total: 20 detection calls** (10 redundant)

**After:**
- 10 wallets analyzed
- Parent: 10 detection calls
- Children: 0 detection calls (use cached)
- **Total: 10 detection calls** (50% reduction)

**Combined with Feb 14 balance caching fix:**
- Total RPC calls: 70-100 → 30-40 (60% total reduction)
- Subsequent requests: 0-10 calls (cache hits)

## Files to Modify

1. `src/queues/jobs/types/index.ts` - Add systemWalletDetection field
2. `src/queues/processors/analysis-operations.processor.ts` - Pass + use detection results

## Related Documentation

- Investigation report: `.ai/context/RPC_CALL_INVESTIGATION_FEB14.md`
- System wallet detection: `src/api/services/system-wallet-detection.service.ts`
- Feb 14 fix: Balance batch pre-fetching + extended cache TTL

## Next Steps After This Fix

1. Monitor RPC call reduction in production
2. Add RPC call metrics to observability dashboard
3. Alert if calls exceed threshold (>40 for 10 wallets)
4. Consider similar optimizations for other analysis flows
