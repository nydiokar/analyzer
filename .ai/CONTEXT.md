# Sova Intel - Project Context

**Branch:** `feat/credit-ledger-foundation`  **Last Updated:** 2026-02-27  **Status:** PAY-4b complete → PAY-5a–5e next

---

##  Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
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
| ⚪ | **[PAY-5a] Pricing discovery endpoint** `GET /api/ai/pricing` | 🟢 S | Returns a machine-readable map of `{endpoint, credits, usdEquivalent, description}` for all `@RequireCredits` endpoints. Required for any external agent to self-onboard without reading source. No auth required. |
| ⚪ | **[PAY-5b] Agent usage stats** | 🟡 M | Admin query surface + dashboard widget showing x402 revenue: per-wallet breakdown, total agent payments, credits consumed vs human credits. Query from `CreditTransaction WHERE reason = 'x402_payment'`. |
| ⚪ | **[PAY-5c] `X-Payment-Receipt` response header** | 🟢 S | After successful x402 payment, return confirmed tx signature in `X-Payment-Receipt` header so agent can record it for their own accounting. 2-line change in `CreditGuard`. |
| ⚪ | **[PAY-5d] Blocked wallet E2E test** | 🟢 S | Verify `isActive=false` on an agent user row returns HTTP 403. Manual DB flip + script check. The kill switch was designed in but never exercised. |
| ⚪ | **[PAY-5e] Agent SDK / integration guide** | 🟡 M | Docs + minimal code example showing how an external agent negotiates the x402 handshake: discovery → build tx → attach header → handle replay. Reference implementation in `x402-agent-test.ts`. |
| ⚪ | **[PAY-6] Credit pricing audit + endpoint gating review** | 🟡 M | Full review of which endpoints consume credits, at what cost, and whether the gating makes sense for real usage patterns. See detailed sub-tasks below. |
| ⚪ | **[PAY-6a] Map every endpoint to cost + gating decision** | 🟢 S | Audit all controllers for `@RequireCredits`. Document current state vs proposed. Key questions: (1) is this a standalone user action or part of a larger operation already charged elsewhere? (2) does this hit Helius/heavy compute or just read pre-computed DB data? (3) does gating this kill UX at the free tier? Affected: `behavior-analysis`(5cr), `dashboard-analysis`(10cr), `similarity/queue`(100cr), `holder-profiles`(free), `pnl-overview`(free), `hud`(free), `token-performance`(free). |
| ⚪ | **[PAY-6b] Tune credit costs on existing gated endpoints** | 🟢 S | Based on PAY-6a findings, update `@RequireCredits(N)` values. Current concern: `behavior-analysis` at 5cr is a pure DB read (cheap to serve) — may be too high for adoption. `similarity/queue` at 100cr may be too high for product stage. Changes are 1-line each per endpoint. |
| ⚪ | **[PAY-6c] Gate currently-free expensive endpoints** | 🟡 M | `POST /analyses/holder-profiles` analyzes up to 50 wallets with Helius calls per wallet — currently free, real cost. `POST /analyses/holder-profiles/wallet` single-wallet variant — lighter but still compute. `GET /wallets/:addr/pnl-overview` hits Helius. Decide whether to gate these and at what cost, considering UX impact vs cost exposure. |
| ⚪ | **[PAY-6d] Verify compound operation charging** | 🟢 S | Some operations trigger follow-up jobs internally (e.g. `dashboard-analysis` with `queueWorkingAfter=true` queues a second deeper analysis). Verify the user is not double-charged for the same logical action, and that sub-operations spawned server-side don't re-trigger `CreditGuard`. |
| ⚪ | **[PAY-6e] Update credits page UI to reflect final pricing** | 🟢 S | The "Cost per operation" reference table in `/dashboard/credits` is hardcoded (3 rows). After PAY-6b/6c settle the real costs, update the table + the `OPERATION_COSTS` constant in the credits page + checkout `OrderSummary` breakdown to match. |
| ⚪ | Production auth hardening: cookie-mode readiness + CSP tightening | 🔴 L | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until backend cookie auth, frontend CSRF header flow, and stricter CSP are complete. |
| ⚪ | Implement feed feature | 🔴 L | Design and implement activity feed functionality. |

