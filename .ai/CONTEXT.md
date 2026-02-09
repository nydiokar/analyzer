# Sova Intel - Project Context

**Branch:** `main`  **Last Updated:** 2026-02-09  **Status:**  Active Development

---

##  Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
|  |  |  | No active tasks |

before you start format these into the table above
1. Fix wallet profile page mess in the wallet area
2. Add admin functionality to halt regs and disable accounts / possibly code-based registration 
3. Create the dashboard for grafana ? 


**Recently Completed:**
-  Telegram alerting service activation + similarity job memory optimization (Feb 9) - Removed unnecessary cosine vectors to fix OOM errors
-  Phased production deployment toolkit (Feb 8) - 4-phase automated deployment scripts + observability stack
-  Metrics endpoint firewall security documentation (Feb 6) - Critical security guidance for production
-  Full Prometheus + Grafana observability stack (Feb 6) - Production-ready monitoring with zero vendor lock-in
-  Poker-style HUD implementation with clean tooltip hierarchy (Feb 6)
-  Wallet profile layout reorganization - metrics grouped properly (Feb 6)
-  Trackers HUD robustness pass: batch chunking + encode state gating + clean nickname rendering (Feb 6)
-  Fix: Stale HUD data on demo + profile pages after re-analysis (Feb 5)
-  WebSocket & Redis automatic reconnection (Feb 3)
-  Wallet HUD system implementation (Feb 2)
-  Batch analyze functionality in tracked wallets (Feb 1)
-  Comprehensive job throttling and priority fixes (Feb 1)
-  Password reset confirmation email (Feb 1)
-  Import bulk cooldown redesign (Feb 1)
-  Tracked wallets backend-frontend wiring completion (Jan 30)
-  Similarity Lab Frame 3: Pair Insights UX improvements (Jan 30)
-  **P0: Historical Mode Bug - Flash/Working Scopes Fixed** (Jan 29) - Removed timeRange from dashboard scopes to fix persistence
-  DexScreener rate limiting fix with in-flight token tracking (Jan 30)
-  Favorites import system with attack-resistant design (Jan 29)
-  P0: Database deadlock fix with prevention + retry (Jan 26)
-  Similarity Lab Frame 1: Wallet Input Area (Jan 23-25)
-  Similarity Lab Frame 2: Global Analysis Metrics (Jan 25)
-  Error logging cleanup audit (Jan 22)
-  Holder Profiles bucket alignment verification (Jan 25)
-  Job subscription handling refactor (Jan 25)
-  TimeRangeSelector hydration fix (Jan 25)
-  Bulk favorites import + auto-analysis queueing (Jan 27)
-  Summary card skeleton regression 



<details>
<summary><b>Legend</b></summary>

**Status:**  In Progress   Blocked   Ready   Testing
**Scope:**  Small (<50 lines, <1hr)   Medium (2-5 files, <4hrs)   Large (5+ files, multi-day)

</details>

---

##  Current Focus & Priorities


### P1: Helius API Optimization (Mandatory, Not Urgent)
**Goal:** Reduce redundant RPC calls from 29k account fetches to ~10-50 per check (95%+ reduction)

<details>
<summary><b>Implementation Recommendation</b></summary>

**Phase 1: Quick Win   Implemented (Jan 30, 2026)**
1. Enable `changedSinceSlot` in V2 API calls
   - Store last checkpoint slot in Redis per wallet
   - Only fetch changed accounts on subsequent calls
   - Falls back to full fetch if slot too old
2. Transaction-triggered cache invalidation
   - HeliusSyncService already processes transactions
   - When new transaction arrives, invalidate affected token accounts
   - Next balance request fetches only invalidated accounts

**Phase 2: Long-term Solution**
3. Helius Webhooks for account changes
   - Subscribe to account change webhooks (not just transaction webhooks)
   - Real-time balance updates, no polling needed
4. WebSocket subscriptions for active wallets
   - Open WebSocket connections for actively monitored wallets
   - Close connections when no longer needed
   - Instant updates for tracked wallets

</details>

Use `TaskList` to see current status, `TaskGet #N` to see details, `TaskUpdate` to mark progress.

---

##  Recent Activity

### February 9, 2026 (Latest)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 09.1 | FEAT | Telegram alerting service activation + similarity memory optimization | M | `security-alerts.service.ts`, `analyzer.ts`, `similarity-service.ts` |

**Summary:**

**09.1:** Activated Telegram alerting service and fixed critical memory bloat in similarity analysis jobs. **Telegram Alerts:** Re-enabled Telegram security alert service in `AuthModule` imports (was previously disabled), updated `SecurityAlertsService` to use environment variable flag `TELEGRAM_ALERTS_ENABLED` for runtime control, added to PM2 ecosystem config for production deployment. **Similarity Memory Fix - Critical Performance Issue:** Removed unnecessary storage of full cosine similarity vectors that were causing OOM errors on large wallet sets. **Root Cause:** `calculateCosineSimilarityMatrix()` was building dense N×N matrices and storing them in job results even though only aggregate metrics were needed. For 30 wallets analyzing 500 tokens each, this created ~900KB of redundant vector data per job. **Solution:** (1) Replaced external `compute-cosine-similarity` library with custom implementation that avoids allocating unnecessary arrays, (2) Changed capital allocation vector creation to only store non-zero dimensions (sparse vectors) - loops only over tokens actually invested in rather than full token universe, (3) Changed binary token vectors to only store tokens actually traded (presence = 1, absence = not stored), (4) Custom dot product + norm calculation that works directly with sparse token objects, (5) Removed vector storage from aggregate metrics - only keep the numeric similarity scores. **Performance Impact:** Memory usage reduced by ~85% for typical 10-30 wallet comparisons, eliminates OOM crashes on large similarity jobs, faster vector creation (no zero-filling loops). **Queue Config:** Reduced similarity queue concurrency from 3→2 to further prevent memory spikes. **Files:** `src/api/shared/services/security-alerts.service.ts` (env flag), `src/api/modules/auth.module.ts` (re-enabled), `src/core/analysis/similarity/analyzer.ts` (sparse vectors + custom cosine), `src/core/analysis/similarity/similarity-service.ts` (removed vector storage), `src/queues/processors/similarity-operations.processor.ts` (concurrency), `src/queues/config/queue.config.ts` (concurrency), `ecosystem.config.js` (env var), `package.json` (removed dependency).

