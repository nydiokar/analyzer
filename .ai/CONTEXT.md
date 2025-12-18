# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `refactor/websocket-user-rooms` (WebSocket architecture refactor)
**Previous Branch**: `pretty` (design system + auth polish)
**Status**: WebSocket refactor complete, ready for testing
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
8. **WebSocket Refactor** – User-scoped rooms (see `.ai/context/WEBSOCKET_JOB_REFACTOR.md`)

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

## WebSocket Refactor (Branch: refactor/websocket-user-rooms)

### ✅ What Was Completed (2025-12-18)

**Problem Solved:**
- ❌ Race conditions on page load causing missed job events
- ❌ Multiple socket connections from HMR breaking subscriptions
- ❌ Jobs completing but frontend never receiving events
- ❌ Tabs not loading due to incomplete job event handling

**Implementation:**
1. **Phase 1**: Added `userId` to all job data interfaces and controllers ✅
2. **Phase 2**: Gateway auto-joins clients to `user-{userId}` rooms ✅
3. **Phase 3**: All job publishers extract and pass userId ✅
4. **Phase 4**: Frontend passes userId in socket auth handshake ✅
5. **Critical Fix**: Fixed 15 direct gateway calls bypassing the bridge ✅

**Files Modified:**
- `src/queues/jobs/types/index.ts` - Added userId to all job interfaces
- `src/api/controllers/analyses.controller.ts` - Extract userId from req.user
- `src/api/shared/job-progress.gateway.ts` - Room-based broadcasting
- `src/queues/services/job-events-bridge.service.ts` - Pass userId from job.data
- `src/queues/processors/analysis-operations.processor.ts` - 4 direct calls fixed
- `src/queues/processors/enrichment-operations.processor.ts` - 5 direct calls fixed
- `src/queues/processors/similarity-operations.processor.ts` - 6 direct calls fixed
- `dashboard/src/hooks/useJobProgress.ts` - Pass userId in socket auth

**How It Works:**
- Jobs created with `userId` from authenticated requests
- WebSocket gateway routes events to `user-{userId}` rooms
- All tabs receive events automatically via room membership
- Backward compatible: jobs without userId use legacy per-job subscription

### 🧪 Testing Required

**Expected Behavior:**
1. Page loads → WebSocket connects → Joins user room
2. All 3 dashboard jobs complete with proper subscribe/unsubscribe
3. Tabs load correctly with all data
4. Multiple tabs receive same events
5. HMR doesn't break subscriptions

**Console Logs to Verify:**
```
Backend:
  Client {id} connected and joined room: user-{userId}
  📡 Room broadcast: job-completed → user-{userId} (job: xxx)

Frontend:
  ✅ WebSocket connected
  🔔 Subscribing to job: dashboard-xxxxx
  🔕 Unsubscribing from job: dashboard-xxxxx
```

### ⚠️ CRITICAL: Architecture Not Yet Fully Centralized

**Problem Discovered After Implementation:**

Despite fixing all 15 direct gateway calls to include userId, the architecture is NOT truly centralized. We're extracting userId in 15+ places instead of once.

**Current Architecture (TWO PATHS):**

1. **Path A - Simple Progress** (CENTRALIZED ✅):
   - Processors call `job.updateProgress(data)`
   - BullMQ emits event → Bridge listens
   - Bridge extracts `userId` from `job.data` ONCE
   - Bridge calls gateway with userId

2. **Path B - Rich Progress** (DECENTRALIZED ❌):
   - Processors call `gateway.publishProgressEvent(jobId, queue, customData, undefined, userId)`
   - Each of 15 call sites extracts userId manually: `const userId = job.data.userId`
   - Direct to gateway, bypassing bridge entirely

**Why This Is a Problem:**
- Adding new jobs requires manual userId extraction in every processor
- Inconsistent patterns (some through bridge, some direct)
- Maintenance burden - easy to forget userId on new calls
- Not DRY - violates "extract once" principle


Definitive solution: BullMQ handles progress - bridge picks it up automatically no need for adding second path of job progress in the processor and mixing it with the business logic. 

### 🧹 Cleanup After Verification

Once verified working, remove backward compatibility code:

1. **Gateway (job-progress.gateway.ts)**:
   - Remove legacy per-job subscription loop in `broadcastToSubscribers` (lines 239-246)
   - Remove `subscribe-to-job` / `unsubscribe-from-job` handlers (lines 249-269)
   - Remove `clientSubscriptions.jobIds` tracking (keep only userId)
   - Remove `pruneJobSubscriptions` method (no longer needed)

2. **Frontend (useJobProgress.ts)**:
   - Simplify `subscribeToJob` - no need to emit 'subscribe-to-job'
   - Remove HTTP polling fallback (or keep for non-authenticated users)

3. **Types**:
   - Update `ClientSubscription` interface to remove `jobIds: Set<string>`

**Branch Strategy:**
- Test thoroughly on `refactor/websocket-user-rooms`
- When verified: merge to `main` first (production fix)
- Then merge `main` → `pretty` to continue design work

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
- Merge refactor/websocket-user-rooms → main → pretty
- Clean up backward compatibility code (see cleanup section)
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
