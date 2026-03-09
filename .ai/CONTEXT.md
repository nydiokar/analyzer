# Sova Intel - Project Context

**Branch:** `feat/tracked-wallets-page`  **Last Updated:** 2026-03-09  **Status:** Holdings Radar backend complete — frontend wiring next

**Base:** `main` (Credit ledger + Intel API layer + X402 agent payments + TypeScript SDK — all merged)

---

##  Active Work

### feat/tracked-wallets-page

Full spec: `spec.md` in repo root.

| Status | Task | Area | Notes |
|:------:|:-----|:----:|:------|
| ✅ | **[TRK-1] Schema** — `RadarWallet`, `RadarHolding` models + `User.isAnalyst` flag | Backend | Migration `20260309091049_add_radar_models_and_analyst_flag` applied. |
| ✅ | **[TRK-2] AnalystGuard** — guard checking `user.isAnalyst \|\| user.isAdmin` | Backend | `src/api/shared/guards/analyst.guard.ts` + `src/api/shared/decorators/analyst.decorator.ts`. Registered as global guard in `AppModule`. |
| ✅ | **[TRK-3] Snapshot service** — upsert holdings from `BalanceCacheService`, dust filter, first-seen detection | Backend | `src/api/services/radar-snapshot.service.ts`. No ATA calls — firstSeenAt is radar-detection time only. |
| ⏭️ | **[TRK-4] ATA acquisition time** — deferred, not needed for v1 | Backend | Skipped. `acquiredAt` field exists on schema for future use. |
| ✅ | **[TRK-5] Radar controller + module** — all 7 endpoints (`/analyst/radar/...`), all guarded by `@IsAnalyst()` | Backend | `src/api/controllers/radar.controller.ts`, `src/api/modules/radar.module.ts`. Wired into `ApiModule`. |
| ✅ | **[TRK-AUTH] `isAnalyst` propagation** — field missing from all auth responses and frontend User type | Backend + Frontend | `auth.service.ts` (3 return blocks), `auth.controller.ts` (`getProfile`), `auth-store.ts` (User + AuthResponse), `useAuth.ts` (login + register). |
| ⚪ | **[TRK-6] Frontend page scaffold** — `/radar` route, access gate, AppShell nav item | Frontend | `src/app/radar/page.tsx`. Redirect non-analyst users. |
| ⚪ | **[TRK-7] Event feed view** — unreviewed-first, `firstSeenAt DESC`, `TokenBadge inline s`, review actions | Frontend | Default landing view. Uses `GET /analyst/radar/feed`. |
| ⚪ | **[TRK-8] Holdings view** — per-wallet expandable, sortable table, `TokenBadge inline s` | Frontend | Secondary view. Uses `GET /analyst/radar/:address/holdings`. |
| ⚪ | **[TRK-9] Add wallet input + snapshot trigger** — address validation, POST, immediate snapshot, show result | Frontend | Top of page. On add: POST wallet → POST snapshot → refresh feed. |
| ⚪ | **[TRK-10] Review status actions** — mark reviewed / ignore inline in feed and holdings table | Frontend | PATCH `/analyst/radar/holdings/:id/review`. Optimistic update. |

---