REMOVE AUTODOC from deps! 

**Recently Completed:**
-  **[PAY-2a/2b] Solana Pay checkout + schema** (Feb 24, branch `feat/credit-ledger-foundation`) — `CreditPack` + `PaymentIntent` models, migration applied, 3 packs seeded (Starter $15/1k, Builder $120/10k, Pro $900/100k). `PaymentService` generates Solana Pay URL + base64 QR via `@solana/pay` + `qrcode`. `PaymentController` exposes `GET /payments/packs`, `POST /payments/checkout`, `GET /payments/:id/status`, `GET /users/me/credits`. Verified: checkout returns valid Solana Pay URL targeting treasury wallet + valid QR PNG. Status polls correctly. **Files:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/api/services/payment.service.ts`, `src/api/controllers/payment.controller.ts`, `src/api/modules/payment.module.ts`, `src/api.module.ts`.
-  **[PAY-1d] Decorate production endpoints** (Feb 24, branch `feat/credit-ledger-foundation`) — `@RequireCredits(5)` on behavior-analysis, `@RequireCredits(100)` on similarity/queue, `@RequireCredits(10)` on dashboard-analysis. Verified with 402 on 0-balance user.
-  **[PAY-1c] @RequireCredits decorator + guard + interceptor** (Feb 24, branch `feat/credit-ledger-foundation`) — Created `@RequireCredits(N)` decorator for marking endpoints with credit cost. `CreditGuard` (pre-check) verifies user has sufficient balance before handler executes, throws HTTP 402 `{error,balance,required}` if insufficient. `CreditInterceptor` (post-deduct) deducts credits AFTER successful response (async, non-blocking). Failed requests do NOT consume credits. Both registered globally in `app.module.ts`. Test endpoint added: `GET /api/v1/test-auth/credits` (costs 5 credits). **Files:** `src/api/shared/decorators/require-credits.decorator.ts`, `src/api/shared/guards/credit.guard.ts`, `src/api/shared/interceptors/credit.interceptor.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/controllers/test.controller.ts`. **Test plan:** `.ai/context/monetization/PAY-1c-TEST-PLAN.md`. **Ready for testing.**
-  **[PAY-1a/1b] Credit ledger foundation** (Feb 24, branch `feat/credit-ledger-foundation`) — `CreditBalance` + `CreditTransaction` models added to `schema.prisma` (append-only ledger, never mutate balance directly). `CreditsService` implements atomic `topUp`/`deduct` via Prisma `$transaction` — deduct throws HTTP 402 `{error,balance,required}` on short balance. `CreditsModule` is `@Global`. `grantSignupBonus(userId)` wired into `AuthService.register()` (non-fatal). Migration applied: `20260224002042_credit_ledger`. **Files:** `prisma/schema.prisma`, `src/api/services/credits.service.ts`, `src/api/modules/credits.module.ts`, `src/app.module.ts`, `src/api/modules/auth.module.ts`, `src/api/shared/services/auth.service.ts`.


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
- ✅ `[PAY-3]` X402 protocol layer — **verified E2E Feb 27** (real mainnet USDC → 200 response → replay rejected)

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

### February 27, 2026 (Latest)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 27.1 | 🎯 FEAT | PAY-4b: dedicated checkout route + credits page restructure | 🟡 M | `dashboard/src/app/dashboard/credits/page.tsx`, `dashboard/src/app/dashboard/credits/checkout/[packId]/page.tsx` (new), `dashboard/src/components/credits/ExpiryCountdown.tsx` (new), `dashboard/src/components/credits/CreditPurchaseModal.tsx`, `dashboard/src/components/layout/AppShell.tsx`, `dashboard/src/components/auth/UserMenu.tsx` |
| 27.2 | 🔧 REFACTOR | Credits page UX: two-column layout, pack grid below fold, scroll-to CTA | 🟢 S | `dashboard/src/app/dashboard/credits/page.tsx` |
| 27.3 | 🐛 FIX | Checkout bugs: double `!packsLoading`, `!!pack` boolean dep, missing `setCheckout(null)` on retry, `React` import, `$¢` notation | 🟢 S | `dashboard/src/app/dashboard/credits/checkout/[packId]/page.tsx`, `dashboard/src/app/dashboard/credits/page.tsx` |

**Summary:**

**27.1:** Implemented PAY-4b. New route `dashboard/credits/checkout/[packId]` — two-column page (order summary + payment). Payment column has 5 states: `loading` (creating intent), `qr` (QR code + copy URL + countdown + polling + WS), `confirmed` (success + "View Balance"), `expired` (explicit "Session Expired" + retry CTA), `error` (failed POST + retry). `ExpiryCountdown` extracted from `CreditPurchaseModal` to `components/credits/ExpiryCountdown.tsx` — shared by both, gains `prominent` prop for page vs modal display. `CreditPurchaseModal` updated to import it. AppShell: `Credits` and `Top Holders` removed from nav bar. Balance chip updated title. UserMenu: `Credits · {N}` entry added with live balance between Account and Settings. `tsc --noEmit` clean throughout.

**27.2:** Restructured `/dashboard/credits` page. Above the fold: fixed 320px left column (balance hero at 6xl, cost-per-operation reference, "Top Up Credits" scroll-to button) + fluid right column (full transaction history). Below the fold: full-width pack grid with proper pack cards showing price, credits, per-credit cost, "what you get" breakdown (N× per operation type), "Most Popular" badge on middle pack. Each pack "Select" CTA → navigates to that pack's checkout. `PackCard` and `OPERATION_COSTS` constant shared between reference table and pack cards (single source of truth). Empty transaction state uses `Receipt` icon instead of `Loader2`.

**27.3:** Bug sweep after flow audit. Fixed: (1) `!packsLoading && !packsLoading` typo in redirect guard — second condition was dead; (2) `!!pack` boolean in useEffect deps — unstable derived value, replaced with `pack?.id`; (3) missing `setCheckout(null)` before retry POST — old checkout object could leak into WS effect; (4) `React.ReactNode` used without React import; (5) `$1.5¢` contradictory currency notation — removed `$` prefix, display as `1.5¢ per credit`; (6) `OrderSummary` had unused `checkout` prop — removed; (7) `<img>` ESLint warnings on QR elements — suppressed with targeted `eslint-disable-next-line` comments (data: URI, next/image cannot optimize).

### February 26, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 26.1 | 🐛 FIX | PAY-2c bug: Helius tokenAmount is human float not raw base units — remove /1e6 | 🟢 S | `src/api/services/payment-confirmation.service.ts` |
| 26.2 | 🧪 TEST | PAY-2c E2E verified: real $15 USDC → webhook → 1000 credits confirmed | 🟢 S | `dashboard/src/app/pay-test/page.tsx` |
| 26.3 | 🎯 FEAT | PAY-4: Credits dashboard page + purchase modal + WS + 402 handling | 🟡 M | `dashboard/src/app/dashboard/credits/page.tsx`, `dashboard/src/components/credits/CreditPurchaseModal.tsx`, `dashboard/src/hooks/useCredits.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/components/layout/AppShell.tsx`, `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`, `dashboard/src/app/similarity-lab/page.tsx` |
| 26.4 | 🐛 FIX | PAY-4 type audit: align CreditTransaction/PaymentStatus/CreditPack to real backend contracts | 🟢 S | `dashboard/src/types/api.ts`, `dashboard/src/hooks/useCreditPacks.ts`, `dashboard/src/components/credits/CreditPurchaseModal.tsx` |
| 26.5 | 🎯 FEAT | PAY-3: X402 protocol layer — autonomous agent payments via Solana wallet identity | 🔴 L | `src/api/services/x402-verification.service.ts` (new), `src/api/shared/guards/composite-auth.guard.ts`, `src/api/shared/guards/credit.guard.ts`, `src/api/shared/interceptors/credit.interceptor.ts`, `src/api/modules/credits.module.ts`, `src/api/services/credits.service.ts`, `src/scripts/x402-agent-test.ts` (new), `src/scripts/generate-wallet.ts` (new) |

**Summary:**

**26.1:** Fixed amount validation bug in `PaymentConfirmationService.tryConfirmByAccounts`. Helius Enhanced Transaction format sends `tokenTransfers[].tokenAmount` as a human-readable float (e.g. `15` for $15 USDC), not raw base units. The code was dividing by `1e6`, turning `15` into `0.000015` which always failed the `>= intent.amountUsdc` check. Removed the division — compare directly.

**26.2:** Full E2E test with real mainnet USDC payment. Helius webhook fired → reference pubkey matched pending intent → amount validated → `confirmIntent` ran → credits topped up → `payment:confirmed` WS event emitted. Status endpoint confirmed `phase: confirmed` with `txSignature`. Credit balance: 0 → 1000. Reconciliation fallback also triggered on the pre-fix pending intent. Test page at `dashboard/src/app/pay-test/page.tsx`.

**26.3:** Implemented PAY-4 frontend payment flow. `/dashboard/credits` page: balance card, credit costs reference, transaction ledger with `delta`-signed amounts and `reason`-derived labels. `CreditPurchaseModal`: 3-stage flow (pack grid → QR → confirmed). Polls `GET /payments/:id/status` every 3s via SWR `refreshInterval`. Separate Socket.IO listener for `payment:confirmed` WS event (faster confirmation path). Expiry countdown timer — hits zero → silently returns to pack selection. SWR `mutate` on credits cache key after confirmation. 402 handling: `BehavioralPatternsTab` shows contextual "Insufficient credits" EmptyState with Buy Credits button + suppresses retry on 402. `similarity-lab` shows Sonner toast with required/balance + "Buy Credits" action. Credits nav item (auth-only) + live balance chip in AppShell header. All hooks null-keyed when unauthenticated. **Verified E2E:** $15 USDC → Payment Confirmed modal → +1,000 in ledger. Known UX limitation: expiry returns to packs silently with no explanation — tracked as PAY-4b.

**26.5:** Implemented PAY-3 X402 protocol layer. Autonomous agents pay per-request via Solana USDC — no API key or JWT needed. Architecture: `CompositeAuthGuard` gets an X402 early path — if `X-Payment` header present, extracts fee payer pubkey from the signed tx, auto-provisions a `User` row keyed by `<pubkey>@x402.agent`, sets `request.user`. Also adds a discovery path: unauthenticated requests to `@RequireCredits` endpoints pass through so `CreditGuard` can return the 402 payment instructions payload. `CreditGuard` validates the USDC `transferChecked` instruction locally (mint, recipient, amount), submits + confirms on-chain, atomically claims the tx signature in Redis (`SET NX EX 86400`) for replay protection, records a `CreditTransaction` ledger entry (`reason: x402_payment`, `refId: txSig`) without touching credit balance. `CreditInterceptor` skips deduction when `request.x402Paid = true`. `CreditsModule` cleaned: guards/interceptors removed (live in AppModule), `X402VerificationService` + `RedisModule` added. `CreditsService.recordX402Payment()` added. Test script: `src/scripts/x402-agent-test.ts` — 6-step flow (discovery → build tx → pay → verify 200 → verify replay rejection). Wallet generator: `src/scripts/generate-wallet.ts`. **Pending:** E2E test — fund agent wallet `zEQfU8xvhnbRDEFTuzFHjHa6cQwd47A6g7fNCnzUaqW` with 0.01 SOL + $1 USDC, then run test script. Decision log: `.ai/context/monetization/PAY-3-X402-DECISIONS.md`.

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










