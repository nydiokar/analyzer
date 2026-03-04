# Sova Intel - Project Context

**Branch:** `main`  **Last Updated:** 2026-03-04  **Status:** PFT bot complete → Payment infrastructure (Solana Pay + X402) is next priority

---

##  Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ✅ | PFT Oracle Bot v2 — All phases complete (scaffold → IPFS) | 🔴 L | Phases 1-4 done. Bot live on PFT marketplace. `/profile`, `/holders`, `/analyze`, `/compare` + IPFS attachments all working. Phase 5 (hardening) is next when revisiting. |
| ⚪ | **[PAY-0] Create treasury wallet** | 🟢 S | New dedicated Phantom/Solflare wallet. Add pubkey to `.env` as `TREASURY_WALLET_ADDRESS`. Blocks all payment work. |
| ⚪ | **[PAY-1a] Prisma: CreditBalance + CreditTransaction models** | 🟢 S | Add both models to `schema.prisma`, run `prisma migrate dev`. Ledger pattern — never update balance directly, always append tx + update atomically. |
| ⚪ | **[PAY-1b] CreditsModule + CreditsService** | 🟡 M | `getBalance` (Redis→DB), `deduct`, `topUp`, `grantSignupBonus`. New module at `src/api/modules/credits.module.ts`. |
| ⚪ | **[PAY-1c] @RequireCredits decorator + CreditGuard** | 🟡 M | Decorator sets metadata, guard checks balance before + deducts after success. Failed requests don't charge. Returns HTTP 402 on insufficient credits. |
| ⚪ | **[PAY-1d] Wire signup bonus + decorate endpoints** | 🟢 S | Call `grantSignupBonus(userId)` in auth flow (100 free credits). Add `@RequireCredits(N)` to behavior-analysis(5), similarity(100+), dashboard jobs (10/25/50). |
| ⚪ | **[PAY-2a] Prisma: CreditPack + PaymentIntent models** | 🟢 S | Add to schema, migrate. Seed 3 default packs (Starter $15/1k, Builder $120/10k, Pro $900/100k). |
| ⚪ | **[PAY-2b] PaymentModule — checkout + status endpoints** | 🟡 M | `POST /payments/checkout` (creates intent, returns QR), `GET /payments/:id/status` (poll target), `GET /payments/packs`, `GET /users/me/credits`. Add `@solana/pay`, `@solana/web3.js`, `qrcode`. |
| ⚪ | **[PAY-2c] Payment confirmation worker (BullMQ)** | 🟡 M | Repeating job per pending intent. `findReference()` against Helius RPC, verify USDC mint + amount, mark confirmed, call `creditsService.topUp()`, emit WebSocket event, expire after 30min. |
| ⚪ | **[PAY-3] X402 protocol layer (agent/bot payments)** | 🔴 L | Extend CreditGuard: on 402 with no `X-Payment` header → return x402 payload. With header → verify on-chain tx → allow through → deduct. `pnpm add x402`. Enables autonomous agent consumption. |
| ⚪ | **[PAY-4] Credits dashboard UI** | 🟡 M | `/dashboard/credits` page: balance display, "Buy Credits" button → QR modal, transaction ledger, low-balance WebSocket notification. Admin: manual credit grant tool. |
| ⚪ | Production auth hardening: cookie-mode readiness + CSP tightening | 🔴 L | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until backend cookie auth, frontend CSRF header flow, and stricter CSP are complete. |
| ⚪ | Implement feed feature | 🔴 L | Design and implement activity feed functionality. |

