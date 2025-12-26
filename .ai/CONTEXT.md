# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover` (storytelling enhancement + median fix)
**Status**: Discover page COMPLETE - Ready for testing & merge ✅
**Last Updated**: 2025-12-26 (median bug fix + UI polish)

---

## What's Working

### ✅ Layout & Navigation
- Two-shell architecture: LandingShell (unauth) + AppShell (auth with top bar)
- Routes: `/` (landing), `/discover` (default after login), `/trackers`, `/wallets/[address]`
- Command modal search (Cmd/Ctrl+K) with "Import & Analyze" action

### ✅ Authentication & Session Management
- JWT-based auth with automatic token refresh (5-min buffer, no modals)
- Email verification via React Email + Resend
- Password reset flow
- Admin panel for API key management (visible only to admins)
- Protected routes auto-show auth modal, redirect back after login

### ✅ Dashboard Components
- All components migrated to shadcn/ui + Tailwind
- TokenBadge integrated throughout (resizable, always-visible)
- Tracked Wallets page with CRUD, filtering, collections
- Responsive design for laptop screens

### ✅ Backend
- Dual auth: JWT (users) + API keys (services)
- BullMQ job queues with WebSocket progress updates
- Redis caching, rate limiting
- Holder profile analysis with behavioral patterns

### ✅ **WebSocket Refactor** – User-scoped rooms with maps for jobId -> userId

---

## Current Tasks

### 📋 Blocked/On Hold (requires partner discussion)
1. **Comprehensive Tooltips** – Exit timing/global metrics still need tooltips (waiting on partner for content)
2. **Holder Classification** – Edge case: better heuristics for holders without exits (needs partner input on logic)

### ✅ Recently Completed

- **🔥 CRITICAL BUG FIX: Median Inconsistency** (2025-12-26) – Fixed speed category showing wrong median values:
  - **Root Cause**: Two different median calculations in system:
    - `medianHoldTime` (DEPRECATED): Trade-level median - simple median across ALL flips
    - `medianCompletedHoldTimeHours`: Token-level median - median OF per-token medians (more sophisticated)
  - **Bug**: speedCategory classification used `medianCompletedHoldTimeHours` but display showed `medianHoldTime`
  - **Impact**: "Momentum (5-30min)" showing "median: 2.3h" (138 minutes!) - completely wrong
  - **Fix Applied**:
    - ✅ Added `medianCompletedHoldTimeHours` field to BehaviorProfile schema (nullable)
    - ✅ Migration created: `20251226190008_add_median_completed_hold_time_hours`
    - ✅ Updated `behavior-service.ts` to save correct median from `historicalPattern.medianCompletedHoldTimeHours`
    - ✅ Updated `discover.service.ts` to use `medianCompletedHoldTimeHours` for display (with fallback to deprecated field for old data)
    - ✅ Updated filters and sorting to use new field
    - ✅ Backfilled existing data with SQL script
  - **Verification**: "Momentum (5-30min)" wallets now show "median: 29min" ✓ (matches Historical Pattern)
  - **Files Changed**:
    - Schema: `prisma/schema.prisma` (line 150)
    - Backend: `src/core/analysis/behavior/behavior-service.ts` (line 133), `src/api/services/behavior.service.ts` (line 96), `src/api/services/discover.service.ts` (lines 237, 262, 127, 190, 205)
  - **Technical Notes**:
    - Token-level median prevents high-volume tokens from dominating the calculation
    - Only uses completed (EXITED) positions for clean signal
    - Falls back gracefully for old data without the new field

