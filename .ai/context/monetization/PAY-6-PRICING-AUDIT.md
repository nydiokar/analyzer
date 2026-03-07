# PAY-6 — Credit Pricing Audit & API Strategy

**Date:** 2026-02-27
**Branch:** `feat/credit-ledger-foundation`
**Status:** Audit complete → Implementation pending
**Covers:** PAY-5a, PAY-6a, PAY-6b, PAY-6c, PAY-6d, PAY-6e + new Intel API layer

---

## 1. AUDIT RESULTS (PAY-6a)

### Currently Gated Endpoints (3 total)

| Endpoint | Method | Credits | Real Cost | Verdict |
|----------|--------|---------|-----------|---------|
| `/wallets/:addr/behavior-analysis` | GET | 5 | **0 RPC** — pure DB read of `WalletBehaviorProfile` | **OVERGATED.** This is a rendering endpoint for the dashboard. Remove gate. |
| `/analyses/wallets/dashboard-analysis` | POST | 10 | 1-2 Helius RPC (sync if stale) + PnL + behavior compute | **Price too high.** Reduce to 5. This is auto-triggered on wallet page visit. |
| `/analyses/similarity/queue` | POST | 100 | CPU-heavy pairwise comparison. No direct Helius if wallets synced. BalanceCacheService may hit Helius on cache miss. | **Way too high.** Reduce to 20. |

### Currently Ungated Expensive Endpoints

| Endpoint | Method | Credits | Real Cost | Verdict |
|----------|--------|---------|-----------|---------|
| `/analyses/holder-profiles` | POST | 0 | Orchestrates N wallet-mode child jobs. Each child: sync + PnL + behavior. Up to 50 Helius RPC calls for fresh wallets. Cached wallets: 0 RPC. | **MUST GATE.** Add @RequireCredits(20). |
| `/analyses/holder-profiles/wallet` | POST | 0 | Same pipeline as dashboard-analysis (sync + PnL + behavior). 1-2 RPC if stale. | **Make internal-only or gate at 5.** Users should use dashboard-analysis for single wallets. |

### Currently Ungated Cheap Endpoints (Correctly Free)

| Endpoint | Method | Real Cost | Verdict |
|----------|--------|-----------|---------|
| `/wallets/:addr/summary` | GET | 0 RPC, DB read | **Keep free.** Dashboard rendering. |
| `/wallets/:addr/pnl-overview` | GET | 0 RPC, DB read of pre-computed data | **Keep free.** |
| `/wallets/:addr/token-performance` | GET | 0 RPC, paginated DB read | **Keep free.** |
| `/wallets/:addr/hud` | GET | 0 RPC, 60s Redis cache | **Keep free.** |
| `/wallets/hud/batch` | POST | 0 RPC, batch DB read | **Keep free.** |
| `/wallets/:addr/classification` | GET | 0 RPC, DB read | **Keep free.** |
| `/wallets/:addr/notes/*` | ALL | 0 RPC, CRUD ops | **Keep free.** |
| `/wallets/:addr/exit-timing-tokens/:bucket` | GET | 0 RPC, cached profile data | **Keep free.** |
| `/discover/wallets` | GET | 0 RPC, 120s cache | **Keep free.** |
| `/discover/aggregation` | GET | 0 RPC, 120s cache | **Keep free.** |
| `/token-info/:mint/top-holders` | GET | 0 RPC, cached | **Keep free.** |
| `/token-info` | POST | Async background enrichment | **Keep free.** Fire-and-forget. |
| `/analyses/similarity/enrich-balances` | POST | Async background | **Keep free.** |
| `/analyses/wallets/status` | POST | 0 RPC, DB read | **Keep free.** |

### Compound Operation Verification (PAY-6d)

**dashboard-analysis with `queueWorkingAfter=true`:**
- Flash analysis completes → internally queues working-scope analysis
- Working analysis is an internal job-to-job trigger, NOT a new API call
- `CreditGuard` only runs on API-level requests, not internal job queuing
- **CONFIRMED: No double-charge.** User pays 5 credits once, gets flash + working.

**holder-profiles token mode → wallet-mode child jobs:**
- Token-mode orchestrator queues separate wallet-mode BullMQ jobs
- Child jobs are internal, never hit the API layer
- `CreditGuard` never fires on child jobs
- **CONFIRMED: No double-charge.** User pays 20 credits once for the orchestrator.

