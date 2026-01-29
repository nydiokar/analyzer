# PNL Balances Fix - Historical Mode Bug Solution

**Status:** Designed in `pnl-balance-fixes` branch, not yet merged
**Priority:** P0 - Critical
**Branch:** `remotes/crypto_analyzer/pnl-balance-fixes`
**Key Commits:**
- `8290041` - "Fix PnL/TokenPerformance freshness and add period-key guards"
- `571f512` - "Enhance P&L calculation accuracy and address transfer classification issues"
- `b540811` - "add evidence for the broken scopes... not persisting timeRange snapshots"

---

## 🔴 The Problem

### Root Cause Analysis

**Current Broken Behavior:**
```typescript
// In analysis-operations.processor.ts (lines 402-408):
const timeRange =
  scope === 'deep'
    ? undefined
    : {
        startTs: Math.max(0, nowSeconds - Math.round((effectiveHistoryWindowDays ?? 7) * 86400)),
        endTs: nowSeconds,
      };
```

**What Happens:**
1. Dashboard analysis is triggered with scope `'flash'` or `'working'`
2. Processor **always** sets `timeRange` for non-deep scopes
3. PNL service checks: `const isHistoricalView = !!timeRange;` (line 155 of pnl-analysis-service.ts)
4. Triggers historical mode → **skips persistence** of:
   - `WalletPnlSummary` (account summary data)
   - `AnalysisResult` (token performance)
   - FIFO lots (to avoid corrupting all-time state)
5. Frontend queries `WalletPnlSummary` → finds nothing → shows "unanalyzed"

**Why This Design is Wrong:**
- `timeRange` should be used for **data filtering** (which transactions to include)
- It should NOT be used as a flag for "historical query vs live snapshot"
- Flash/working are **progressive snapshots of current state**, not historical queries
- Only user-triggered custom time ranges (via TimeRangeSelector) are true historical queries

---

## ✅ The Solution (from `pnl-balance-fixes` branch)

### Concept: Period Keys

**Core Idea:** Use a versioned key to identify each analysis result uniquely.

**Period Key Format:**
```
{walletAddress}:{startTs}:{endTs}:{version}
```

**Examples:**
- All-time analysis: `4hSX...pzD:all:all:2026-01-04.1`
- 7-day flash: `4hSX...pzD:1738108800:1738800000:2026-01-04.1`
- Custom range: `4hSX...pzD:1735689600:1738281600:2026-01-04.1`

### Implementation Details

#### 1. **Analysis Key Utilities**

**Backend:** `src/core/utils/analysis-key.ts`
```typescript
import { PNL_ANALYSIS_VERSION } from '../../config/constants';

export type PeriodRange = { startTs?: number; endTs?: number } | undefined;

const normalizeBound = (value?: number): string => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return 'all';
  }
  return Math.floor(value).toString(10);
};

export const buildPeriodKey = (
  walletAddress: string,
  timeRange?: PeriodRange,
  version: string = PNL_ANALYSIS_VERSION,
): string => {
  const start = normalizeBound(timeRange?.startTs);
  const end = normalizeBound(timeRange?.endTs);
  return `${walletAddress}:${start}:${end}:${version}`;
};
```

**Frontend:** `dashboard/src/lib/analysis-keys.ts`
```typescript
export const PNL_ANALYSIS_VERSION = '2026-01-04.1';

const normalizeBound = (value?: number | null): string => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return 'all';
  }
  return Math.floor(value).toString(10);
};

export const buildPeriodKey = (
  walletAddress: string,
  startDate?: Date | null,
  endDate?: Date | null,
  version: string = PNL_ANALYSIS_VERSION,
): string => {
  const startTs = startDate ? Math.floor(startDate.getTime() / 1000) : undefined;
  const endTs = endDate ? Math.floor(endDate.getTime() / 1000) : undefined;
  const start = normalizeBound(startTs);
  const end = normalizeBound(endTs);
  return `${walletAddress}:${start}:${end}:${version}`;
};

export const matchesPeriodKey = (expected: string | null, actual?: string | null): boolean => {
  if (!expected) {
    return true;
  }
  return expected === actual;
};
```

#### 2. **Response Metadata**

**Added to API responses:**
```typescript
export class TokenPerformanceMeta {
  periodKey: string;           // Identifies which analysis result this is
  analysisVersion: string;     // Version for cache busting
  computedAt: string;          // When response was generated
  scope: 'deep' | 'custom';    // Analysis scope
  periodStartTs?: number;      // Time filter start (if any)
  periodEndTs?: number;        // Time filter end (if any)
  balanceSnapshotAt?: string;  // When balances were fetched
  balanceSource?: 'analysis' | 'live';  // Balance data source
  balanceDiffCount?: number;   // # tokens with balance divergence
}
```