- **Discover Page Storytelling Enhancement** (2025-12-26) – Complete metrics integration + UI improvements:
  - **Separate Speed & Flow Filters**:
    - Added dedicated Speed filter (8 options: Sniper → Hodler)
    - Added dedicated Flow filter (6 options: Buy-Only → Mixed)
    - Replaced confusing "Balanced Trader" filter that showed no results
    - Backend: Added `speedCategory` and `flowPattern` query parameters to discover DTO
  - **Metrics Integration**: All 25+ backend metrics now used in narratives:
    - ✅ velocityScore integrated into speed narratives
    - ✅ sequenceConsistency shown qualitatively (not raw numbers)
    - ✅ exitPattern displayed for all flow types (not just BALANCED)
    - ✅ percentOfValueInCurrentHoldings smartly shown (only when < 100% for BUY_ONLY, < 95% for ACCUMULATOR)
    - ✅ Staleness indicator added (shows data age in hours)
  - **Redundancy Removal**:
    - Removed holding time from BUY_ONLY flow (redundant with Speed "No Exits")
    - Removed holding time from ACCUMULATOR flow (avoiding duplication)
    - Current holdings data moved from Speed to Flow narratives (correct categorization)
  - **Color Palette**:
    - Unified colors matching holder-profiles
    - Speed: Red (fast) → Orange → Yellow → Blue → Emerald (slow)
    - Flow: Emerald (high conviction) → Blue (balanced) → Yellow (mixed) → Red (exit)
    - Created `dashboard/src/lib/strategy-colors.ts` with `getSpeedColor()` and `getFlowColor()` helpers
  - **UI Polish** (2025-12-26):
    - ✅ Fixed filter row wrapping - removed redundant wallet count, moved refresh button inline
    - ✅ Balanced column widths: PnL min-width 140px (no more 3-line wrapping), Speed max 380px, Flow max 480px
    - ✅ Reduced filter gaps from `gap-3` to `gap-2.5` for tighter layout
    - ✅ Reduced input widths from 90px to 85px
    - ✅ All controls fit on ONE row now
  - **Files Changed**:
    - Frontend: `dashboard/src/app/discover/page.tsx` (filters, column widths, wallet count removal)
    - Backend: `src/api/services/discover.service.ts` (new query params, filter logic)
    - DTOs: `src/api/shared/dto/discover-wallet.dto.ts` (speedCategory, flowPattern params)
    - Narratives: `dashboard/src/lib/behavior-narratives.tsx` (removed redundant data, added smart % display)
    - Colors: `dashboard/src/lib/strategy-colors.ts` (NEW FILE - unified color palette)

- **Classification Refactor - Days 1-6 COMPLETE** (2025-12-25) – Full stack implementation:
  - **LOW LAYER (Data & Computation)**:
    - Schema migration: Added 6 new fields (speedCategory, flowPattern, strategyType, velocityScore, tokensWithOnlyBuys, medianActiveHoldingHours)
    - Migration applied: `20251225144120_add_classification_fields`
    - Indexes added: strategyType, speedCategory
    - New type system: 3 enums (SpeedCategory, FlowPattern, StrategyType) with 8, 6, and 9 categories respectively
    - Analyzer refactor: 4 new helper functions compute classification fields with holder bypass logic
      - `computeSpeedCategory()` - Exit timing from completed cycles (analyzer.ts:1555)
      - `computeFlowPattern()` - Buy/sell directional bias (analyzer.ts:1575)
      - `deriveStrategyType()` - Canonical filter with holder bypass (analyzer.ts:1603)
      - `computeVelocityScore()` - 0-100 logarithmic scale (analyzer.ts:1668)
    - Holder bypass implemented: Wallets with 3+ tokens held 24h+ OR 50+ SOL position bypass "Low Activity" gate
    - Field population verified: classifyTradingStyle() sets all new fields (analyzer.ts:1712-1731)
  - **MID LAYER (API & Persistence)**:
    - behavior-service.ts: All 6 new fields destructured and saved to database (lines 90-93, 130, 145-147)
    - Deleted broken extractBehaviorType() method - no more string parsing
    - discover.service.ts: Uses strategyType enum filter (EQUALS, not CONTAINS) (line 100)
    - DTOs updated: behavior-response.dto.ts and discover-wallet.dto.ts expose new fields with proper TypeScript types
    - Discover service: Maps speedCategory, flowPattern, strategyType to API response (lines 245-247)
  - **CONSOLIDATION (Single Source of Truth)**:
    - ALL behavior constants moved to `src/core/analysis/behavior/constants.ts`
    - Deleted duplicate BEHAVIOR_ANALYSIS_CONFIG from global config/constants.ts
    - All imports verified: Only analyzer.ts imports from behavior/constants.ts
    - Threshold alignment: ACCUMULATOR_RATIO_MIN updated from 2.5 → 2.0 to match FLOW_THRESHOLDS
  - **HIGH LAYER (Frontend Display)**:
    - Frontend types updated: dashboard/src/types/api.ts with 3 new enums (SpeedCategory, FlowPattern, StrategyType)
    - WalletSummaryData interface: Added strategyType, speedCategory, flowPattern fields (lines 35-37)
    - Discover page filters: Updated to new StrategyType enum values with descriptions (page.tsx:56-66)
    - BehavioralPatternsTab.tsx: Displays strategyType, speedCategory, flowPattern with comprehensive tooltips
    - AccountSummaryCard.tsx: Shows strategyType badge with full classification descriptions
    - WalletBaseballCard.tsx: Enhanced tooltip with all 8 speed categories explained
    - MinimalHoldersTable.tsx: Added detailed speed category reference in tooltips
    - **TOOLTIPS**: All classification fields now have user-friendly explanations:
      - Strategy Type: 9 strategies explained (FAST_TRADER, DAY_TRADER, SWING_TRADER, etc.)
      - Speed Category: 8 levels from SNIPER (<1min) to HOLDER (30+d)
      - Flow Pattern: 6 patterns (BUY_ONLY, ACCUMULATOR, DISTRIBUTOR, etc.)
  - **BUILD STATUS**: ✅ Next.js builds successfully (no errors, only linting warnings)
  - Backward compatible: Old fields (tradingStyle, flipperScore, behaviorClassification) still populated for 6 months
  - Implementation docs: `.ai/context/classification/` (4 reference files)