**holder-profiles → similarity (FRONTEND coupling):**
- Backend holder-profiles does NOT trigger similarity
- The FRONTEND (`dashboard/src/app/tools/holder-profiles/page.tsx` line 240) auto-fires `POST /analyses/similarity/queue` after holder-profiles completes
- This IS a separate API call → DOES trigger CreditGuard → DOES charge separately
- **PROBLEM: User sees one action ("analyze holders"), gets charged twice (20 + 20 = 40)**
- **FIX: Decouple. Make similarity opt-in button on frontend. See Phase 3 below.**

---

## 2. STRATEGIC DECISION: Internal vs Public API (PAY-6b + PAY-6c)

### The Core Insight

The 96+ existing endpoints were built to serve the Next.js dashboard. Individual component-level data fetching: summary for the header, HUD for the card, behavior for the tab, PnL for the chart, token-performance for the table. This is good frontend architecture but terrible API product architecture.

**Charging per-read on dashboard-serving endpoints is insane:**
- Wallet page loads hit 5+ endpoints simultaneously (summary + HUD + token-performance + behavior + PnL)
- Every browser refresh costs credits
- Users would burn through packs just browsing their own dashboard

**Solution: Two-tier endpoint strategy.**

### Tier 1: Internal Endpoints (Dashboard)

All existing endpoints stay as-is. JWT auth only. **No credit gating on reads.** Credit gating ONLY on compute triggers (the 3 endpoints that actually trigger expensive background work).

Dashboard users pay for:
- `dashboard-analysis` (5 credits) — auto-triggered when visiting a stale wallet
- `holder-profiles` (20 credits) — user-initiated from holder profiles tool
- `similarity/queue` (20 credits) — user-initiated, opt-in after holder-profiles

Dashboard users get for free:
- All read endpoints (summary, HUD, behavior, PnL, tokens, notes, discover, classification)
- The reads are the OUTPUT of the analyses they already paid for

**Auto-trigger behavior on wallet page:**
- Data fresh (<30 min): page loads normally, reads cached data, 0 credits
- Data stale (>30 min): auto-triggers flash analysis (5 credits)
- User has 0 credits: show last known data (even if stale) + staleness indicator + "Refresh (5cr)" button + "Buy Credits" CTA. NEVER block the page.

### Tier 2: Public Intel Endpoints (Developers, LLMs, Agents)

New controller: `IntelController` at `/api/v1/intel/`. These are the endpoints we SELL. They aggregate internal data into self-contained, valuable responses.

| Endpoint | Method | Auth | Credits | Response |
|----------|--------|------|---------|----------|
| `/intel/pricing` | GET | **None** | **0** | Machine-readable pricing map (PAY-5a) |
| `/intel/wallet/:addr` | GET | API key / X402 | **5** | Combined: summary + HUD + behavior + PnL overview |
| `/intel/wallet/:addr/tokens` | GET | API key / X402 | **3** | Token performance (paginated) |
| `/intel/token/:mint/holders` | POST | API key / X402 | **35** | Holder profiles + similarity bundled |
| `/intel/wallet/:addr/hud` | GET | API key / X402 | **1** | HUD only (cheap, for widgets/embeds) |
| `/intel/wallets/batch-hud` | POST | API key / X402 | **5** | Batch HUD for up to 50 wallets |

**Why these endpoints:**

1. **`/intel/wallet/:addr` (5cr)** — One call = complete wallet intelligence. No need for agents to call 5 separate endpoints. If wallet is unanalyzed/stale, this endpoint auto-triggers analysis internally and returns results when ready (or returns partial + job ID for polling).

2. **`/intel/wallet/:addr/tokens` (3cr)** — Token-level P&L detail. Separately valuable for portfolio trackers.

3. **`/intel/token/:mint/holders` (35cr)** — Unique moat. Holder profiles + similarity in one call. Bundles 20 + 20 at 12.5% discount. Agents pay once, get everything.

4. **`/intel/wallet/:addr/hud` (1cr)** — Lightweight embed option. 6 metrics + badges. For developers building widgets.

5. **`/intel/wallets/batch-hud` (5cr)** — Batch for leaderboards/comparison views. Up to 50 wallets.

### Preventing Internal Endpoint Abuse

**Problem:** Users can register, get JWT, and call internal endpoints directly with the JWT token, bypassing the public Intel endpoints.

**Mitigations (layered):**

