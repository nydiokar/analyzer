# Sova Intel - Project Context

**Branch:** `main`  **Last Updated:** 2026-03-06  **Status:** Credit ledger + Intel API layer merged from feat/credit-ledger-foundation — X402 agent payments live, TypeScript SDK shipped

---

##  Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| ✅ | **[PAY-8] Synchronous cold-wallet resolution — eliminate split flow** | 🔴 L | Current cold wallet flow is fundamentally broken for the payment model: `GET /hud` cold → 402 → pay 1cr → 202 (job queued) → client polls → `GET /hud` again → 402 → **pay 1cr again** → 200 (data). **Double charge confirmed** — `@RequireCredits` fires on every request, has no memory that this wallet was already paid 15s ago. Problems: (1) **double charging** — agent pays 1cr to queue and 1cr again to retrieve; (2) **free compute attack** — a different caller can queue at 0cr (no auth) and never pay; (3) **incoherent payment UX** — 3 requests to get 1 result; (4) **broken x402 verification** — spec requires 402 visible on entry, but queue step bypasses it for unauthenticated callers. **Fix:** `/hud` and `/intel/wallet/:addr` must hold the HTTP connection open on cold wallet — queue the flash job internally, await completion (max 30s via BullMQ completion event or Redis pub/sub on the specific jobId), then return 200 + data in a single request/response. Client always sees: 402 (price discovery) → pay → one request → one result. 1cr charged once on entry. **No `/wait` endpoint** — the waiting is internal to the existing handler, fully transparent to the client. Fallback to 202+jobId only if analysis exceeds 30s timeout (rare for flash scope). |
| ✅ | **[PAY-0] Create treasury wallet** | 🟢 S | New dedicated Phantom/Solflare wallet. Add pubkey to `.env` as `TREASURY_WALLET_ADDRESS`. Blocks all payment work. |
| ✅ | **[PAY-1a] Prisma: CreditBalance + CreditTransaction models** | 🟢 S | Both models added to `schema.prisma`. User gets `creditBalance`/`creditTransactions` relations. Run `npx prisma migrate dev --name credit-ledger` to apply. Branch: `feat/credit-ledger-foundation`. |
| ✅ | **[PAY-1b] CreditsModule + CreditsService** | 🟡 M | `getBalance`, `deduct` (atomic, throws 402 on short balance), `topUp`, `grantSignupBonus` (non-fatal, called from AuthService.register). `@Global()` module wired into AppModule. Branch: `feat/credit-ledger-foundation`. |
| ✅ | **[PAY-1c] @RequireCredits decorator + CreditGuard** | 🟡 M | Decorator sets metadata (`@RequireCredits(N)`), `CreditGuard` checks balance before, `CreditInterceptor` deducts after success. Failed requests don't charge. Returns HTTP 402 on insufficient credits. Test endpoint at `GET /api/v1/test-auth/credits`. |
| ✅ | **[PAY-1d] Decorate endpoints** | 🟢 S | `@RequireCredits(5)` on `GET /wallets/:addr/behavior-analysis`, `@RequireCredits(100)` on `POST /analyses/similarity/queue`, `@RequireCredits(10)` on `POST /analyses/wallets/dashboard-analysis`. Verified: 402 `{"error":"insufficient_credits","balance":0,"required":5}` returned on 0-balance requests. |
| ✅ | **[PAY-2a] Prisma: CreditPack + PaymentIntent models** | 🟢 S | Both models added. Migration `20260224122500_payment_packs` applied. 3 packs seeded via `pnpm seed`. |
| ✅ | **[PAY-2b] PaymentModule — checkout + status endpoints** | 🟡 M | `POST /payments/checkout` (creates intent, returns QR), `GET /payments/:id/status`, `GET /payments/packs`, `GET /users/me/credits`. `@solana/pay`, `@solana/web3.js`, `qrcode` installed. Verified end-to-end. |
| ✅ | **[PAY-2c] Payment confirmation — webhook + reconciliation** | 🟡 M | `POST /integrations/helius/payment-webhook` — verifies `HELIUS_PAYMENT_WEBHOOK_SECRET`, finds pending intent by reference pubkey in accountData, validates USDC mint + amount, calls `creditsService.topUp()`, marks intent `confirmed`, emits `payment:confirmed` WS event. `PaymentReconciliationProcessor` — BullMQ worker on `payment-reconciliation` queue, `upsertJobScheduler` runs every 5min, scans pending intents >2min old, calls `findReference()` once per intent, expires stale ones. Idempotent via `updateMany where status=pending`. **Bug fixed (Feb 26):** Helius sends `tokenAmount` as human float (e.g. `15`), not raw base units — removed erroneous `/1e6` division. **Verified E2E (Feb 26):** Real $15 USDC payment → webhook fired → intent confirmed → 1000 credits landed. **Files:** `src/api/services/payment-confirmation.service.ts`, `src/api/controllers/helius-webhook.controller.ts` (+handler), `src/queues/processors/payment-reconciliation.processor.ts`, `src/queues/queue.module.ts`, `dashboard/src/app/pay-test/page.tsx` (test page). |
| ✅ | **[PAY-3] X402 protocol layer (agent/bot payments)** | 🔴 L | Implemented + E2E verified Feb 27. Agents pay per-request via real on-chain USDC — no API key needed. Wallet-identified (`<pubkey>@x402.agent`). Replay protection via Redis SET NX. Fixed: ATA vs raw wallet address comparison in `X402VerificationService.extractUsdcTransfer`. See `.ai/context/monetization/PAY-3-X402-DECISIONS.md`. |
| ✅ | **[PAY-4] Credits dashboard UI** | 🟡 M | `/dashboard/credits` page live. Balance display, transaction ledger (delta/reason from real backend shape), Buy Credits modal (pack grid → QR → confirmed stages), `payment:confirmed` WS listener, status polling every 3s, SWR revalidation on confirmation, 402 handling in BehavioralPatternsTab + SimilarityLab, Credits nav item + live balance chip in AppShell. **Verified E2E Feb 26:** real $15 USDC → 1000 credits → Payment Confirmed modal → ledger updated. **Files:** `dashboard/src/app/dashboard/credits/page.tsx`, `dashboard/src/components/credits/CreditPurchaseModal.tsx`, `dashboard/src/hooks/useCredits.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/types/api.ts` (+payment types), `dashboard/src/lib/swr-config.ts` (+cache keys). |
| ✅ | **[PAY-4b] Checkout page UX upgrade** | 🟡 M | Dedicated `/dashboard/credits/checkout/[packId]` route. Two-column layout: left = order summary (pack name, price, "what you get" breakdown per operation type), right = QR code + copy Solana Pay URL + expiry countdown + all terminal states (loading/qr/confirmed/expired/error). `ExpiryCountdown` extracted to shared component. `CreditPurchaseModal` kept (still used as fallback) but no longer primary flow. Credits page restructured: two-column (balance+costs+CTA left, full transaction history right), pack grid below the fold with "Top Up" scroll-to. "Most Popular" highlight on middle pack. `Top Holders` removed from nav. `Credits` removed from nav (accessible via balance chip + UserMenu). UserMenu gains live Credits balance entry. **tsc clean.** |
| ✅ | **[PAY-6a] Map every endpoint to cost + gating decision** | 🟢 S | **AUDIT COMPLETE (Feb 27).** Full audit of all controllers. 3 gated endpoints reviewed, 2 ungated expensive endpoints identified, compound operations verified no-double-charge, frontend similarity coupling documented. See `.ai/context/monetization/PAY-6-PRICING-AUDIT.md`. |
| ✅ | **[PAY-6d] Verify compound operation charging** | 🟢 S | **VERIFIED (Feb 27).** dashboard-analysis with `queueWorkingAfter` does NOT double-charge (internal job-to-job, CreditGuard doesn't fire). holder-profiles child wallet jobs do NOT double-charge. Frontend similarity auto-fire IS a separate charge — to be decoupled (opt-in button). |
| ✅ | **[PAY-6b] Tune credit costs on existing gated endpoints** | 🟢 S | Done (commit fcd3e60): `behavior-analysis` gate removed. `dashboard-analysis` 10→5cr. `similarity/queue` 100→20cr. |
| ✅ | **[PAY-6c] Gate currently-free expensive endpoints** | 🟢 S | Done (commit fcd3e60): `holder-profiles` → @RequireCredits(25) (bundles similarity, auto-fires free). `holder-profiles/wallet` → @RequireCredits(5). |
| ✅ | **[PAY-6e] Update credits page UI to reflect final pricing** | 🟢 S | Done: `OPERATION_COSTS` → Dashboard=5cr, Holder Profiles+Similarity=25cr, Similarity standalone=20cr. Checkout breakdown updated to match. |
| ✅ | **[PAY-5a] Pricing discovery endpoint** `GET /intel/pricing` | 🟡 M | Done (commit fcd3e60): `PricingController` at `/api/v1/pricing`. `@Public()`. Returns endpoints[], packs[], x402 config. Wired into PaymentModule. |
| ✅ | **[PAY-7a] Holder-profiles + similarity pricing decision** | 🟢 S | **SUPERSEDED by PAY-SIM.** Original decision was 25cr bundled. Revised: 20cr for holder-profiles + dynamic 10/20cr for similarity = 30cr total for full flow. Standalone similarity 10cr (pre-synced) or 20cr (needs sync). See `.ai/context/monetization/PAY-SIMILARITY-DYNAMIC-PRICING.md`. |
| ✅ | **[PAY-SIM] Credit charging architecture fix** | 🟡 M | Done (Mar 1). (1) Removed `@RequireCredits(25)` from `holder-profiles` → explicit `creditsService.deduct(20cr)` with try/catch refund. (2) Removed `@RequireCredits(20)` from `similarity/queue` → dynamic `creditCost = walletsNeedingSync.length > 0 ? 20 : 10` with try/catch refund. (3) Injected `CreditsService` into `AnalysesController`. (4) Updated `pricing.controller.ts` similarity entry to 10cr min + updated description. `tsc --noEmit` clean. |
| ✅ | **[PAY-SIM-HOTFIX] Cache-aware charging alignment + Intel static guard** | 🟢 S | Done (Mar 3). (1) Similarity dynamic pricing excludes known/system wallets from sync eligibility to prevent false `20cr` on cache-heavy reruns. (2) Holder-profiles token jobs mark cache-only outcomes and auto-refund `20cr` for internal `/analyses/holder-profiles` requests when no wallet sync is required. (3) Refund path explicitly scoped to internal request IDs (`holder-profiles-*`) so Intel static-priced endpoints are unaffected. (4) Credits UI transaction mapping fixed: refund reasons no longer show as "Credit Purchase". |
| ✅ | **[PAY-SIM-UI] Transaction label fix + pricing display update** | 🟢 S | Done (Mar 1). (1) `getTxConfig` updated — reason→label map (Holder Profiles, Similarity Analysis, Dashboard Analysis, Wallet Profile), refund→text-yellow-400, x402→text-purple-400. (2) `OPERATION_COSTS` collapsed to 3 rows: Dashboard=5cr, Holder Profiles+Similarity=30cr, Similarity standalone=20cr. Separate `PACK_BREAKDOWN_COSTS` (3 rows) powers PackCard "what you get". (3) Checkout breakdown → Dashboard/5, Holder+Similarity/30, Standalone Similarity/20. (4) Left column now `lg:sticky` so balance+costs+CTA stay visible while scrolling. (5) Per-credit price display fixed: `$0.015 each` instead of `1.50¢`. (6) `CreditPack` seed re-run (packs were missing from DB). `tsc --noEmit` clean. **E2E verified Mar 1:** MISSING→20cr✅ READY→10cr✅ 402@balance=8(need10)✅ 402@balance=15(need20)✅ no-auth→401✅ balance unchanged on rejection✅. |
| ✅ | **[PAY-7] Intel API layer — GET endpoints** | 🔴 L | Done + E2E verified (Mar 2). Three GET endpoints: `GET /intel/wallet/:addr` (5cr) — aggregated summary+HUD+behavior+PnL, freshness 30min, stale→auto-queues flash→202 jobId (0cr charged via throw), re-call→200 data (5cr charged via return). `GET /intel/wallet/:addr/tokens` (3cr). `GET /intel/wallet/:addr/hud` (1cr). Static `@RequireCredits(N)` → X402 auto on all. Credit contract: handler `return`→interceptor fires (charges); `throw HttpException`→interceptor skips (0cr). E2E: 402 required:5 ✅ · 200 summary+HUD ✅ · /hud 1cr ✅ · /tokens 3cr ✅. |
| ✅ | **[PAY-7-POST] Intel POST scaffolds** | 🟢 S | `POST /intel/token/:mint/holders` and `POST /intel/wallets/batch-hud` wired and tsc clean (Mar 2). batch-hud: per-wallet freshness check, queues flash analysis for missing/stale wallets (same pattern as GET /intel/wallet/:addr), returns `{huds, queued[], skipped[]}`. holders: queues analyze-holder-profiles job, returns jobId — agent polls `GET /jobs/:id/result` for HolderProfilesResult. **Pricing fixed + remaining POST endpoints added in PAY-8a/8b/8c.** |
| ✅ | **[PAY-8a] Reprice `POST /intel/token/:mint/holders` → 20cr** | 🟢 S | Done (Mar 2). `@RequireCredits(20)`. JSDoc + Swagger updated. `changedFromCredits: 35` flagged in pricing controller. |
| ✅ | **[PAY-8b] `POST /intel/wallets/similarity` (20cr)** | 🟡 M | Done (Mar 2). New endpoint on `IntelController`. `@RequireCredits(20)` → X402 auto. Body: `{wallets: string[]}` (2-30 addresses). Validates all addresses, queues `ComprehensiveSimilarityFlowData` via `SimilarityOperationsQueue`. Returns `{status, jobId, requestId, walletCount, monitoringUrl}`. `SimilarityOperationsQueue` injected into `IntelController`. Pricing controller updated with new entry. |
| ✅ | **[PAY-8c] `POST /intel/token/:mint/holders/deep` (35cr — bundled)** | 🟡 M | Done (Mar 2). Queues holder-profiles job + similarity job independently, returns both jobIds. Agent provides `wallets[]` in body alongside `topN`. 12.5% discount vs 20+20=40cr separate calls. **Partial-failure bug fixed (see 2.3 below):** if similarity queue fails after holder-profiles job accepted, returns HTTP 206 with holder-profiles jobId and 0cr charged instead of 500 with ghost job. |
| ✅ | **[PAY-7b] Frontend: graceful 0-balance auto-trigger** | 🟡 M | Done (Mar 2). `WalletProfileLayout.tsx`: `shouldAutoTriggerFlash` guards on `creditBalance === null \|\| creditBalance < 5` — auto-trigger skipped while loading or low balance. `isDataStale` memo (30min window). Yellow staleness banner shown when `balance < 5 && isDataStale && !isAnalyzing && !isDemoAccount` — "Refresh (5cr)" button + "Buy Credits →" link to `/dashboard/credits`. Stale data always visible; page never blocked. `tsc --noEmit` clean. |
| ✅ | **[PAY-5b] Agent usage stats** | 🟡 M | Done (Mar 2). Frontend widget on `/dashboard/credits` left sidebar — "Agent API Usage" card shown only when `agentTxs.length > 0`. Derives from existing `useCredits()` transactions (no new API call): filters `reason === 'x402_payment'`, displays payment count, credits consumed, USDC equivalent (`credits × $0.015`). `tsc --noEmit` clean. |
| ✅ | **[PAY-5c] `X-Payment-Receipt` response header** | 🟢 S | Done (Mar 2). Captured `txSig` return from `x402VerificationService.verify()` in `CreditGuard`. Added `response.setHeader('X-Payment-Receipt', txSig)` on confirmed x402 path. `tsc --noEmit` clean. |
| ⚪ | **[PAY-5d] Blocked wallet E2E test** | 🟢 S | Verify `isActive=false` on an agent user row returns HTTP 403. Manual DB flip + script check. |
| ✅ | **[PAY-5e] SKILL.md / integration guide** | 🟡 M | Done (Mar 3). Agent skill published to `docs/skill/`. Two files: `skill.json` (machine-readable index, triggers, payment params) + `SKILL.md` (canonical AgentSkills format with YAML frontmatter). SKILL.md covers: what data is available + real response shapes, pricing table, API key auth (`X-Api-Key`), full X402 handshake (402 body → build transferChecked → X-Payment header → TypeScript implementation), async job polling loop with result keys + 15min TTL warning, autonomous agent decision tree, full error table. Deliberately excludes JWT (browser-only). Next: MCP server skill (separate task). |
| ✅ | **[PAY-5f] TypeScript SDK package (`@sova/intel-sdk`)** | 🟡 M | Done (Mar 3). SDK added in `packages/sdk/` with typed client for all Intel endpoints, API key + X402 auth, async polling helpers, and Vitest coverage for warm/cold/job/x402/error paths. Build is `pnpm run build` (`tsc`) with declaration files emitted to `packages/sdk/dist/`. |
| ⚪ | **[INTEL-DEEP-BUG] Fix `POST /intel/token/:mint/holders/deep` similarity chaining** | 🟡 M | Endpoint currently requires caller to pass `wallets[]` upfront, but callers can't know the holders before the job runs — circular dependency. Fix: add `chainSimilarity: true` flag to `AnalyzeHolderProfilesJobData`, processor auto-queues similarity job using discovered holder addresses after completion. Controller removes `wallets[]` from request body, returns `chainedSimilarityRequestId` upfront so agent can poll result key directly. No round-trip needed. **Full spec + proposed implementation:** `.ai/context/monetization/INTEL-DEEP-CHAIN-BUG.md`. Files: `src/queues/jobs/types/index.ts`, `src/api/controllers/intel.controller.ts`, `src/queues/processors/analysis-operations.processor.ts`, `documentation/skill/SKILL.md`. |
| ⚪ | Production auth hardening: cookie-mode readiness + CSP tightening | 🔴 L | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until backend cookie auth, frontend CSRF header flow, and stricter CSP are complete. |
| ⚪ | Implement feed feature | 🔴 L | Design and implement activity feed functionality. |

> **Note:** REMOVE AUTODOC from deps!

**Recently Completed:**
-  **Admin panel density overhaul** (Mar 4) - Refined `/admin` layout for higher information density and reduced scrolling. Compacted top shell (smaller header, tighter spacing, denser tabs), widened content container, and converted **Users** + **Registration Codes** from large card stacks into compact row/table-style lists with column headers and viewport-scaled scroll areas (`h-[62vh]`). Users now show clear columns (user, email, flags, created/last login, actions) and registration codes show code, status, usage, dates, and actions in a single scan line. Also removed unused icon import and fixed pagination separator text rendering. **File:** `dashboard/src/app/admin/page.tsx`.
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

### P0: Payment Infrastructure — IN PROGRESS (Feb 24)

Solana-native credit system. No Stripe. USDC only. Modular: humans pay via Solana Pay QR, agents pay via X402.
Full plan: `.ai/context/monetization/DEFINITIVE_PLAN.md`

**Progress:**
- ✅ `[PAY-1a–1d]` Credit system foundation — schema, service, guard, interceptor, decorator — all verified
- ✅ `[PAY-2a–2c]` Solana Pay checkout + webhook confirmation — **E2E verified** (real $15 USDC → 1000 credits)
- ✅ `[PAY-3]` X402 protocol layer — **E2E verified** (real mainnet USDC → 200 → replay rejected)
- ✅ `[PAY-4/4b]` Credits dashboard + checkout page UX — complete
- ✅ `[PAY-6a/6d]` **Pricing audit complete** — all endpoints traced, compound ops verified, strategy decided
- ✅ `[PAY-6b]` Tune credit costs — behavior gate removed, dashboard 10→5cr, similarity 100→20cr
- ✅ `[PAY-6c]` Gate holder-profiles(25cr, bundles similarity), holder-profiles/wallet(5cr)
- ✅ `[PAY-5a]` `GET /api/v1/pricing` — public pricing discovery endpoint live
- ✅ `[PAY-6e]` Credits page UI updated — Dashboard=5cr, Holder+Similarity=25cr, Similarity standalone=20cr
- ✅ `[PAY-7a]` Pricing decision revised — see PAY-SIM below (25cr bundle superseded)
- ✅ `[PAY-SIM]` Credit charging architecture fix — dynamic similarity pricing, explicit deduct with refund
- ✅ `[PAY-SIM-HOTFIX]` Cache-aware charging alignment — similarity false-20cr fixed, holder-profiles cache-only refund for internal flow, Intel static-pricing guard
- ✅ `[PAY-SIM-UI]` Transaction labels + OPERATION_COSTS update
- ✅ `[PAY-7b]` Graceful 0-balance auto-trigger (staleness banner + CTA)
- ✅ `[PAY-7]` Intel GET endpoints — `GET /intel/wallet/:addr` (5cr), `/tokens` (3cr), `/hud` (1cr) — E2E verified
- ✅ `[PAY-7-POST]` Intel POST scaffolds wired
- ✅ `[PAY-8a]` Reprice `/intel/token/:mint/holders` 35cr → 20cr
- ✅ `[PAY-8b]` `POST /intel/wallets/similarity` (20cr standalone) — live
- ✅ `[PAY-8c]` `POST /intel/token/:mint/holders/deep` (35cr bundled) — live, partial-failure bug fixed (HTTP 206)
- ✅ `[PAY-5f]` TypeScript SDK package (`@sova/intel-sdk`) — complete (`packages/sdk`, typed client + tests + README)
- ✅ `[PAY-8]` Synchronous cold-wallet resolution — HTTP connection held, `waitUntilFinished` via `JobEventsBridgeService` (reuses existing `QueueEvents`, no extra Redis connections), 200 returned in single request. Prepaid marker for >30s fallback (x402/credit type encoded). Freshness gate bypassed on prepaid re-call. **E2E verified** (JWT): warm 200 fast ✅ · cold 200 direct (synchronous hold) ✅ · post-analysis /hud instant ✅ · single credit charge confirmed ✅

**Key decisions (Feb 27–Mar 2, revised Mar 2):**
- **Intel POST endpoint shape (Mar 2):** Three-endpoint model for holder intelligence: `POST /intel/token/:mint/holders` (20cr, standalone profiles), `POST /intel/wallets/similarity` (20cr, standalone similarity), `POST /intel/token/:mint/holders/deep` (35cr, bundled — agent provides known wallet list upfront, queues both jobs immediately, returns two jobIds). Replaces original "35cr bundled" plan which failed because the processor doesn't auto-chain similarity — the agent must provide the wallet list or make two calls. Price: separate calls cost 40cr, deep bundle costs 35cr (12.5% discount).

**Key decisions (Feb 27–Mar 1, revised Mar 1):**
- **Two-tier API model:** `/analyses/*` = internal compute primitives for the dashboard (dynamic/explicit pricing, no X402). `/intel/*` = external product API for devs and agents (static pricing, full X402, stable contracts). Processors and queue services are 100% shared — no logic duplication.
- **Why separate controllers, not one:** `@RequireCredits` is static (compile-time). X402 payment instructions must be returned before the handler runs (guard fires first). Dynamic pricing requires reading wallet status inside the handler body. These are irreconcilable in one endpoint — hence the split.
- **Revised pricing:** holder-profiles = 20cr (was 25cr bundle). Similarity = 10cr if wallets pre-synced, 20cr if needs Helius sync. Full holder-profiles + similarity flow = 30cr. Standalone similarity = 10–20cr.
- **Free read concern (behavior-analysis):** Accepted. JWT users can read cached behavioral profiles at 0cr. This is intentional — free reads are the dashboard UX. The expensive operations (Helius RPCs, CPU-heavy similarity) are always credit-gated. Intel layer monetizes the aggregated read as a product for external consumers.
- **X402:** Unchanged on existing endpoints. New Intel endpoints get X402 for free via static `@RequireCredits` decorator.
- **Full spec:** `.ai/context/monetization/PAY-SIMILARITY-DYNAMIC-PRICING.md`

**Key decisions (Mar 3, 2026):**
- **Intel pricing contract remains static:** `/intel/*` is priced per accepted request (static decorator cost), regardless of whether underlying computation used cache. Cache reuse affects latency/infra load, not endpoint price.
- **cacheOnly metadata transparency:** Keep `metadata.cacheOnly` in holder-profiles job results as operational telemetry. Do not hide it; document static Intel pricing clearly to avoid ambiguity.

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

### March 4, 2026 (Latest)

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

### March 3, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 3.1 | 🐛 FIX | Similarity dynamic pricing false-positive: known/system wallets forced 20cr | 🟢 S | `src/api/controllers/analyses.controller.ts` |
| 3.2 | 🐛 FIX | Holder-profiles cache-only billing: internal flow auto-refund + UI label correction | 🟡 M | `src/queues/processors/analysis-operations.processor.ts`, `src/queues/jobs/types/index.ts`, `dashboard/src/app/dashboard/credits/page.tsx` |
| 3.3 | 📋 DECISION | Intel static-pricing guard + transparency policy for `cacheOnly` | 🟢 S | `src/queues/processors/analysis-operations.processor.ts`, `.ai/CONTEXT.md` |
| 3.4 | 📄 DOCS | PAY-5e: SKILL.md agent integration guide — canonical AgentSkills format | 🟡 M | `docs/skill/SKILL.md` (new), `docs/skill/skill.json` (new) |
| 3.5 | 🎯 FEAT | PAY-5f: TypeScript SDK package for Intel API consumers | 🟡 M | `packages/sdk/src/*`, `packages/sdk/src/client.test.ts`, `packages/sdk/README.md`, `packages/sdk/package.json`, `packages/sdk/tsconfig.json` |

**Summary:**

**3.1:** Fixed a pricing false-positive in `POST /analyses/similarity/queue`. Dynamic `10/20cr` decision previously evaluated all wallets, including known/system wallets intentionally skipped by analysis flows; those often appeared `MISSING/STALE` and incorrectly forced `20cr`. The controller now excludes known/system wallets from sync-eligibility before computing `walletsNeedingSync`, preserving `10cr` when no sync-eligible wallets need refresh.

**3.2:** Implemented cache-aware holder-profiles billing for internal dashboard flow. Token-mode holder profiles now annotate `metadata.cacheOnly` when outcomes are fully cache-served, including wallet-mode child jobs served from Tier-1/Tier-2 cache. `AnalysisOperationsProcessor` issues a `+20` refund (`refund:AnalysisOperationsProcessor.holderProfilesCacheOnly`) for internal `holder-profiles-*` requests that are cache-only. Credits page transaction mapping fixed so refund reasons render as "Refund"/specific refund labels instead of "Credit Purchase".

**3.3:** Guarded Intel pricing contract: cache-only refund path is restricted to internal `/analyses/holder-profiles` request IDs only, preventing accidental refunds on static-priced `/intel/*` calls that share the same processor. Decision recorded: keep `cacheOnly` visible in job result metadata (telemetry), document Intel as static-priced per accepted request.

**3.4:** Published agent skill to `docs/skill/`. Follows canonical AgentSkills spec (agentskills.io) with YAML frontmatter — compatible with Claude Code, Cursor, Gemini CLI and other skills-aware frameworks. Structure: data-first (what you get + real response shapes) → pricing → how to pay (API key first, X402 second with full TypeScript implementation) → async job loop → agent decision tree → errors. Omits JWT (browser session only). Key decisions: treasury ATA not hardcoded (deployment-specific env var, cached after first 402); `/pricing` schema not documented in skill (costs hardcoded, live endpoint for human SDK builders); MCP server skill remains a separate follow-on task.

**3.5:** Implemented `@sova/intel-sdk` in `packages/sdk/` for external API consumers. The SDK exposes all current Intel endpoints with strict TS types, supports API key and X402 auth, and adds convenience pollers for async jobs (`pollHolderProfiles`, `pollSimilarity`, `pollDeepAnalysis`). Unit tests cover warm/cold profile behavior, correct result-key contracts (`jobId` for holder profiles, `requestId` for similarity), deep 206 partial handling, and X402 probe→payment→retry flow. Build pipeline is `pnpm run build` (`tsc`) with `.d.ts` declarations emitted to `dist/`.

### March 2, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 2.1 | 🎯 FEAT | PAY-7: IntelController — three X402-ready read endpoints for external API | 🔴 L | `src/api/controllers/intel.controller.ts` (new), `src/api/modules/intel.module.ts` (new), `src/api.module.ts` (+IntelModule), `src/scripts/intel-agent-test.ts` (new) |
| 2.2 | 🎯 FEAT | PAY-7b: Graceful 0-balance auto-trigger — staleness banner + Refresh CTA | 🟡 M | `dashboard/src/components/layout/WalletProfileLayout.tsx` |
| 2.3 | 🎯 FEAT | PAY-8a/8b/8c: Reprice /holders 20cr + add /similarity + add /holders/deep + update pricing controller + test script | 🟡 M | `src/api/controllers/intel.controller.ts`, `src/api/controllers/pricing.controller.ts`, `src/scripts/test-intel-post.ts` |
| 2.4 | 🐛 FIX | `/holders/deep` partial-failure: ghost job + silent 500 when similarity queue fails after holder-profiles accepted | 🟢 S | `src/api/controllers/intel.controller.ts` |
| 2.5 | 🐛 FIX | `dashboard-analysis` conditional charging: free for fresh (<24h) or zero-data wallets, 5cr only for missing/stale/>24h/forceRefresh | 🟡 M | `src/api/controllers/analyses.controller.ts` |
| 2.6 | 🐛 FIX | Similarity always charging 20cr instead of 10cr: system wallets were being checked for sync status AFTER credit deduction, making `walletsNeedingSync` always non-empty | 🟢 S | `src/api/controllers/analyses.controller.ts` (fixed by filtering system wallets before the status check) |

**Summary:**

**2.6:** Similarity dynamic pricing was always charging 20cr instead of 10cr. Root cause: system wallets (AMMs, token programs, etc.) always have `status: MISSING` because they're never synced, so `walletsNeedingSync.length > 0` was always true — even on runs where all real wallets were freshly analyzed. The processor already filters system wallets out of the actual similarity computation (log: "Filtered 1 system wallet(s)"), but the controller was checking wallet statuses before that filter, counting system wallets as needing sync. Fix: filter system/known wallets from the addresses before calling `getWalletsStatus` so the cost decision only reflects wallets that would actually be synced.

**2.5:** Removed `@RequireCredits(5)` from `POST /analyses/wallets/dashboard-analysis` and replaced with conditional explicit deduction. Charging rules: FREE for wallets analyzed within 24h (auto-refresh is housekeeping); FREE for wallets with no PnL data that have been tried before (zero-swap wallets, token addresses — don't keep charging for nothing); 5cr for genuinely missing wallets (first-ever analysis), wallets with data >24h old, or `forceRefresh=true` (manual button). Two parallel DB reads added: `getWalletPnlSummaryWithRelations` + `getLatestDashboardAnalysisRun`. Intel endpoints unaffected — they use static `@RequireCredits` and are on a separate controller.

**2.4:** Found and fixed a partial-failure bug in `POST /intel/token/:mint/holders/deep`. If `addHolderProfilesJob` succeeded but `queueSimilarityJob` then threw (Redis blip, BullMQ issue, `getWalletsStatus` DB failure), the original code propagated the error as a 500 — the holder-profiles job was already running in BullMQ with no job ID surfaced to the caller, and 0cr were charged (correct by accident). Fix: wrap `queueSimilarityJob` in `try/catch`; on failure `throw new HttpException({status:'partial', holderProfiles:{jobId,...}, similarity:null, message:...}, 206)`. Throw (not return) so `CreditInterceptor` skips → 0cr charged. Caller receives the holder-profiles jobId to poll and clear recovery instructions. Added 206 to Swagger `@ApiResponse`.

**2.3:** PAY-8a/8b/8c. Repriced `POST /intel/token/:mint/holders` from 35cr → 20cr (`@RequireCredits(20)`). Added `POST /intel/wallets/similarity` (20cr) — static pricing for X402 compatibility, queues `ComprehensiveSimilarityFlowData` via `SimilarityOperationsQueue`, validates all addresses, returns `{status, jobId, requestId, walletCount, monitoringUrl}`. Added `POST /intel/token/:mint/holders/deep` (35cr) — bundled endpoint, queues holder-profiles + similarity independently, agent provides `wallets[]` upfront, returns both jobIds. `pricing.controller.ts` updated with all three new entries + `changedFromCredits: 35` flag on /holders. Test script (`test-intel-post.ts`) fully rewritten: TEST 0 = `GET /pricing` (public, pre-login), TEST A = /holders (20cr), TEST B = /similarity (20cr), TEST C = /holders/deep (35cr) with dual job polling.

**2.2:** PAY-7b. `shouldAutoTriggerFlash` now returns `false` when `creditBalance === null` (loading) or `< 5` — auto-trigger is suppressed safely. Added `isDataStale` memo (30min window). Yellow staleness banner renders when `balance < 5 && isDataStale && !isAnalyzing && !isDemoAccount`: shows "Data may be stale. You need at least 5 credits to refresh." + "Refresh (5cr)" button (same flash params as auto-trigger) + "Buy Credits →" link to `/dashboard/credits`. Stale data stays visible; page never blocked. `tsc --noEmit` clean.

**2.1:** Implemented PAY-7 Intel API layer. `GET /intel/wallet/:addr` (5cr) aggregates summary + HUD + behavior + PnL using same services as dashboard (`WalletHudService`, `PnlOverviewService`, `BehaviorService`). Freshness gated at 30 min (same threshold as `WalletProfileLayout.shouldAutoTriggerFlash`): fresh → 200 immediately; stale/missing → auto-queues flash analysis via `AnalysisOperationsQueue` (same job data, same BullMQ processor, same Redis lock key) → 202 with jobId. `GET /intel/wallet/:addr/tokens` (3cr) — `TokenPerformanceService` direct. `GET /intel/wallet/:addr/hud` (1cr) — `WalletHudService` direct. Credit contract: only `return` (200) triggers `CreditInterceptor`; non-data responses use `throw HttpException` (202/422) so interceptor skips — agent pays once, when data is delivered. Dedup: known-wallet check (4 conditions), BullMQ queue scan, Redis lock. `unrealizedPnl` served live via `PnlOverviewService` → DexScreener, not DB snapshot. **E2E verified:** 4 on-chain USDC payments, 402 `required:5` ✅ · 200 summary+HUD ✅ · `/hud` 1cr ✅ · `/tokens` 3cr/60 tokens ✅.

### February 26, 2026

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

**Last Updated:** 2026-03-06  **Branch:** `main`








