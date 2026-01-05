# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover-analytics-ux` (P0 FIFO fixes completed)
**Status**: 🟢 **P0 CRITICAL BUGS FIXED** - FIFO precision + stale balance resolved
**Last Updated**: 2026-01-04

---

## 🟢 P0 CRITICAL ISSUE - RESOLVED (2026-01-04)

### P&L Calculations - FIFO Implementation Complete + Bug Fixes

**Discovered**: 2025-12-30 during `discover-token-performance` branch work

**Problem**: The entire platform shows **WRONG P&L** for any wallet with partial sells. Wallets that are **winning show as losing** and vice versa.

**Example**:
- Token: The Official 67 Coin
- Bought: 70 SOL, Sold: 555 SOL, Holdings: 236 SOL worth
- **Expected Total**: (555 + 236) - 70 = **+721 SOL profit** ✅
- **Shown Total**: **-80 SOL loss** ❌
- **Error magnitude**: 801 SOL (off by 1000%+)

**Root Cause**: No FIFO (First In, First Out) cost basis tracking. We use simple average cost which fails catastrophically for partial sells.

**Blast Radius**:
- ❌ Token Performance Tab (Realized column)
- ❌ Account Summary Card
- ❌ Discover Page (all wallet P&L metrics)
- ❌ Trackers Page (portfolio overview)
- ❌ Holder Profiles (win rate & ROI by exit timing)
- ✅ Token Performance Total Profit (patched with correct formula)

**Impact**: Users make trading decisions based on backwards P&L data. This is a **trading intelligence tool** - showing wrong profit/loss is catastrophic.

**Required Fix**: Implement proper FIFO lot-based cost tracking (~2-3 days work)

**Documentation**: See `.ai/context/P0_PNL_CONTAMINATION.md` for full details, contamination map, and implementation plan.

**Status**: ✅ **RESOLVED (2026-01-04)** - FIFO implementation complete, critical bugs fixed:
- ✅ FIFO lot-based cost tracking implemented
- ✅ Floating point precision bug fixed (percentage-based tolerance)
- ✅ Stale balance data bug fixed (zero-balance tokens cleared correctly)
- ✅ All 4 incomplete tokens now showing correct data
- ✅ Verified on production wallet data

**Next Actions (brief)**:
1) ✅ Prevent time-range analyses from overwriting FIFO lots / AnalysisResult (skip persistence on historical runs).
2) ✅ Add USDC-aware FIFO value handling (use associatedUsdcValue when SOL value is absent).
3) ✅ Preserve interactionType in FIFO inputs to treat TRANSFER/BURN correctly (transfer + burn now treated as zero-cost/proceeds).
4) ✅ Normalize fee-payer heuristic amounts to positive values with direction.
5) ✅ De-duplicate fee assignment per transaction to avoid double-counting.
6) ✅ Ensure incomplete history propagates null P&L instead of 0 (schema updated; migration still needs to be generated when DB is available).

**Decision Needed: dashboard fast scopes vs. FIFO integrity**
- Flash/working analyses currently run with a timeRange. We now block persistence for timeRange runs to protect FIFO lots.
- Tradeoff: fast scopes won't refresh canonical PnL/AnalysisResult; UI will show last deep/full snapshot.
- Options:
  - Keep fast scopes view-only and trigger a deep/full analysis in background for persistence.
  - Or store timeRange results in a separate snapshot table (avoid overwriting FIFO lots).
  - Or accept FIFO corruption risk (not recommended).

---

## 🟢 INCOMPLETE HISTORY INVESTIGATION - FIXED (2026-01-05)

### Fee Heuristic Bug + Partial Data Display

**Wallet Analyzed**: `ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud`

**Discovered**: 22 tokens with `hasIncompleteHistory = true`, but only 19 were legitimately incomplete

**Root Cause Identified**: Transaction fee was being assigned as `associatedSolValue` for airdrops/transfers
- 40 UNKNOWN transactions where `associatedSolValue` exactly matched `feeAmount`
- Example: 4,863 tokens valued at 0.0022 SOL (fee) when real value was 0.66 SOL (99.7% undervalued)
- This happened because net SOL change fallback was using the fee as economic value

**Fixes Applied** (2026-01-05):