1. **Internal endpoints don't have `@RequireCredits` on reads.** So there's nothing to "bypass" — the reads are free for JWT-authenticated users by design. The value proposition of Intel endpoints is CONVENIENCE (one call vs five), not restriction.

2. **Compute triggers DO have `@RequireCredits`.** `dashboard-analysis`, `holder-profiles`, `similarity/queue` — these cost credits regardless of whether called via JWT or API key. There's no way around this. The data reads are only useful AFTER someone paid for the analysis.

3. **API key scoping (future enhancement).** API keys can be scoped to Intel endpoints only. JWT (dashboard users) gets internal endpoints. This isn't blocking for launch but should be implemented.

4. **Rate limiting differentiation.** Internal endpoints have dashboard-appropriate rate limits. Intel endpoints can have higher limits for paid API users. This is already partially in place via ThrottlerGuard.

5. **The economic reality:** A developer who registers, gets 100 free credits, and calls internal endpoints directly gets: (a) read access to already-analyzed wallets (someone else paid for the analysis), and (b) 20 wallet analyses at 5cr each. That's not abuse — that's the free tier working as intended. They'll need to buy credits for anything meaningful.

---

## 3. X402 AGENT PAYMENTS

X402 is pay-per-request via on-chain USDC. Already implemented and verified E2E.

**Pricing formula:** `totalUsdc = credits × USDC_PER_CREDIT`

Current `USDC_PER_CREDIT = 0.015` (matches Starter pack rate: $15 / 1000 credits).

| Intel Endpoint | Credits | X402 Cost (USDC) |
|----------------|---------|-----------------|
| `/intel/wallet/:addr` | 5 | $0.075 |
| `/intel/wallet/:addr/tokens` | 3 | $0.045 |
| `/intel/token/:mint/holders` | 35 | $0.525 |
| `/intel/wallet/:addr/hud` | 1 | $0.015 |
| `/intel/wallets/batch-hud` | 5 | $0.075 |

**X402 flow stays unchanged:**
1. Agent hits Intel endpoint without auth → gets 402 with payment instructions
2. Agent builds Solana USDC transfer → submits tx → attaches `X-Payment` header
3. `CompositeAuthGuard` extracts payer pubkey → auto-provisions agent user
4. `CreditGuard` verifies on-chain transfer → claims in Redis (replay protection)
5. `CreditInterceptor` skips deduction (agent paid on-chain, not credit balance)

**No changes needed to X402 infrastructure.** It already works with `@RequireCredits(N)` — the guard reads the decorator value to calculate the USDC amount.

**Decision:** X402 agents should access Intel endpoints, not internal endpoints. The internal endpoints don't have `@RequireCredits` on reads, so X402 discovery (402 response) wouldn't fire. Intel endpoints are the agent-facing surface.

---

## 4. PACK PRICING REFERENCE

| Pack | Credits | USDC | Per-Credit |
|------|---------|------|-----------|
| Starter | 1,000 | $15 | $0.015 |
| Builder | 10,000 | $120 | $0.012 |
| Pro | 100,000 | $900 | $0.009 |

**What you get per pack (dashboard user):**

| Action | Starter (1K cr) | Builder (10K cr) | Pro (100K cr) |
|--------|-----------------|-------------------|---------------|
| Wallet analyses | 200 | 2,000 | 20,000 |
| Holder profile runs | 50 | 500 | 5,000 |
| Similarity analyses | 50 | 500 | 5,000 |

**What you get per pack (API developer):**

| Action | Starter | Builder | Pro |
|--------|---------|---------|-----|
| Full wallet intel | 200 | 2,000 | 20,000 |
| Token reports | 333 | 3,333 | 33,333 |
| Holder+similarity bundles | 28 | 285 | 2,857 |
| HUD reads | 1,000 | 10,000 | 100,000 |

---

## 5. IMPLEMENTATION PLAN

### Phase 1: Pricing Cleanup (PAY-6b + PAY-6c)

**Files to change:**

| File | Change |
|------|--------|
| `src/api/controllers/wallets.controller.ts` | Remove `@RequireCredits(5)` from `behavior-analysis` |
| `src/api/controllers/analyses.controller.ts` | Change `dashboard-analysis` from `@RequireCredits(10)` → `@RequireCredits(5)` |
| `src/api/controllers/analyses.controller.ts` | Change `similarity/queue` from `@RequireCredits(100)` → `@RequireCredits(20)` |
| `src/api/controllers/analyses.controller.ts` | Add `@RequireCredits(20)` to `holder-profiles` |
| `src/api/controllers/analyses.controller.ts` | Add `@RequireCredits(5)` to `holder-profiles/wallet` (or remove endpoint) |

