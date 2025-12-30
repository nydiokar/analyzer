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

#### Task 3: Speed/Flow Analytics in Discover 📈
**Goal**: Add analytics sidebar to Discover page (like Tracked Wallets overview)
**Location**: `dashboard/src/app/discover/page.tsx`
**Features**:
- Overview card showing distribution of wallets by Speed Category (completed)
- Overview card showing distribution by Flow Pattern (completed)
- Velocity filter slider (0-100) with backend filtering (completed)
- Visual legend for speed/flow ranges (completed)
**Data**: Available from discover API response
**Priority**: Medium - Fills empty space, useful context
**Status**: Complete

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