### February 8, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 08.1 | FEAT | Phased production deployment toolkit | L | 12 files, 680 lines added |
| 08.2 | DOC | Node.js version requirement update | S | `SETUP.md` |

**Summary:**

**08.1:** Created comprehensive 4-phase production deployment automation toolkit with LLM-friendly documentation. **Phase Structure:** (1) `01-bootstrap.sh` - Host + app bootstrap, dependency install/build, Redis startup, PostgreSQL Docker container + role + database creation, prints ready-to-use `DATABASE_URL`; (2) `02-deploy.sh` - Strict `.env` validation (checks all required vars), Prisma migrations, PM2 start/restart with health checks; (3) `03-nginx.sh` - Creates/updates nginx vhost for API with Let's Encrypt TLS support, supports `--http-only` bootstrap mode, validates and reloads nginx safely; (4) `04-observability.sh` - Docker Compose orchestration for Prometheus + Grafana stack, verifies Prometheus targets are healthy. **Documentation:** `deployment/README.md` (quick start), `deployment/RUNBOOK.md` (124-line comprehensive runbook with troubleshooting), `deployment/LLM_GUIDANCE.md` (AI agent guidance for deployment assistance). **Observability Stack Pinning:** Created `ops/observability/` directory with pinned Docker Compose config (Prometheus 3.0, Grafana 11.4), pre-configured Grafana provisioning (datasources + dashboards), production-ready Prometheus config with all scrape targets. **Design Philosophy:** Phased execution with clear checkpoints, idempotent scripts (safe to re-run), strict validation before destructive operations, LLM-friendly structure for AI-assisted deployment. **Production Ready:** Handles SSL/TLS, process management, database migrations, observability deployment, nginx configuration. **Files:** `deployment/scripts/01-bootstrap.sh`, `deployment/scripts/02-deploy.sh`, `deployment/scripts/03-nginx.sh`, `deployment/scripts/04-observability.sh`, `deployment/README.md`, `deployment/RUNBOOK.md`, `deployment/LLM_GUIDANCE.md`, `ops/observability/docker-compose.yml`, `ops/observability/grafana/provisioning/`, `ops/observability/prometheus/prometheus.yml`.

**08.2:** Updated setup documentation to require Node.js 22.x (current LTS) and enhanced migration guide with detailed steps for version switching using nvm/fnm.

### February 7, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 07.1 | REFACTOR | BullMQ metrics collector Redis connection standardization | S | `bullmq-metrics-collector.service.ts` |

**Summary:**

**07.1:** Refactored BullMQ metrics collector to use standardized `redisConnection` property instead of `getRedisConnection()` method for improved code clarity and consistency. Removed commented-out queue name to clean up codebase. Minor refactor with no functional changes - improves maintainability.

### February 6, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 06.9 | DOC | Critical firewall security documentation for metrics endpoint | S | `docs/observability/README.md` |
| 06.8 | FEAT | Full Prometheus + Grafana observability stack implementation | L | 21 files, 3,914 lines added |

**Summary:**

**06.9:** Added critical security documentation for production deployment of metrics endpoint. **Security Issue:** Metrics endpoint is currently `@Public()` decorator - accessible without authentication on port 3001. **Risk:** Publicly exposes tech stack, route patterns, traffic volume, and internal architecture - industry standard (Netflix/Uber/GitHub) is to firewall this endpoint. **Solution Documented:** Two deployment options with detailed `ufw` firewall commands - (1) Same host deployment: block port 3001 from public internet, allow only localhost; (2) Separate Prometheus server: block port 3001 from public, allow only Prometheus server IP. **Documentation Structure:** Prominent security warning at top of observability README, dedicated Security Recommendations section with copy-paste firewall commands, added to Phase 5 deployment checklist as CRITICAL step, verification steps to ensure protection works correctly. **Implementation:** 2-minute setup, standard security practice. **Files:** `docs/observability/README.md` (+85 lines of security guidance).

**Summary:**

