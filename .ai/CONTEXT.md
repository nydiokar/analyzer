# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `pretty` (design system + auth polish)
**Status**: TokenBadge refactor complete. UI polish and tooltips added.
**Last Updated**: 2025-12-20

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

### 📋 Ready to Start (6 tasks)
4. **Fast Exit Metric Clarification** – Show median + avg (not redundant), add tooltip
5. **Discover Page Redesign** – Add featured wallets, tool showcase (layout exists)
6. **Job History Page** – Timeline with re-run capability, hyperlinks to results
7. **Onboarding Flow** – Post-registration checklist (verify email → explore tools)
8. **Enhanced WalletBadge Component** – Create reusable wallet badge (mirror TokenBadge pattern):
   - Inline variant (2-row compact) for tables
   - Card variant for profile pages
   - Show: address (clickable/copyable), trades (buy↑/sell↓), PnL (labeled as realized/unrealized), win rate, last active
   - Action icons inline (copy address by clicking it, solscan link, profile link)
   - Replaces current simple WalletBadge + frees up table columns (Recency, separate Trades/PnL/Win columns)
   - See: `dashboard/src/components/shared/TokenBadge.tsx` as reference pattern
   - Design doc: `.ai/context/wallet_badge_and_categorization_refactor.md`
9. **Categorization System Analysis** (research task) – Investigate and document current categorization chaos:
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
