# Sova Intel - Project Context

**Branch:** `feat/telegram-bot-intel`  **Last Updated:** 2026-03-10  **Status:** TG-1–TG-10 complete — E2E tested, running in production

**Base:** `feat/tracked-wallets-page` → `main` (Credit ledger + Intel API + X402 + Holdings Radar — all complete)

---

##  Active Work

### feat/telegram-bot-intel

Full spec: `.ai/context/telegram-bot/spec.md`

| Status | Task | Area | Notes |
|:------:|:-----|:----:|:------|
| ✅ | **[TG-1] Schema + migration** — `TelegramBotLog` model | Backend | Migration `20260309153328_add_telegram_bot_log` applied. |
| ✅ | **[TG-2] API key seed script** — `prisma/seed-telegram-bot.ts` | Backend | Creates `system-telegram-bot` User + `ak_<hex>` ApiKey (bcrypt hash). Run once — prints raw key to stdout. |
| ✅ | **[TG-3] Bot scaffold** — `src/bot/intel/` entry point + auth middleware | Bot | `index.ts`, `bot.ts`, `config.ts`. Telegraf setup, `ALLOWED_USER_IDS` allowlist, SIGINT/SIGTERM, `process.send('ready')`. |
| ✅ | **[TG-4] Intel API client** — `intel-client.ts` | Bot | Typed axios wrapper: `getHud` / `getProfile` (35s timeout), `postHolders`, `pollJob` (5s). Header: `x-api-key`. Types copied from pft-bot_v2. |
| ✅ | **[TG-5] /hud command + formatter** | Bot | `commands/hud.ts` + `formatters/hud.formatter.ts`. ⏳ → await API → edit msg with Telegram HTML. |
| ✅ | **[TG-6] /profile command + formatter** | Bot | `commands/profile.ts` + `formatters/profile.formatter.ts`. Same ⏳ → edit pattern, 5cr. |
| ✅ | **[TG-7] /holders command + formatter + async poll** | Bot | `commands/holders.ts` + `formatters/holders.formatter.ts`. POST → poll every 3s (up to 120s) → edit. Formatter adapted from pft-bot_v2. |
| ✅ | **[TG-8] Attribution logging** — write `TelegramBotLog` rows | Bot | `attribution.ts` — fire-and-forget `logInvocation()` called in all three handlers. |
| ✅ | **[TG-9] PM2 process config** — add `sova-tg-bot` entry to `ecosystem.config.js` | DevOps | ts-node interpreter, `wait_ready: true`, `exp_backoff_restart_delay: 100`, `max_memory_restart: 512M`. |
| ✅ | **[TG-10] E2E test** — all three commands verified with real addresses in Telegram | Manual | All three commands working. Attribution rows confirmed in `TelegramBotLog`. Bot running from `dist/` via PM2. |

---

### Pending carry-over (not this branch)

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ⚪ | **[SDK-PUBLISH]** Publish `@sova/intel-sdk` to npm — add `"type": "module"` + dual exports to `package.json`, write minimal `README.md`, bump to `0.1.0`, add `prepublishOnly: pnpm build`, then `pnpm publish --access public`. Keep `workspace:*` in monorepo; external consumers pin npm version. | 🟢 S | `packages/sdk/package.json`, `packages/sdk/README.md` |
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

### P0: Telegram Bot Intel — 🚧 IN PROGRESS (Mar 9, 2026)

New feature on `feat/telegram-bot-intel`. Full spec in `.ai/context/telegram-bot/spec.md`.

**What this is:** Telegraf-based Telegram bot exposing `/hud`, `/profile`, and `/holders` commands — all wired to the Intel HTTP API via a single `system-telegram-bot` API key. First retail revenue surface for Sova Intel.

**Key design decisions:**
- Separate process (not NestJS module) — independent PM2 entry, no DI container needed
- Single system API key for billing; per-user attribution via `TelegramBotLog` DB table
- `ALLOWED_TELEGRAM_USER_IDS` env var allowlist — same pattern as legacy bot
- No client-side polling: `/hud` and `/profile` use PAY-8 synchronous hold (API holds 30s, returns 200 + data). Bot sends ⏳ then edits the message — one message per command.
- `/holders` is genuinely async (POST → 202 → job runs minutes) — bot polls `GET /jobs/:jobId` every 3s invisibly, edits the ⏳ message when done
- File structure: `src/bot/intel/` — separate from legacy `src/core/bot/` (no reuse)

### P1: Holdings Radar — ✅ COMPLETE (Mar 9, 2026)

`feat/tracked-wallets-page` merged. Full spec in `.ai/context/holding_feed/spec.md`.

**Key design decisions:**
- `isAnalyst` on `User` — operational role separate from `isAdmin`
- No FK to existing `Wallet` model — standalone `RadarWallet` / `RadarHolding` models
- Route `/analyst/radar/...`; `GET /analyst/radar/feed` declared before `GET /analyst/radar/:address/holdings` to avoid NestJS param shadowing
- `isAnalyst` propagated through all auth paths

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