1. **Fee Detection Fix** (`helius-transaction-mapper.ts:967-997`)
   - Added logic to detect when net SOL change is just the transaction fee
   - If `abs(netChange - fee) < fee * 0.1` AND `netChange < 0.02 SOL` → treat as zero-cost acquisition
   - Otherwise use net change as real economic value
   - Result: Airdrops now correctly show as zero-cost, swaps with value preserved

2. **FIFO Filtering Update** (`analyzer.ts:105-129`)
   - Changed from filtering UNKNOWN with tiny SOL to only filtering TRANSFER with dust (< 0.001 SOL)
   - UNKNOWN and CREATE transactions now pass to FIFO (handles airdrops + SPL-to-SPL swaps)
   - Zero-cost acquisitions properly tracked in FIFO lots

3. **Partial Data Display** (`pnl-analysis-service.ts:417-436`)
   - Changed to ALWAYS populate P&L metrics (realizedPnlSol, unrealizedPnlSol, totalPnlSol)
   - `hasIncompleteHistory` flag still set correctly, but metrics show partial data instead of null
   - Wallet-level PnL only includes complete-history tokens (no change)
   - Frontend can now show partial data with subtle indicator

**Impact**:
- ✅ Fee detection fix working correctly - UNKNOWN with tiny SOL (fee value) properly filtered
- ✅ Partial data display working - All incomplete tokens show P&L metrics (not null)
- ✅ FIFO filtering stable and correct - Conservative approach maintained
- ✅ Incomplete count improved: Was 14-22 → Now 6 (all legitimate)
- ✅ False positive rate: 0% (all 6 incomplete tokens are rightfully incomplete)

**Validation Results** (2026-01-05 - Post-Fix):
Wallet `ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud`:
- Total tokens: 48
- Complete: 42 (87.5%)
- Incomplete: 6 (12.5%)
- With P&L data: 46 (95.8%) ← All incomplete tokens now show partial data!

**Incomplete Breakdown:**
- 4 tokens: Sells without any buys (clearly acquired before tracking)
- 2 tokens: Sold more than bought (partial history, e.g., 6Vik7Z... sold 34.8M but bought 24.6M)
- All 6 are LEGITIMATE incomplete flags ✅

**What's Passed to FIFO:**
- SWAP: Always passed ✅
- UNKNOWN/TRANSFER with ≥ 0.01 SOL: Passed ✅
- UNKNOWN/TRANSFER with < 0.01 SOL: Filtered (airdrops, DCA deposits, fee-valued) ✅
- BURN: Always filtered ✅

**Key Fix - Fee Detection Logic:**
```typescript
// In helius-transaction-mapper.ts:967-997
// Detect when net SOL change is just the transaction fee
const netChangeIsJustFee = feeInSol > 0 &&
    Math.abs(absSolChange - feeInSol) < (feeInSol * 0.1) &&
    absSolChange < 0.02;

if (netChangeIsJustFee) {
    // Don't use fee as economic value → associatedSolValue stays 0
}
```

**Next Steps** (deferred):
- Implement full wallet history backfill (fetch from genesis) to eliminate legitimate incomplete history
- Add subtle UI indicator for incomplete history (no screaming warnings)
- Strategy: Quick analysis first (4000 txs), then background backfill job
- Add `--force` flag to helius-analyzer.ts for forced re-analysis (DONE)

**Open Issue - Cross-Wallet Transfers**:
Wallet `ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud` has sent significant amounts to `HAsNv9GjHsCrcSN6bRWwsxbH8fD89tZiYY5D6YpaUQLz` - this is calculated as a loss but could be the same user's wallet (internal transfer). Future consideration: token tracing across wallets to identify related accounts and exclude internal transfers from P&L calculations. This would require building a wallet relationship graph and transaction flow analysis.

---

## What's Working

### ✅ Core Features
- **Authentication**: JWT + API keys, email verification, password reset
- **Wallet Analysis**: PnL tracking, behavioral patterns, holder profiles
- **Classification System**: 3-tier wallet categorization (speedCategory, flowPattern, strategyType)
- **Discover Page**: Enhanced storytelling with separate Speed/Flow filters, all metrics integrated
- **Tracked Wallets Page**: Complete UI with import/export (CSV), add wallet modal, collection filters
- **Job Queues**: BullMQ + Redis with WebSocket progress updates
- **Caching**: Two-tier (Redis + PostgreSQL) for holder profiles

