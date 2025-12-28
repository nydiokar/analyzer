# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `discover`
**Status**: Ready for merge to main ✅
**Last Updated**: 2025-12-28

---

## What's Working

### ✅ Core Features
- **Authentication**: JWT + API keys, email verification, password reset
- **Wallet Analysis**: PnL tracking, behavioral patterns, holder profiles
- **Classification System**: 3-tier wallet categorization (speedCategory, flowPattern, strategyType)
- **Discover Page**: Enhanced storytelling with separate Speed/Flow filters, all metrics integrated
- **Job Queues**: BullMQ + Redis with WebSocket progress updates
- **Caching**: Two-tier (Redis + PostgreSQL) for holder profiles

### ✅ Recent Fixes (Dec 28)
- **Merge from main**: Integrated Prometheus, Sentry, Redis updates
- **Removed unrealistic value cap**: 10k SOL filter removed - whale holdings now display properly
- **Stablecoin exclusion**: USDC, USDT, wrapped tokens excluded from PnL display
- **Scam filter consolidation**: Now uses `BEHAVIOR_ANALYSIS_CONFIG` constant as default (config can override)
- **Database connection fix**: Fixed statement_timeout query parameter bug from main merge

### 📋 Architecture Decisions
See `documentation/01. ARCHITECTURE_DECISIONS.md` for all major decisions
- Classification system details archived in `docs/archive_plans/classification-refactor-2025-12/`

---

## Current Priority Tasks

### 1. **Tracked Wallets Page Redesign** 🎯 NEXT
**Goal**: Make favorites/tracked wallets page pretty and useful

**Current State**:
- Basic CRUD functionality works
- Collections system exists
- Needs better UX and visual design

**Todo**:
- [ ] Improve layout and visual hierarchy
- [ ] Add quick stats/metrics for each tracked wallet
- [ ] Better collection management UI
- [ ] Add wallet comparison features
- [ ] Bulk operations (add multiple, export, etc.)

---

### 2. **Job History Page** 🎯 UPCOMING
**Goal**: Timeline with re-run capability, hyperlinks to results

**Current State**:
- Job system works (BullMQ + WebSocket)
- No dedicated history/timeline UI

**Todo**:
- [ ] Create job history timeline view
- [ ] Add filters (date range, job type, status)
- [ ] Re-run button for failed/completed jobs
- [ ] Link job results to wallet/analysis pages
- [ ] Show progress for running jobs

---

## Blocked/On Hold

**Waiting on partner discussion**:
1. Comprehensive tooltips for exit timing/global metrics (need content)
2. Holder classification edge cases (need logic clarification)

---

## Known Issues (Not Blocking)

1. Wallet PnL mismatch edge case: CuPrb8rBk8UBpz8vQ4iDiGivjgKG1VGLc5Lvidx6HMwj shows 100% loss but onchain is break-even
2. Mapper missing wallet-to-wallet transfers (non-swap transactions) - intentionally deferred

---

## Architecture Stack

### Frontend
- Next.js 14 (App Router)
- shadcn/ui + Tailwind CSS
- Tremor charts
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
- Archive: `docs/archive_plans/`

---

## Quick Start Next Session

**Current branch**: `discover` (merged with main, ready to merge to main)

**Next steps**:
1. Merge `discover` → `main` (when ready)
2. Start **Tracked Wallets Page** redesign
3. Then **Job History Page**

**Commands**:
```bash
# Development
npm run dev              # Start backend
cd dashboard && npm run dev  # Start frontend

# Production
npm run build
pm2 restart sova-backend-api
```

---

**Notes**:
- Admin access: `ADMIN_USER_IDS` and `ADMIN_EMAILS` env vars
- Dev mode is unoptimized (expected), production is fast
- Classification system details in architecture docs
