# Sova Intel - Project Context

**Branch:** `main` / `feature/token-dash-v2`  **Last Updated:** 2026-03-19  **Status:** Token Dashboard — transplant complete, personal token watchlist shipped, branch ready to merge

**Base:** `feat/tracked-wallets-page` → `main` (Credit ledger + Intel API + X402 + Holdings Radar — all complete)

---

##  Active Work


### March 23, 2026 — GTM Week 1 Remaining Tasks (Day 5 of 7)

**Posts: 4/7. 2 days left (Mar 24-25). Need 3 more posts.**

| # | Task | Priority | Notes |
|:--:|:-----|:--------:|:------|
| GTM-1 | **Fix + post Colosseum draft** | 🔴 NOW | Replace fabricated "454 agents" number with a real stat. Draft is in `.claude/drafts/`. One edit, one publish → 5/7 posts. |
| GTM-2 | **Post token holder breakdown** | 🔴 NOW | Pick a trending token, run `POST /intel/token/:mint/holders`, post the distribution. All 4 posts so far are wallet-focused — need token content. 20 min. |
| GTM-3 | **Open Twitter bot for public use** | 🔴 NOW | Rate-limit it and open. This is the Week 1 organic flywheel — every public lookup is a shareable card impression. Announce on @Sova_intel. |

---

### March 22, 2026 — GTM Playbook + sova-x Wallet Profile Card 

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 22.1 | 🎯 FEAT | GTM W1: published runner analysis + $DOWNALDTWUMP thread (2/7 posts). Integration guide draft fixed (SDK field names). x402 Hook + Colosseum drafts ready to post. | 🟢 S | `.claude/drafts/`, `.claude/agent-progress/PROGRESS.md` |
| 22.2 | 🎯 FEAT | sova-x: on-demand wallet profile card — SVG renderer + CLI script. `pnpm test:wallet-card <ADDR>` → PNG in `out/`. Uses public `GET /intel/wallet/:addr`. Design in progress. | 🟡 M | `sova-x/src/render/wallet-profile-card.ts`, `sova-x/src/scripts/test-wallet-card.ts` |

---

### Pending carry-over (not this branch)

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ⚪ | **[PAY-X402-RECEIPT]** Fix `X-Payment-Response` receipt header — split `confirmAndRecord` into broadcast (fast, in guard) + confirm (slow, fire-and-forget), set header synchronously in interceptor with known sig | 🟢 S | `x402-verification.service.ts`, `credit.guard.ts`, `credit.interceptor.ts` |
| ⚪ | **[PAY-5d]** Blocked wallet E2E test — `isActive=false` returns 403 | 🟢 S | Manual DB flip + script |
| ⚪ | **[INTEL-DEEP-BUG]** Fix `/intel/token/:mint/holders/deep` similarity chaining — add `chainSimilarity: true` flag to job, processor auto-queues similarity after holder-profiles completes | 🟡 M | `src/queues/jobs/types/index.ts`, `intel.controller.ts`, `analysis-operations.processor.ts` |
| ⚪ | **[HUD-TOKENS-DAY]** Fix wallet HUD `tokens/day` metric — `uniqueTokensPerDay` is currently derived from wall-clock span (`firstTransactionTimestamp` → `lastTransactionTimestamp`) instead of true active trading days, which understates wallets with gaps between sessions. Correct fix: compute and persist `activeTradingDays` in behavior analysis from distinct trading dates, then have HUD/profile views use that field with a legacy fallback for old rows. | 🟡 M | `src/core/analysis/behavior/analyzer.ts`, `src/core/analysis/behavior/behavior-service.ts`, `src/api/services/wallet-hud.service.ts`, `prisma/schema.prisma` |
| ⚪ | **[SUBMODULES-BOTS-INTEL-DOCS]** Extract the Twitter bot implementation, Telegram bot implementation, and external `/intel` API documentation into separate git submodules so they can be versioned and maintained independently from the main analyzer repo. Scope includes deciding boundaries, moving the code/docs cleanly, and updating local references/build workflows so the main repo still integrates with those modules without duplicating sources. | 🔴 L | `src/bot/`, `pft-bot_v2/`, `packages/sdk/`, `documentation/`, `src/api/controllers/intel.controller.ts` |
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