**Recently Completed:**
-  **Holder Profiles UI cleanup** (Mar 4) - Removed "Top Holders" from nav (`AppShell.tsx` `navItems`) — route still exists, just not linked. Removed `OutcomeStrip` classification card (high churn / stable etc.) from `TokenPulse`. Replaced it with a 4th `CognitiveMetricCard` — **Fresh Supply** — showing `freshSupplyPercent` (supply % held by wallets with no exit history). Grid adjusted from `[auto_2fr_repeat(3,...)]` → `[auto_repeat(4,...)]`. Renamed "Holder (no exits yet)" → "Fresh" across `TraderDistributionBar`, `MinimalHoldersTable`, `WalletBaseballCard`. Tooltip on "Fresh" badge updated to "Fresh — holding with no exits yet". `getTokenOutcome` aliased as `getTokenStats` in `TokenPulse` import to reflect actual usage. **Files:** `AppShell.tsx`, `TokenPulse.tsx`, `CognitiveMetricCard.tsx`, `TraderDistributionBar.tsx`, `MinimalHoldersTable.tsx`, `WalletBaseballCard.tsx`.
-  **Log Level Refactor — Phase 1** (Feb 24) - Audited 94 INFO-level log calls across 16 backend files. Applied verdicts: 13 REMOVE, 54 → DEBUG, 27 KEEP. INFO output for a 20-wallet holder-profiles job reduced from 900+ lines to ~22. Phase 2 (structured events + CI schema enforcement) designed and documented at `.ai/context/log_audit/IMPLEMENTATION_PLAN.md` — not yet implemented.
-  **PFT Oracle Bot v2 — Phase 4: IPFS attachments** (Feb 23) - Tested `upload_content` MCP tool for large comparison markdown files. Bot now attaches IPFS-hosted reports when reply text exceeds on-chain size limits.
-  **PFT Oracle Bot v2 — Phase 3: `/analyze` and `/compare` commands** (Feb 23) - Explicit `/analyze` deferred jobs working across flash/working/deep scopes. `/compare` fully tested end-to-end with real wallets.
-  **PFT Oracle Bot v2 — `/compare` formatter overhaul** (Feb 23) - Rewrote `pft-bot_v2/src/formatters/comparison.ts` from scratch to handle the real `CombinedSimilarityResult` shape (`pairwiseSimilarities`, `binaryScore`, `capitalScore`, `sharedTokens`, `capitalAllocation`, `binaryUniqueTokenCount*`). Chat message now shows a per-pair card: progress bar + overall %, behavioral/capital split, shared token count with Jaccard % and per-wallet coverage (e.g. "285 tokens (52% of A · 59% of B · Jaccard 38%)"), top 5 token names inline. Queued-ack overrides `estimatedProcessingTime` with `~45 sec` (API was returning "9 minutes"). Report (`comparison.md`) has clean metadata table, wallet list with token counts, per-pair section with full addresses + metrics table, shared tokens filtered to ≥0.1% capital weight (capped at 50 rows). Context section replaces verdict: shows raw facts only — shared count, % of universe, Jaccard, per-wallet coverage, capital alignment signal. No editorial judgements. Test fixture updated to real shape. Live-tested against `F4CB..1k1Q` ↔ `GPsd..UXPU`: 285 shared tokens / 729 universe / 58% overall. **Files:** `pft-bot_v2/src/formatters/comparison.ts`, `pft-bot_v2/src/commands.ts`, `pft-bot_v2/src/test-formatters.ts`.
-  **PFT Oracle Bot v2 — Live Chain Registration & Testing** (Feb 22) - Successfully registered "Sova Intel" bot on Post Fiat testnet marketplace. Created wallet (`rEMrwTNtpjgoPgRZ1nTLS6oak5RpU4oQaL`, seed: `sEd7SuxpCYTQJ1Seb6N1tmbVTxahBdY`), installed dependencies, registered bot via MCP. Fixed critical amount parsing bug: MCP returns `amount_drops` not `amount_pft` (1 PFT = 1,000,000 drops). Bot successfully processed test payments, called analyzer API, and posted formatted wallet profiles on-chain. Added persistent hash storage (last 100 tx hashes saved to cursor file) + bot address filtering to skip own replies. **Remaining issue:** Cursor advancement not preventing reprocessing of old messages on restart - bot sees same 4 messages repeatedly. Root cause unclear: either MCP's `scan_messages` with `since_ledger` is inclusive, or wallet address filtering isn't working (`getWalletInfo().address` returns undefined). **Files:** `pft-bot_v2/.env`, `pft-bot_v2/src/scanner.ts`, `pft-bot_v2/create-wallet.ts`.
-  **PFT Oracle Bot v2 — Test Bot Job Completion + Formatter Refinement + HUD Update** (Feb 22) - Fixed test bot to wait for job completion and show final results instead of exiting after queuing. Added `waitForJobCompletion()` helper that polls every 2s (10min max), detects new jobs, formats results based on job type. Refined both formatters to eliminate all made-up heuristics and provide clear context: (1) **Holders formatter** now shows full wallet addresses (no truncation), full token metadata (name/symbol/mint), token-specific holdings ("Token Bag" column from `tokenHoldingValueSol`), clear "Overall PnL" label (wallet-wide realized), actual wallet exit time (not category typical), data quality medals (🥇🥈🥉) + cycle count, supply % by trader type, removed made-up star flag (winRate>0.65 heuristic). (2) **Profile formatter** clarified PnL is "(realized)", hold time is "(median across positions)", better section headers ("Performance (Overall)", "Trading Behavior"). Updated `WalletHud` interface after main merge: removed `medianPnlPerToken`, added `avgTxValueSol` (average transaction value in SOL). Profile formatter now shows "PnL (avg)" (trimmedMeanPnl) and "Avg Tx Size" (avgTxValueSol) instead of dual PnL metrics. Both formatters now only use real backend data - `isWhale`/`isBot` from HUD, all other fields directly from API responses. **Files:** `pft-bot_v2/src/test-bot.ts`, `pft-bot_v2/src/formatters/holders.ts`, `pft-bot_v2/src/formatters/profile.ts`, `pft-bot_v2/src/analyzer.ts`, `pft-bot_v2/src/test-formatters.ts`.
-  **PFT Oracle Bot v2 — `/profile` state machine + surface test** (Feb 20) - Rewrote `handleProfile` as a 5-state flow (unanalyzed → auto-flash, already running → hook in, system wallet → reject, HUD missing → re-queue working, HUD present → reply). `WalletHud` type synced to actual backend DTO (`provenance.dataRange`, `medianPnlPerToken`). Deferred jobs fetch HUD post-completion, not raw job blob. Added `test-bot.ts` interactive script (`npm run test:bot`) to validate full pipeline before wiring MCP.
-  **PFT Oracle Bot v2 — Phase 1 Scaffold** (Feb 20) - Created `pft-bot_v2/` as a standalone Node.js process (not NestJS module) for the "Sova Intel" bot on the Post Fiat network. Architecture: scan loop polls for inbound PFT messages every 5s → deterministic command parser (`/holders`, `/profile`, `/analyze`, `/compare`) → calls analyzer API (localhost:3001) → pure-function formatters produce text → replies on-chain via `@postfiatorg/pft-chatbot-mcp` MCP subprocess. **No LLM in the loop** — all formatting is deterministic. PFT MCP client wraps all 13 tools (v0.3.0 Zod schemas): `create_wallet`, `scan_messages`, `get_message`, `send_message`, `register_bot`, `search_bots`, `get_bot`, `delete_bot`, `upload_content`, `get_thread`, `check_balance`, `send_pft`, `get_wallet_info`. 4 runtime deps: `@modelcontextprotocol/sdk`, `axios`, `dotenv`, `@postfiatorg/pft-chatbot-mcp` (spawned via npx). **Files:** `pft-bot_v2/package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `ecosystem.config.cjs`, `src/config.ts`, `src/pft-client.ts`, `src/analyzer.ts`, `src/commands.ts`, `src/scanner.ts`, `src/deferred-jobs.ts`, `src/index.ts`, `src/formatters/holders.ts`, `src/formatters/profile.ts`, `src/formatters/analysis.ts`, `src/formatters/comparison.ts`. Plan docs at `.ai/context/pft-oracle/PLAN_pft-oracle-bot.md` and `PROMPT_scaffold-pft-bot.md`.
-  **Wallet Hunt UI** (Feb 18) - Full frontend for the Wallet Hunt feature. Three-column layout (`/wallet-hunt`): Hunts list (220px) | Snapshots (420px) | Candidates (flex). Hunt creation via inline input (Enter/Escape). Snapshot rows use `TokenBadge inline size="s"` for full token identity (avatar, name, symbol, market cap, chart link). Candidate rows are 2-line: WalletBadge + confidence bar + track button on row 1; overlapping `MiniTokenAvatar` chips showing exactly which token mints the wallet appeared in on row 2. Optimistic snapshot removal with revert on error. Track button cross-references `useFavorites` + session-local Set to show "tracked" state without re-fetching. Inactivity warning (>14 days) rendered as a plain flex div to avoid shadcn Alert's absolute-icon CSS conflict. **Files:** `dashboard/src/app/wallet-hunt/page.tsx`, `dashboard/src/hooks/useWalletHunts.ts`, `dashboard/src/types/api.ts` (+wallet hunt types), `dashboard/src/lib/swr-config.ts` (+cache keys), `dashboard/src/lib/error-messages.ts` (+5 hunt error contexts), `dashboard/src/components/layout/AppShell.tsx` (+nav item).
-  **Wallet Hunt Feature** (Feb 18) - Full CRUD feature for cross-token wallet hunting. Users create named "hunts", add token snapshots (top-holder captures from Solana RPC), and the system computes candidate wallets that appear across multiple token snapshots (intersection logic). Candidates can be tracked (saved to favorites). 5-hunt limit per user enforced. Duplicate snapshot (same token+source) rejected with 400. Fixed post-implementation: `ValidationPipe` missing on `POST /wallet-hunts` and `POST /:id/snapshots` causing 500 instead of 400 on bad input. **Files:** `wallet-hunt.controller.ts`, `wallet-hunt.service.ts`, `wallet-hunt.module.ts`, `wallet-hunt.dto.ts`, `prisma/migrations/20260218101209_add_wallet_hunt/`.


<details>
<summary><b>Legend</b></summary>

**Status:**  In Progress   Blocked   Ready   Testing
**Scope:**  Small (<50 lines, <1hr)   Medium (2-5 files, <4hrs)   Large (5+ files, multi-day)

</details>

---

##  Current Focus & Priorities

### P0: Payment Infrastructure — NEXT UP (Feb 23+)

Solana-native credit system. No Stripe. USDC only. Modular: humans pay via Solana Pay QR, agents pay via X402.
Full plan: `.ai/context/monetization/DEFINITIVE_PLAN.md`

**Unblocked order:**
1. `[PAY-0]` Create treasury wallet → add to `.env` ← **START HERE**
2. `[PAY-1a→1d]` Credit system (DB models + guard + signup bonus) — validates without any real payment
3. `[PAY-2a→2c]` Solana Pay checkout — humans buy credit packs with USDC via QR
4. `[PAY-3]` X402 layer — agents/bots pay per-request autonomously
5. `[PAY-4]` Credits dashboard UI — fully self-service

**Open questions before starting:**
- Treasury wallet created? (hard blocker)
- Free credits on signup: 100?
- Pack pricing confirmed: $15 / $120 / $900?
- Credits expiry: no expiry recommended

### P1: PFT Oracle Bot v2 — ✅ COMPLETE (Phases 1-4, Feb 20-23)

Phases 1-4 done and live on PFT marketplace. `/profile`, `/holders`, `/analyze`, `/compare` + IPFS attachments all working.
Phase 5 (hardening: payment validation, crash recovery, rate limiting) deferred — revisit after payment infra.
**Plan docs:** `.ai/context/pft-oracle/PLAN_pft-oracle-bot.md`

### P2: Helius API Optimization — ✅ COMPLETE (Feb 16-17)

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

### February 26, 2026 (Latest)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 26.1 | 📊 INVESTIGATION | PostgreSQL growth attribution (day-level + table-level + wallet pressure points) | 🟡 M | DB internals (`pg_class`, `pg_stat_user_tables`), container `analyzer-postgres`, `.ai/CONTEXT.md` |

**26.1:** Investigated sustained DB growth (~1 GB/day observed operationally) directly in production PostgreSQL (`sova_analyzer`) via read-only SQL from `analyzer-postgres` container. Current DB size: **13 GB** (`13967906483` bytes). Largest tables by total relation size: `SwapAnalysisInput` **9194 MB**, `HeliusTransactionCache` **2105 MB**, `TokenLot` **1136 MB**, `AnalysisResult` **638 MB**.  
14-day estimated growth share (from day-level row ingest × current per-row relation footprint):  
- `SwapAnalysisInput`: **~60.9%** (**404.7 MB/day** avg)  
- `HeliusTransactionCache`: **~21.3%** (**141.7 MB/day** avg)  
- `TokenLot`: **~11.3%** (**75.5 MB/day** avg)  
- `AnalysisResult`: **~6.5%** (**43.0 MB/day** avg)  
Key anomaly day: **2026-02-12** (simultaneous surge across all large tables; est. ~1.57 GB from these 4 tables alone).  
Main storage inflation pressure is not vacuum bloat on the top ingest tables: `SwapAnalysisInput` dead tuples are near-zero (`0.01%`), `HeliusTransactionCache` dead tuples `0`. Growth is primarily new inserts.  
Critical index pressure: `SwapAnalysisInput_signature_mint_direction_amount_key` is **~3791 MB** alone (largest single index in DB), indicating high duplicate-prevention/index amplification cost on heavy ingest path.  
Wallet concentration remains meaningful: top wallets in last 14 days contribute tens of thousands of rows each (`SwapAnalysisInput` top wallet `45047` rows; `TokenLot` top wallet `16437`; `AnalysisResult` top wallet `12645` updated rows).
Playbook for future sessions: `.ai/context/db_op/DB_GROWTH_PLAYBOOK_2026-02-26.md`

### February 24, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 24.1 | 🔧 REFACTOR | Log level refactor Phase 1 — INFO noise 900+ → ~22 lines per job | 🔴 L | 16 `src/` files across processors + core services |

**24.1:** Full audit of 94 INFO-level log calls. Verdict categories: 13 REMOVE (BullMQ worker events, instantiation logs, DB record ID bookkeeping), 54 → DEBUG (per-wallet sub-steps, internal filter stats, cache management, phase telemetry), 27 KEEP (job entry/exit boundaries, PnL outcomes, sync completion, error recovery). Files touched: `analysis-operations.processor.ts`, `enrichment-operations.processor.ts`, `similarity-operations.processor.ts`, `database-service.ts`, `helius-sync-service.ts`, `helius-api-client.ts`, `pnl-analysis-service.ts`, `wallet-balance-service.ts`, `behavior.service.ts` (API + core), `analyzer.ts` (behavior), `similarity.service.ts`, `token-info.service.ts`, `holder-profiles-cache.service.ts`, `dexscreener-service.ts`, `onchain-metadata.service.ts`. Signal check written to `IMPLEMENTATION_PLAN.md` — one noted gap: behavior analysis inside the holder-profile per-wallet path has no INFO boundary (low impact; orchestration completion count covers it). Phase 2 design (structured event keys + CI allowlist) documented but not implemented.

### February 23, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 23.1 | 🔧 REFACTOR | `/compare` formatter overhaul — real API shape, Jaccard context, no verdicts | 🟡 M | `pft-bot_v2/src/formatters/comparison.ts`, `src/commands.ts`, `src/test-formatters.ts` |

### February 20, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 20.1 | 🎯 FEAT | PFT Oracle Bot v2 — Phase 1 scaffold (all source files + MCP client) | 🔴 L | `pft-bot_v2/src/*` (11 files), `package.json`, `tsconfig.json`, `ecosystem.config.cjs` |
| 20.2 | 🔧 REFACTOR | `/profile` state machine — smart flow for analyzed/unanalyzed/system wallets | 🟡 M | `src/analyzer.ts`, `src/commands.ts`, `src/deferred-jobs.ts`, `src/formatters/profile.ts` |
| 20.3 | 🧪 FEAT | Interactive surface test script — validates full pipeline before MCP wiring | 🟢 S | `src/test-bot.ts`, `package.json` |

**Summary:**

**20.1:** Created `pft-bot_v2/` — a standalone Node.js bot ("Sova Intel") that runs on the Post Fiat (PFTL) network. Users send commands with PFT payment, the bot calls the analyzer API, formats JSON into text, and replies on-chain. **Architecture:** Spawns `@postfiatorg/pft-chatbot-mcp` (v0.3.0) as an MCP stdio subprocess for all chain I/O (XRPL transactions, IPFS encryption, bot registry). The bot is the application layer on top — deterministic command parsing, analyzer HTTP client, pure-function formatters. No LLM, no database, no changes to analyzer backend. **MCP Client Coverage:** All 13 tools wrapped. **Key design decisions:** (1) MCP subprocess over direct import — `index.d.ts` exports nothing, stdio is the stable contract. (2) Deferred job polling — file persistence for crash recovery. (3) Cursor + dedup Set prevents double-processing on restart.

**20.2:** Rewrote `/profile` as a proper state machine before touching the chain. The original flow was `GET /hud → if null: "go use /analyze"` — broken UX that punted to the user. New flow: (1) `GET /wallets/{addr}/summary` — fast read, tells us wallet state. (2) `status: 'unanalyzed'` → auto-queue flash analysis → defer with `type: 'profile'` → ack. (3) `alreadyRunning` → hook into existing job. (4) `skipped` (LP/system wallet) → reject with label. (5) `status: 'ok'` but HUD null → queue working analysis → defer. (6) HUD present → immediate reply. Deferred jobs for both `'profile'` and `'analysis'` now resolve by fetching HUD post-completion (not parsing raw BullMQ result). `WalletHud` interface updated to match actual backend DTO: added `provenance.dataRange`, `medianPnlPerToken`, `signalType`. Profile formatter shows both P/L signals (median + trimmed mean) and data date range from provenance. **Files:** `src/analyzer.ts` (WalletHud type), `src/commands.ts` (handleProfile rewrite), `src/deferred-jobs.ts` (type + sendResult), `src/formatters/profile.ts` (full rewrite).

**20.3:** Added `src/test-bot.ts` — interactive REPL that simulates the full bot pipeline without MCP or chain. Asks for `ANALYZER_API_KEY` (URL is hardcoded default `localhost:3001/api/v1`). Smoke-tests connectivity, then drops into a command loop: type `/profile <addr>`, `/analyze <addr>`, `/holders <mint>`, or paste a bare address (auto-wraps as `/profile`). Prints parse result, exact bot reply text, any attachments, elapsed time, and registered deferred jobs. Run with `npm run test:bot`. **Files:** `src/test-bot.ts`, `package.json` (+`test:bot` script).


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

**Last Updated:** 2026-02-26  **Branch:** `main`








