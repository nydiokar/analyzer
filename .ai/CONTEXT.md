# Current State

Project: Sova Intel - Wallet Analysis System
Branch: discover-analytics-ux
Last Updated: 2026-01-13

## Current Focus
Job queue stability and reliability improvements.

## Previous Focus (2026-01-12)
UX/Analytics refactor for three main pages:
1. Tracked Wallets - Layout improvements and additional columns
2. Discover - Filtering improvements and column reorganization
3. Holder Profiles - Major restructuring with similarity integration
4. Similarity Lab - Bug fixes (TBD)

## Previous Focus (Completed)
FIFO PnL correctness when history is partial and when transfers/order ops appear.

## Key Changes (2026-01-07)
- SwapAnalyzer now passes ALL SPL transfers to FIFO (no pre-filter).
- FIFO uses mapper value only; non-economic is value==0 (no type-based logic).
- FIFO now returns partial realized PnL even when history is incomplete (no nulls).
- FIFO proceeds are counted only for matched lots (unmatched sells do not inflate realized).
- Wallet-level PnL includes partials (still flagged by hasIncompleteHistory).
- Token performance no longer nullifies realized/total just because incomplete.
- Token performance excludes stablecoins and noise tokens with zero activity or <0.01 SOL holdings.
- Mapper fixes:
  - ignore self-transfers (fromUserTA && toUserTA) to avoid inventory distortion
  - CREATE_ORDER / CANCEL_ORDER are forced to zero value
- SwapAnalyzer debug logs gated by env var PNL_DEBUG_LOGS=true.

## Reprocessing Required After Mapper Changes
Mapper changes do not backfill existing SwapAnalysisInput rows. To see fixes:
1) Clear SwapAnalysisInput for the wallet
2) Re-sync wallet (mapping)
3) Re-run PnL analysis

## Debug Scripts
- .ai/context/FIFO_debug/validate-fifo-inputs.ts <WALLET> [MINTS]
  Uses real SwapAnalyzer output; shows per-mint in/out, values, signatures.
- .ai/context/FIFO_debug/inspect-analysis-result.ts <WALLET> <MINT>
  Dumps AnalysisResult row for a wallet+mint.

## Notes
- Partial history is now surfaced as partial realized PnL with hasIncompleteHistory=true.
- Frontend should display realized/total from DB (no nulls) and can badge incomplete.

---

## Queue System Stability Improvements (2026-01-13)

### Problem Diagnosed
A wallet with 29k token accounts triggered system-wide queue starvation after server restart:
- Orphaned Redis lock from crashed job persisted after restart (15-min TTL)
- New jobs for same wallet failed to acquire lock → retried with HIGH priority
- **Retry storm**: Failed jobs kept retrying, consuming workers and starving lower-priority jobs
- **Priority inversion**: High-priority retries blocked legitimate lower-priority work
- Similarity jobs starved because dashboard jobs had higher priority (10 vs 7)

### Root Causes Identified
1. **No orphaned lock cleanup** - Locks from crashed jobs persisted through restart
2. **Retry storm self-DDoS** - Lock failures retried 3x with exponential backoff, wasting workers
3. **Priority inversion** - Failing high-priority jobs blocked working low-priority jobs
4. **Poor logging** - No visibility into lock ownership, TTL, or contention

### Fixes Implemented

#### 1. Orphaned Lock Cleanup on Startup
**File:** `src/queues/queue.module.ts`
- Added `RedisLockService.cleanupOrphanedLocksOnStartup()` to `QueueModule.onModuleInit()`
- Scans all `lock:*` keys on startup, checks if jobs still exist in BullMQ
- Force-releases locks for jobs that no longer exist or are finished
- Prevents server restarts from leaving zombie locks

#### 2. Fail-Fast Lock Acquisition (Prevent Retry Storms)
**Files:**
- `src/queues/processors/analysis-operations.processor.ts`
- `src/queues/processors/wallet-operations.processor.ts`
- `src/queues/processors/similarity-operations.processor.ts`

Changed all lock acquisition failures to throw `UnrecoverableError` instead of regular `Error`:
- **Before:** Job fails → BullMQ retries 3x → wastes workers → creates priority inversion
- **After:** Job fails → throws UnrecoverableError → BullMQ does NOT retry → worker freed immediately

