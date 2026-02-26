# PAY-3 — X402 Protocol Layer: Decisions & Architecture

**Status:** Implemented, pending E2E test with funded agent wallet
**Branch:** `feat/credit-ledger-foundation`
**Date:** 2026-02-26

---

## What X402 Is

HTTP 402 "Payment Required" as a machine-readable protocol. When an autonomous agent hits a credit-gated endpoint without auth, instead of a plain error it receives a structured JSON payload telling it exactly what to pay, to whom, and in what token. The agent builds a real on-chain transaction, signs it, and retries the request with the signed tx in the `X-Payment` header. The server verifies, submits, and confirms the tx before serving the response.

No account needed. No API key. The signed transaction IS the authentication.

---

## Key Decisions

### 1 — Wallet-as-User (Option A), not anonymous

**Decision:** Auto-provision a real `User` DB row for each agent wallet pubkey.

**Why not anonymous (Option B):** No observability, no ability to block abusive wallets, no per-agent usage ledger. "Decentralized" ≠ "untrackable" — blockchain gives us pseudonymous identity via pubkey, we expose that through the DB.

**Why not separate route prefix (Option C):** Would require duplicating endpoint registrations. Unnecessary complexity.

**How it works:** `email = <pubkey>@x402.agent` as the unique DB key. `isActive` can be set to `false` to block a specific wallet. `apiKey` field is populated with a random UUID (schema requires it, never used).

**Identity sentinel:** `@x402.agent` suffix makes agent accounts easily identifiable in admin queries:
```sql
SELECT * FROM "User" WHERE email LIKE '%@x402.agent';
```

### 2 — No rate limiting for X402 agents

**Decision:** Agents bypass throttling implicitly (CompositeAuthGuard returns early for X402 requests before ThrottlerGuard has meaningful context).

**Why:** Agents pay per request. Payment IS the rate limiter. An agent burning $0.075/call 1000 times is $75 in revenue — that's desirable, not a problem. Rate limiting agents would actively hurt revenue and break autonomous pipelines.

**Future:** If a specific wallet is genuinely abusive (scraping, DoS-adjacent), set `isActive = false` on their auto-provisioned user. That's the abuse lever.

### 3 — Server submits the transaction, not the agent

**Decision:** The agent sends a **signed raw transaction** (not a tx signature). The server calls `sendRawTransaction` + `confirmTransaction`.

**Why not "agent broadcasts, sends signature":** We'd have to poll the RPC to verify the tx was confirmed, can't guarantee amount/recipient from the signature alone without fetching the full tx, and the agent could send a signature for a different tx. Submitting ourselves means we control confirmation and can validate the exact instruction before anything lands on-chain.

### 4 — Replay protection via Redis SET NX

**Decision:** After confirmation, atomically claim the tx signature: `SET x402:tx:<sig> <userId> EX 86400 NX`. TTL is 24h (Solana blockhash expires in ~2 min, but we keep it longer for safety).

**Why atomic:** GET+SET would have a race window where two concurrent requests with the same tx bytes both pass. `SET NX` is atomic — only one wins, the other gets a null response and we throw 402.

**Key:** Uses the RPC-confirmed base58 signature (not a locally-derived hash), so it's canonical and unique on-chain.

### 5 — Local tx validation before broadcast

**Decision:** Validate the `transferChecked` instruction locally (mint, recipient, amount) before calling `sendRawTransaction`.

**Why:** Fail fast without spending an RPC call on obviously wrong transactions. If the mint is wrong or recipient doesn't match treasury, reject immediately with a descriptive 402.

### 6 — Ledger record for x402 payments

**Decision:** After confirmation, call `creditsService.recordX402Payment(userId, creditCost, txSig)` — writes a `CreditTransaction` with `delta: -creditCost`, `reason: 'x402_payment'`, `refId: txSig`, without changing `CreditBalance`.

**Why not deduct():** Agent paid real USDC, they have no credit balance to deduct from. But we still want the ledger entry for auditing, analytics, and the credits dashboard.

**Why not topUp() then deduct():** Pointless round-trip. Creates phantom credit transactions.

### 7 — Unauthenticated discovery (first call returns 402 payload)