### P1: Helius API Optimization — ✅ COMPLETE (Feb 16-17)

**Phase 2 (future):** Helius Webhooks / WebSocket subscriptions for active wallets

---

##  Recent Activity

### March 13, 2026 (Latest) — Sig Buyers UI (branch: feature/sig-buyers-ui)

### March 19, 2026 (Latest) — Token Dashboard Merge Polish (branch: feature/token-dash-v2)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 19.1 | 🔧 FIX | Personal token watchlist modal finished — user watchlist API wired through navbar star, personal tags editable, DexScreener `pairCreatedAt` surfaced as token age in favorites | 🟢 S | `user-watched-tokens.service.ts`, `TokenWatchlistModal.tsx`, `useUserWatchedTokens.ts`, `watched-tokens.service.ts` |
| 19.2 | 🔧 FIX | `/tokens` UI simplified for analysts — removed sparkline fetch/render from watched token list and token thread, showing tags instead of trend lines in the list | 🟢 S | `WatchedTokenList.tsx`, `TokenThread.tsx` |

**Summary:** Token dashboard transplant is complete, personal token watchlist UX is shipped, and the branch is ready to merge into `main`.

---

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 13.4 | 🎯 FEAT | SB-1–6: Significant Buyers scaffold — backend service (5-phase pipeline: RPC signatures → enrich → group → filter → analyze), controller, module, frontend page with UTC date/time picker + duration presets + min SOL presets + results table (max 200 rows, copy-all) | 🟡 M | `sig-buyers.dto.ts`, `sig-buyers.service.ts`, `sig-buyers.controller.ts`, `sig-buyers.module.ts`, `tools/sig-buyers/page.tsx`, `AppShell.tsx` |
| 13.5 | 🔧 FIX | System wallet filtering uses centralized registry (`isKnownWallet` + `SystemWalletDetectionService.filterSystemWallets`) — removed hardcoded address list | 🟢 S | `sig-buyers.service.ts` |
| 13.6 | 🔧 FIX | All times UTC throughout — `T...Z` parsing, `getUTC*()` display, ISO slice in results, "UTC" labels in UI | 🟢 S | `tools/sig-buyers/page.tsx` |

**SB-1–11 complete. Feature fully shipped.**

---

### March 13, 2026 — Self-serve API keys

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 13.1 | 🎯 FEAT | Self-serve API key endpoints — `POST/GET/DELETE /users/api-keys` (scope `['read']`, throttle 5/hr, ownership enforced) | 🟢 S | `src/api/controllers/users.controller.ts`, `src/api/modules/users.module.ts` |
| 13.2 | 🎯 FEAT | Developer dashboard page — credit balance, one-time key reveal with copy button, key list + revoke. Nav link in UserMenu dropdown | 🟢 S | `dashboard/src/app/dashboard/developer/page.tsx`, `dashboard/src/components/auth/UserMenu.tsx` |
| 13.3 | 🔧 FIX | `pnpm install` from root — linked `@sova-intel/sdk@0.1.1` workspace package into `node_modules` (was missing, caused bot TS errors) | 🟢 S | `pnpm-workspace.yaml`, `node_modules/@sova-intel/sdk` |

**Summary:** Any developer can now register via email, receive signup credits automatically, open User Menu → API Keys, generate a key, and hit `/intel` endpoints immediately — zero manual intervention required. Registration gate (invite codes) toggled off via admin panel.

---

### March 10, 2026

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

DB ops runbook:
- Use [.ai/context/db_op/ONLINE_DB_CLEANUP_RUNBOOK_2026-03-05.md](/home/luna/analyzer/.ai/context/db_op/ONLINE_DB_CLEANUP_RUNBOOK_2026-03-05.md) for prune/repack maintenance, protected-wallet prune commands, and verified `pg_repack` workflow/results.

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
| **X (Twitter) bot** | `submodules/sova-x/` | full implementation — see repo for src, commands, formatters |
| **Public API docs** | `submodules/sova-intel/` | Docusaurus site — endpoints, SDK, pricing, SKILL.md |
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

**Last Updated:** 2026-03-22  **Branch:** `main`

---