### Pending from main (carry-over, not this branch)

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ⚪ | **[PAY-X402-RECEIPT]** Fix `X-Payment-Response` receipt header — split `confirmAndRecord` into broadcast (fast, in guard) + confirm (slow, fire-and-forget), set header synchronously in interceptor with known sig | 🟢 S | `x402-verification.service.ts`, `credit.guard.ts`, `credit.interceptor.ts` |
| ⚪ | **[PAY-5d]** Blocked wallet E2E test — `isActive=false` returns 403 | 🟢 S | Manual DB flip + script |
| ⚪ | **[INTEL-DEEP-BUG]** Fix `/intel/token/:mint/holders/deep` similarity chaining — add `chainSimilarity: true` flag to job, processor auto-queues similarity after holder-profiles completes | 🟡 M | `src/queues/jobs/types/index.ts`, `intel.controller.ts`, `analysis-operations.processor.ts` |
| ⚪ | **[PAY-X402-RECEIPT] Fix `X-Payment-Response` receipt header on fresh x402 calls** | 🟢 S | Current flow: guard does `validateOnly` (local only, fast), sets `x402PendingTxBytes` on request, handler runs, interceptor `tap` calls `confirmAndRecord` async (fire-and-forget). Problem: `tap` doesn't await async callbacks — response flushes before `confirmAndRecord` resolves, so `response.setHeader('X-Payment-Response', txSig)` throws "Cannot set headers after they are sent to the client". **The errors are harmless** (payment IS confirmed, call succeeded) but the agent never receives the receipt header. **Fix:** split `confirmAndRecord` into two steps: (1) `broadcastAndGetSig(txBytes)` → calls `sendRawTransaction`, returns `txSig` fast (~100-200ms); (2) `confirmAndRecord(txSig, ...)` → waits for finality + Redis SET NX + ledger record (slow, ~5s). Move step 1 to the guard (store `txSig` on request alongside `x402PendingTxBytes`), then in the interceptor `tap` set the header synchronously with the known sig, and fire-and-forget step 2. No latency added to the response. **Files:** `src/api/services/x402-verification.service.ts` (split method), `src/api/shared/guards/credit.guard.ts` (broadcast in guard), `src/api/shared/interceptors/credit.interceptor.ts` (sync setHeader + async confirm). |
| ⚪ | **[INTEL-DEEP-BUG] Fix `POST /intel/token/:mint/holders/deep` similarity chaining** | 🟡 M | Endpoint currently requires caller to pass `wallets[]` upfront, but callers can't know the holders before the job runs — circular dependency. Fix: add `chainSimilarity: true` flag to `AnalyzeHolderProfilesJobData`, processor auto-queues similarity job using discovered holder addresses after completion. Controller removes `wallets[]` from request body, returns `chainedSimilarityRequestId` upfront so agent can poll result key directly. No round-trip needed. **Full spec + proposed implementation:** `.ai/context/monetization/INTEL-DEEP-CHAIN-BUG.md`. Files: `src/queues/jobs/types/index.ts`, `src/api/controllers/intel.controller.ts`, `src/queues/processors/analysis-operations.processor.ts`, `documentation/skill/SKILL.md`. |
| ⚪ | Production auth hardening: cookie-mode readiness + CSP tightening | 🔴 L | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until backend cookie auth, frontend CSRF header flow, and stricter CSP are complete. |
| ⚪ | Implement feed feature | 🔴 L | Design and implement activity feed functionality. |

> **Note:** REMOVE AUTODOC from deps!

**Recently Completed:**

<details>
<summary><b>Legend</b></summary>

**Status:**  In Progress   Blocked   Ready   Testing
**Scope:**  Small (<50 lines, <1hr)   Medium (2-5 files, <4hrs)   Large (5+ files, multi-day)

</details>

---

##  Current Focus & Priorities

### P0: Holdings Radar — Backend ✅ COMPLETE, Frontend next (Mar 9, 2026)

New feature on `feat/tracked-wallets-page`. Full spec in `.ai/context/holding_feed/spec.md`.

**What this is:** Operational monitoring page for specific wallets — ATA holdings via Helius, no analysis pipeline dependency. First-seen token detection feed. Analyst-gated access (`isAnalyst` flag, not admin).

**Backend complete. Next: TRK-6 through TRK-10 (frontend).**

**Key design decisions:**
- `isAnalyst` on `User` (not `isAdmin`) — operational role separate from administrative role
- `AnalystGuard`: `user.isAnalyst === true || user.isAdmin === true` — global guard, `@IsAnalyst()` applied at controller class level
- No FK to existing `Wallet` model — standalone `RadarWallet` / `RadarHolding` models
- `firstSeenAt` = first detected by radar, not wallet buy time — intentional framing
- TRK-4 (ATA acquisition time) deferred — `acquiredAt` field on schema reserved for future use
- Route `/analyst/radar/...` (not `/analyst/tracked-wallets/...` as originally drafted)
- `GET /analyst/radar/feed` declared before `GET /analyst/radar/:address/holdings` in controller to avoid NestJS param shadowing
- `isAnalyst` propagated through all auth paths: login, register, token refresh, `/auth/me`

### P1: Helius API Optimization — ✅ COMPLETE (Feb 16-17)

**What was done:**
- Slot watermarks migrated from Redis (30s TTL) → `TokenAccountWatermark` Prisma table (persistent, Feb 16 commit `3bb107f`)
- Balance cache TTLs increased: default 5min→30min, medium 15min→2hr, whale 45min→4hr
- Fixed broken cache-miss + watermark incremental path that caused similarity jobs to silently drop wallets (Feb 17)
- Fixed hardcoded 30s TTL overwriting 30-min cached balances in `getBalances()` incremental write (Feb 17)
- All 5 Redis write paths in `balance-cache.service.ts` now use adaptive `getTtlSeconds()`

