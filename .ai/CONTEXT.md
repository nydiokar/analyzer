# Sova Intel - Project Context

**Branch:** `feat/credit-ledger-foundation`  **Last Updated:** 2026-02-26  **Status:** PAY-4 frontend complete + verified E2E → PAY-4b (checkout page UX upgrade) next, then PAY-3 (X402)

---

##  Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ✅ | PFT Oracle Bot v2 — All phases complete (scaffold → IPFS) | 🔴 L | Phases 1-4 done. Bot live on PFT marketplace. `/profile`, `/holders`, `/analyze`, `/compare` + IPFS attachments all working. Phase 5 (hardening) is next when revisiting. |
| ✅ | **[PAY-0] Create treasury wallet** | 🟢 S | New dedicated Phantom/Solflare wallet. Add pubkey to `.env` as `TREASURY_WALLET_ADDRESS`. Blocks all payment work. |
| ✅ | **[PAY-1a] Prisma: CreditBalance + CreditTransaction models** | 🟢 S | Both models added to `schema.prisma`. User gets `creditBalance`/`creditTransactions` relations. Run `npx prisma migrate dev --name credit-ledger` to apply. Branch: `feat/credit-ledger-foundation`. |
| ✅ | **[PAY-1b] CreditsModule + CreditsService** | 🟡 M | `getBalance`, `deduct` (atomic, throws 402 on short balance), `topUp`, `grantSignupBonus` (non-fatal, called from AuthService.register). `@Global()` module wired into AppModule. Branch: `feat/credit-ledger-foundation`. |
| ✅ | **[PAY-1c] @RequireCredits decorator + CreditGuard** | 🟡 M | Decorator sets metadata (`@RequireCredits(N)`), `CreditGuard` checks balance before, `CreditInterceptor` deducts after success. Failed requests don't charge. Returns HTTP 402 on insufficient credits. Test endpoint at `GET /api/v1/test-auth/credits`. |
| ✅ | **[PAY-1d] Decorate endpoints** | 🟢 S | `@RequireCredits(5)` on `GET /wallets/:addr/behavior-analysis`, `@RequireCredits(100)` on `POST /analyses/similarity/queue`, `@RequireCredits(10)` on `POST /analyses/wallets/dashboard-analysis`. Verified: 402 `{"error":"insufficient_credits","balance":0,"required":5}` returned on 0-balance requests. |
| ✅ | **[PAY-2a] Prisma: CreditPack + PaymentIntent models** | 🟢 S | Both models added. Migration `20260224122500_payment_packs` applied. 3 packs seeded via `pnpm seed`. |
| ✅ | **[PAY-2b] PaymentModule — checkout + status endpoints** | 🟡 M | `POST /payments/checkout` (creates intent, returns QR), `GET /payments/:id/status`, `GET /payments/packs`, `GET /users/me/credits`. `@solana/pay`, `@solana/web3.js`, `qrcode` installed. Verified end-to-end. |
| ✅ | **[PAY-2c] Payment confirmation — webhook + reconciliation** | 🟡 M | `POST /integrations/helius/payment-webhook` — verifies `HELIUS_PAYMENT_WEBHOOK_SECRET`, finds pending intent by reference pubkey in accountData, validates USDC mint + amount, calls `creditsService.topUp()`, marks intent `confirmed`, emits `payment:confirmed` WS event. `PaymentReconciliationProcessor` — BullMQ worker on `payment-reconciliation` queue, `upsertJobScheduler` runs every 5min, scans pending intents >2min old, calls `findReference()` once per intent, expires stale ones. Idempotent via `updateMany where status=pending`. **Bug fixed (Feb 26):** Helius sends `tokenAmount` as human float (e.g. `15`), not raw base units — removed erroneous `/1e6` division. **Verified E2E (Feb 26):** Real $15 USDC payment → webhook fired → intent confirmed → 1000 credits landed. **Files:** `src/api/services/payment-confirmation.service.ts`, `src/api/controllers/helius-webhook.controller.ts` (+handler), `src/queues/processors/payment-reconciliation.processor.ts`, `src/queues/queue.module.ts`, `dashboard/src/app/pay-test/page.tsx` (test page). |
| ⚪ | **[PAY-3] X402 protocol layer (agent/bot payments)** | 🔴 L | Extend CreditGuard: on 402 with no `X-Payment` header → return x402 payload. With header → verify on-chain tx → allow through → deduct. `pnpm add x402`. Enables autonomous agent consumption. |
| ✅ | **[PAY-4] Credits dashboard UI** | 🟡 M | `/dashboard/credits` page live. Balance display, transaction ledger (delta/reason from real backend shape), Buy Credits modal (pack grid → QR → confirmed stages), `payment:confirmed` WS listener, status polling every 3s, SWR revalidation on confirmation, 402 handling in BehavioralPatternsTab + SimilarityLab, Credits nav item + live balance chip in AppShell. **Verified E2E Feb 26:** real $15 USDC → 1000 credits → Payment Confirmed modal → ledger updated. **Files:** `dashboard/src/app/dashboard/credits/page.tsx`, `dashboard/src/components/credits/CreditPurchaseModal.tsx`, `dashboard/src/hooks/useCredits.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/types/api.ts` (+payment types), `dashboard/src/lib/swr-config.ts` (+cache keys). |
| ⚪ | **[PAY-4b] Checkout page UX upgrade** | 🟡 M | Replace `CreditPurchaseModal` with a dedicated `/checkout?packId=xxx` page (Helius-style). Left column: order summary (pack name, credits, price, what you get). Right column: QR code + Solana Pay URL + expiry. Expiry handled gracefully — show "Session expired" state with "Start over" CTA back to `/dashboard/credits` instead of silent modal reset. Better mobile layout. See `.ai/context/monetization/PAY-4b-DESIGN.md` for reference. |
| ⚪ | Production auth hardening: cookie-mode readiness + CSP tightening | 🔴 L | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until backend cookie auth, frontend CSRF header flow, and stricter CSP are complete. |
| ⚪ | Implement feed feature | 🔴 L | Design and implement activity feed functionality. |

