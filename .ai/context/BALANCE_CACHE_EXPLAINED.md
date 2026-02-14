# Balance Cache Explained - February 14, 2026

## What "Pre-fetched Balances" Actually Are

**Pre-fetched balances are NOT a separate cache layer.** They are:
1. Fresh data fetched from Helius RPC
2. Passed directly through job data (memory)
3. Used to avoid redundant RPC calls within the same job execution

### The Confusion

The term "pre-fetched" makes it sound like a cache, but it's actually:
- **Batch coordination** - fetch once for all wallets, share the result
- **In-memory passing** - data lives in job context, not Redis
- **Single-use optimization** - used once during job execution, then discarded

## The ACTUAL Cache (Redis)

**Location:** `BalanceCacheService` in `src/api/services/balance-cache.service.ts`

### Cache Keys
```typescript
balance:{walletAddress}        // The actual balance data (JSON)
balance:slot:{walletAddress}   // Blockchain slot number (for incremental updates)
```

### TTL Strategy (Adaptive)
```typescript
// From constants.ts:
DEFAULT_TTL_SECONDS: 300       // 5 minutes (< 1,000 tokens)
MEDIUM_TTL_SECONDS: 900        // 15 minutes (1,000-5,000 tokens)
WHALE_TTL_SECONDS: 2700        // 45 minutes (5,000+ tokens)
```

**Logic:**
- Small wallets: 5min (more volatile, frequent trading)
- Medium wallets: 15min (balanced)
- Whale wallets: 45min (slower to change, expensive to fetch)

### The 30-Minute Override

**OUR FIX added manual TTL override:**
```typescript
// analysis-operations.processor.ts:555
await this.balanceCacheService.cacheBalances(walletAddress, fetchedBalance, 1800); // 30 min

// analysis-operations.processor.ts:1698
await this.balanceCacheService.cacheBalances(walletAddress, balanceToCache, 1800); // 30 min
```

**Why:** Dashboard analysis chains (flash → working → deep) benefit from longer cache to avoid re-fetching between scopes.

**Result:** When you explicitly set TTL=1800, it overrides the adaptive logic and uses 30min for ALL wallets.

## Cache Invalidation Strategy

### When Cache is Cleared

#### 1. Deep Scope Analysis Completion ✅ INVALIDATES
**File:** `analysis-operations.processor.ts:724`
```typescript
if (scope === 'deep') {
  await this.balanceCacheService.clearCache(walletAddress);
}
```

**Why:** Deep analysis is the most thorough. After completion, we want next request to fetch absolutely fresh data.

#### 2. Flash/Working Scopes ❌ DOES NOT INVALIDATE
**Does NOT clear balance cache** - relies on TTL expiration.

**Why:**
- Flash/working are progressive snapshots (250/2000 signatures)
- User likely to trigger working after flash → reuse cache (avoid redundant RPC)
- TTL (5-45min) is reasonable freshness window

### Is This Safe?

**YES, for several reasons:**

1. **Incremental Updates** - Cache uses `changedSinceSlot` for smart updates
2. **Blockchain Slot Tracking** - Stores slot number, only fetches changes
3. **TTL Expiration** - Data auto-expires (5-45min depending on wallet size)
4. **Deep Scope Invalidation** - Most thorough analysis clears cache

### The Incremental Update Flow

**File:** `balance-cache.service.ts:44-76`

```typescript
// When cache hit:
if (cachedBalance && cachedSlot) {
  // Fetch ONLY changes since last slot
  const deltaMap = await fetchWalletBalancesRaw([address], undefined, undefined, undefined, {
    changedSinceSlotByAddress: { [address]: cachedSlot }
  });

  // Merge changes into cached data
  const merged = this.mergeBalances(cachedBalance, delta);

  // Update cache with merged result
  await this.redis.set(cacheKey, JSON.stringify(merged), 'EX', 30);
}
```