#### 3. **Frontend Guards Against Stale Data**

**In `AccountStatsPnlTab.tsx` (lines 444-577):**
```typescript
const expectedAllTimeKey = useMemo(
  () => (walletAddress ? buildPeriodKey(walletAddress) : null),
  [walletAddress],
);
const expectedPeriodKey = useMemo(
  () => (walletAddress ? buildPeriodKey(walletAddress, startDate, endDate) : null),
  [walletAddress, startDate, endDate],
);

// Guard against stale responses
const hasPeriodSelection = !!startDate && !!endDate;
const periodKeyMatches = !hasPeriodSelection
  ? true
  : matchesPeriodKey(expectedPeriodKey, pnlData?.periodMeta?.periodKey ?? null);
const allTimeKeyMatches = matchesPeriodKey(expectedAllTimeKey, pnlData?.allTimeMeta?.periodKey ?? null);
const effectivePnlData = periodKeyMatches && allTimeKeyMatches ? pnlData : null;
const isStaleResponse = !!pnlData && (!periodKeyMatches || !allTimeKeyMatches);

if ((isLoading || isStaleResponse) && !isAnalyzingGlobal) {
  return <PnlDisplaySkeleton />;
}
```

**Why This Works:**
- Frontend computes expected period key from current time range selection
- Compares against `periodKey` in API response
- If mismatch → response is stale (from wrong time range) → show skeleton
- Prevents flashing incorrect data while correct analysis loads

#### 4. **Live Balance Overlay**

**In `token-performance.service.ts` (lines 217-273):**
```typescript
// Fetch live balances from BalanceCacheService
let balanceByMint: Map<string, { balance: string; uiBalance: number }> | null = null;
let balanceFetchedAt: Date | undefined;

try {
  const balanceSnapshot = await this.balanceCacheService.getBalances(walletAddress);
  if (balanceSnapshot) {
    balanceFetchedAt = balanceSnapshot.fetchedAt;
    balanceByMint = new Map(
      balanceSnapshot.tokenBalances.map(tb => [tb.mint, { balance: tb.balance, uiBalance: tb.uiBalance || 0 }])
    );
  }
} catch (error) {
  this.logger.warn(`Failed to fetch live balances for ${walletAddress}. Using stored balances.`);
}

responseMeta.balanceSnapshotAt = balanceFetchedAt ? balanceFetchedAt.toISOString() : undefined;
responseMeta.balanceSource = balanceByMint ? 'live' : 'analysis';
responseMeta.balanceDiffCount = 0;

// For each token result:
const liveBalance = balanceByMint?.get(ar.tokenAddress);
const hasLiveBalance = !!liveBalance;
const currentUiBalance = hasLiveBalance
  ? (liveBalance?.uiBalance ?? 0)
  : (derivedBalanceFromNetAmount ?? (dbCurrentUiBalance || 0));

// Track divergence
if (hasLiveBalance && Math.abs((liveBalance?.uiBalance ?? 0) - storedUiBalance) > 1e-9) {
  responseMeta.balanceDiffCount = (responseMeta.balanceDiffCount || 0) + 1;
}
```

**Why This Matters:**
- Stored balances in `AnalysisResult` can become stale (user bought/sold after analysis)
- Overlay live balances from cache → always show current holdings
- Track divergence count → trigger re-analysis if too many tokens changed

---

## 🎯 What Was Actually Fixed in `pnl-balance-fixes`

### ✅ Implemented:
1. **Period key system** - Uniquely identifies each analysis result
2. **Frontend guards** - Prevents showing stale data from wrong time range
3. **Live balance overlay** - Shows current holdings even if analysis is old
4. **Metadata tracking** - Response includes `meta` with period info
5. **Auto-trigger on divergence** - If balances diverge significantly, queue re-analysis

### ❌ NOT Implemented (Planned):
1. **Snapshot tables** - Separate storage for time-range results
2. **Distinction between snapshot vs historical** - Still treats all time ranges as historical
3. **FIFO lot preservation** - Still skips saving FIFO lots for time-ranged analysis

---

## 🚧 What Still Needs to be Done

### The Root Issue Remains