REMOVE AUTODOC from deps! 

**Recently Completed:**
-  **[PAY-2a/2b] Solana Pay checkout + schema** (Feb 24, branch `feat/credit-ledger-foundation`) — `CreditPack` + `PaymentIntent` models, migration applied, 3 packs seeded (Starter $15/1k, Builder $120/10k, Pro $900/100k). `PaymentService` generates Solana Pay URL + base64 QR via `@solana/pay` + `qrcode`. `PaymentController` exposes `GET /payments/packs`, `POST /payments/checkout`, `GET /payments/:id/status`, `GET /users/me/credits`. Verified: checkout returns valid Solana Pay URL targeting treasury wallet + valid QR PNG. Status polls correctly. **Files:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/api/services/payment.service.ts`, `src/api/controllers/payment.controller.ts`, `src/api/modules/payment.module.ts`, `src/api.module.ts`.
-  **[PAY-1d] Decorate production endpoints** (Feb 24, branch `feat/credit-ledger-foundation`) — `@RequireCredits(5)` on behavior-analysis, `@RequireCredits(100)` on similarity/queue, `@RequireCredits(10)` on dashboard-analysis. Verified with 402 on 0-balance user.
-  **[PAY-1c] @RequireCredits decorator + guard + interceptor** (Feb 24, branch `feat/credit-ledger-foundation`) — Created `@RequireCredits(N)` decorator for marking endpoints with credit cost. `CreditGuard` (pre-check) verifies user has sufficient balance before handler executes, throws HTTP 402 `{error,balance,required}` if insufficient. `CreditInterceptor` (post-deduct) deducts credits AFTER successful response (async, non-blocking). Failed requests do NOT consume credits. Both registered globally in `app.module.ts`. Test endpoint added: `GET /api/v1/test-auth/credits` (costs 5 credits). **Files:** `src/api/shared/decorators/require-credits.decorator.ts`, `src/api/shared/guards/credit.guard.ts`, `src/api/shared/interceptors/credit.interceptor.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/controllers/test.controller.ts`. **Test plan:** `.ai/context/monetization/PAY-1c-TEST-PLAN.md`. **Ready for testing.**
-  **[PAY-1a/1b] Credit ledger foundation** (Feb 24, branch `feat/credit-ledger-foundation`) — `CreditBalance` + `CreditTransaction` models added to `schema.prisma` (append-only ledger, never mutate balance directly). `CreditsService` implements atomic `topUp`/`deduct` via Prisma `$transaction` — deduct throws HTTP 402 `{error,balance,required}` on short balance. `CreditsModule` is `@Global`. `grantSignupBonus(userId)` wired into `AuthService.register()` (non-fatal). Migration applied: `20260224002042_credit_ledger`. **Files:** `prisma/schema.prisma`, `src/api/services/credits.service.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/modules/auth.module.ts`, `src/api/shared/services/auth.service.ts`.
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

### P0: Payment Infrastructure — IN PROGRESS (Feb 24)

Solana-native credit system. No Stripe. USDC only. Modular: humans pay via Solana Pay QR, agents pay via X402.
Full plan: `.ai/context/monetization/DEFINITIVE_PLAN.md`

**Progress:**
- ✅ `[PAY-1a]` Schema: `CreditBalance` + `CreditTransaction` models — migration applied (`20260224002042_credit_ledger`)
- ✅ `[PAY-1b]` `CreditsService` + `CreditsModule` + signup bonus wired
- ✅ `[PAY-1c]` `@RequireCredits` decorator + `CreditGuard` + `CreditInterceptor`
- ✅ `[PAY-1d]` Decorate endpoints — behavior-analysis(5), similarity(100), dashboard(10) — **verified with 402**
- ⚪ `[PAY-0]` Treasury wallet — create dedicated Phantom/Solflare wallet, add `TREASURY_WALLET_ADDRESS` to `.env`
- ✅ `[PAY-2a]` Schema: `CreditPack` + `PaymentIntent` models — migration `20260224122500_payment_packs`, 3 packs seeded
- ✅ `[PAY-2b]` `PaymentService` + `PaymentController` + `PaymentModule` — checkout QR, status poll, packs list, credits balance — **verified end-to-end**
- ✅ `[PAY-2c]` Webhook confirmation + reconciliation fallback — **verified E2E Feb 26** (real $15 USDC → 1000 credits confirmed)
- ✅ `[PAY-4]` Credits dashboard UI — `/dashboard/credits` page, purchase modal, WS confirmation, 402 handling — **verified E2E Feb 26**
- ⚪ `[PAY-4b]` Checkout page UX upgrade — dedicated `/checkout` page (Helius-style), graceful expiry handling
- ⚪ `[PAY-3]` X402 protocol layer (agent/bot autonomous payments)

**Open questions:**
- Treasury wallet created? (needed before PAY-2)
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
| 26.1 | 🐛 FIX | PAY-2c bug: Helius tokenAmount is human float not raw base units — remove /1e6 | 🟢 S | `src/api/services/payment-confirmation.service.ts` |
| 26.2 | 🧪 TEST | PAY-2c E2E verified: real $15 USDC → webhook → 1000 credits confirmed | 🟢 S | `dashboard/src/app/pay-test/page.tsx` |
| 26.3 | 🎯 FEAT | PAY-4: Credits dashboard page + purchase modal + WS + 402 handling | 🟡 M | `dashboard/src/app/dashboard/credits/page.tsx`, `dashboard/src/components/credits/CreditPurchaseModal.tsx`, `dashboard/src/hooks/useCredits.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/components/layout/AppShell.tsx`, `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`, `dashboard/src/app/similarity-lab/page.tsx` |
| 26.4 | 🐛 FIX | PAY-4 type audit: align CreditTransaction/PaymentStatus/CreditPack to real backend contracts | 🟢 S | `dashboard/src/types/api.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/components/credits/CreditPurchaseModal.tsx` |

**Summary:**

**26.1:** Fixed amount validation bug in `PaymentConfirmationService.tryConfirmByAccounts`. Helius Enhanced Transaction format sends `tokenTransfers[].tokenAmount` as a human-readable float (e.g. `15` for $15 USDC), not raw base units. The code was dividing by `1e6`, turning `15` into `0.000015` which always failed the `>= intent.amountUsdc` check. Removed the division — compare directly.

**26.2:** Full E2E test with real mainnet USDC payment. Helius webhook fired → reference pubkey matched pending intent → amount validated → `confirmIntent` ran → credits topped up → `payment:confirmed` WS event emitted. Status endpoint confirmed `phase: confirmed` with `txSignature`. Credit balance: 0 → 1000. Reconciliation fallback also triggered on the pre-fix pending intent. Test page at `dashboard/src/app/pay-test/page.tsx`.

**26.3:** Implemented PAY-4 frontend payment flow. `/dashboard/credits` page: balance card, credit costs reference, transaction ledger with `delta`-signed amounts and `reason`-derived labels. `CreditPurchaseModal`: 3-stage flow (pack grid → QR → confirmed). Polls `GET /payments/:id/status` every 3s via SWR `refreshInterval`. Separate Socket.IO listener for `payment:confirmed` WS event (faster confirmation path). Expiry countdown timer — hits zero → silently returns to pack selection. SWR `mutate` on credits cache key after confirmation. 402 handling: `BehavioralPatternsTab` shows contextual "Insufficient credits" EmptyState with Buy Credits button + suppresses retry on 402. `similarity-lab` shows Sonner toast with required/balance + "Buy Credits" action. Credits nav item (auth-only) + live balance chip in AppShell header. All hooks null-keyed when unauthenticated. **Verified E2E:** $15 USDC → Payment Confirmed modal → +1,000 in ledger. Known UX limitation: expiry returns to packs silently with no explanation — tracked as PAY-4b.

**26.4:** Post-implementation type audit against actual backend contracts. `CreditTransaction`: backend sends `delta`/`reason`/`refId`/`balanceAfter` — not `amount`/`type` (no enum). `PaymentStatus`: no `credits` field, no `failed` status (only `pending/confirmed/expired`), real fields are `status/phase/message/confirmedAt/txSignature`. `CreditPack`: removed invented `description` field. `ExpiryCountdown`: fixed interval recreation bug (removed `secondsLeft` from `useEffect` deps, use `useRef` for callback). `useCreditPacks`: auth-gated (endpoint requires JWT). `tsc --noEmit` clean.

### February 24, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 24.1 | 🎯 FEAT | Credit ledger foundation — Prisma models + CreditsService + signup bonus wired | 🟡 M | `prisma/schema.prisma`, `src/api/services/credits.service.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/modules/auth.module.ts`, `src/api/shared/services/auth.service.ts` |
| 24.2 | 🎯 FEAT | @RequireCredits decorator + CreditGuard + CreditInterceptor (PAY-1c) | 🟡 M | `src/api/shared/decorators/require-credits.decorator.ts`, `src/api/shared/guards/credit.guard.ts`, `src/api/shared/interceptors/credit.interceptor.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/controllers/test.controller.ts` |
| 24.3 | 🎯 FEAT | Decorate production endpoints with credit costs (PAY-1d) | 🟢 S | `src/api/controllers/wallets.controller.ts`, `src/api/controllers/analyses.controller.ts` |
| 24.4 | 🎯 FEAT | Solana Pay checkout + payment schema (PAY-2a/2b) | 🟡 M | `prisma/schema.prisma`, `prisma/seed.ts`, `src/api/services/payment.service.ts`, `src/api/controllers/payment.controller.ts`, `src/api/modules/payment.module.ts` |

**Summary:**

**24.1:** Implemented PAY-1a and PAY-1b on branch `feat/credit-ledger-foundation`. Added `CreditBalance` (one-to-one per user, running total) and `CreditTransaction` (append-only ledger, indexed on `userId+createdAt`) to `schema.prisma`. `User` gains `creditBalance` / `creditTransactions` relations. `CreditsService` provides: `getBalance` (returns 0 if no row), `topUp` (upsert balance + append tx in single Prisma `$transaction`), `deduct` (reads balance inside tx → throws HTTP 402 `{error,balance,required}` if short → decrements + appends tx), `grantSignupBonus` (calls topUp with `FREE_CREDITS_ON_SIGNUP` env var, default 100, swallows errors), `getRecentTransactions`. `CreditsModule` is `@Global()` — injectable everywhere without re-importing. Injected `CreditsService` into `AuthService`; `grantSignupBonus(user.id)` called immediately after user creation. Migration applied: `20260224002042_credit_ledger`. TypeScript compiles clean.

**24.3:** Implemented PAY-1d — applied `@RequireCredits(N)` to production endpoints: `GET /wallets/:addr/behavior-analysis` (5 credits, `wallets.controller.ts`), `POST /analyses/similarity/queue` (100 credits, `analyses.controller.ts`), `POST /analyses/wallets/dashboard-analysis` (10 credits, `analyses.controller.ts`). Dashboard scope tiers (flash=10/working=25/deep=50) deferred — scope is a runtime body param, static decorator applies flash cost as baseline. Verified end-to-end: set balance to 0 via Prisma, hit both `/test-auth/credits` and `/wallets/.../behavior-analysis` — both returned HTTP 402 `{"error":"insufficient_credits","balance":0,"required":5}`. Guard reads live DB balance; decorator metadata drives the `required` field correctly.

**24.2:** Implemented PAY-1c — credit gating infrastructure. Created `@RequireCredits(N)` decorator (sets metadata). `CreditGuard` (global, registered in `app.module.ts`) runs BEFORE handler: reads metadata → checks user auth → fetches balance → throws HTTP 402 `{error:"insufficient_credits",balance:N,required:N}` if short → stores `creditCost` on request object if sufficient. `CreditInterceptor` (global) runs AFTER handler: reads `creditCost` from request → on success, calls `creditsService.deduct()` asynchronously (non-blocking) → on error, does nothing (failed requests don't consume credits). Both use existing `CreditsService` atomic operations. Test endpoint added: `GET /api/v1/test-auth/credits` requires 5 credits, returns success message. Test plan documented at `.ai/context/monetization/PAY-1c-TEST-PLAN.md`. TypeScript compiles clean. **Ready for testing before PAY-1d.**

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

**Last Updated:** 2026-02-26 (evening)  **Branch:** `feat/credit-ledger-foundation`