### ✅ Recent Completions
- **Discover Analytics UX** (2025-12-31): Professional ECharts visualizations with PnL aggregation
- **Holder Profile Cache Fix** (2025-12-31): Fixed stale data issue with `analyzedTimestampEnd` check
- **Staleness Config Centralization** (2025-12-31): Unified `WALLET_STALENESS_CONFIG` constant
- **Cache Invalidation Enhancement** (2025-12-31): Added 500ms delay + behavioral patterns invalidation
- **Tracked Wallets Overhaul** (2025-12-29): Complete UI redesign with portfolio stats
- **Import/Export** (2025-12-30): CSV-based wallet import/export with validation
- **Memory Leak Fixes** (Dec 2025): HeliusSyncService, Redis clients, BullMQ cleanup
- **PostgreSQL Optimization** (Dec 2025): Checkpoint tuning, statement timeouts

---

## Current Work - Parallel Development

### 🎯 Branch 1: `discover-analytics-ux` (LLM 1)
**Focus**: UI Enhancements & Analytics Visualizations

**Task Count**: 4 tasks (was 3, added exit timing redesign)

#### Task 1: Polish & UX Improvements ✨
**Goal**: Unified error handling, better loading states, consistent UX
- Add loading skeletons to Discover/Trackers pages (completed)
- Standardize error message formats across app (completed)
- Improve empty states (no data scenarios) (completed)
- Better tooltips and help text (completed)
- **Files**: Various components across dashboard
- **Priority**: High - Quality of life improvements
- **Status**: Complete

#### Task 2: Collection-Based Analytics 📊
**Goal**: Show which collections perform best in Tracked Wallets page
**Location**: `dashboard/src/app/trackers/page.tsx` sidebar
**Features**:
- Performance metrics per collection (avg PnL, avg balance, wallet count) (completed)
- Click collection to filter main table (completed)
- Visual breakdown: "Portfolio: 5 wallets, 45 SOL PnL"
**Data**: Already available in `favoriteWallets` - aggregate by collections
**Priority**: Medium - New feature, high value
**Status**: Complete

#### Task 3: Speed/Flow Analytics in Discover 📈✅
**Goal**: Add analytics sidebar to Discover page with visual charts
**Location**: `dashboard/src/app/discover/page.tsx`
**Features**:
- Replaced list-based distribution with professional donut charts using Apache ECharts ✅
- Muted pastel color palette for better readability and visual comfort ✅
- Percentages displayed outside pie slices with leader lines for clarity ✅
- Interactive hover states showing category name (color-coded) in center ✅
- Three-line center display: total wallet count (default) / specific count+% (hover), category name (hover), PnL (hover) ✅
- Hover only triggers on pie slices, not labels/lines ✅
- Backend aggregation endpoint `/discover/aggregation` with netPnl aggregation per category ✅
- Velocity filter slider (0-100) with backend filtering ✅
- Charts sized at 340px with proper container spacing (no clipping) ✅
**Backend Changes**:
- Added `getDiscoverAggregation()` in `DiscoverService` with netPnl aggregation per category
- Updated `getDiscoverAggregationData()` in `DatabaseService` to fetch and map `netPnl`
- Added `DiscoverAggregationResponseDto` with `totalPnl` field (aggregated from netPnl)
**Data**: Full dataset aggregation (not just current page), uses netPnl from pnlSummary
**Priority**: Medium - Fills empty space, provides qualitative insights
**Status**: ✅ Complete (Dec 31, 2025)

#### Task 4: Exit Timing Drilldown Redesign 🎭 [IN PROGRESS]
**Goal**: Redesign the drilldown panel and hold metrics structure in wallet profiles
**Problem**: Panel that opens when clicking exit timing buckets is "complete garbage" - unintuitive, cramped, no sorting. Hold metrics (median/avg/holding) are confusing mesh.
**Location**:
- `dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx`
- `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx`
**Challenge**: Design a way to review tokens from time buckets that feels professional, plus clarify hold metrics structure
**Priority**: High - User pain point, "thorn in eye"
**Status**: Designed, ready for implementation

**Design Specifications**:

