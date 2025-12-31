# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover-token-performance` (currently working on P0 issue)
**Status**: 🔴 **P0 BLOCKER - P&L Contamination Discovered**
**Last Updated**: 2025-12-30

---

## 🔴 P0 CRITICAL ISSUE - BLOCKS ALL OTHER WORK

### P&L Calculations Are Fundamentally Broken

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

**Status**: User plans to work on this as top priority. All other feature work is BLOCKED until this is fixed.

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
- Add loading skeletons to Discover/Trackers pages
- Standardize error message formats across app
- Improve empty states (no data scenarios)
- Better tooltips and help text
- **Files**: Various components across dashboard
- **Priority**: High - Quality of life improvements

#### Task 2: Collection-Based Analytics 📊
**Goal**: Show which collections perform best in Tracked Wallets page
**Location**: `dashboard/src/app/trackers/page.tsx` sidebar
**Features**:
- Pie chart or bar chart showing collection distribution
- Performance metrics per collection (avg PnL, avg balance, wallet count)
- Click collection to filter main table
- Visual breakdown: "Portfolio: 5 wallets, 45 SOL PnL"
**Data**: Already available in `favoriteWallets` - aggregate by collections
**Priority**: Medium - New feature, high value

#### Task 3: Speed/Flow Analytics in Discover 📈
**Goal**: Add analytics sidebar to Discover page (like Tracked Wallets overview)
**Location**: `dashboard/src/app/discover/page.tsx`
**Features**:
- Overview card showing distribution of wallets by Speed Category
- Overview card showing distribution by Flow Pattern
- Visual breakdown with colored badges
- Shows filtered vs total counts
**Data**: Available from discover API response
**Priority**: Medium - Fills empty space, useful context

#### Task 4: Exit Timing Drilldown Redesign 🎭
**Goal**: Redesign the drilldown panel and hold metrics structure in wallet profiles
**Problem**: Panel that opens when clicking exit timing buckets is "complete garbage" - unintuitive, cramped, no sorting. Hold metrics (median/avg/holding) are confusing mesh.
**Location**:
- `dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx`
- `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx`
**Challenge**: Design a way to review tokens from time buckets that feels professional, plus clarify hold metrics structure
**Priority**: High - User pain point, "thorn in eye"

**Tech Stack**: React, Recharts/Tremor for charts, existing UI components

---

### 🎯 Branch 2: `discover-token-performance` (LLM 2)
**Focus**: Token Performance Fixes & Enhancements
**Status**: ⚠️ **PAUSED** - Discovered P0 blocker during work

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