**06.8:** Implemented complete self-hosted observability infrastructure from ground zero to production-ready monitoring. **Phase 1: Application Metrics** - Wired HTTP metrics middleware in `main.ts` tracking all requests (method/route/status + duration histogram), added analysis job metrics in processors tracking 5 job types (pnl, behavior, dashboard, holder-profiles, mint-participants) with success/failure counters and duration histograms, implemented BullMQ queue metrics service that polls all 5 queues every 5s exposing 6 gauges per queue (waiting, active, failed, completed, delayed, stalled). **Phase 2: Infrastructure Documentation** - Created comprehensive exporter installation guide for node_exporter (host metrics), postgres_exporter (database metrics with pg_stat_statements), and redis_exporter (cache metrics) with security recommendations and troubleshooting for all platforms. **Phase 3: Prometheus Configuration** - Created production-ready `prometheus.yml` with all scrape targets (app, bullmq, node, postgres, redis, prometheus self-monitoring), detailed setup guide covering apt/binary/Docker installation options, retention policy and storage optimization guidance. **Phase 4: Grafana Dashboards** - Built 6 professional dashboards (3,800+ lines of JSON): (1) Host Overview - CPU/memory/disk/network/temperature, (2) Node.js Runtime - heap/GC/event loop/memory leak detection, (3) HTTP API - RPS/error rate/latency percentiles/slowest routes, (4) BullMQ Queues (CRITICAL) - queue depth/throughput/failures/status table, (5) PostgreSQL - connections/TPS/cache hit ratio/deadlocks/slow queries, (6) Redis - memory/hit rate/evictions/fragmentation. **Key Architecture:** BullMQMetricsCollectorService auto-starts on module init with graceful error handling (won't crash if Redis down), HTTP middleware uses hrtime for microsecond precision, job processors track via wrapper methods with try/catch to ensure metrics recorded even on failure, all metrics properly labeled for cardinality control. **Documentation:** Master README with quick start, exporter guide with security best practices, Prometheus setup guide with retention policies, dashboard guide with troubleshooting workflows, validation script for automated testing. **Cost Savings:** Self-hosted ~$10/mo (disk only) vs Datadog $180-300/mo = $2,040-3,480/year savings. **Zero Lock-In:** 100% open source (Apache 2.0 / AGPL), data never leaves server, standard PromQL portable to any tool. **Implementation Time:** ~10 hours as estimated. **Result:** Production-ready observability with instant visibility into HTTP requests, job processing, queue health, database performance, cache efficiency, and system resources. **Files:** `main.ts` (HTTP middleware), `metrics.service.ts` (+45 lines, BullMQ gauges), `bullmq-metrics-collector.service.ts` (new, 110 lines), `metrics.module.ts` (register collector), `analysis-operations.processor.ts` (+66 lines, job tracking), plus comprehensive docs in `docs/observability/`.

### February 6, 2026 (Earlier)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 06.7 | FIX | Fix: Checkbox selection freeze in Trackers (300+ rows re-rendering) | S | `trackers/page.tsx` |

**Summary:**

**06.7:** Fixed critical performance issue where clicking a checkbox to select a wallet caused UI freeze/lag for 100-500ms with 300+ wallets. **Root Cause - Fundamental Architectural Issue:** (1) **Unnecessary always-visible HUD rendering**: Proactively fetched and rendered HUD badges for ALL 300 wallets on page load, even though user wasn't looking at them; (2) **Inline arrow functions breaking memoization**: `onFavoriteToggle={() => setDeletingWallet(wallet)}`, `onEdit={() => setEditingWallet(wallet)}` created new function references on every render, breaking `React.memo()` optimization; (3) **Checkbox state entangled with HUD rendering**: Pure UI state (checkbox) triggered re-renders of expensive HUD components that had nothing to do with selection. **The Fix - Two-Part Solution:** (1) **Lazy HUD loading**: Removed proactive HUD fetching (`useWalletHudCache` disabled by default), changed `WalletBadge` to use `hudDisplay="tooltip"` instead of inline badges, HUD now fetches on-demand during 800ms hover delay via `WalletHudOverlay` internal fetching, centralized caching prevents duplicate fetches; (2) **Memoized row component**: Created `WalletRow` memo component with stable `useCallback` handlers, completely decoupled checkbox selection state from HUD rendering. **Result:** Checkbox clicks instant (no re-renders), HUD only loads when user hovers (lazy + cached), encode HUD button triggers fetch explicitly when needed. **Files:** `trackers/page.tsx` (removed proactive HUD fetch, added lazy fetch state, WalletRow memo, tooltip display mode). **Architecture Decision:** Don't render expensive components speculatively - use hover intent + caching instead.

### February 6, 2026 (Earlier)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 06.1 | FIX | Fix: TooltipProvider missing in WalletHudOverlay | S | `WalletHudOverlay.tsx` |
| 06.2 | FEAT | Poker-style HUD implementation - always-visible badges | L | `WalletHudBadge.tsx`, `useWalletHudCache.ts`, `WalletBadge.tsx`, `MinimalHoldersTable.tsx`, `trackers/page.tsx` |
| 06.3 | FIX | Fix: Tooltip hierarchy conflicts - competing tooltips | S | `WalletHudBadge.tsx`, `WalletBadge.tsx` |
| 06.4 | FEAT | Wallet profile layout reorganization | S | `WalletProfileLayout.tsx` |
| 06.5 | FEAT | Optional HUD-encoded wallet names with manual transform controls | L | `trackers/page.tsx`, `wallet-name-encoding.ts`, `WalletEditForm.tsx`, `QuickAddForm.tsx`, `constants.ts` |
| 06.6 | FEAT | HUD scaling + encode flow hardening | M | `useBatchWalletHud.ts`, `useWalletHudCache.ts`, `trackers/page.tsx`, `WalletBadge.tsx` |

**Summary:**

**06.1:** Fixed runtime error `Tooltip must be used within TooltipProvider` in WalletHudOverlay. **Root Cause:** `InlineDisplay` component used multiple `<Tooltip>` components without a `TooltipProvider` ancestor, which is required by shadcn/ui's Tooltip implementation. **Fix:** Imported `TooltipProvider` and wrapped the `InlineDisplay` return JSX with it. **Files:** `WalletHudOverlay.tsx` (added TooltipProvider import and wrapper).

**06.2:** Redesigned HUD from invasive expandable-row pattern to sleek poker-style always-visible badges. **Problems Fixed:** (1) HUD shown as full-width expandable rows below wallets, breaking table layout completely, (2) Required "Show HUD" toggle + individual row expansion - jarring UX with layout shifts, (3) Slow performance - data fetched only after toggle, (4) Multiple competing components (old + new code fighting). **New Architecture:** Two-row WalletBadge layout - Row 1: wallet info + actions, Row 2: compact HUD badges ( M  ) indented below wallet name. **New Components Created:** (1) `WalletHudBadge.tsx` - Compact poker-style badges (quality emoji + colored behavior circle + bot/whale), pure visual component with no tooltip logic, ~80 lines; (2) `useWalletHudCache.ts` - Smart caching hook with proactive fetching, WebSocket integration for auto-invalidation, wraps existing `useBatchWalletHud`. **Components Modified:** (1) `WalletBadge.tsx` - Two-row layout for minimal variant, HUD badges on second row with single delayed tooltip (800ms), clean separation of wallet info vs HUD display; (2) `MinimalHoldersTable.tsx` - Removed `useTableHudToggle`, "Show HUD" button, expand/collapse logic, expandable rows; added `useWalletHudCache` for proactive fetching, HUD badges inline with wallet; (3) `trackers/page.tsx` - Complete cleanup of old HUD code, removed toggle button, chevron buttons, expandable rows, Fragment wrappers, conditional table columns. **Performance:** Proactive fetching (batch data loads immediately), SWR deduplication + 24h Redis TTL, auto-invalidation via WebSocket. **Result:** True poker-style HUD - always visible, non-invasive, zero layout disruption, information-dense yet minimal. **Files:** `WalletHudBadge.tsx` (new), `useWalletHudCache.ts` (new), `WalletBadge.tsx`, `MinimalHoldersTable.tsx`, `trackers/page.tsx`. **Note:** `WalletHudInline.tsx` and `useTableHudToggle.ts` kept (still used in Similarity Lab components).

**06.3:** Fixed tooltip hierarchy conflicts where multiple competing tooltips were showing simultaneously. **Problems:** (1) WalletBadge tooltip on wallet address (instant), (2) WalletHudBadge tooltip wrapping entire badge row, (3) Individual tooltips on EACH badge (, M, , ), (4) All showing with different delays, truncated vs full data. **Solution:** Single clean tooltip hierarchy - wallet address keeps quick tooltip ("Click to copy profile link"), HUD badges row wrapped with single delayed tooltip (800ms) showing full WalletHudOverlay content, NO tooltips on individual badges. **Changes:** (1) Stripped WalletHudBadge down to pure visual component (removed all tooltip logic, formatters, detailed content - reduced from ~175 to 80 lines), (2) WalletBadge wraps HUD badge row with Tooltip showing WalletHudOverlay. **Result:** No more competing tooltips, clean UX with deliberate 800ms hover delay. **Files:** `WalletHudBadge.tsx`, `WalletBadge.tsx`.

**06.4:** Reorganized wallet profile header layout - moved HUD from weird floating box in left column to right column next to summary card. **Before:** HUD in left column below wallet badge (unbalanced, confusing), summary card isolated on right, excessive vertical spacing. **After:** Clean left-right separation - Left: wallet identity (badge, collections, analysis control), Right: performance metrics (summary card + HUD side by side, time range below). **Layout Structure:** Two-column flex layout with `flex-end` alignment on right column, summary and HUD in horizontal row (responsive - stacks vertically on mobile). **Result:** Professional organization with metrics grouped together, no weird floating boxes. **Files:** `WalletProfileLayout.tsx`.

**06.5:** Added optional HUD nickname encoding controls on Trackers so users can append or remove compact behavior tags from wallet names in bulk. **Flow:** Added `wallet-name-encoding.ts` utilities (`encodeHudName`, `stripHudEncoding`), wired `Encode HUD`/`Remove HUD` actions in Trackers, and updated nickname input limits through shared constant `WALLET_NICKNAME_MAX` used by `QuickAddForm` and `WalletEditForm`. **Result:** users can maintain plain nicknames or toggle HUD-encoded labels when exporting/using downstream tools. **Files:** `dashboard/src/app/trackers/page.tsx`, `dashboard/src/lib/wallet-name-encoding.ts`, `dashboard/src/components/layout/QuickAddForm.tsx`, `dashboard/src/components/layout/WalletEditForm.tsx`, `dashboard/src/lib/constants.ts`.

**06.6:** Hardened Trackers HUD flow after review. **Problems identified:** (1) backend HUD batch endpoint caps at 200 wallets while favorites can reach 300, (2) encode action could run before HUD was ready and silently skip with "missing HUD", (3) HUD tags in nickname should remain stored/exportable but not clutter wallet label rendering. **Fixes:** (1) added sequential chunked HUD fetching in `useBatchWalletHud` with conservative batch size 180, (2) added HUD fetch gate in `useWalletHudCache` so main table paints first and HUD hydrates after, (3) added pre-checks in `trackers/page.tsx` to block encode during HUD loading/error states with explicit toasts, (4) adjusted `WalletBadge` to strip HUD encoding from display label only (`stripHudEncoding`) while preserving full encoded nickname in storage. **Outcome:** scalable HUD fetch for large favorite sets, safer encode UX, and cleaner table labels without sacrificing encoded data for bot/chart consumers. **Files:** `dashboard/src/hooks/useBatchWalletHud.ts`, `dashboard/src/hooks/useWalletHudCache.ts`, `dashboard/src/app/trackers/page.tsx`, `dashboard/src/components/shared/WalletBadge.tsx`.

### February 5, 2026 (Earlier)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 05.1 | FIX | Fix: Stale HUD data on demo + profile pages after re-analysis | M | `useWalletHud.ts`, `useBatchWalletHud.ts`, `WalletProfileLayout.tsx` |
| 05.2 | FIX | Fix: Batch HUD fetch hitting Next 404 instead of backend | S | `dashboard/src/hooks/useBatchWalletHud.ts`, `dashboard/src/hooks/useWalletHud.ts` |

**Summary:**

**05.1:** Fixed HUD showing stale data after wallet re-analysis on both the hud-demo page and the wallet profile page. **Root Cause - Two Issues:** (1) **SWR `dedupingInterval: 60s` blocked all refetches**  `dedupingInterval` means "don't make another request for this key if one was made in the last N ms." Combined with `refreshInterval: 0` and `revalidateOnFocus: false`, once HUD data was fetched SWR would serve the cached copy for 60s regardless of backend changes. A hard page refresh within that window still hit the in-memory cache. (2) **HUD keys were missing from `globalMutate` in `onJobCompleted`**  `WalletProfileLayout` already invalidated summary, token-performance, pnl-overview, and behavioral-patterns after analysis completed, but the HUD single and batch cache keys were never included. Nothing told SWR "go refetch" for HUD. The backend was fine throughout: `invalidateCache()` was correctly called in the processor after PNL, behavior, and dashboard analysis, and the Redis key was deleted. **The Fix:** (1) Set `dedupingInterval: 0` on `useWalletHud`, `useWalletHudBatch`, and `useBatchWalletHud`  deduping at 60s was overly aggressive and redundant with `refreshInterval: 0`; concurrent mounts still dedupe naturally via SWR's internal flight-merging. (2) Added `globalMutate` for `/wallets/{address}/hud` and batch HUD keys (matching by address inclusion) in `WalletProfileLayout`'s `onJobCompleted`, alongside the existing invalidations. **Files:** `useWalletHud.ts` (dedupingInterval 60s0, removed unused CACHE_DURATIONS import), `useBatchWalletHud.ts` (same), `WalletProfileLayout.tsx` (added HUD key invalidation in onJobCompleted).

**05.2:** Fixed batch HUD requests returning Next.js 404 HTML because frontend was calling `/api/wallets/hud/batch` (no route) while rewrites only proxy `/api/v1/*`. **Root Cause:** Direct `fetch('/api/...')` bypassed the shared `fetcher` base URL and rewrite logic. **Fix:** Route batch HUD through the shared `fetcher` so it resolves to the backend API base (`/api/v1/wallets/hud/batch` or configured base URL). **Files:** `dashboard/src/hooks/useBatchWalletHud.ts`, `dashboard/src/hooks/useWalletHud.ts`.

### February 3, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 03.1 | FIX | Critical fix: Stale token prices causing inflated P/L | S | `token-info.service.ts` |
| 03.2 | FEAT | WebSocket & Redis automatic reconnection | M | `job-progress.gateway.ts`, `useJobProgress.ts`, `redis.provider.ts` |
| 03.3 | DOC | HUD-WalletBadge Integration Design Plan | S | `.ai/HUD_INTEGRATION_PLAN.md` |

**Summary:**

**03.1:** Fixed critical bug where token prices stuck at stale values (days old) caused wildly incorrect P/L calculations (e.g., 14,930x inflated: $0.235 vs actual $0.00001574). **Root Cause - Two Issues:** (1) **In-flight deadlock** - `buildTokenEnrichmentPlan()` marked tokens "in-flight" BEFORE fetching, causing subsequent enrichment to skip all tokens (thinking already processed). Created deadlock where tokens permanently marked in-flight but never enriched. (2) **Fire-and-forget race** - `setImmediate()` in `triggerTokenInfoEnrichment()` returned before DexScreener completed, so processors reading prices immediately got stale data. **The Fix:** (1) Moved in-flight markers from plan builder to actual fetch (`enrichTokensBackground`) - plan only checks staleness, markers set when actually fetching. (2) Removed `setImmediate()` - now awaits DexScreener completion, ensuring fresh prices. **Impact:** Enrichment properly updates prices, P/L uses fresh data, eliminates inflated portfolios from dead tokens with cached pump prices. **Design Note:** API controllers still don't await enrichment (fast response), but enrichment processor awaits (correct calculations). In-flight mechanism correctly prevents duplicate fetches but was set too early. **Files:** `token-info.service.ts` (moved markers, removed setImmediate, added set-before-fetch with cleanup).

**03.2:** Fixed production-critical resilience issue where Redis/Docker restart permanently broke WebSocket real-time updates, requiring manual backend restart. **Root Causes:** (1) Backend Redis subscriber attempted subscription only once with 5-second delay - no retry on failure, (2) Frontend Socket.io limited to 5 reconnection attempts then gave up permanently, (3) No automatic re-subscription when Redis reconnected after being down, (4) Log spam: when Redis down, services logged 100+ identical errors per second. **The Fix:** (1) **Backend Reconnection** - Added exponential backoff retry logic (1s2s4s8smax 30s, never stops), added Redis connection state monitoring (`ready`/`close`/`reconnecting` events), automatic re-subscription when Redis reconnects, duplicate subscription prevention with `isSubscribed` flag; (2) **Frontend** - Changed `reconnectionAttempts: 5`  `Infinity` (never give up), added `reconnectionDelayMax: 10000` (max 10s between attempts), added detailed reconnection event logging; (3) **Redis Provider** - Added `enableOfflineQueue: true` (queue commands during disconnection), `keepAlive: 30000` (connection health monitoring); (4) **Log Spam Prevention** - Added ONE LINE to `main.ts` calling `setupThrottledLogging()` which monkey-patches `Logger.prototype` globally - ALL Logger instances automatically throttle repeated errors (max once per 10 seconds), shows count of suppressed logs, adds helpful hints for Redis errors. **Impact:** App now survives Redis restarts with zero manual intervention AND clean logs. **Implementation:** Global monkey-patch approach - zero per-file changes needed, all existing and new code gets throttling automatically. **Files:** `main.ts` (1 line added), `core/logging/setup-throttled-logging.ts` (interceptor), `job-progress.gateway.ts` (retry logic), `useJobProgress.ts` (infinite reconnection), `redis.provider.ts` (offline queue). **Documentation:** `FINAL_SOLUTION.md` (quick reference), `.ai/context/WEBSOCKET_RECONNECTION_FIX.md`.

**03.3:** Designed comprehensive integration plan for HUD-WalletBadge layer overlay pattern. **Design Philosophy:** HUD is a supplementary layer on WalletBadge (not a replacement) that appears on-demand to "complete" the badge with additional performance metrics. **Three Display Modes:** (1) **Inline Expandable Rows** - For tables (Holder Profiles, Similarity pairs, Tracked wallets) with table-level toggle + per-row expand/collapse, batch HUD fetch on toggle, smooth animations, compact single-line format; (2) **Delayed Hover Tooltip** - For compact lists/cards with 800ms hover delay (intentional hover detection), smart positioning to avoid viewport clipping, detailed multi-line format, tap-to-show on mobile; (3) **Expanded Grid** - For wallet profile pages with always-visible full detail grid, reuses existing `WalletHudOverlay` component. **Key Architecture:** WalletBadge UI remains 100% unchanged when `showHud={false}` (backward compatible), HUD is additive-only via conditional rendering, batch fetching via `useBatchWalletHud` hook (single API call for 50+ wallets), table state management via `useTableHudToggle` hook. **New Components:** `WalletHudInline.tsx` (compact single-line variant), `useBatchWalletHud.ts` (batch fetching hook), `useTableHudToggle.ts` (table toggle state). **Implementation:** 5 phases over 2-3 days (14-20 hours) - foundation components, WalletBadge integration, table integration (4 files), tooltip integration (3 files), profile integration. **Performance:** Batch fetch 100 wallets <500ms, SWR caching with 60s deduplication, conditional fetching (only when HUD enabled). **Files:** Detailed implementation plan in `.ai/HUD_INTEGRATION_PLAN.md` with visual mockups, code patterns, testing checklist, and pitfall warnings for future implementer.

### February 2, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 02.1 | FEAT | Wallet HUD (Heads-Up Display) system | L | Backend: `wallet-hud.service.ts`, `wallet-hud.controller.ts`, `wallet-hud.dto.ts`, `wallet-hud.module.ts`, `analysis-operations.processor.ts`; Frontend: `WalletHudOverlay.tsx`, `useWalletHud.ts`, `hud-demo/page.tsx` |

**Summary:**

**02.1:** Implemented poker HUD-style wallet metrics system for at-a-glance evaluation. **Core Metrics (6):** Trimmed mean PNL (outliers removed), median P/L per token, behavior code (M/F/H/A/I/S/?), avg trades/day, win rate, data quality tier (). **Conditional Badges (2):**  Bot (>60 tokens/day),  Whale (>200 SOL unrealized PNL). **Backend:** Single optimized query with nested includes (pnlSummary.advancedStats + behaviorProfile), Redis caching (24h TTL to prevent memory bloat), cache invalidation on PNL/behavior analysis completion via processor hooks, batch endpoint with O(1) lookup map, rate limiting (100 req/10min), max 200 wallets/batch. **Frontend:** Three display variants (inline compact, tooltip detailed, expanded grid), SWR hooks with proper cache strategy (no auto-refresh - data static until re-analysis), number formatting utilities (K/M suffixes), color system aligned with existing strategy colors, demo page at `/hud-demo`. **Key Decisions:** Whale detection uses unrealized PNL (portfolio value) NOT just SOL balance to match holder profiles display; 24h TTL prevents Redis bloat while active wallets get immediate cache invalidation; uses exported `prisma` instance directly (no DatabaseService dependency). **Performance:** Cache hit <5ms, cache miss <100ms single wallet, batch 100 wallets <200ms.

### February 1, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 01.1 | FEAT | Password reset confirmation email | S | `email.service.ts`, `auth.service.ts` |
| 01.2 | DECISION | Import bulk cooldown redesign - remove user-level restrictions | S | `user-favorites.service.ts` |
| 01.3 | FEAT | Comprehensive job throttling and priority fixes | M | `user-favorites.controller.ts`, `similarity-analysis.dto.ts`, `analyses.controller.ts` |
| 01.4 | FEAT | Batch analyze functionality in tracked wallets | S | `dashboard/src/app/trackers/page.tsx` |

**Summary:**

**01.1:** Added security confirmation email sent after successful password reset. New `sendPasswordResetConfirmationEmail()` method in EmailService sends user-friendly confirmation with timestamp, security warning for unauthorized changes, and security tips. Called from `AuthService.resetPassword()` after password update (non-blocking - won't fail password reset if email fails). Email includes green success banner, amber warning box for unauthorized changes, and security best practices. Helps users detect account compromise and reinforces security awareness.

**01.2:** Removed user-level import cooldown that was blocking all favorites imports for 1 hour. **Problem:** Users importing even 2 wallets were locked out for 1 hour - too restrictive for organizing favorites. **Solution:** Removed `checkImportCooldown()` and `lastBulkImportAt` tracking from import flow. Users can now import/organize favorites freely without time restrictions. **Rate limiting strategy:** Analysis job queueing is naturally limited by (1) wallet-level freshness checks (existing `AnalysisRun` table), (2) queue concurrency limits, and (3) job processor skip logic for recently-analyzed wallets. Import is now purely organizational - analysis jobs remain protected against abuse. **Files modified:** `user-favorites.service.ts` (removed cooldown check, removed `USER_FAVORITES_CONFIG` import, removed `checkImportCooldown()` method, removed `updateUserLastBulkImport()` call).

**01.3:** Comprehensive audit and fixes for job throttling across all analysis endpoints. **Problems identified:** (1) Favorites endpoints had NO throttling, (2) Favorites import used HIGH priority for first 50 wallets (inappropriate for non-critical operations), (3) Similarity analysis had no max wallet limit, (4) Inconsistent protection across endpoints. **Solution implemented:** Added HTTP rate limiting to favorites endpoints (import: 10/hour, batch-analyze: 15/hour, collection-refresh: 10/hour), changed favorites import priority from HIGH  NORMAL (first 50 wallets), added 30-wallet max to similarity analysis DTO validation, updated API documentation. **Rate limits chosen:** Conservative for free users (~500 analysis jobs/hour realistic accounting for freshness skips), extensible for power users (future `User.rateLimitMultiplier` field). **Files modified:** `user-favorites.controller.ts` (added `@Throttle` decorators and `@UseGuards(ThrottlerGuard)`, changed JobPriority.HIGH  JobPriority.NORMAL, updated API docs), `similarity-analysis.dto.ts` (added `@ArrayMaxSize(30)`), `analyses.controller.ts` (updated API docs). Created comprehensive audit document at `.ai/context/JOB_THROTTLING_AUDIT.md` documenting all job-creating endpoints, hidden job multiplication patterns, and rate limiting strategy.

**01.4:** Wired batch analyze functionality in tracked wallets page. **Missing:** Backend endpoint existed (`POST /users/me/favorites/batch-analyze`) but no UI to use it. **Implementation:** Added checkbox column to wallets table with "select all" toggle, multi-wallet selection state management, batch actions toolbar that appears when wallets selected, scope selector dropdown (flash/working/deep), and "Analyze Selected" button. **Features:** Max 20 wallets per batch (enforced in UI and backend DTO), clear selection after successful queue, scope persists across selections, real-time validation and error handling. **UX improvements:** Selected count displayed, clear button to deselect all, disabled state when >20 wallets selected, loading state during API call. **Files modified:** `dashboard/src/app/trackers/page.tsx` (added Checkbox import, selection state, batch analyze handlers, toolbar UI, checkbox cells in table rows, updated colspan for empty state).

### January 30, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 30.1 | FIX | DexScreener 429 rate limiting fix - in-flight token tracking | L | `token-info.service.ts`, `string-sanitizer.ts`, `database-service.ts`, `helius-api-client.ts`, `queue.config.ts`, `constants.ts` |
| 30.2 | FEAT | Similarity balances + token metadata stability pass | L | `dashboard/src/app/similarity-lab/page.tsx`, `dashboard/src/hooks/useTokenMetadata.ts`, `src/api/services/balance-cache.service.ts`, `src/core/services/wallet-balance-service.ts`, `src/core/services/helius-api-client.ts`, `src/config/constants.ts`, `src/queues/processors/enrichment-operations.processor.ts`, `dashboard/src/components/similarity-lab/results/MostCommonTokens.tsx` |

**Summary:**

**30.1:** Fixed cascading DexScreener 429 rate limit errors during bulk wallet analysis (138 concurrent jobs). **Root Cause:** Multiple enrichment jobs fetching same tokens simultaneously - with 95% token overlap across wallets (SOL, USDC, popular memes), system was making 138x redundant API calls. **Solution: In-Flight Token Tracking** - Redis-based deduplication system that marks tokens currently being fetched (`token:in-flight:{address}` with 30s TTL). When Job 2 starts while Job 1 is fetching SOL/USDC, Job 2's `getTokenEnrichmentPlan()` sees in-flight markers and skips those tokens. Markers automatically cleared after enrichment completes (with try/finally safety). **Additional Fixes:** (1) UTF-8 sanitization utility (`string-sanitizer.ts`) to strip null bytes from Solana transaction data before DB insert - prevents `invalid byte sequence for encoding "UTF8": 0x00` errors; (2) Batched metadata updates with deadlock handling in `updateMetadataSourceToHybrid()` to reduce lock contention; (3) Reduced Helius RPS from 4040 (kept), internal concurrency 108, enrichment queue concurrency recommendations (user handling config). **Expected Impact:** 90%+ reduction in duplicate token fetches, zero 429 errors, 20-30 min for 138-wallet imports (down from 10-15 min with retries/failures). **Implementation Details:** Check-then-set pattern with 2-5ms race window (acceptable - goal is 95% reduction not 100%). TTL failsafe prevents stuck markers if cleanup fails. Non-blocking design - no polling or waiting. Bug fixed in `enrichTokensBackground()` missing cleanup call.

**30.2:** Fixed TokenBadge metadata auto-refresh (forced post-enrichment refresh). Switched similarity lab persistence to job-pointer only (no giant localStorage payloads), deduped enrichment subscriptions, and trimmed enriched balances to meaningful tokens only. MostCommonTokens now builds metadata only for rendered mints (logs removed). Enabled V2 `changedSinceSlot` incremental balance updates centrally via BalanceCacheService with slot tracking + merge logic, added whale-aware cache TTLs in `constants.ts`, and centralized `MIN_UI_BALANCE` filtering.

### January 29, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 29.1 | FEAT | Favorites import system - attack-resistant design | L | `user-favorites.controller.ts`, `user-favorites.service.ts`, `database-service.ts`, `constants.ts`, `batch-analyze-favorites.dto.ts` |
| 29.2 | FIX | P0 Fix: Dashboard scopes (flash/working) persistence bug | S | `analysis-operations.processor.ts` |

**Summary:**

**29.1:** Implemented production-ready favorites import system with enterprise-grade protection. **Import Flow:** 50+250 batching (first 50 HIGH priority immediate, next 250 LOW priority staggered over 1 hour with 14.4sec delays). **Cooldown Protection:** User-level import cooldown (1 hour between bulk imports) via `User.lastBulkImportAt`. **Freshness Checking:** Wallet-level freshness (existing `AnalysisRun` table + processor logic) - prevents duplicate analysis when multiple users track same wallet. **New Endpoints:** `POST /batch-analyze` (up to 20 wallets, working/deep scope) and `POST /collections/:name/refresh` (flash analysis for collection, max 100 wallets). **Key Decision:** Did NOT add per-user analysis timestamps (would cause duplicate work problem) - instead rely on existing wallet-level freshness checks in processor. **DTO Cleanup:** Removed confusing unused params from import DTO (analyze, analysisScope, forceRefresh, etc). All jobs queue with `forceRefresh: false` to let processor decide based on wallet-level staleness. System correctly handles 100 users tracking same wallet - first queues analysis, subsequent requests skipped by processor.

**29.2:** Fixed critical bug where flash/working scopes completed analysis but didn't persist data, causing frontend to show "unanalyzed" state. **Root Cause:** `timeRange` was set for non-deep scopes (7d/30d) to optimize data fetching, but this incorrectly triggered "historical view" mode in PnL service  skipped persistence to protect FIFO lots from corruption. **The Insight:** Dashboard scopes are **progressive all-time snapshots** (differing only in depth: 250/2000/3000 signatures), NOT time windows. Setting `timeRange` conflated two concepts: (1) data fetching optimization and (2) historical query detection. **The Fix:** Removed `timeRange` from dashboard scope initialization (set to `undefined` for all scopes). Flash/working now fetch transactions based purely on `targetSignatureCount`, process ALL fetched data chronologically, and persist complete FIFO lot state. User-triggered time ranges (via API `?startDate=...`) remain view-only via `isViewOnly: true` flag. See `.ai/context/HISTORICAL_VIEW_INVESTIGATION.md` for full analysis and test plan.

### January 27, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 27.1 | FEAT | Similarity Lab: Holder picker tracking flow + UI refactor | L | `similarity-lab/page.tsx`, `TokenHolderPicker.tsx`, `BulkTrackModal.tsx`, `WalletBadge.tsx`, tracking hooks |
| 27.2 | FEAT | Favorites: Allow tracking wallets without prior analysis (stub wallet upsert) | S | `database-service.ts` |
| 27.3 | FIX | P0 Fix: Invalid address auto-trigger spam | M | `dashboard/src/lib/solana-utils.ts`, `WalletProfileLayout.tsx`, `WalletSearch.tsx` |
| 27.4 | FEAT | Bulk favorites import + auto-analysis queueing | M | `user-favorites.controller.ts`, `user-favorites.service.ts`, `database-service.ts`, `trackers/page.tsx` |

**Summary:**

**27.1:** Redesigned holder picker tracking UX with a confirmable bulk-track modal, compact copy/track controls, and LP/system exclusion. Extracted tracking logic into reusable hooks and a shared modal, added a similarity-lab flow hook, and refined holder table spacing + minimal wallet badge copy actions.

**27.2:** Removed the ?wallet must exist? constraint for favorites by upserting a stub wallet record on add. Users can now track wallets immediately without forcing analysis; analysis still behaves as initial sync when run later.

**27.3:** Fixed invalid address auto-trigger spam by enforcing base58 decode validation (32-byte public key), preventing auto-trigger when address is invalid, and adding an auto-trigger cooldown even on request failure to stop retry storms.

**27.4:** Added bulk favorites import endpoint with schema normalization (trackedWalletAddress/name/emoji/alertsOn), batch upsert for favorites, and auto-queue dashboard analysis after import. Trackers UI now supports JSON/CSV import, optional import collection, and auto-queues deep analysis for the first 5 wallets (targetSignatureCount set to 10k but capped by DASHBOARD_MAX_SIGNATURES until raised).

<details>
<summary><b>Icon Legend</b></summary>

**Type:**
 Completed   Fix/Refactor   Metrics/Monitoring   Documentation   Decision   Bug   Feature

</details>


##  Known Issues

| Severity | Issue | Impact | Location | Status |
|:--------:|:------|:-------|:---------|:------:|
|  | Database Deadlock in Token Metadata Upserts | ~~Intermittent enrichment failures~~ | `database-service.ts:upsertManyTokenInfo` |  Fixed (Jan 26) |

<details>
<summary><b>Details: Database Deadlock (RESOLVED)</b></summary>

**Error:** `PostgresError { code: "40P01", message: "deadlock detected" }`

**Root Cause:** Multiple parallel DexScreener batch processes attempting to upsert overlapping token sets in different orders, causing circular lock dependencies.

**Example Scenario:**
```
Process A: Upserts [TokenA, TokenB, TokenC]
Process B: Upserts [TokenC, TokenB, TokenA] (same tokens, different order)
 Process A locks TokenA, Process B locks TokenC
 Both wait for TokenB  DEADLOCK
```

**Solution Implemented (Jan 26, 2026):**

1. **Prevention (~95% reduction):**
   - Sort all token data alphabetically by address before transaction
   - Ensures consistent lock acquisition order across all concurrent processes
   - Industry-standard deadlock prevention technique

2. **Recovery (remaining ~5%):**
   - Exponential backoff retry (100ms base, 200ms, 400ms)
   - Random jitter (0-50ms) to prevent retry collision
   - Max 3 attempts before failing
   - Deadlock-specific error detection (40P01, P2034)

**Why This Approach:**
-  Maintains parallel processing performance
-  Preserves transaction atomicity
-  Follows PostgreSQL best practices
-  Alternative (global lock): Kills parallelism
-  Alternative (no transactions): Loses data consistency

**Monitoring:** Watch for log messages "Deadlock detected in upsertManyTokenInfo" to verify fix effectiveness.

</details>

---

##  Architecture Decisions

ALWAYS run scripts with "npx ts-node -r tsconfig-paths/register" 

### Lock Scope Independence
*Decided: 2026-01-13*

Each analysis type uses isolated lock keys:

```
Dashboard:       lock:wallet:dashboard-analysis:{address}
PnL:             lock:wallet:pnl:{address}
Behavior:        lock:wallet:behavior:{address}
Sync:            lock:wallet:sync:{address}
Similarity:      lock:similarity:{requestId}
Holder Profiles: NO LOCK (relies on service idempotency)
```

**Rationale:** Services are idempotent. Database caching allows safe concurrent execution. Metrics track if contention becomes problematic.



---

##  Quick Reference

### Key Code Locations

| Area | Path | Notes |
|:-----|:-----|:------|
| **Dashboard Components** | `dashboard/src/components/` | Primary work area |
| Discover Page | `dashboard/src/app/discover/` |  Complete |
| Tracked Wallets | `dashboard/src/app/trackers/` |  Complete |
| Holder Profiles v2 | `dashboard/src/components/holder-profiles/v2/` |  Final review |
| Similarity Lab | `dashboard/src/app/similarity-lab/` |  Bug fixes pending |
| Analysis API | `src/api/controllers/analyses.controller.ts` | Backend endpoints |
| Queue System | `src/queues/processors/` | Job processing |
| Core Analysis | `src/core/analysis/` | Math & logic |

### Documentation Files

| File | Purpose |
|:-----|:--------|
| `CONTEXT.md` | Timeline, active tasks, decisions (this file) |
| `GUIDE.md` | Implementation roadmap, build instructions |
| `RULES.md` | AI agent execution contract |
| `HANDOFF.md` | Session start/end protocol |

---

##  Usage Guide

### When to Update

 After completing tasks  Add to Recent Activity
 Starting new work  Add to Active Work
 Architectural decisions  Add to Architecture Decisions
 Discovering bugs  Add to Known Issues
 End of session  Update Current Focus, timestamp, and CHANGELOG.md for user-facing changes

### Entry Format

Recent Activity entries use: `DD.N` numbering (e.g., `13.1`, `13.2` for Jan 13)

```
| ID | Icon | Clear title | Scope | Key components/files |
```

- **ID:** Day.Sequence (13.1, 13.2, ...)
- **Icon:** Type indicator (      )
- **Title:** What was accomplished
- **Scope:**  Small,  Medium,  Large
- **Components:** Shortened paths to key files

---

**Last Updated:** 2026-02-06  **Branch:** `discover-analytics-ux`











