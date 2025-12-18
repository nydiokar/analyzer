# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `refactor/websocket-user-rooms` (WebSocket architecture refactor)
**Previous Branch**: `pretty` (design system + auth polish)
**Status**: WebSocket refactor complete, tested and working! Next is polishing and design.
**Last Updated**: 2025-12-18

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

### 🔨 Partial (3 tasks - finish these)
1. **Comprehensive Tooltips** – Exit timing/global metrics still need tooltips
2. **Time Unit Disambiguation** – Verify no "35m" (min vs month) ambiguity remains
3. **Holder Classification** – Edge case: better heuristics for holders without exits

### 📋 Ready to Start (5 tasks)
4. **Fast Exit Metric Clarification** – Show median + avg (not redundant), add tooltip
5. **Discover Page Redesign** – Add featured wallets, tool showcase (layout exists)
6. **Job History Page** – Timeline with re-run capability, hyperlinks to results
7. **Onboarding Flow** – Post-registration checklist (verify email → explore tools)

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
2. **Job polling admin error** - Fixed: GET `/jobs/:jobId` now accessible to all users.
3. **WebSocket race condition** - ✅ **FIXED** in refactor/websocket-user-rooms branch.

---

## Next Session Quick Start

**Current Priority**: Test WebSocket refactor + centralized architecture (see testing section above)

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