**Verification:**
- `tsc --noEmit` clean
- Existing test endpoint still works
- 402 responses reflect new credit amounts

### Phase 2: Pricing Discovery Endpoint (PAY-5a)

**New file:** `src/api/controllers/intel.controller.ts`

Create `GET /api/v1/intel/pricing` endpoint:
- `@Public()` decorator — no auth required
- Returns JSON with:
  - `endpoints[]`: all credit-gated endpoints with `{ path, method, credits, usdEquivalent, description, category }`
  - `packs[]`: available credit packs with `{ name, credits, priceUsdc, perCreditUsdc }`
  - `x402`: agent payment info `{ usdcPerCredit, usdcMint, network }`
- USD equivalent calculated from Starter pack rate ($0.015/credit)
- Categories: `"compute"` (internal triggers), `"intel"` (public API)

**Implementation options:**
- **Option A (config-driven):** Maintain a static pricing config array. Pro: explicit, easy to read. Con: can drift from actual decorators.
- **Option B (reflection-driven):** Use NestJS `DiscoveryService` + `Reflector` to scan all controllers at runtime and find `@RequireCredits` metadata. Pro: always accurate. Con: more complex, exposes internal endpoints too.
- **Recommended: Option A** with a build-time check that the config matches actual decorators. The pricing endpoint should only expose INTEL endpoints + compute triggers, not internal reads. Reflection would expose everything.

**New module:** `IntelModule` importing `DatabaseModule`, `CreditsModule`.

### Phase 3: Frontend UX Updates (PAY-6e + similarity decoupling)

| File | Change |
|------|--------|
| `dashboard/src/app/tools/holder-profiles/page.tsx` | Remove auto-fire of similarity (line ~240). Add "Run Similarity Analysis (20 credits)" button. |
| `dashboard/src/components/layout/WalletProfileLayout.tsx` | Update auto-trigger: if credits < 5, show stale data + refresh CTA instead of blocking |
| `dashboard/src/app/dashboard/credits/page.tsx` | Update `OPERATION_COSTS` constant with new prices |
| `dashboard/src/app/dashboard/credits/checkout/[packId]/page.tsx` | Update OrderSummary breakdown with new prices |

### Phase 4: Intel Aggregation Endpoints (NEW — post-PAY-6)

Build the actual Intel controller methods:

| Endpoint | Implementation |
|----------|---------------|
| `GET /intel/wallet/:addr` | Internally calls: summary service + HUD service + behavior service + PnL overview service. Aggregates into single response. If wallet unanalyzed: return `{ status: 'unanalyzed', message, analyzeUrl }` with HTTP 200 (not 404). |
| `GET /intel/wallet/:addr/tokens` | Proxies token-performance service with pagination. |
| `POST /intel/token/:mint/holders` | Queues holder-profiles job + waits for completion + queues similarity job + waits for completion. Returns combined result. Or: returns job IDs for async polling. |
| `GET /intel/wallet/:addr/hud` | Direct proxy to HUD service. |
| `POST /intel/wallets/batch-hud` | Direct proxy to batch HUD. |

**Decision point:** Should `/intel/wallet/:addr` trigger analysis if wallet is stale? Two options:
- **Sync mode:** Trigger analysis, wait (up to 2-3 min), return results. Simpler for agents but long HTTP timeout.
- **Async mode:** Return `{ status: 'analyzing', jobId, pollUrl }` immediately. Agent polls. More robust.
- **Recommended: Async with optional sync.** Query param `?wait=true` blocks until analysis completes (with timeout). Default returns immediately with job ID.

### Phase 5: Optimization Backlog (Future, Not Blocking)

These improve YOUR margins but don't change user-facing pricing:

| Task | Impact | Priority |
|------|--------|----------|
| Pairwise similarity cache (key: walletA+walletB+featureVersion) | Reduces CPU on repeat similarity requests | Medium |
| Persisted wallet feature vectors | Eliminates vector recomputation in similarity | Medium |
| Enforce no-Helius-in-similarity rule | Prevents cost leak from BalanceCacheService misses during similarity | High |
| Holder-profiles batch balance prefetch optimization | Already partially done. Verify it's working correctly. | Low |
| Background warming for frequently-accessed wallets | Reduces first-caller latency | Low |
| Bounded freshness policy (explicit TTLs per layer) | Reduces unnecessary recomputation | Medium |