### March 10, 2026 (Latest)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 10.1 | 🔧 REFACTOR | Replace hand-rolled `IntelClient` + duplicate types with `@sova/intel-sdk` — bot now uses canonical SDK throughout | 🟡 M | `src/bot/intel/intel-client.ts` (deleted), `bot.ts`, all commands, all formatters |
| 10.2 | 🐛 FIX | SDK `types.ts` was wrong — `WalletHud` had invented fields (`isBotFlagged`, `pnlSignal`) instead of real API fields (`isBot`, `isWhale`, `trimmedMeanPnl`, etc). Fixed against `WalletHudDto` source of truth | 🟡 M | `packages/sdk/src/types.ts`, `client.ts`, `index.ts`, `client.test.ts` |
| 10.3 | 🎯 FEAT | Add `HolderProfile` + `HolderProfilesResult` types to SDK — were missing entirely | 🟢 S | `packages/sdk/src/types.ts`, `index.ts` |
| 10.4 | 🎯 FEAT | Add contract tests (`contract.test.ts`) to SDK — hit real API, validate every field of every response type. `pnpm test` excludes them, `pnpm test:contract` runs them with env vars | 🟢 S | `packages/sdk/src/contract.test.ts`, `package.json` |
| 10.5 | 🔧 REFACTOR | Add `packages/sdk` to pnpm workspace, add `@sova/intel-sdk: workspace:*` to root deps | 🟢 S | `pnpm-workspace.yaml`, `package.json` |
| 10.6 | 🐛 FIX | Bot config env vars renamed to avoid collision with security/audit bot — `TELEGRAM_BOT_TOKEN` → `INTEL_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS` → `INTEL_BOT_ALLOWED_USER_IDS` | 🟢 S | `src/bot/intel/config.ts` |
| 10.7 | 🐛 FIX | Profile formatter was mixing hold time sources — `behavior.medianHoldTimeHours` vs `hud.medianHoldTimeHours` causing different values in `/hud` vs `/profile`. Both now use `hud.medianHoldTimeHours` (completed positions, more reliable) | 🟢 S | `formatters/profile.formatter.ts` |
| 10.8 | 🎯 FEAT | Redesign `/hud` output — full address copyable in `<code>`, compact single-glance layout | 🟢 S | `formatters/hud.formatter.ts` |
| 10.9 | 🎯 FEAT | Redesign `/profile` output — sectioned (PERFORMANCE / BEHAVIOR / PORTFOLIO / META), `timeAgo()` for last analyzed, full address copyable | 🟢 S | `formatters/profile.formatter.ts` |
| 10.10 | 🎯 FEAT | Redesign `/holders` output — distribution elevated to top, sorted by hold-time spectrum (Sniper→Holder), system wallets demoted to footer, uncategorized wallets shown as `🆕 New` with supply % | 🟢 S | `formatters/holders.formatter.ts` |
| 10.11 | 🔧 REFACTOR | PM2 ecosystem entry: switch from ts-node interpreter to compiled `dist/bot/intel/index.js` — eliminates 300MB ts-node memory footprint | 🟢 S | `ecosystem.config.js` |
| 10.12 | 🐛 FIX | `@nestjs/core` upgraded to `11.1.9` by pnpm drift breaking `ScheduleModule` + `EventEmitterModule`. Pinned `@nestjs/core@11.1.2`, `@nestjs/common@11.1.6`, `@nestjs/schedule@6.0.0` | 🟢 S | `package.json` |
| 10.13 | 🐛 FIX | `manage-api-keys.ts` script missing `EventEmitter2` arg after `ApiKeyService` constructor changed | 🟢 S | `scripts/manage-api-keys.ts` |

### March 9, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 9.11 | 🎯 FEAT | TG-1–TG-9: Full Telegram Bot Intel implementation — schema, seed, scaffold, client, commands, formatters, attribution, PM2 | 🟡 M | `prisma/schema.prisma`, `prisma/seed-telegram-bot.ts`, `src/bot/intel/` (11 files), `ecosystem.config.js` |
| 9.10 | 🎯 FEAT | Branch `feat/telegram-bot-intel` created — spec + CONTEXT updated | 🟢 S | `.ai/context/telegram-bot/spec.md`, `.ai/CONTEXT.md` |

### March 9, 2026 — Holdings Radar (previous branch)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 9.1 | 🎯 FEAT | TRK-1–5: Full Holdings Radar backend — models, guard, snapshot service, 7 endpoints | 🟡 M | `radar.controller.ts`, `radar-snapshot.service.ts`, `radar.module.ts`, schema migration |
| 9.2 | 🐛 FIX | `isAnalyst` missing from all auth responses and frontend `User` type | 🟡 M | `auth.service.ts`, `auth.controller.ts`, `auth-store.ts`, `useAuth.ts` |
| 9.3 | 🎯 FEAT | TRK-6–10: Holdings Radar frontend — event feed, holdings view, add/remove wallet, review actions | 🟡 M | `dashboard/src/app/radar/page.tsx` |
| 9.4–9.9 | 🐛 FIX | Cascade of price/dust/USD bugs in radar snapshot and feed | 🟢 S | `radar-snapshot.service.ts`, `radar/page.tsx` |

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
| **AnalystGuard** | `src/api/shared/guards/analyst.guard.ts` | `isAnalyst \|\| isAdmin` |
| **Telegram bot entry** | `src/bot/intel/index.ts` | Standalone process — runs from `dist/bot/intel/index.js` via PM2 (`sova-tg-bot`) |
| **Telegram bot spec** | `.ai/context/telegram-bot/spec.md` | Architecture decisions, file structure, API contract |
| **Bot API key script** | `scripts/manage-api-keys.ts` | `create <userId> -d "..." -s "full"` to generate key |
| **Intel SDK** | `packages/sdk/src/` | `SovaIntelClient` — canonical types + HTTP client. `pnpm test` for unit, `pnpm test:contract` for live API validation |
| **Bot env vars** | `.env` | `INTEL_BOT_TOKEN`, `INTEL_API_KEY`, `INTEL_BOT_ALLOWED_USER_IDS`, `INTEL_BASE_URL` (optional, defaults to localhost:3001) |

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

**Last Updated:** 2026-03-10  **Branch:** `feat/telegram-bot-intel`  **TG-1 through TG-10 complete — bot live, running from dist/, SDK aligned with API**








