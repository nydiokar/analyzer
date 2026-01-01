# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover`
**Status**: Ready for parallel development 🚀
**Last Updated**: 2025-12-30

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

#### Task 4: ROI Calculation Fix 🐛
**Problem**: ROI showing -300% when it should be ~0% because fees/taxes are almost equal to buy amount (e.g., 0.001 SOL bought, 0.002 SOL fees)
**Location**:
- Backend: `src/core/services/pnl-analysis-service.ts`
- Backend: `src/api/services/token-performance.service.ts`
- Frontend: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
**Solution**:
- Adjust ROI formula to handle edge case where `totalSolSpent ≈ 0`
- Option A: Show "N/A" or "—" when spent amount < threshold (e.g., 0.01 SOL)
- Option B: Calculate ROI excluding fees: `(received - spent) / (spent - fees) * 100`
- Add validation: if `spent < fees * 0.5`, mark as dust trade
**Priority**: High - Data accuracy bug

#### Task 5: Time Filter Detachment 🔧
**Problem**: Token Performance tab shows NO tokens when wallet has no transactions in filtered time period, even though wallet holds tokens
**Location**:
- Backend: `src/api/services/token-performance.service.ts`
- Frontend: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
**Solution**:
- Decouple token list from transaction history filter
- Always show current holdings
- Apply time filter only to PnL calculations and transaction counts
- Show: "Holding 5 tokens (2 traded in last 30d, 3 held only)"
**Priority**: High - UX bug, confusing behavior

#### Task 6: Infinite Scroll Pagination ♾️
**Goal**: Replace horizontal pagination (1, 2, 3...) with vertical infinite scroll
**Location**: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
**Implementation**:
- Load initial 20 tokens
- On scroll to bottom, load next 20
- Show loading indicator at bottom
- Keep existing filters/sorting
**Library**: `react-intersection-observer` or `react-infinite-scroll-component`
**Priority**: Medium - Better UX for large token lists

**Tech Stack**: NestJS backend, Prisma ORM, React frontend

---

## Branch Strategy

### Workflow:
1. **LLM 1** works on `discover-analytics-ux` (tasks 1, 2, 3)
2. **LLM 2** works on `discover-token-performance` (tasks 4, 5, 6)
3. Both branches based on `discover` (current state)
4. When done, merge both back into `discover`
5. Resolve any conflicts (should be minimal)
6. Then `discover` → `main` for deployment

### Why This Split:
- **Minimal overlap**: Different pages/components
- **Independent work**: No blocking dependencies
- **Low conflict risk**: Tasks 4-5-6 touch same area but sequential

---

## Deployment Notes

### Backend Changes Required (When Merging to Main):
- 3 Database migrations (classification fields, storytelling metrics)
- New API endpoints (discover.controller.ts, discover.service.ts)
- Updated services (user-favorites, behavior, token-performance)

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