- **WalletBadge Component Complete** (2025-12-23) – Fully synchronized favorite system:
  - Added nickname/tags display in both inline and card variants
  - Integrated Edit button for favorites management
  - All profile/solscan links open in new tabs (no workflow disruption)
  - Removed duplicate buttons from WalletProfileLayout
  - Professional add/remove flow with modals everywhere
  - Single source of truth: useFavorites() hook
- **Discover Page Data Quality Fix** (2025-12-23) – Fixed fundamental data issues:
  - Trading style filter now works (changed from exact match to CONTAINS)
  - Exposed unrealized PnL and buy/sell counts from database (data existed, wasn't shown)
  - Data-driven behavior tags (e.g., "Heavy accumulator · 38 buys / 0 sells · -145 SOL unrealized")
  - Table shows buy↑/sell↓ breakdown with green/red colors
  - PnL labeled as "realized" or "unrealized" to avoid confusion
  - Cleaner Recency column layout
  - Implementation doc: `.ai/context/discover_page_data_quality_fix.md`
- **TokenBadge Refactor** (2025-12-20) – Inline variant now borderless, compact, horizontal 2-row layout. Fixed sizing hierarchy (name > symbol), added "MC:" prefix, removed duplicate Market Cap column
- **Radix UI Hydration Fix** – Added `suppressHydrationWarning` to Popover/Tooltip/Tabs/DropdownMenu triggers
- **Tooltips & UX Polish** – Added tooltips to wallet header (refresh, favorites, edit, status indicators), AccountSummaryCard (classification descriptions, trades breakdown, activity date)
- **Theme Picker Cleanup** – Removed duplicate from wallet page (already in profile)
- **Time Unit Disambiguation** – VERIFIED: All time formatting uses unambiguous suffixes (min, mo, h, d, s)
- **WebSocket Refactor** – User-scoped rooms, merged to `pretty` branch

### 📋 Current Priority - Discover Branch Ready for Merge

**Status**: ✅ COMPLETE - All work done, ready for testing & merge

**What Was Completed**:
1. ✅ Classification refactor (Days 1-6) - New speedCategory, flowPattern, strategyType system
2. ✅ Discover page storytelling - All metrics integrated with separate Speed/Flow filters
3. ✅ Critical median bug fix - Speed categories now show correct values
4. ✅ UI polish - Filter row, column widths, color palette

**Next Steps**:
1. **Test in browser** - Verify all filters work, median values correct, layout clean
2. **Commit changes** - Stage and commit all files
3. **Merge to main** - Create PR or merge directly if confident
4. **Backfill existing wallets** (optional) - Re-analyze wallets to populate `medianCompletedHoldTimeHours` for historical data

**Reference docs**: See `.ai/context/classification/` folder for detailed implementation plan (completed)

### 📋 Ready to Start (3 tasks)
4. **Fast Exit Metric Clarification** – Show median + avg (not redundant), add tooltip
5. **Discover Page Redesign** – Add featured wallets, tool showcase (layout exists)
6. **Job History Page** – Timeline with re-run capability, hyperlinks to results
7. **Onboarding Flow** – Post-registration checklist (verify email → explore tools)
8. ~~**Enhanced WalletBadge Component**~~ – ✅ DONE (2025-12-23)
9. **Categorization System Documentation** (research task) – Document current categorization:
   - Analyze how each component currently categorizes wallets (Discover, Holder Profiles, Analytics)
   - Document `categorize-holdings.ts` logic (FIFO weighted hold time, time buckets) and why it's not used
   - Identify ad-hoc categories invented per-component (PARTIAL_HOLDER, ACCUMULATOR, etc.)
   - Map all existing classification fields: `tradingStyle`, `behaviorType`, `speedCategory`, etc.
   - Propose centralized `WalletCategorizationService` to eliminate duplication
   - Goal: Understand current state before refactoring to centralized system
   - Design doc: `.ai/context/wallet_badge_and_categorization_refactor.md`

---

## Architecture Notes

### Frontend Stack
- Next.js 14 (App Router)
- shadcn/ui + Tailwind CSS
- Tremor charts (kept for data viz)
- Socket.IO client for job progress

### Backend Stack
- NestJS + TypeScript
- BullMQ (Redis-backed queues)
- Prisma ORM (PostgreSQL)
- WebSocket gateway for real-time updates

### Key Files
- **Frontend**: `dashboard/src/`
- **Backend**: `src/api/` (controllers, services)
- **Queues**: `src/queues/` (processors, jobs)
- **Context docs**: `.ai/context/` (design plans, refactor docs)

---

## Known Issues

1. **Dev mode slow** - First page visit compiles (6-12s), subsequent fast. Production is optimized.
2. **Favorites state sync** - Occasional cache staleness after add/remove (investigate SWR revalidation) ✅ Fixed
3. ~~Job polling admin error~~ - ✅ Fixed: GET `/jobs/:jobId` now accessible to all users
4. ~~WebSocket race condition~~ - ✅ Fixed in user-scoped rooms refactor

---

## Next Session Quick Start

**Discover Branch Status**: ✅ READY TO MERGE

**Completed Today (2025-12-26)**:
- ✅ Fixed critical median inconsistency bug (speed categories showing wrong values)
- ✅ Added `medianCompletedHoldTimeHours` field to database
- ✅ Integrated all metrics into discover page narratives
- ✅ Added separate Speed/Flow filters
- ✅ UI polish: fixed filter row wrapping, balanced column widths
- ✅ Removed redundant wallet count, tightened spacing

**What to Do Next**:
1. **Test in browser**: Verify discover page works correctly
2. **Commit & push**: Stage all changes to `discover` branch
3. **Merge**: Create PR or merge to main if confident
4. **Move to next priority**: Address remaining issues from backlog

**Known Issues to Address Next**:
1. CuPrb8rBk8UBpz8vQ4iDiGivjgKG1VGLc5Lvidx6HMwj - shows 100% loss but onchain is break-even
2. Fix 20k SOL tx cap - currently skip analysis of super whales
3. Mapper missing wallet-to-wallet transfers (non-swap txs)


---

## Notes

- **Performance**: Dev mode unoptimized (expected), production build fast
- **Admin access**: Controlled via `ADMIN_USER_IDS` and `ADMIN_EMAILS` env vars
- **BullMQ Dashboard**: Can install `@bull-board/express` for job queue UI
- **Tremor charts**: Kept unchanged (excellent as-is)