**Decision:** `CompositeAuthGuard` allows unauthenticated requests through to `CreditGuard` if the endpoint has `@RequireCredits` and no auth headers are present. `CreditGuard` then returns the 402 payment instructions.

**Why:** An agent hitting the API for the first time has no auth and no knowledge of the price. The 402 response IS the price discovery mechanism — it's the whole point of the protocol. Blocking at auth before the agent can see the price breaks the handshake.

**Safety:** The endpoint handler never executes — `CreditGuard` throws before reaching it. No data is served to unauthenticated requests.

### 8 — 402 payload shape follows x402 spec (not custom fields)

**Decision:** Response uses `x402Version`, `accepts[]` with `maxAmountRequired`, `payTo`, `asset`, `scheme`, `network` — the actual x402 spec fields.

**Why:** Real x402 client libraries (CDK, agent frameworks) parse the spec shape. Custom fields would require custom client code. Spec-compliant means any x402-aware agent can consume Sova Intel out of the box.

---

## Guard Chain Flow

```
Request (no headers)
  └─ CompositeAuthGuard: @RequireCredits + no auth → let through (no user set)
  └─ ThrottlerGuard: passes
  └─ AdminGuard: not @AdminOnly → passes
  └─ CreditGuard: no user, no X-Payment → throwPaymentRequired() → 402 ✓

Request (X-Payment header)
  └─ CompositeAuthGuard: X-Payment → extractPayerFromHeader() → findOrCreateAgentUser()
                         → request.user = agentUser → return true
  └─ ThrottlerGuard: passes
  └─ AdminGuard: passes
  └─ CreditGuard: user exists, X-Payment → verify() → local validation → sendRawTransaction
                  → confirmTransaction → Redis SET NX → recordX402Payment()
                  → request.x402Paid = true → return true
  └─ Handler executes → 200 ✓
  └─ CreditInterceptor: x402Paid = true → skip deduction ✓

Request (JWT/API key, sufficient credits)
  └─ CompositeAuthGuard: JWT/API key → request.user = dbUser → return true
  └─ CreditGuard: user exists, no X-Payment, balance >= required → store creditCost → return true
  └─ Handler executes → 200 ✓
  └─ CreditInterceptor: deduct credits ✓
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/api/services/x402-verification.service.ts` | New service: tx verification, findOrCreateAgentUser, extractPayerFromHeader, replay protection, ledger record |
| `src/api/shared/guards/composite-auth.guard.ts` | +X402 early path, +discovery path (unauthenticated @RequireCredits passthrough) |
| `src/api/shared/guards/credit.guard.ts` | +x402 path, +discovery 402 payload, refactored throwPaymentRequired() |
| `src/api/shared/interceptors/credit.interceptor.ts` | +x402Paid skip |
| `src/api/modules/credits.module.ts` | Cleaned: guards/interceptors removed (they live in AppModule), added X402VerificationService + RedisModule |
| `src/api/services/credits.service.ts` | +recordX402Payment() |
| `src/scripts/x402-agent-test.ts` | New: full E2E test script (discovery → pay → verify → replay) |
| `src/scripts/generate-wallet.ts` | New: keypair generator utility |

---

## Pricing

```
USDC_PER_CREDIT = 0.015   ($15 / 1000 credits)
USDC_DECIMALS   = 6
amount_base_units = credits × 0.015 × 1_000_000

Examples:
  behavior-analysis (5 credits)  → 75,000 base units = $0.075
  dashboard-analysis (10 credits) → 150,000 base units = $0.15
  similarity/queue (100 credits)  → 1,500,000 base units = $1.50
```

---

## Still To Do / Known Gaps

- **E2E test not yet run** — needs agent wallet funded with USDC on mainnet (`AGENT_PRIVKEY` in `.env`, `TEST_WALLET_ADDR` set)
- **Treasury ATA** — must exist on-chain (confirmed: already received USDC in PAY-2c test)
- **`transferChecked` account index assumption** — destination is `keys[2]`. This is standard for SPL token but should be verified against a real agent-built tx in the E2E test
- **No test for blocked wallet (`isActive=false`)** — manual DB test needed
- **`behavior-analysis` response latency during X402** — handler may take 5-30s; the confirm step adds ~5s on top. Total latency for agents: 10-35s. Acceptable for autonomous agents, worth documenting