**How it works now:**
1. First fetch → full Helius call → balance cached (30min-4hr) + slot watermark stored in DB
2. Repeat fetch within TTL window → incremental `changedSinceSlot` → only changed tokens returned → merged with cached baseline → written back with full TTL
3. Cache miss (TTL expired) → full fetch regardless of watermark (watermark alone can't reconstruct full balance)
4. Holder profiles → similarity job chain: balances cached at 30min, similarity hits cache, zero extra RPC calls

**Phase 2 (future):** Helius Webhooks / WebSocket subscriptions for active wallets

---

##  Recent Activity

### March 9, 2026 (Latest)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 9.1 | 🎯 FEAT | TRK-1: `RadarWallet` + `RadarHolding` Prisma models + `User.isAnalyst` flag, migration applied | 🟢 S | `prisma/schema.prisma`, migration `20260309091049` |
| 9.2 | 🎯 FEAT | TRK-2: `AnalystGuard` + `@IsAnalyst()` decorator, registered as global guard | 🟢 S | `src/api/shared/guards/analyst.guard.ts`, `src/api/shared/decorators/analyst.decorator.ts`, `src/app.module.ts` |
| 9.3 | 🎯 FEAT | TRK-3: `RadarSnapshotService` — `BalanceCacheService` reuse, dust filter, upsert with firstSeenAt/deactivation | 🟢 S | `src/api/services/radar-snapshot.service.ts` |
| 9.4 | 🎯 FEAT | TRK-5: `RadarController` (7 endpoints at `/analyst/radar/...`) + `RadarModule` wired into `ApiModule` | 🟡 M | `src/api/controllers/radar.controller.ts`, `src/api/modules/radar.module.ts`, `src/api.module.ts` |
| 9.5 | 🐛 FIX | `isAnalyst` missing from all auth responses and frontend `User` type — propagated through full auth chain | 🟡 M | `src/api/shared/services/auth.service.ts`, `src/api/controllers/auth.controller.ts`, `src/store/auth-store.ts`, `src/hooks/useAuth.ts` |

**Summary:**

**9.1–9.4:** Full Holdings Radar backend. `RadarWallet` tracks monitored addresses; `RadarHolding` stores per-wallet-token state with `firstSeenAt`, `reviewStatus`, `isActiveHolding`. Snapshot service calls `BalanceCacheService.getBalances()`, applies dust filter (usdValue < 80 OR uiBalance < 200), upserts new tokens with `reviewStatus=unreviewed`, updates existing, deactivates absent. All 7 REST endpoints at `/analyst/radar/...` gated by `@IsAnalyst()`. `GET feed` declared before `GET :address/holdings` to prevent NestJS route shadowing. `ValidationPipe` applied per `@Body()` param.

**9.5:** `isAnalyst` was not included in login/register/refresh responses or `GET /auth/me`. Frontend `User` type and auth store also lacked the field. Fixed across all three auth service return blocks, the `getProfile` endpoint, the frontend `User` + `AuthResponse` interfaces, and both login/register paths in `useAuth.ts`. Frontend access gate (`user.isAnalyst || user.isAdmin`) will now work correctly.

---

### March 4, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 4.1 | 🐛 FIX | x402 v2 migration: server was emitting v1 protocol with CAIP-2 network names (mixed versions) | 🟡 M | `src/api/shared/guards/credit.guard.ts`, `src/api/shared/guards/composite-auth.guard.ts` |
| 4.2 | 🐛 FIX | Job polling 401: `GET /jobs/:jobId` required auth, blocking x402 agents with no persistent identity | 🟢 S | `src/api/controllers/jobs.controller.ts` |
| 4.3 | 🔒 SEC | Strip `result` + `data` from public job status — unauthenticated poll returns status/progress only | 🟢 S | `src/api/controllers/jobs.controller.ts` |
| 4.4 | 🎯 FEAT | `/hud` auto-queues flash analysis on unknown wallet — returns 202 + jobId instead of 404 | 🟡 M | `src/api/controllers/intel.controller.ts` |
| 4.5 | 🎯 FEAT | PAY-8: Synchronous cold-wallet resolution — hold HTTP connection, await job, return 200 in one request | 🔴 L | `src/api/controllers/intel.controller.ts`, `src/api/shared/guards/credit.guard.ts`, `src/queues/services/job-events-bridge.service.ts` |
| 4.6 | 🐛 FIX | PAY-8: Prepaid re-call bypassed freshness gate — stale `updatedAt` caused re-queue instead of serving | 🟢 S | `src/api/controllers/intel.controller.ts` |
| 4.7 | 🧪 TEST | PAY-8: `test-pay8.ts` — synchronous hold contract verification (JWT, no agent wallet needed) | 🟢 S | `src/scripts/test-pay8.ts` |

**Summary:**

**4.1:** The server was emitting `x402Version: 1` in the 402 body (v1 protocol) but using CAIP-2 network format (`solana:5eykt4...`) which is a v2 convention — breaking all x402 library clients that correctly implement the spec. Migrated to full x402 v2: `PAYMENT-REQUIRED` response header (base64 JSON), `x402Version: 2`, CAIP-2 network, `amount` field (not `maxAmountRequired`). Both guards now read `payment-signature` header (v2) with fallback to `x-payment` (v1 legacy). Response header changed from `X-Payment-Receipt` to `X-Payment-Response` (v2 spec). MCP wallet client (`mcp-x402`) updated with `AgentExactSvmScheme` subclass that injects `feePayer: signer.address` when the server omits it — the agent correctly pays its own SOL transaction fees.

**4.2 / 4.3:** Job status polling was gated by `CompositeAuthGuard` — agents completing a payment have no persistent JWT or API key, so polling their own job returned 401. Made `GET /jobs/:jobId` public (`@Public()` decorator). To prevent free data extraction via jobId enumeration (`dashboard-<8hex>`), unauthenticated responses are stripped of `result` and `data` — only `id`, `name`, `queue`, `status`, `progress`, `createdAt`, `processedAt`, `finishedAt`, `attempts`, `maxAttempts` are returned. Authenticated users still get full response.

**4.5/4.6/4.7:** PAY-8 — synchronous cold-wallet resolution. `getWalletIntel` and `getWalletHud` now hold the HTTP connection open (up to 30s) while the flash analysis runs, returning 200 + data in a single request. Uses `JobEventsBridgeService.waitForJob()` which reuses the already-open `QueueEvents` subscriber connection (no duplicate Redis connections). Three dedup paths (queue scan, Redis lock, fresh queue) all await the job. Prepaid marker written to Redis on timeout/failure — encodes `'x402'` vs userId so `CreditGuard` on re-call knows whether to skip or apply balance deduction. Freshness gate bypassed when `X-Prepaid-Job-Id` header is present (analysis just ran — stale `updatedAt` was causing re-queue loop). Test script `test-pay8.ts` verifies the full contract with JWT auth (no agent wallet required): 402 gate, warm 200 fast, cold 200 via synchronous hold, single credit charge, post-analysis /hud instant from DB. **E2E passed.**

**4.4:** `GET /intel/wallet/:addr/hud` previously returned 404 on unknown wallets, forcing agents to make an extra call to `GET /intel/wallet/:addr` (5cr) just to trigger analysis before being able to use the cheaper 1cr HUD endpoint. The HUD endpoint now auto-queues a flash analysis on missing wallet (same logic as `getWalletIntel`) and returns 202 + `jobId` + `monitoringUrl`. Agent polls (free), then calls `/hud` again — 1cr charged on 200. `queueWorkingAfter: false` — HUD flash doesn't chain a working analysis (unnecessary for a 1cr signal call).

---

<details>
<summary><b>Icon Legend</b></summary>

**Type:**
 Completed   Fix/Refactor   Metrics/Monitoring   Documentation   Decision   Bug   Feature

</details>


##  Known Issues

---

##  Architecture Decisions

ALWAYS run scripts with "npx ts-node -r tsconfig-paths/register" 

### DB Growth Investigation Protocol
*Decided: 2026-02-26*

For future sessions investigating DB growth, run this sequence first (read-only):

1. Verify runtime + DB target:
   - `pm2 status`
   - `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'`
   - Expect active container: `analyzer-postgres` and DB `sova_analyzer`.
2. Baseline size:
   - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"`
3. Top table footprint:
   - Query `pg_total_relation_size`, `pg_relation_size`, `pg_indexes_size`, toast size from `pg_class`.
4. Day-level growth attribution:
   - Group by day on:
     - `SwapAnalysisInput.timestamp` (epoch int)
     - `HeliusTransactionCache.fetchedAt` (fallback to `timestamp`)
     - `TokenLot.createdAt`
     - `AnalysisResult.updatedAt`
   - Compute rows/day and estimated MB/day.
5. Separate true growth vs bloat:
   - `pg_stat_user_tables`: `n_live_tup`, `n_dead_tup`, autovacuum timestamps.
6. Identify index amplification:
   - `pg_index` + `pg_relation_size(index)` on top tables.
7. Identify workload concentration:
   - Top wallets by row counts (14d) for `SwapAnalysisInput`, `TokenLot`, `AnalysisResult`.

Interpretation rule used in this session:
- If dead tuples are low on biggest tables, growth is ingest-driven, not vacuum lag.
- If one index is multi-GB and tied to high-ingest table, index strategy is a primary pressure point.

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
| **Holdings Radar controller** | `src/api/controllers/radar.controller.ts` | 7 endpoints at `/analyst/radar/...` |
| **Holdings Radar service** | `src/api/services/radar-snapshot.service.ts` | Snapshot + dust filter |
| **Holdings Radar module** | `src/api/modules/radar.module.ts` | Imports `BalanceCacheModule` |
| **AnalystGuard** | `src/api/shared/guards/analyst.guard.ts` | `isAnalyst \|\| isAdmin` |

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

**Last Updated:** 2026-03-09  **Branch:** `feat/tracked-wallets-page`  **Backend TRK-1–5 complete, frontend TRK-6–10 next**