---

## 6. OPEN DECISION POINTS

### Decided

| Decision | Answer | Rationale |
|----------|--------|-----------|
| Charge per-read on internal endpoints? | **No** | Dashboard would be unusable. Reads are free for JWT users. |
| Charge per-read on Intel endpoints? | **Yes** | API developers pay for data access. Intel endpoints are the product. |
| Bundle similarity into holder-profiles? | **On Intel only** | Intel: bundled at 35cr. Dashboard: decoupled, opt-in at 20cr. |
| Auto-trigger analysis on wallet page? | **Keep, but graceful 0-balance handling** | Show stale data + CTA if no credits. Never block. |
| X402 pricing model? | **Same formula, same USDC_PER_CREDIT** | No changes to X402 infrastructure needed. |
| Make holder-profiles/wallet public? | **Gate at 5cr or remove** | Same work as dashboard-analysis. No arbitrage. |

### To Be Decided During Implementation

| Decision | Options | Impact |
|----------|---------|--------|
| Intel endpoint for unanalyzed wallets | Sync (wait) vs Async (job ID) vs Hybrid (`?wait=true`) | UX for agents. Recommend hybrid. |
| API key scoping to Intel-only | Implement now vs defer | Prevents JWT-to-internal-endpoint bypass. Can defer — not a real abuse vector. |
| Signup bonus credits (currently 100) | Keep 100 vs increase | 100 credits = 20 wallet analyses. Enough to evaluate. |
| `/intel/pricing` implementation | Config-driven vs reflection-driven | Config recommended for control. |

---

## 7. COMPARISON TO HOLDERSCAN

| Feature | HolderScan | Sova Intel |
|---------|-----------|------------|
| Model | Request units per call | Credits (compute triggers + Intel reads) |
| Cheapest plan | Free with HolderScan Premium | 100 free credits on signup |
| Standard plan | $149/mo for 200K units | Starter: $15 for 1K credits |
| Holder data | Top 1000 holders, basic stats | Top 50 holders with full behavioral analysis, similarity |
| Wallet analysis | Basic PnL + hold time | Full PnL + behavior + classification + HUD + token performance |
| Similarity | None | Jaccard + cosine pairwise comparison |
| Real-time | No | WebSocket job progress |
| Agent payments | No | X402 protocol (on-chain USDC) |
| SDK | No | Planned (TypeScript) |

**Sova Intel is MORE data per request, CHEAPER entry point ($15 vs $149), but SMALLER holder coverage (50 vs 1000).** The value proposition is depth of analysis, not breadth of data.

---

## 8. FILES REFERENCE

| Area | Key Files |
|------|-----------|
| Credit decorator | `src/api/shared/decorators/require-credits.decorator.ts` |
| Credit guard | `src/api/shared/guards/credit.guard.ts` |
| Credit interceptor | `src/api/shared/interceptors/credit.interceptor.ts` |
| X402 verification | `src/api/services/x402-verification.service.ts` |
| Composite auth | `src/api/shared/guards/composite-auth.guard.ts` |
| Wallets controller | `src/api/controllers/wallets.controller.ts` |
| Analyses controller | `src/api/controllers/analyses.controller.ts` |
| Wallet HUD controller | `src/api/controllers/wallet-hud.controller.ts` |
| Payment controller | `src/api/controllers/payment.controller.ts` |
| Credits service | `src/api/services/credits.service.ts` |
| Pack seed data | `prisma/seed.ts` |
| Dashboard auto-trigger | `dashboard/src/components/layout/WalletProfileLayout.tsx` (lines 885-942) |
| Holder-profiles similarity coupling | `dashboard/src/app/tools/holder-profiles/page.tsx` (line 240) |
| Credits page UI | `dashboard/src/app/dashboard/credits/page.tsx` |
| Analysis processor | `src/queues/processors/analysis-operations.processor.ts` |
| Similarity processor | `src/queues/processors/similarity-operations.processor.ts` |

---

**Last Updated:** 2026-02-27
**Author:** Claude (Opus 4.6) + human review
**Next Step:** Phase 1 implementation (pricing cleanup)
