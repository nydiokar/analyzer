# Credit Charging Architecture — Dynamic Pricing & API Layer Design

**Date:** 2026-03-01
**Branch:** `feat/credit-ledger-foundation`
**Status:** Decided → Implementation pending
**Supersedes:** Previous version of this file

---

## The Problem

### Problem 1 — Static decorator can't express dynamic cost

`@RequireCredits(N)` is a compile-time static decorator. The similarity endpoint cost is runtime-dynamic: 10cr if wallets are already cached, 20cr if Helius sync is needed. You cannot know this until you query DB wallet status inside the handler body. The guard fires before the handler runs. These two facts are incompatible.

**Result:** `@RequireCredits` must be removed from `POST /analyses/similarity/queue`. Dynamic cost requires explicit `creditsService.deduct()` called after the wallet status check inside the handler.

### Problem 2 — Compound operations and double-charging

`POST /analyses/holder-profiles` costs 25cr via `@RequireCredits(25)`. After it completes, the frontend auto-fires `POST /analyses/similarity/queue` as a separate HTTP call, which hits `@RequireCredits(20)`. This is a separate guard invocation — the user gets charged twice independently.

The intended pricing is: holder-profiles run (Helius-heavy) + similarity on already-synced wallets = one combined operation. It shouldn't cost 25 + 20 = 45cr. It should cost 20cr (profiles) + 10cr (similarity on cached wallets) = 30cr total.

### Problem 3 — Free ride on behavioral analysis

`GET /wallets/:addr/behavior-analysis` was gated at 5cr and later the gate was removed (PAY-6b decision). This is a pure DB read — it returns the aggregated behavioral profile for a wallet that has been analyzed. A user with a JWT and zero credits can call this for any pre-analyzed wallet. This is ~70% of the product value for free.

**Decision:** This is acceptable short-term because:
- The wallet must already be analyzed (someone paid to trigger that)
- Rate limiting is in place
- The real attack surface is triggering new compute, not reading cached results
- Invite codes / registration controls limit who gets a JWT

When Intel layer is built, `GET /intel/wallet/:addr` aggregates this same data at 5cr, which is the paid external-facing surface. Internal reads stay free for dashboard UX. This is a product decision, not a security hole.

---

## The Architecture Decision

### Two-Tier API Model

```
/api/v1/analyses/*   ←  Internal compute primitives  ←  Dashboard frontend only
/api/v1/intel/*      ←  External product API          ←  Devs, agents, bots
```

**`/analyses/*` endpoints:**
- Serve the dashboard frontend (JWT auth, human users)
- Dynamic pricing via explicit `creditsService.deduct()` calls
- No `@RequireCredits` decorator on compound/dynamic endpoints
- No X402 agent payment support (agents use Intel endpoints)
- Can evolve freely — not a stable external contract

**`/intel/*` endpoints:**
- New `IntelController` — separate file, separate module
- Static pricing via `@RequireCredits(N)` decorator — X402 works automatically
- Internally call queue services directly — same BullMQ jobs, same processors
- Zero code duplication in job logic — only thin orchestration glue
- Stable external contract for devs and autonomous agents

**Why this works for X402:**
`CreditGuard` reads the `@RequireCredits` metadata and returns the 402 payment instructions payload (price, treasury, network) before the handler runs. This only works if price is static. Intel endpoints have static prices → X402 works. Analyses endpoints have dynamic prices → X402 cannot work there → that's fine, they're internal.

**Why this works for Telegram bot:**
Bot calls `creditsService.deduct()` then `analysisOperationsQueue.addHolderProfilesJob()` directly. No HTTP. No guard. No double-charge. Same processors handle the job.

---

## What Changes (PAY-SIM Implementation)

### Files to modify

| File | Change |
|------|--------|
| `src/api/services/credits.service.ts` | Add `checkAndDeduct(userId, amount, reason)` — wraps existing `deduct()` with a refund-on-failure contract for upfront charging |
| `src/api/controllers/analyses.controller.ts` | Remove `@RequireCredits` from `holder-profiles` and `similarity/queue`; inject `CreditsService`; add explicit deduct calls with try/catch refund |
| `dashboard/src/app/dashboard/credits/page.tsx` | Update `getTxConfig` label map + `OPERATION_COSTS` |
| `dashboard/src/app/dashboard/credits/checkout/[packId]/page.tsx` | Update breakdown costs |
| `src/api/controllers/pricing.controller.ts` | Update similarity to show 10–20cr dynamic range |

### CreditsService: `checkAndDeduct` method

The existing `deduct()` already does atomic check+deduct in a Prisma transaction. The new method is a thin wrapper that adds refund-on-failure semantics:

```typescript
async checkAndDeduct(userId: string, amount: number, reason: string): Promise<void> {
  // deduct() already throws HTTP 402 if balance insufficient
  await this.deduct(userId, amount, reason);
  // Caller wraps queue call in try/catch and calls topUp() to refund if it throws
}
```

Controllers that call this must follow the pattern:
```typescript
await this.creditsService.deduct(userId, creditCost, reason);
try {
  await this.queue.addJob(jobData);
} catch (queueError) {
  await this.creditsService.topUp(userId, creditCost, `refund:${reason}`);
  throw new InternalServerErrorException('Failed to queue job');
}
```

### `POST /analyses/holder-profiles` — new charging logic

Remove `@RequireCredits(25)`. Inject `CreditsService` in constructor.

```typescript
// Cost: 20cr (holder profiles compute — Helius RPCs)
// Similarity fires separately from frontend at 10-20cr after this completes
const HOLDER_PROFILES_COST = 20;

if (req.user) {
  await this.creditsService.deduct(
    req.user.id,
    HOLDER_PROFILES_COST,
    'endpoint:AnalysesController.queueHolderProfilesAnalysis'
  );
}
try {
  const job = await this.analysisOperationsQueue.addHolderProfilesJob(jobData, ...);
} catch (err) {
  if (req.user) {
    await this.creditsService.topUp(req.user.id, HOLDER_PROFILES_COST,
      'refund:AnalysesController.queueHolderProfilesAnalysis');
  }
  throw new InternalServerErrorException('Failed to queue job');
}
```

### `POST /analyses/similarity/queue` — dynamic pricing

Remove `@RequireCredits(20)`. The wallet status check already runs at line 208-211 of the current controller. Dynamic cost based on that result:

```typescript
// walletsNeedingSync computed from databaseService.getWalletsStatus() (already in code)
const creditCost = walletsNeedingSync.length > 0 ? 20 : 10;

if (req.user) {
  await this.creditsService.deduct(
    req.user.id,
    creditCost,
    'endpoint:AnalysesController.queueSimilarityAnalysis'
  );
}
try {
  const job = await this.similarityOperationsQueue.addSimilarityAnalysisFlow(jobData, ...);
} catch (err) {
  if (req.user) {
    await this.creditsService.topUp(req.user.id, creditCost,
      'refund:AnalysesController.queueSimilarityAnalysis');
  }
  throw new InternalServerErrorException('Failed to queue job');
}
```

**Resulting total cost for the full holder-profiles + similarity flow:**
- Holder profiles (20 fresh wallets): 20cr
- Similarity auto-fired after (wallets now READY, walletsNeedingSync=[]): 10cr
- **Total: 30cr = $0.45** ✅

**Standalone similarity (Similarity Lab):**
- Wallets need sync: 20cr ✅
- Wallets pre-synced: 10cr ✅

### `CreditsService` is already `@Global()` — no module changes needed

`CreditsModule` is `@Global()` and imported in `AppModule`. `CreditsService` is injectable anywhere. Just add it to `AnalysesController` constructor.

---

## What Changes (PAY-SIM-UI Implementation)

### Transaction label fix — `credits/page.tsx`

Current `getTxConfig()` shows "Used" for all negative-delta transactions. Fix:

```typescript
function getTxConfig(tx: CreditTransaction): { label: string; icon: React.ReactNode; color: string } {
  if (tx.delta > 0) {
    if (tx.reason === 'signup_bonus') return { label: 'Signup Bonus', icon: <Gift />, color: 'text-blue-400' };
    if (tx.reason === 'x402_payment') return { label: 'Agent Payment (X402)', icon: <Zap />, color: 'text-purple-400' };
    return { label: 'Credit Purchase', icon: <ArrowUpCircle />, color: 'text-green-400' };
  }
  const labelMap: Record<string, string> = {
    'endpoint:AnalysesController.queueHolderProfilesAnalysis': 'Holder Profiles',
    'endpoint:AnalysesController.queueSimilarityAnalysis': 'Similarity Analysis',
    'endpoint:AnalysesController.queueDashboardWalletAnalysis': 'Dashboard Analysis',
    'endpoint:AnalysesController.queueWalletHolderProfile': 'Wallet Profile',
  };
  const label = labelMap[tx.reason] ?? (tx.reason.startsWith('refund:') ? 'Refund' : 'Analysis');
  return { label, icon: <ArrowDownCircle />, color: 'text-red-400' };
}
```

### OPERATION_COSTS update