**Current State (even in `pnl-balance-fixes`):**
```typescript
// In pnl-analysis-service.ts:
const isHistoricalView = !!timeRange;  // ← This is still wrong!

if (!isViewOnlyMode) {
  if (isHistoricalView) {
    logger.warn('Historical/time-range analysis detected... skipping persistence');
    // ❌ Still skips WalletPnlSummary, AnalysisResult, FIFO lots
  } else {
    // ✅ Saves everything
  }
}
```

**What `pnl-balance-fixes` Added:**
- Workarounds (period keys, live balance overlay) to make the UI show correct data
- But doesn't fix the underlying persistence bug

### The Complete Fix (Not Yet Implemented)

**Proposed Snapshot Architecture (from commit `b540811`):**

```sql
-- New tables needed:
CREATE TABLE "AnalysisResultSnapshot" (
  "id" SERIAL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "scope" TEXT NOT NULL,  -- 'flash' | 'working' | 'deep' | 'custom'
  "periodStartTs" INTEGER,
  "periodEndTs" INTEGER,
  "tokenAddress" TEXT NOT NULL,
  -- ... all fields from AnalysisResult ...
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("walletAddress", "scope", "periodStartTs", "periodEndTs", "tokenAddress")
);

CREATE TABLE "WalletPnlSummarySnapshot" (
  "id" SERIAL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "periodStartTs" INTEGER,
  "periodEndTs" INTEGER,
  -- ... all fields from WalletPnlSummary ...
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("walletAddress", "scope", "periodStartTs", "periodEndTs")
);
```

**Logic Changes Needed:**

```typescript
// In pnl-analysis-service.ts:
const isCustomTimeRange = !!(timeRange?.startTs) || !!(timeRange?.endTs);
const isDashboardScope = ['flash', 'working', 'deep'].includes(scope);

if (!isViewOnlyMode) {
  if (isDashboardScope && !isCustomTimeRange) {
    // Dashboard scope without custom time filter → canonical data
    // ✅ Save to WalletPnlSummary, AnalysisResult, FIFO lots
    await this.databaseService.upsertWalletPnlSummary(...);
    await this.databaseService.batchUpsertAnalysisResult(...);
    await this.databaseService.saveFifoLots(...);
  } else if (isDashboardScope && isCustomTimeRange) {
    // Dashboard scope WITH time filter → snapshot
    // ✅ Save to WalletPnlSummarySnapshot, AnalysisResultSnapshot
    // ❌ Don't save FIFO lots (would corrupt all-time state)
    await this.databaseService.upsertWalletPnlSummarySnapshot(...);
    await this.databaseService.batchUpsertAnalysisResultSnapshot(...);
  } else {
    // User-triggered custom range (via TimeRangeSelector) → historical query
    // ❌ Don't save anything (view-only)
  }
}
```

**API Read Path Changes:**

```typescript
// In token-performance.service.ts:
async getPaginatedTokenPerformance(walletAddress, queryDto) {
  const { startDate, endDate, scope } = queryDto;

  if (startDate || endDate) {
    // Time filter active → check snapshots first
    const snapshot = await this.databaseService.getAnalysisResultSnapshot({
      walletAddress,
      scope: scope || 'deep',
      periodStartTs: startDate ? Math.floor(startDate.getTime() / 1000) : undefined,
      periodEndTs: endDate ? Math.floor(endDate.getTime() / 1000) : undefined,
    });

    if (snapshot) {
      return this.formatSnapshotResponse(snapshot);
    }
    // Fallback to canonical if no snapshot
  }

  // No time filter → use canonical tables
  const results = await this.databaseService.getAnalysisResults({ walletAddress });
  return this.formatResponse(results);
}
```

---

## 📊 Migration Path

### Phase 1: Add Period Keys (Already Done in `pnl-balance-fixes`)
- ✅ Add `buildPeriodKey()` utility
- ✅ Add `meta` to API responses
- ✅ Frontend guards against stale data
- ✅ Live balance overlay

### Phase 2: Create Snapshot Tables (NOT DONE)
- Create migration for new tables
- Add database methods for snapshot CRUD

### Phase 3: Update Analysis Logic (NOT DONE)
- Change `isHistoricalView` detection to distinguish:
  - Dashboard scopes (flash/working/deep) → save canonical or snapshot
  - Custom time ranges (user TimeRangeSelector) → view-only
- Route saves to correct tables based on scope + time range

### Phase 4: Update Read Paths (NOT DONE)
- Check snapshots first when time filter present
- Fallback to canonical tables
- Merge snapshot + live balance data

### Phase 5: Frontend Updates (NOT DONE)
- Use period keys everywhere
- Request snapshot data when time filter active
- Handle both canonical and snapshot responses

---

## 🎯 Why This Architecture?

**Problem with Current Approach:**
- All-time state (FIFO lots, canonical PnL) gets overwritten by time-ranged analysis
- Flash/working scopes can't persist because they'd corrupt all-time data

**Why Snapshots Solve It:**
- Canonical tables store "all-time" or "most recent deep" analysis
- Snapshot tables store time-windowed views (7d flash, 30d working, custom ranges)
- FIFO lots only update with all-time/deep analysis
- Flash/working can persist without corrupting all-time state

**Benefits:**
- Fast lookup for common ranges (flash, working)
- No re-computation every time user views wallet
- Progressive enhancement (flash → working → deep)
- Each scope has its own snapshot, no conflicts

---

## 🔧 Constants Added

**In `src/config/constants.ts`:**
```typescript
export const PNL_ANALYSIS_VERSION = '2026-01-04.1';

// Freshness windows (already existed):
export const DASHBOARD_ANALYSIS_SCOPE_DEFAULTS = {
  flash: {
    freshnessMinutes: 30,    // Don't re-run if < 30min old
    targetSignatureCount: 250,
    historyWindowDays: 7,
  },
  working: {
    freshnessMinutes: 180,   // 3 hours
    targetSignatureCount: 2000,
    historyWindowDays: 30,
  },
  deep: {
    freshnessMinutes: 720,   // 12 hours
    targetSignatureCount: 3000,
    historyWindowDays: undefined,  // All time
  },
};
```

---

## 📝 Key Takeaways

### What `pnl-balance-fixes` Branch Gives Us:
1. ✅ **Period key system** - Identifies analysis results uniquely
2. ✅ **Frontend guards** - Prevents stale data display
3. ✅ **Live balance overlay** - Always shows current holdings
4. ✅ **Better UX** - No flashing incorrect data

### What It Doesn't Fix:
1. ❌ **Persistence bug** - Flash/working still don't save WalletPnlSummary
2. ❌ **Snapshot architecture** - Canonical vs snapshot tables not implemented
3. ❌ **FIFO corruption** - Risk of overwriting all-time FIFO lots still exists

### Bottom Line:
**`pnl-balance-fixes` is a sophisticated workaround, not a complete fix.**

The branch makes the frontend resilient to missing data by:
- Overlaying live balances
- Detecting stale responses
- Auto-triggering re-analysis

But it doesn't address the root cause: **flash/working scopes still skip persistence**.

---

## 🚀 Cherry-Pick Strategy

### What to Cherry-Pick from `pnl-balance-fixes`:
1. **Period key utilities** (`analysis-key.ts` in backend and frontend)
2. **API metadata** (add `meta` to responses)
3. **Live balance overlay** (in token-performance.service.ts)
4. **Frontend guards** (period key matching in UI components)
5. **PNL_ANALYSIS_VERSION constant**

### What NOT to Cherry-Pick (Yet):
1. **Snapshot table creation** (not implemented)
2. **Snapshot read/write logic** (not implemented)
3. **Distinction in `isHistoricalView` logic** (still broken)

### Recommended Approach:
1. Cherry-pick workaround improvements (period keys, live overlay)
2. **Fix the root cause separately:** Change `isHistoricalView = !!timeRange` to proper logic
3. Plan snapshot architecture as Phase 2 (optional enhancement)

---

## 🔗 Related Files

**Backend:**
- `src/core/services/pnl-analysis-service.ts` - Where historical mode is detected
- `src/queues/processors/analysis-operations.processor.ts` - Where timeRange is set
- `src/api/services/token-performance.service.ts` - Token performance API
- `src/api/services/pnl-overview.service.ts` - PNL overview API
- `src/core/utils/analysis-key.ts` - Period key builder (backend)
- `src/config/constants.ts` - PNL_ANALYSIS_VERSION

**Frontend:**
- `dashboard/src/lib/analysis-keys.ts` - Period key builder (frontend)
- `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx` - PNL display with guards
- `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` - Token table with guards

**Documentation:**
- Evidence commit: `b540811` - Problem analysis
- Fix commit: `8290041` - Period key implementation
- Enhancement commit: `571f512` - PNL calculation improvements

**Branch:** `remotes/crypto_analyzer/pnl-balance-fixes`

---

**Last Updated:** 2026-01-29
**Next Steps:** Cherry-pick period keys, then fix `isHistoricalView` logic separately