**Part A: ExitTimingDrilldownPanel - Simple Data Table**
```
╔════════════════════════════════════════════════════════════════════════════╗
║ Exit Timing: Momentum (5-30 min)                                      [X] ║
║ 47 tokens • 23 wins, 24 losses                                             ║
╠════════════════════════════════════════════════════════════════════════════╣
║ [Search token...______]  [All ▼]  [Sort: PnL ▼]                           ║
║                          Winners/Losers/All                                ║
║                                                                             ║
║ TOKEN              ENTRY          EXIT           HOLD    PNL      ROI     ║
║ ─────────────────────────────────────────────────────────────────────────  ║
║ 🪙 BONK           Jan 15 14:32   Jan 15 14:47   15m    +2.4    +45% ✓    ║
║ 🪙 WIF            Jan 12 09:15   Jan 12 09:27   12m    +1.8    +32% ✓    ║
║ 🪙 SAMO           Jan 10 16:45   Jan 10 17:03   18m    -0.3    -12% ✗    ║
║ 🪙 MEME           Jan 8  11:22   Jan 8  11:50   28m    +0.9    +18% ✓    ║
║ ...                                                                         ║
║                                                                             ║
║                      [Load More]                 Showing 20 of 47          ║
╚════════════════════════════════════════════════════════════════════════════╝
```

**Features (keep it lightweight)**:
- Clean table with: Token badge, Entry date, Exit date, Hold duration, PnL (SOL), ROI %, Win/Loss (✓/✗)
- Search by token name/symbol
- Filter: All/Winners/Losers dropdown
- Sort: PnL, ROI, Hold time, Entry date, Exit date
- Load more pagination
- NO complex stats, aggregations, or charts - just clean data view
- Style: Match Discover/Trackers pages (modern, sleek, professional)

**Part B: WalletBaseballCard Hold Metrics** [TODO - needs further design]
**Problem**: Current display mixes "exits only" with "exits + active holdings" which is mathematically confusing
**Solution needed**: Visually separate current holdings vs completed exits, don't mix time metrics
**Status**: Awaiting design - will tackle after Part A is implemented

**Tech Stack**: React, Recharts/Tremor for charts, existing UI components

---

## Bug Fixes & Infrastructure Improvements (Dec 31, 2025)

### Holder Profile Stale Cache Bug 🐛✅
**Problem**: Holder profiles showing outdated data (Dec 11) when viewed on Dec 31
**Root Cause**: `isSnapshotFresh()` only checked if snapshot was newer than wallet's last fetch, but didn't verify if the wallet analysis itself was stale
**Solution**:
- Added `analyzedTimestampEnd` staleness check in `holder-profiles-cache.service.ts`
- Centralized 24-hour threshold in `WALLET_STALENESS_CONFIG` constant
- Now properly triggers re-analysis when wallet data is >24 hours old
**Files Changed**:
- `src/api/services/holder-profiles-cache.service.ts` (added staleness check)
- `src/config/constants.ts` (added `WALLET_STALENESS_CONFIG`)
- `src/core/services/database-service.ts` (use centralized constant)

### Cache Invalidation Improvements 🔄✅
**Problem**: After job completion, frontend sometimes showed stale data
**Solution**:
- Added 500ms delay before cache invalidation to ensure backend finishes writing
- Added `behavioral-patterns` cache invalidation on job completion
**Files Changed**:
- `dashboard/src/components/layout/WalletProfileLayout.tsx`
**Note**: Event-driven approach would be better, but delay is pragmatic solution for now

---

### 🎯 Branch 2: `discover-token-performance` (LLM 2)
**Focus**: Token Performance Fixes & Enhancements
**Status**: ⚠️ **PAUSED** - Discovered P0 blocker during work

#### 🔧 Additional Scope (P0 Fix)
Include transfer-in/out (non-DEX) in FIFO lot accounting: treat transfer-out as a sell with 0 proceeds to avoid overstated P&L; treat transfer-in as a zero-cost lot. This is needed to keep realized P&L correct when tokens leave/enter without swaps.