```typescript
const OPERATION_COSTS = [
  { label: 'Dashboard Analysis', cost: 5 },
  { label: 'Holder Profiles', cost: 20 },
  { label: 'Similarity (after Holder Profiles)', cost: 10 },
  { label: 'Similarity (standalone)', cost: 20 },
] as const;
```

### Checkout breakdown update

```typescript
{ label: 'Dashboard Analyses', count: Math.floor(credits / 5), cost: 5 },
{ label: 'Holder + Similarity runs', count: Math.floor(credits / 30), cost: 30 },
{ label: 'Standalone Similarity', count: Math.floor(credits / 20), cost: 20 },
```

---

## What Does NOT Change

- `CreditGuard` — unchanged. Still handles X402 + static `@RequireCredits` endpoints
- `CreditInterceptor` — unchanged. Still handles post-success deduction for decorated endpoints
- `CompositeAuthGuard` — unchanged. X402 discovery path still works for any endpoint with `@RequireCredits`
- `POST /analyses/wallets/dashboard-analysis` — stays at `@RequireCredits(5)`. Simple, non-compound, static price
- `POST /analyses/holder-profiles/wallet` — stays at `@RequireCredits(5)`. Simple, non-compound, static price
- All queue processors — untouched. This is the whole point: logic lives in processors, pricing lives in controllers
- All queue services (`AnalysisOperationsQueue`, `SimilarityOperationsQueue`) — untouched

---

## PAY-7 Intel Layer — How It Plugs In

When building `IntelController`:

```typescript
// src/api/controllers/intel.controller.ts

@Post('/intel/token/:mint/holders')
@RequireCredits(35)   // ← static price, X402 works automatically
async getTokenHolders(@Req() req, @Param('mint') mint: string) {
  // CreditGuard already checked balance and will deduct via CreditInterceptor
  // Internally: call queue services directly — NO HTTP to /analyses/*
  const profilesJob = await this.analysisOperationsQueue.addHolderProfilesJob({ ... });
  const similarityJob = await this.similarityOperationsQueue.addSimilarityAnalysisFlow({ ... });
  // Return jobIds for polling / websocket
}
```

`IntelController` injects `AnalysisOperationsQueue` and `SimilarityOperationsQueue` directly — the exact same queue instances the analyses controller uses. Same BullMQ workers process the jobs. Zero logic duplication.

**Key point:** The `@RequireCredits(35)` decorator makes X402 work automatically for agents. The `CreditGuard` reads it before the handler, returns the 402 payment instructions, and `CreditInterceptor` deducts on success. Intel layer gets full X402 support for free because it uses static pricing.

---

## X402 After This Change

| Endpoint | X402 support | Reason |
|----------|-------------|--------|
| `POST /analyses/similarity/queue` | ❌ No | Dynamic price, decorator removed |
| `POST /analyses/holder-profiles` | ❌ No | Compound, decorator removed |
| `POST /analyses/wallets/dashboard-analysis` | ✅ Yes | Static @RequireCredits(5) |
| `POST /intel/token/:mint/holders` (future) | ✅ Yes | Static @RequireCredits(35) |
| `GET /intel/wallet/:addr` (future) | ✅ Yes | Static @RequireCredits(5) |

Agents target Intel endpoints. Dashboard targets analyses endpoints. No overlap needed.

---

## Verification Steps (after PAY-SIM implementation)

1. Balance = 15cr → hit `similarity/queue` with pre-synced wallets → 202, deducts 10cr → balance = 5cr
2. Balance = 5cr → hit `similarity/queue` again → 402 `required: 10`
3. Balance = 15cr → hit `similarity/queue` with MISSING wallets → 402 `required: 20`
4. Balance = 25cr → hit `similarity/queue` with MISSING wallets → 202, deducts 20cr → balance = 5cr
5. Balance = 30cr → hit `holder-profiles` → 202, deducts 20cr → balance = 10cr → frontend fires similarity (wallets READY) → deducts 10cr → balance = 0cr
6. Verify no double deduction in transaction ledger (should be exactly 2 rows: -20, -10)
7. Kill queue mid-test → verify refund transaction appears in ledger

---

## Key Principles

> **`@RequireCredits` is for simple, static-price, external-facing endpoints only.**
> **Compound or dynamic-price endpoints use explicit `creditsService.deduct()` with refund-on-failure.**
> **Internal job-to-job calls never go through HTTP.**
> **Intel controller reuses queue services directly — processors are the shared logic layer.**

---

**Last Updated:** 2026-03-01
**Author:** Claude (Sonnet 4.6) + human review
**Next:** Implement PAY-SIM (backend) → PAY-SIM-UI (frontend labels) → PAY-7 (Intel controller)