Benefits:
- No retry storms consuming workers
- Failed jobs fail immediately and free workers for legitimate work
- Users get clear error message: "Analysis already in progress (locked by: job-123, TTL: 180000ms)"

#### 3. Enhanced Lock Failure Logging
All lock failures now log:
- Lock owner (job ID)
- Remaining TTL in milliseconds
- Resource being locked (wallet address, request ID, etc.)
- Explicit "FAILED (no retry)" message

Example log:
```
❌ Cannot acquire lock for dashboard analysis on ABC123 [scope=working].
Locked by: dashboard-xyz789, TTL: 450000ms. Job dashboard-abc456 FAILED (no retry).
```

#### 4. Metrics for Lock Contention and Concurrent Analysis
**Files:**
- `src/api/services/metrics.service.ts`
- `src/queues/queue.module.ts`
- `src/queues/processors/analysis-operations.processor.ts`

Added Prometheus metrics:
- `lock_contention_total{lock_type, resource}` - Counts lock acquisition failures
- `concurrent_analysis_attempts_total{analysis_type, resource_type}` - Tracks concurrent analysis attempts

Use cases:
- Monitor if lock contention is a real problem or edge case
- Track how often holder profiles analysis runs while dashboard analysis is in progress
- Data-driven decisions on whether to add coordination/locks

Example metrics:
```
lock_contention_total{lock_type="dashboard",resource="wallet"} 5
concurrent_analysis_attempts_total{analysis_type="holder_profiles",resource_type="wallet"} 12
```

Access via: `GET /api/v1/metrics` (Prometheus format)

### Architecture Notes

**Lock Scope Independence:**
- Dashboard uses `lock:wallet:dashboard-analysis:{address}`
- PnL uses `lock:wallet:pnl:{address}`
- Behavior uses `lock:wallet:behavior:{address}`
- Sync uses `lock:wallet:sync:{address}`
- Similarity uses `lock:similarity:{requestId}`
- **Holder profiles uses NO LOCK** - relies on service idempotency

**Priority System (Unchanged):**
- CRITICAL (10): User dashboard requests
- HIGH (7): Similarity analysis
- NORMAL (5): Regular analysis
- LOW (3): Background enrichment
- MAINTENANCE (1): Cleanup jobs

Priorities prevent background jobs from blocking interactive user requests. Fail-fast prevents priority inversion from retry storms.

**Testing Results:**
- Ran 2 simultaneous jobs for same wallet → both completed smoothly
- Services are idempotent → concurrent execution is safe
- Database caching works → second job benefits from first's work
- No lock contention → no blocking

### Impact
- **Server restart resilience**: Orphaned locks cleaned up automatically
- **Self-DDoS prevention**: Lock conflicts fail immediately instead of retrying
- **Better observability**: Clear logs + metrics for monitoring
- **Faster recovery**: Workers freed immediately instead of wasting cycles on retries
- **User experience**: Clear error messages when analysis is already in progress

---

## Active Tasks (2026-01-13)

### 1. Tracked Wallets Page Refactor
**Status:** ✅ COMPLETED
**Docs:** `.ai/context/TRACKED_WALLETS_PAGE.md`
**Changes Implemented:**
- ✅ Moved Add Wallet, Import, Export buttons above table (right-aligned)
- ✅ Moved search bar above table (left-aligned)
- ✅ Updated columns: Wallet | PnL | Winrate | Last Active | SOL Balance
- ✅ Fixed PnL to show total (realized + unrealized) in SOL format
- ✅ Fixed Winrate to use `tokenWinRatePercent` from AdvancedTradeStats
- ✅ Updated backend to include advancedStats in getFavoriteWalletsByUserId query
- ✅ WalletBadge shows no metrics (showMetrics=false)

**Files Modified:**
- `dashboard/src/app/trackers/page.tsx` - Layout and display changes
- `src/api/services/user-favorites.service.ts` - PnL and winrate calculation fixes
- `src/core/services/database-service.ts` - Added advancedStats to query