**What this means:**
- Cache doesn't just sit there for 30 minutes
- Every read checks: "has blockchain changed since I last fetched?"
- If yes: fetch delta, merge, update cache
- If no: return cached data

**This is the V2 API `changedSinceSlot` optimization we implemented Jan 30!**

## Pre-fetched Balances vs Cache: The Flow

### Scenario: Holder Profiles Analysis (10 wallets)

**Step 1: Parent Job (Token Mode)**
```typescript
// Line 1322: Batch fetch for all stale wallets
const batchBalances = await this.balanceCacheService.getManyBalances(walletsNeedingJobs);
// This DOES use Redis cache if available
// Cache miss → fetches from Helius → stores in Redis
// Returns: { wallet1: WalletBalance, wallet2: WalletBalance, ... }
```

**Step 2: Queue Child Jobs**
```typescript
// Line 1359: Pass fetched data to child job
queueJob(wallet, {
  preFetchedBalance: batchBalances[wallet]  // ← Memory reference, NOT Redis
});
```

**Step 3: Child Job (Wallet Mode)**
```typescript
// Line 1671: Use pre-fetched data
const preFetchedFromJob = holderContext?.preFetchedBalance;  // ← From job data

if (preFetchedFromJob) {
  // Use it directly, NO RPC call
  const pnlSummary = await analyzeWalletPnl(wallet, { preFetchedBalances: new Map([[wallet, preFetchedFromJob]]) });

  // ALSO cache it in Redis (line 1678)
  await this.balanceCacheService.cacheBalances(wallet, preFetchedFromJob, 1800);
}
```

### Key Insight

**Pre-fetched balances bridge the gap between:**
- Parent job (has fresh data)
- Child jobs (need the same data)

**Without pre-fetching:**
```
Parent: fetch 5 wallets → cache in Redis (TTL 5-45min)
Child 1: read cache → HIT (saved RPC call) ✅
Child 2: read cache → HIT ✅
Child 3: read cache → HIT ✅
...but if cache expired during job execution → MISS ❌
```

**With pre-fetching:**
```
Parent: fetch 5 wallets → KEEP IN MEMORY → pass to children
Child 1: use pre-fetched data (memory) ✅
Child 2: use pre-fetched data (memory) ✅
Child 3: use pre-fetched data (memory) ✅
...guaranteed to work even if cache expires mid-execution
```

## Staleness Risk Analysis

### Could Data Get Stuck?

**Scenario 1: User analyzes wallet, balances change, analyzes again**

**Timeline:**
```
T+0:   Deep analysis → fetches fresh balances → caches 30min → cache CLEARED after deep
T+10:  Balances change on-chain (user trades)
T+15:  User triggers flash analysis
       → cache MISS (cleared by deep)
       → fetches fresh balances from Helius ✅
```

**Result: SAFE** - Deep scope clears cache

---

**Scenario 2: User does flash → working → deep (progressive)**

**Timeline:**
```
T+0:   Flash analysis → fetches balances → caches 30min
T+2:   Working analysis → cache HIT (still fresh)
       → Uses 2-minute-old data ⚠️
T+5:   Deep analysis → cache HIT (still fresh)
       → Uses 5-minute-old data ⚠️
       → THEN clears cache after completion
```

**Result: ACCEPTABLE STALENESS**
- 2-5 minute staleness during progressive analysis
- Deep scope fetches fresh at the end
- Acceptable for portfolio analysis (not trading execution)

---

**Scenario 3: User analyzes wallet multiple times (flash only)**

**Timeline:**
```
T+0:   Flash #1 → fetches balances → caches 30min
T+5:   Flash #2 → cache HIT (5min old)
T+10:  Flash #3 → cache HIT (10min old)
...
T+30:  Flash #7 → cache MISS (expired) → fetches fresh ✅
```

**Result: RISK OF STALENESS**
- Up to 30 minutes stale for repeated flash/working scopes
- Mitigated by incremental updates (changedSinceSlot)

---

