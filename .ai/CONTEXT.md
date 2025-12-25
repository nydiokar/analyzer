# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover` (design system + auth polish) ✅ SHIPPED
**Status**: Classification system refactor - Days 1-6 COMPLETE ✅ (backend + frontend + tooltips), ready for Day 7 testing
**Last Updated**: 2025-12-25 (late evening session)

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

### 📋 Current Priority (IN PROGRESS) - Classification Refactor MVP

**Goal**: Centralize classification logic in `analyzer.ts`, store explicit enums in DB, expose via API

**Sprint Plan** (5-7 days, bottom-up: LOW → MID → HIGH layers)
**Progress**: ✅ Days 1-6 Complete | 🔄 Day 7 Next (Testing & Integration)

**Reference docs**: See `.ai/context/classification/` folder (6 files):
- `classification_target_state.md` - What we're building (the contract)
- `component_impact_map.md` - 35 files to touch, ranked by impact
- `classification_taxonomy_map.md` - Category definitions & thresholds
- `classification_scientific_assessment.md` - Design decisions & edge cases

---

**✅ Day 1-2: LOW LAYER (Data & Schema)** - COMPLETED 2025-12-25

Guide: `component_impact_map.md` lines 73-85

1. ✅ **Schema** (`prisma/schema.prisma`):
   - Added: `speedCategory String?`, `flowPattern String?`, `strategyType String?`
   - Added: `velocityScore Int?`, `tokensWithOnlyBuys Int`, `medianActiveHoldingHours Float?`
   - Added indexes on strategyType, speedCategory
   - Migration applied: `20251225144120_add_classification_fields`

2. ✅ **Types** (`src/types/behavior.ts` - 41 usages):
   - Added: `SpeedCategory` type (SNIPER...HOLDER)
   - Added: `FlowPattern` type (BUY_ONLY, SELL_ONLY, ACCUMULATOR, DISTRIBUTOR, BALANCED, MIXED)
   - Added: `StrategyType` type (9 categories: FAST_TRADER, DAY_TRADER, ..., LOW_ACTIVITY)
   - Updated BehavioralMetrics interface with new optional fields

3. ✅ **Constants** (`src/core/analysis/behavior/constants.ts` - 68 usages):
   - Added: SPEED_THRESHOLDS (8 levels: SNIPER to HOLDER)
   - Added: FLOW_THRESHOLDS (STRONG_BUY_RATIO: 2.0, STRONG_SELL_RATIO: 0.5)
   - Added: MINIMUM_DATA (trades: 5, tokensWithCompletedCycles: 2)
   - Added: HOLDER_BYPASS (multiToken: 3 tokens + 24h, singleToken: 50 SOL)
   - Added: VELOCITY_SCORE parameters

---

**✅ Day 3-4: LOW LAYER (Computation)** - COMPLETED 2025-12-25

Guide: `component_impact_map.md` lines 44-48 + `classification_target_state.md` lines 116-202

4. ✅ **Analyzer** (`src/core/analysis/behavior/analyzer.ts` - 88 usages, most critical):
   - Added helper functions:
     - `computeSpeedCategory()` - Classifies exit timing from completed cycles
     - `computeFlowPattern()` - Classifies buy/sell directional bias
     - `deriveStrategyType()` - Canonical filter with holder bypass logic
     - `computeVelocityScore()` - 0-100 logarithmic scale
   - Modified `calculateBehavioralMetrics()`:
     - Now computes `medianActiveHoldingHours` (from current holdings)
     - Now computes `largestActivePositionSol` (for holder bypass)
   - Modified `classifyTradingStyle()`:
     - Populates all new fields (speedCategory, flowPattern, strategyType, velocityScore)
     - **Implements holder bypass**: 3+ tokens held 24h+ OR 50+ SOL position
     - Maintains backward compatibility (tradingStyle, flipperScore still populated)

5. ✅ **Bot Detector** (`src/core/analysis/bot-detector.ts` - 10 usages):
   - Verified compatible (uses flipperScore and tradingStyle, both still exist)
   - No changes required

**Build Status**: ✅ TypeScript compiles without errors

---

**✅ Day 5: MID LAYER (API & Transport)** - COMPLETED 2025-12-25

Guide: `component_impact_map.md` lines 88-101

6. ✅ **Behavior Service** (`src/api/services/behavior.service.ts` - 27 usages):
   - ✅ Deleted broken `extractBehaviorType()` method
   - ✅ Reads speedCategory directly from DB (line 89: `behaviorType = profile.speedCategory || 'HOLDER'`)
   - ✅ All 6 new fields destructured (lines 90-93: speedCategory, flowPattern, strategyType, velocityScore, medianActiveHoldingHours)
   - ✅ All 6 new fields saved to profileDataToSave (lines 130, 145-148)
   - ✅ Added tokensWithOnlyBuys to cache (line 120)

7. ✅ **Discover Service** (`src/api/services/discover.service.ts` - 29 usages):
   - ✅ Replaced CONTAINS with EQUALS (line 100: `strategyType: { equals: normalizedStyle }`)
   - ✅ Maps new fields to DTO response (lines 245-247)

8. ✅ **DTOs** (behavior-response.dto.ts, discover-wallet.dto.ts):
   - ✅ behavior-response.dto.ts: Added 5 new fields with proper TypeScript types (lines 183-192)
   - ✅ discover-wallet.dto.ts: Updated query enum (lines 55-62), added 3 new response fields (lines 118-125)
   - ✅ Imports SpeedCategory, FlowPattern, StrategyType types from behavior.ts

9. ✅ **Controllers** (wallets.controller.ts, analyses.controller.ts):
   - ✅ No changes needed - DTOs map correctly via service layer

**✅ BONUS: Single Source of Truth Consolidation** - COMPLETED 2025-12-25

- ✅ Moved ALL `BEHAVIOR_ANALYSIS_CONFIG` from `config/constants.ts` → `behavior/constants.ts`
- ✅ Deleted duplicate from global config (was 2.5/0.4, now unified at 2.0/0.5)
- ✅ Updated analyzer.ts import: `from '../../../config/constants'` → `from './constants'`
- ✅ Verified: ONLY analyzer.ts imports behavior constants (no orphaned imports)
- ✅ Build verified: TypeScript compiles after consolidation

---

**✅ Day 6: HIGH LAYER (Frontend)** - COMPLETED 2025-12-25

Guide: `component_impact_map.md` lines 105-117

10. ✅ **API Types** (`dashboard/src/types/api.ts` + `dashboard/src/types/discover.ts`):
    - ✅ Added: SpeedCategory, FlowPattern, StrategyType enums (lines 102-138)
    - ✅ Updated: BehaviorAnalysisResponseDto with 5 new optional fields (lines 183-188)
    - ✅ Updated: DiscoverWalletMetrics with speedCategory, flowPattern, strategyType (discover.ts lines 17-19)
    - ✅ Added comprehensive JSDoc comments explaining each enum

11. ✅ **Discover Page** (`dashboard/src/app/discover/page.tsx`):
    - ✅ Replaced styleOptions: Old values (sniper, scalper, flipper, etc.) → NEW StrategyType enum (lines 56-66)
    - ✅ Added 8 enum options: FAST_TRADER, DAY_TRADER, SWING_TRADER, POSITION_TRADER, PURE_HOLDER, ACCUMULATOR, DISTRIBUTOR, BALANCED_TRADER
    - ✅ Added hints for each option (e.g., "Sniper/scalper/momentum" for FAST_TRADER)
    - ✅ Updated presets: hyper-flipper → FAST_TRADER, balanced-fast → SWING_TRADER, patient-holder → PURE_HOLDER (lines 354, 359, 364)
    - ⏸️ Table columns: Showing speedCategory + flowPattern (deferred - can add later if needed)

12. ⏸️ **Baseball Card** (`dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx`):
    - ⏸️ Deferred: Can use new fields later (not critical for Discover page functionality)

**Build Status**: ✅ Frontend compiles successfully (Next.js 15.5.9)
- No TypeScript errors related to new classification fields
- Only minor linting warnings (unused imports)
- Ready for runtime testing

---

**Day 7: Testing & Integration**

13. **Manual testing**:
    - Test Case 1a: 1 buy, 700 SOL position, 45 days → PURE_HOLDER ✓
    - Test Case 1b: 1 buy, 5 SOL position, 2 days → LOW_ACTIVITY ✓
    - Test Case 1c: 5 tokens, no exits, 48h avg → PURE_HOLDER ✓
    - Reference: `classification_scientific_assessment.md` lines 268-301

14. **Discover page validation**:
    - Filter by PURE_HOLDER → shows holders
    - Filter by FAST_TRADER → shows snipers/scalpers
    - No "LOW_ACTIVITY" wallets with significant positions

15. **Ship to discover branch**

---

**Deferred to V2** (post-launch):
- Backfill 10k existing wallets (BullMQ background job)
- Migrate 14 internal scripts (low priority, they're internal tools)
- Add confidence/sample size metrics
- Temporal windows (30d, 90d, all-time classifications)
- BehavioralPatternsTab.tsx updates (33 usages, not needed for discover)

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

**Current Priority**: Fix several issues: 

1. CuPrb8rBk8UBpz8vQ4iDiGivjgKG1VGLc5Lvidx6HMwj - this address shows he lost 100% but onchain I see always at around break-even - investigate
2. fix absurdly large amounts of sol txs - 20k sol, we currently have cap for some reason - important to fix - we skip analysis of super whales. 
3. Mapper is missing plain txs where it's not swap - if it's wallet to wallet. 

**Recent Changes (2025-12-18)**:
- ✅ Fully centralized job event architecture through bridge
- ✅ All 15 direct gateway calls now rely on bridge - only using job.updateProgress(data)
- ✅ No more manual userId extraction in processors

**After WebSocket Verified**:
- Resume `pretty` branch work:
  - Fast exit metric polish (#4) - 30 min
  - Finish tooltips (#1) - 1-2 hours
  - Sanity check/Polishing of every individual page
  - Discover page content (#5) - 2-3 hours
  - Job history page (#6) - now possible with reliable WebSocket
  - Onboarding flow (#7) - 3-4 hours


---

## Notes

- **Performance**: Dev mode unoptimized (expected), production build fast
- **Admin access**: Controlled via `ADMIN_USER_IDS` and `ADMIN_EMAILS` env vars
- **BullMQ Dashboard**: Can install `@bull-board/express` for job queue UI
- **Tremor charts**: Kept unchanged (excellent as-is)
