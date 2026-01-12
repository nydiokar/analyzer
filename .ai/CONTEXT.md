# Current State

Project: Sova Intel - Wallet Analysis System
Branch: discover-analytics-ux
Last Updated: 2026-01-12

## Current Focus
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

## Active Tasks (2026-01-10)

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
- Similarity lab + analyses controller have TODOs for cache-only path when ready.
- Holder profiles page has TODOs for JobResult unwrap + cache-only similarity queue.
- Holder profiles UI: clear stale results on failure vs keep last success (decide behavior).

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