### 2. Discover Page Refactor
**Status:** ✅ COMPLETED
**Docs:** `.ai/context/DISCOVER_PAGE.md`
**Changes Implemented:**
- ✅ Split header into two rows (title row + filter row)
- ✅ Extracted winrate from wallet badge to separate column
- ✅ Added time period filters (1d/7d/30d/All) - placeholders, right-aligned
- ✅ Added Active (48) filter as prominent pill badge at start of filter row
- ✅ Moved Flow/Speed category filters to pie chart click interactions
- ✅ Reordered columns: Wallet | PnL | Winrate | SOL Balance | Speed | Flow | Unpaired
- ✅ Made PnL, Winrate, SOL Balance columns tight and compact (w-32, w-20, w-20)
- ✅ Removed fixed width from Flow column for natural text wrapping
- ✅ Reduced pie chart sizes from 340px to 260px
- ✅ Removed min-height from Speed chart container to fit content
- ✅ Added tooltips directing users to filter via pie charts
- ✅ Added currentSolBalance to backend API response

**Files Modified:**
- `dashboard/src/app/discover/page.tsx` - Layout, filtering, table structure, column order
- `src/api/services/discover.service.ts` - Added currentSolBalance to metrics
- `src/api/shared/dto/discover-wallet.dto.ts` - Added currentSolBalance field
- `dashboard/src/types/discover.ts` - Added currentSolBalance to interface

### 3. Holder Profiles Page Refactor
**Status:** Pending
**Docs:** `.ai/context/HOLDER_PROFILES_PAGE.md`
**Changes:**
- Slim compact input area
- Single row stats: Token Badge | Outcome | Speed | Quality (Gold+Silver) | Mean Behavior Similarity
- Replace category counts with trader distribution bar chart (1sec-24h+)
- Add "approaching typical hold time" component
- Holders table with 7 columns including merged Category+Time
- Similarity analysis sidebar with compact cards
**Pending (Task 3):** (2026-01-12)
- Holder profiles → similarity now triggers sequentially after completion; review once similarity lab refactor lands.
- Similarity job fast-path currently reads cached balances via private helper in `SimilarityOperationsProcessor`; replace with BalanceCacheService cache-only helper or job flag.

CHECK IF THESE AREN"T ALREADY DONE
- Similarity lab + analyses controller have TODOs for cache-only path when ready.
- Holder profiles page has TODOs for JobResult unwrap + cache-only similarity queue.
- Holder profiles UI: clear stale results on failure vs keep last success (decide behavior).

New TASKS: 
- verify what mean similarity is producing and make sure it's correct and showing what it must
- Outcome is too influenced with the quality of data and other stuff - it should be more influence by the speed - it's almost constantly showing Relatively stable. 
- speed - check if tag (classification) is corresponding with the time
- fix Quality tooltip
- add lines in the Trader Distribution table, so it's easily to see where the chart bar is reaching - currently the bars are like in the air. 
- Approaching typical hold time needs to be finished off. 
- Reduce logs for  [HeliusApiClient] Successfully fetched token accounts (V2) for owner qmC1gusK2b5pYNDp1Aw5nDdZx9WTLVs7KHQoq6AAxFN. Count: 28 - this is happening too often, either wrong or just badly put into the logging system - maybe to only show big counts - over 5000 and to be debug, not info every single of them (maybe some aggregation). 

### 4. Similarity Lab Bug Fixes
**Status:** Pending
**Details:** TBD

---

## Known Issues

### Database Deadlock in Token Metadata Upserts
**Status:** 🔴 Needs Fix
**Location:** `src/core/services/dexscreener.service.ts` → `DatabaseService.upsertManyTokenInfo`
**Error:** `PostgresError { code: "40P01", message: "deadlock detected" }`
**Cause:** Multiple parallel requests trying to upsert the same tokens simultaneously during similarity/holder-profiles analysis.
**Impact:** Token metadata enrichment fails intermittently, retries may help but not guaranteed.
**Potential Fixes:**
1. Add retry logic with exponential backoff in `upsertManyTokenInfo`
2. Use Prisma `$transaction` with `Serializable` isolation level
3. Process token upserts sequentially instead of in parallel batches
4. Add row-level locking or use `ON CONFLICT` more carefully


We are currently denominatic the value only in SOL and USD (USDC) but missing USD1 - USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB