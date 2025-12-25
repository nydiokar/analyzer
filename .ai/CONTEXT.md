# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover` (design system + auth polish) ✅ SHIPPED 
**Status**: Classification system refactor sprint (MVP scope: 5-7 days)
**Last Updated**: 2025-12-25

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

**Reference docs**: See `.ai/context/classification/` folder (6 files):
- `classification_target_state.md` - What we're building (the contract)
- `component_impact_map.md` - 35 files to touch, ranked by impact
- `classification_taxonomy_map.md` - Category definitions & thresholds
- `classification_scientific_assessment.md` - Design decisions & edge cases

---

**Day 1-2: LOW LAYER (Data & Schema)** - 6 files, blocking

Guide: `component_impact_map.md` lines 73-85

1. **Schema** (`prisma/schema.prisma`):
   - Add: `speedCategory String?`, `flowPattern String?`, `strategyType String`
   - Add: `tokensWithOnlyBuys Int`, `medianActiveHoldingHours Float?`
   - Add indexes on strategyType, speedCategory
   - Run migration

2. **Types** (`src/types/behavior.ts` - 41 usages):
   - Keep: `HolderBehaviorType` enum (SNIPER...HOLDER) - this is speedCategory
   - Rename: `BehavioralPattern.HOLDER` → `BUY_ONLY` (avoid collision)
   - Add: `FlowPattern` enum, `StrategyType` enum
   - Export all from one place

3. **Constants** (`src/core/analysis/behavior/constants.ts` - 68 usages):
   - Centralize thresholds: SPEED_THRESHOLDS, FLOW_THRESHOLDS, HOLDER_BYPASS
   - Reference: `classification_target_state.md` lines 70-109

---

**Day 3-4: LOW LAYER (Computation)** - 2 files, critical path

Guide: `component_impact_map.md` lines 44-48 + `classification_target_state.md` lines 116-202

4. **Analyzer** (`src/core/analysis/behavior/analyzer.ts` - 88 usages, most critical):
   - Fix line 1552: Add holder bypass (multi-token OR significant position)
   - Compute: `tokensWithOnlyBuys`, `medianActiveHoldingHours`
   - Compute: `speedCategory` (from completed cycles, null if no exits)
   - Compute: `flowPattern` (BUY_ONLY, ACCUMULATOR, etc.)
   - Derive: `strategyType` (algorithm in target_state.md lines 152-202)
   - Return all fields in metrics object

5. **Bot Detector** (`src/core/analysis/bot-detector.ts` - 10 usages):
   - Verify no breaks (uses behaviorType field)
   - May need small update if field renamed

---

**Day 5: MID LAYER (API & Transport)** - 8 files

Guide: `component_impact_map.md` lines 88-101

6. **Behavior Service** (`src/api/services/behavior.service.ts` - 27 usages):
   - **CRITICAL**: Delete broken `extractBehaviorType()` method (lines 143-155)
   - Read speedCategory, flowPattern, strategyType directly from DB
   - Update cache reconstruction logic

7. **Discover Service** (`src/api/services/discover.service.ts` - 29 usages):
   - Replace: `tradingStyle: { contains: ... }` → `strategyType: { equals: ... }`
   - Add enum filters for speedCategory, flowPattern
   - Reference: `classification_scientific_assessment.md` for filter design

8. **DTOs** (behavior-response.dto.ts, discover-wallet.dto.ts):
   - Add fields: speedCategory, flowPattern, strategyType
   - Keep tradingStyleLabel as deprecated (display only)

9. **Controllers** (wallets.controller.ts, analyses.controller.ts):
   - Verify DTOs map correctly
   - No logic changes

---

**Day 6: HIGH LAYER (Frontend)** - 3 files (discover focus only)

Guide: `component_impact_map.md` lines 105-117

10. **API Types** (`dashboard/src/lib/api.ts` - 27 usages):
    - Add frontend types matching backend DTOs
    - Export: SpeedCategory, FlowPattern, StrategyType enums

11. **Discover Page** (`dashboard/src/app/(app)/discover/page.tsx` - 43 usages):
    - Replace filter: Text input → Dropdown with StrategyType enum values
    - Update table: Show speedCategory + flowPattern in separate columns
    - Add tooltips explaining categories

12. **Baseball Card** (`dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx` - 55 usages):
    - Use speedCategory + flowPattern instead of parsing tradingStyle string
    - Fallback already exists (line 326): `profile.behaviorType ?? 'HOLDER'`
    - Minor update to use new fields

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