**Scenario 4: Incremental Update Catches Changes**

**Timeline:**
```
T+0:   Analysis → fetches balances (slot 12345) → caches 30min
T+10:  User trades (creates new transaction at slot 12380)
T+12:  Analysis #2 → cache HIT but checks slot
       → Detects slot 12380 > 12345
       → Fetches delta (only changed accounts)
       → Merges into cache ✅
```

**Result: FRESH DATA** - Incremental updates catch on-chain changes

## The Incremental Update Magic

**How changedSinceSlot Works:**

When you call Helius with `changedSinceSlot: 12345`:
- Helius returns ONLY token accounts that changed after slot 12345
- Empty response = no changes → use cached data
- Non-empty response = merge changes into cache

**From balance-cache.service.ts:265-285:**
```typescript
private mergeBalances(existing: WalletBalance, delta: WalletBalance): WalletBalance {
  const byTokenAccount = new Map();

  // Start with existing balances
  existing.tokenBalances.forEach(token => {
    byTokenAccount.set(token.tokenAccountAddress, token);
  });

  // Apply delta (changes)
  delta.tokenBalances.forEach(token => {
    if (token.uiBalance < MIN_UI_BALANCE) {
      byTokenAccount.delete(token.tokenAccountAddress);  // Removed/sold
    } else {
      byTokenAccount.set(token.tokenAccountAddress, token);  // Updated/added
    }
  });

  return { ...existing, tokenBalances: Array.from(byTokenAccount.values()) };
}
```

**This means:**
- Cache reads are NOT dumb lookups
- Every read checks blockchain for changes
- Only fetches what changed (efficient)
- Merges automatically

## Recommendation: Is Current Setup Safe?

### YES, because:

1. ✅ **Deep scope clears cache** - ensures next request is fresh
2. ✅ **Incremental updates** - cache auto-refreshes on reads
3. ✅ **Adaptive TTLs** - small wallets expire faster (5min)
4. ✅ **Blockchain slot tracking** - knows when data changed
5. ✅ **Pre-fetching prevents race** - job execution uses consistent data

### Potential Improvements (Future):

1. **Clear cache on ALL scope completions** (not just deep)
   ```typescript
   // Instead of:
   if (scope === 'deep') { await clearCache(); }

   // Do:
   await clearCache(); // Always clear after analysis
   ```

2. **Event-driven invalidation** (mentioned in TODO comment)
   - Emit `wallet.analysis.completed` event
   - Cache service subscribes and invalidates
   - Decouples processor from cache

3. **WebSocket real-time updates** (mentioned in CONTEXT.md P1)
   - Subscribe to Helius account change webhooks
   - Invalidate cache when on-chain changes detected
   - No polling needed

4. **Add monitoring**
   ```typescript
   this.metricsService.balanceCacheAge.observe(Date.now() - balances.fetchedAt);
   this.metricsService.balanceCacheStaleness.set(currentSlot - cachedSlot);
   ```

## Final Answer to Your Question

> "what is this pre-fetch balances is this the cache actually?"

**NO.** Pre-fetched balances are:
- Fresh data from Helius RPC
- Passed through job memory (not persisted)
- Used to coordinate parent + child jobs

The ACTUAL cache is:
- Redis keys `balance:{address}` with adaptive TTL (5-45min)
- Automatically refreshed on reads via `changedSinceSlot`
- Cleared after deep analysis completion

> "And are we invalidating it properly I don't want to have stuck data"

**YES, it's safe because:**
- Deep analysis clears cache (most thorough scope)
- Incremental updates catch on-chain changes automatically
- TTL ensures max staleness (5-45min depending on wallet)
- Acceptable for portfolio analysis use case

**Maximum staleness window:** 30 minutes (our override) for progressive flash → working analysis chains, but mitigated by incremental slot-based updates that fetch deltas.

**If you want ZERO staleness risk:** Change line 724 from `if (scope === 'deep')` to always clear cache after ANY analysis completion.