#### ✅ Progress Update (P0 FIFO Work)
- FIFO logic moved into SwapAnalyzer (source-of-truth aggregation stage).
- PnlAnalysisService now orchestrates persistence only; no average-cost P&L calculations remain.
- Consumers updated to read FIFO fields and skip `hasIncompleteHistory`.
- Prisma schema updated with TokenLot + FIFO fields (migration generated).
- Fixed mapping bug: WSOL total movement now counts only user-involved transfers (prevents router hop double-counting of swap value). Added mapper test for this case.
- FIFO logic verified with multiple wallet runs; tests executed in another environment.
- Backfill script not implemented; dev DB was wiped so backfill not run.

#### ✅ Status
- Marked done for dev use. FIFO math validated on real wallets and mapping fix confirmed.
- Backfill/reprocessing script and formal unit test reruns deferred intentionally.

#### ✅ FIFO Bug Fixes (2026-01-04)
**Issue 1: Floating Point Precision Bug**
- **Problem**: 4 tokens showed `hasIncompleteHistory = true` despite perfect balance (IN = OUT)
- **Root Cause**: `while (remainingToSell > 0)` failed on tiny floating point remainders (e.g., 0.0000000037)
- **Solution**: Implemented percentage-based tolerance with floor/ceiling bounds
  ```typescript
  const PERCENTAGE_TOLERANCE = 0.001; // 0.1% of sale amount
  const MIN_TOLERANCE = 0.001; // Floor: prevent floating point issues
  const MAX_TOLERANCE = 100; // Ceiling: prevent being too loose
  const completionTolerance = Math.min(
    Math.max(normalizedAmount * PERCENTAGE_TOLERANCE, MIN_TOLERANCE),
    MAX_TOLERANCE
  );
  while (remainingToSell > completionTolerance) { ... }
  ```
- **Files**: `src/core/analysis/swap/fifo-lot-tracker.ts:49-100`

**Issue 2: Stale Balance Data Bug**
- **Problem**: Tokens with 15M stale balance when actual balance should be 0 (fully sold)
- **Root Cause**: Helius API doesn't return tokens with balance=0, causing `currentUiBalance: undefined` in upsert, which preserves old data in Prisma
- **Solution**: Trust Helius balance data - if token not in response, set to 0
  ```typescript
  const hasBalanceData = !!currentWalletBalance;

  // If we have fresh balance data:
  //   - Token in response → use it
  //   - Token NOT in response → balance is 0 (sold/transferred)
  // If no balance data (test scripts):
  //   - Leave undefined (don't update field)

  currentUiBalance: hasBalanceData ? (tokenBalance?.uiBalance ?? 0) : undefined
  ```
- **Files**: `src/core/services/pnl-analysis-service.ts:246-270`
- **Impact**: All tokens now show accurate current balances; stale data automatically cleared on analysis
- **Note**: We always fetch balances during analysis (even time-ranged) for unrealized PnL, so `hasBalanceData` is always true in production

**Verification**: Both fixes tested and verified on wallet CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B
- All 4 incomplete tokens now show `hasIncompleteHistory: false` ✅
- All stale balances cleared (15M → 0, 5M → 0) ✅
- FIFO realized PnL calculations now accurate ✅

#### ✅ Issue 3: USDC Conversion Bug (RESOLVED - 2026-01-05)
**Problem**: USDC values treated as SOL 1:1 in FIFO cost basis (668,500 USDC → 668,500 SOL instead of ~4,951 SOL)
**Root Cause**: `fifo-lot-tracker.ts` line 69 used `fallbackUsdcValue` directly without currency conversion
**Solution**: Pass SOL price from `PnlAnalysisService` → `SwapAnalyzer` → `buildFifoLotsForToken()`, convert USDC to SOL
**Impact**: Reduced error from 668,500 SOL to 4,940 SOL (~131x improvement)
**Files Changed**:
- `src/core/analysis/swap/fifo-lot-tracker.ts` - Added `solPriceUsd` parameter, converts USDC→SOL
- `src/core/analysis/swap/analyzer.ts` - Passes SOL price to FIFO tracker
- `src/core/services/pnl-analysis-service.ts` - Already fetches SOL price (cached in Redis, 30s TTL)
**Status**: ✅ Fixed and verified on production data 

#### ✅ Task 4: ROI Calculation Fix (COMPLETED)
**Problem**: ROI showing -300% for dust trades
**Solution**: Added dust trade detection (< 0.01 SOL threshold), hide ROI pill for these cases
**Status**: ✅ Fixed in `TokenPerformanceTab.tsx:174-186`

#### ✅ Task 5: Time Filter Detachment (COMPLETED)
**Problem**: Token Performance tab hid tokens when no activity in time period
**Solution**: Separated fetch URL (with time filter) from cache key (without time filter)
**Status**: ✅ Fixed in `TokenPerformanceTab.tsx:425-473`

#### ✅ Task 6: Infinite Scroll Pagination (COMPLETED)
**Goal**: Replace horizontal pagination with vertical infinite scroll
**Status**: ✅ Already implemented before this branch started

#### ✅ Task 7: Virtual Scrolling + Client-Side Sorting (COMPLETED - 2026-01-02)
**Problem**: Infinite scroll + sorting was fundamentally broken
- Sorting changed → only showed 20 tokens (not the absolute highest/lowest)
- Backend loaded ALL tokens, sorted them, then threw away 96% (extremely wasteful)
- Table flickered and disappeared on every sort change
- Users couldn't see the actual top PNL tokens when sorting

**Root Cause Analysis**:
- Infinite scroll is for BROWSING (one sort order)
- Arbitrary sorting requires seeing ALL results
- Backend already fetched all tokens for calculated fields (totalPnlSol, ROI) but paginated the result
- Every scroll triggered a full DB query + sort, just to return 20 tokens

**Solution Implemented**: Virtual Scrolling + Client-Side Sorting (what "big players" do)
1. **Fetch ALL tokens at once** (`pageSize=999999` instead of 20)
   - Single backend call instead of N calls
   - No pagination - get everything in one request
   - Cache key excludes sorting (no refetch on sort change)

2. **Client-side sorting** (instant, no backend calls)
   - All sorting logic moved to frontend
   - Sorts full dataset in memory (~1ms for 1000 tokens)
   - No flickering - data stays visible during sort
   - `useMemo` prevents re-sorting on every render

3. **Virtual scrolling** (@tanstack/react-virtual)
   - Only renders ~30 visible rows in DOM
   - Handles 100, 1000, or even 10,000+ tokens smoothly
   - Scroll performance stays smooth
   - Estimated row height: 48px, overscan: 10 rows

**Files Changed**:
- `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` - Complete refactor
- `src/api/shared/dto/token-performance-query.dto.ts` - Backend validation fix

**Critical Backend Fix**:
- **REMOVED**: `@Max(100)` validation on pageSize (was blocking large requests!)
- **ADDED**: `@Max(100000)` to allow fetching all tokens
- **Without this fix, only 100 tokens would load!**

**Benefits**:
- ✅ Sorting works correctly - shows absolute highest/lowest values
- ✅ No flickering - instant sorting
- ✅ No arbitrary limits - handles any wallet size
- ✅ Better performance - 1 backend call instead of N
- ✅ Infinite scroll removed - simpler code

**Potential Issues to Monitor**:
1. ⚠️ **Sticky column behavior** - Token column uses `position: sticky`, but virtual scrolling uses `position: absolute`. Test horizontal scrolling to ensure sticky column still works.
2. ⚠️ **Response size** - 1000 tokens ≈ 2-10MB uncompressed. Check gzip compression is enabled.
3. ⚠️ **Database performance** - Wallets with 10,000+ tokens could have slower queries. Monitor query times.
4. ⚠️ **Image loading** - Virtual scrolling only renders visible rows, so only ~30 images load. Should be fine, but verify TokenBadge has lazy loading.
5. ℹ️ **Frontend memory** - 10K tokens × 5KB each = 50MB. Modern browsers handle this easily.
6. ℹ️ **Server load** - Actually might IMPROVE (1 heavy request vs 50 light requests).

**Testing Checklist**:
- [ ] Sort by Total Profit → verify shows absolute highest PNL tokens
- [ ] Wallet with 1000+ tokens → verify loads completely
- [ ] Rapid sorting changes → verify no flickering
- [ ] Horizontal scroll → verify token column stays sticky
- [ ] Network tab → check response size and gzip compression
- [ ] Large wallets (5000+ tokens) → verify scroll performance

**Status**: ✅ Implemented and compiles. Needs production testing.

#### 🔴 P0 DISCOVERED: Fundamental P&L Calculation Error
**What Happened**: While testing fixes, discovered Total Profit showing -80 SOL when should be +721 SOL
**Investigation**: Led to discovery that ALL P&L calculations are wrong for partial sells
**Root Cause**: No FIFO cost basis tracking - simple averaging fails catastrophically
**Scope**: Affects 6 major areas across entire platform (see P0 section above)
**Action**: Created `.ai/context/P0_PNL_CONTAMINATION.md` with full analysis
**Next Steps**: Block all feature work, implement proper FIFO lot tracking (~2-3 days)

#### Additional Changes Made This Branch:
1. ✅ Wallet page layout - natural scrolling with sticky tabs
2. ✅ Last Active timestamp - inline with token badge
3. ✅ Sleek tooltips - consistent styling across table
4. ✅ Total Profit formula - PATCHED with correct calculation (frontend band-aid)

**Tech Stack**: NestJS backend, Prisma ORM, React frontend

---

## Branch Strategy

### ⚠️ ORIGINAL PLAN (NOW BLOCKED BY P0)

**Original Workflow**:
1. **LLM 1** works on `discover-analytics-ux` (tasks 1, 2, 3, 4)
2. **LLM 2** works on `discover-token-performance` (tasks 4, 5, 6)
3. Both branches based on `discover` (current state)
4. When done, merge both back into `discover`
5. Then `discover` → `main` for deployment

**Why This Split**:
- **Minimal overlap**: Different pages/components
- **Independent work**: No blocking dependencies
- **Low conflict risk**: Different areas of codebase

### 🔴 CURRENT REALITY (P0 BLOCKING)

**Branch 2 Status**: Tasks 4-5-6 completed, but discovered P0 issue
**P0 Blocker**: Fundamental P&L calculation error affecting entire platform
**All Feature Work**: PAUSED until P0 is resolved
**Next Steps**:
1. Fix FIFO cost basis tracking (~2-3 days)
2. Verify all infected areas show correct data
3. THEN resume parallel branch work if still desired

---

## Deployment Notes

### Backend Changes Required (When Merging to Main):
- 3 Database migrations (classification fields, storytelling metrics)
- New API endpoints (discover.controller.ts, discover.service.ts)
- Updated services (user-favorites, behavior, token-performance)
- **CRITICAL**: Token performance DTO validation change (`@Max(100)` → `@Max(100000)`)
  - File: `src/api/shared/dto/token-performance-query.dto.ts`
  - Required for virtual scrolling to work (fetches all tokens at once)
  - Without this, frontend will only load 100 tokens maximum!

### Deployment Order (When Ready):
1. Deploy backend to home server first (run migrations)
2. Then merge to `main` (triggers Vercel frontend deploy)
3. **DO NOT** merge to main before backend is deployed (frontend will expect APIs that don't exist)

---

## Architecture Stack

### Frontend
- Next.js 14 (App Router)
- shadcn/ui + Tailwind CSS
- Recharts/Tremor for charts
- Socket.IO client

### Backend
- NestJS + TypeScript
- BullMQ (Redis queues)
- Prisma ORM (PostgreSQL)
- WebSocket gateway

### Key Directories
- Frontend: `dashboard/src/`
- Backend API: `src/api/`
- Core logic: `src/core/`
- Job processors: `src/queues/`
- Documentation: `documentation/`, `docs/`
- Context: `.ai/context/`

---

## Development Commands

```bash
# Start backend
npm run dev

# Start frontend
cd dashboard && npm run dev

# Run migrations (backend deployment)
npx prisma migrate deploy

# Build for production
npm run build
pm2 restart sova-backend-api
```

---

## Notes
- Admin access: `ADMIN_USER_IDS` and `ADMIN_EMAILS` env vars
- Dev mode is unoptimized (expected), production is fast
- Classification system details in `documentation/01. ARCHITECTURE_DECISIONS.md`
- Memory leak fixes documented in `.ai/CURRENT_STATE.md`
- Prisma migration for `AnalysisResult.netSolProfitLoss` nullable still needs to be generated (migration create-only failed due to missing DB).
- Added `scripts/pnl-usage-audit.js` to map PnL field usage and flag netSolProfitLoss hotspots.
