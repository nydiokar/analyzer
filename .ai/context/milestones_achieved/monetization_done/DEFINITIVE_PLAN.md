# DEFINITIVE PAYMENT PLAN — Solana-Native, Modular, No Stripe

**Stack**: Solana Pay (humans) → X402 (agents) → Credit Guard (unified gate)
**Model**: Prepaid credit packs. No subscriptions. No recurring billing.
**Status**: Zero payment infrastructure exists yet. Clean slate.

---

## PHASE 0 — One Decision Before Any Code

**Create a dedicated treasury wallet.**
New Phantom/Solflare wallet. Not your personal one. Save the pubkey.

```env
TREASURY_WALLET_ADDRESS=<new wallet pubkey>
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
FREE_CREDITS_ON_SIGNUP=100
```

Nothing else starts until this exists. Every downstream component depends on it.

---

## PHASE 1 — Credit System (No Payment Yet)

**Goal**: Credits exist. Guard works. API is gateable. No money moves.

This is pure infrastructure. Payment-method-agnostic. Build once, works for everything.

### 1a. Prisma Schema

```prisma
model CreditBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  credits   Int      @default(0)
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model CreditTransaction {
  id           String   @id @default(cuid())
  userId       String
  delta        Int      // positive = top-up, negative = spend
  reason       String   // "purchase" | "signup_bonus" | "endpoint:/wallets/.../behavior-analysis"
  refId        String?  // paymentIntentId or jobId
  balanceAfter Int
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}
```

Rule: never update balance directly. Always append CreditTransaction + update CreditBalance
in a Prisma transaction. Full audit trail, zero extra effort.

### 1b. CreditsModule

```
src/api/modules/credits.module.ts
src/api/services/credits.service.ts
```

CreditService methods:
- `getBalance(userId)` — Redis first, fallback to DB
- `deduct(userId, amount, reason, refId?)` — atomic: insert tx + update balance
- `topUp(userId, amount, reason, refId?)` — same pattern
- `grantSignupBonus(userId)` — called from auth flow on registration

### 1c. @RequireCredits Decorator + CreditGuard

```typescript
@RequireCredits(5)
async getBehaviorAnalysis() { ... }
```

- Guard checks balance BEFORE request
- Deducts AFTER response is sent successfully
- Failed analyses do NOT consume credits
- On insufficient balance: throws HTTP 402 with:
  ```json
  { "error": "insufficient_credits", "balance": N, "required": N }
  ```

### 1d. Wire Signup Bonus

In existing auth module, after user creation:
```typescript
await creditsService.grantSignupBonus(user.id); // 100 free credits
```

### 1e. Decorate Endpoints (Start With These)

```
@RequireCredits(2)   /wallets/{address}/summary
@RequireCredits(3)   /wallets/{address}/pnl-overview
@RequireCredits(5)   /wallets/{address}/behavior-analysis
@RequireCredits(10)  /analyses/wallets/dashboard-analysis (flash)
@RequireCredits(25)  /analyses/wallets/dashboard-analysis (working)
@RequireCredits(50)  /analyses/wallets/dashboard-analysis (deep)
@RequireCredits(100) /analyses/similarity/queue (base, + 10/wallet)
```

### Phase 1 End State

Credits in DB. Guard fires. 100 free credits on signup.
Paid endpoints block at 0. Returns 402. No money moves yet.

---

## PHASE 2 — Solana Pay Checkout (First Payment Method)

**Goal**: Users buy credit packs with USDC. QR code flow. Human-facing.

### 2a. New Files

```
src/api/modules/payment.module.ts
src/api/controllers/payment.controller.ts
src/api/services/payment.service.ts
src/api/workers/payment-confirmation.processor.ts
```

### 2b. Prisma Additions

```prisma
model CreditPack {
  id        String  @id @default(cuid())
  name      String  // "Starter" | "Builder" | "Pro"
  credits   Int     // 1000 | 10000 | 100000
  priceUsdc Float   // 15 | 120 | 900
  active    Boolean @default(true)
}

model PaymentIntent {
  id                String    @id @default(cuid())
  userId            String
  packId            String
  credits           Int
  amountUsdc        Float
  status            String    @default("pending") // pending|confirmed|expired
  solanaPayUrl      String
  destinationWallet String
  createdAt         DateTime  @default(now())
  expiresAt         DateTime  // 30 minutes from creation
  confirmedAt       DateTime?
  txSignature       String?

  @@index([userId, status])
  @@index([status, expiresAt])
}
```

### 2c. API Endpoints

```
GET  /payments/packs          → list available credit packs
POST /payments/checkout       → create PaymentIntent, return QR
GET  /payments/:id/status     → poll for confirmation
GET  /users/me/credits        → current balance + recent transactions
```

POST /payments/checkout response:
```json
{
  "id": "pi_xxx",
  "solanaPayUrl": "solana:WALLET?amount=120&spl-token=USDC_MINT&memo=pi_xxx&label=Analyzer",
  "qrCodeDataUrl": "data:image/png;base64,...",
  "expiresAt": "2026-02-23T20:38:41Z",
  "amount": 120,
  "credits": 10000
}
```

GET /payments/:id/status response:
```json
{
  "status": "pending",
  "phase": "waiting",
  "message": "Scan QR code with Phantom or Solflare"
}
```

### 2d. Confirmation — Webhook Primary + Reconciliation Fallback

**Decision (Feb 24):** Per-intent polling was rejected. It costs ~600 RPC calls per pending
intent (findReference() every 3s over 30min). At any real user volume this becomes
expensive and rate-limited. Big players (Stripe, Coinbase Commerce) never poll — they
use webhooks as the primary path with a single reconciliation job as a safety net.

**Architecture:**

```
Payment confirmed on-chain
        │
        ▼
Helius pushes to POST /integrations/helius/payment-webhook
        │
        ▼
PaymentWebhookHandler:
  - find PaymentIntent by reference pubkey
  - verify USDC mint + amount >= expected
  - mark confirmed + store txSignature
  - creditsService.topUp()
  - emit WebSocket event payment:confirmed
        │
        ▼ (safety net only)
Reconciliation BullMQ job (runs every 5 min, ONE job total):
  - scans all pending intents older than 2min (gives webhook time to arrive)
  - for each: calls findReference() once
  - if found: same confirm flow as above
  - if expiresAt passed: mark expired
```

**Why this is correct:**
- Zero RPC calls in the happy path (webhook does it)
- One reconciliation scan per 5 min regardless of user count — O(1) not O(n intents)
- Catches missed webhooks (Helius outage, network blip)
- Same BullMQ infrastructure already in the project

**Local dev:** use `ngrok http 3001` to get a public URL, register it in Helius dashboard
under Enhanced Transactions webhook, filter to treasury wallet address. One-time setup.

**Helius webhook registration:**
- Type: Enhanced Transactions
- Wallet: TREASURY_WALLET_ADDRESS
- URL: https://<your-ngrok-or-prod-domain>/api/v1/integrations/helius/payment-webhook
- Auth: add `HELIUS_PAYMENT_WEBHOOK_SECRET` to .env, verify `x-helius-signature` header

**Files to create:**
```
src/api/controllers/helius-webhook.controller.ts  — add new @Post('payment-webhook') handler
src/queues/processors/payment-reconciliation.processor.ts  — single scheduled BullMQ job
```

### 2e. Packages

```bash
pnpm add @solana/pay @solana/web3.js qrcode
pnpm add -D @types/qrcode
```

That's it. Apache 2.0. No telemetry.

### Credit Pack Pricing

```
STARTER    1,000 credits   = $15 USDC
BUILDER   10,000 credits   = $120 USDC
PRO      100,000 credits   = $900 USDC
```

### Phase 2 End State

Human user: clicks "Buy Credits" → QR appears → scans with Phantom →
approves → 3-5 seconds → "Credits added" → redirect to dashboard.
No Stripe. No third party. No KYC.

---

## PHASE 3 — X402 Protocol (Agent/Bot Payment Method)

**Goal**: AI agents and trading bots pay per-request autonomously. No human involvement.

This is additive. Phase 1 and 2 infrastructure is unchanged.

### How It Works

When `CreditGuard` fires a 402 and the request lacks `X-Payment` header,
return an x402 payload instead of a plain error:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana-mainnet",
    "maxAmountRequired": "5000000",
    "resource": "/wallets/{address}/behavior-analysis",
    "description": "5 USDC for behavior analysis",
    "payTo": "TREASURY_WALLET",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "memo": "req_<requestId>"
  }]
}
```

Agent flow:
1. Agent hits endpoint → gets 402 + x402 payload
2. Agent signs USDC tx with its own keypair
3. Agent retries request with `X-PAYMENT: <proof>` header
4. Server verifies on-chain → serves response
5. No account needed beyond API key. Fully autonomous.

### Package

```bash
pnpm add x402  # Coinbase's implementation, open source, Solana-first
```

### CreditGuard Extension

```typescript
// Existing: return 402 plain error
// Extended: if no X-Payment header → return x402 payload
//           if X-Payment header → verify tx → allow through → deduct
```

Same guard, extended. Not replaced.

### Phase 3 End State

Trading bots (OpenClaw, custom bots) hit API → pay per-request in USDC →
get data → done. Zero human in the loop. This is the agentic economy path.

---

## PHASE 4 — Self-Service UI & Visibility

**Goal**: Users never need to contact you. System is fully autonomous.

- `/dashboard/credits` page:
  - Current balance (big number)
  - "Buy Credits" button → opens QR checkout modal
  - Transaction ledger (top-ups + spends)
  - Which endpoints are consuming credits
- Low-balance WebSocket notification (push when credits < 50)
- Admin panel additions:
  - View all user balances
  - Manually grant credits (support, beta comp)
  - See PaymentIntent history

### Phase 4 End State

Fully self-service. You don't touch anything per-user manually.

---

## WHAT STAYS OUT (Until Much Later)

| Thing | Why deferred |
|-------|-------------|
| Stripe | Never. Credit packs eliminate the need. |
| Subscriptions/recurring | Credit packs solve this more simply. |
| Ocean Protocol | Phase 5+ if ever. |
| RapidAPI listing | After Phase 2 is solid and has real users. |
| Python/Rust SDKs | After paying customers validate the API. |

---

## ARCHITECTURE SUMMARY

```
HUMAN USER                    AI AGENT / BOT
     │                              │
     │ buys credit pack             │ hits endpoint
     ▼                              ▼
Solana Pay QR              HTTP 402 + x402 payload
     │                              │
     │ USDC tx on-chain             │ signs + retries with X-PAYMENT
     ▼                              ▼
Confirmation Worker         X402 Verifier (CreditGuard extension)
     │                              │
     └──────────────┬───────────────┘
                    ▼
            CreditBalance (Postgres)
            CreditTransaction ledger
                    │
                    ▼
            CreditGuard (@RequireCredits)
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
     ALLOWED               BLOCKED
     process + deduct      402 + instructions
```

---

## IMPLEMENTATION ORDER (No Ambiguity)

```
1. [ ] Create treasury wallet → add to .env
2. [ ] Add CreditBalance + CreditTransaction to schema.prisma
3. [ ] prisma migrate dev
4. [ ] Build CreditsModule + CreditsService
5. [ ] Build @RequireCredits decorator + CreditGuard
6. [ ] Wire grantSignupBonus into auth flow
7. [ ] Add @RequireCredits decorators to endpoints
8. [ ] Test: new user gets 100 credits, hits behavior-analysis, balance goes to 95
         ↑ PHASE 1 DONE — ship this
9. [ ] Add CreditPack + PaymentIntent to schema.prisma
10.[ ] prisma migrate dev
11.[ ] Build PaymentModule + PaymentController + PaymentService
12.[ ] Build payment-confirmation BullMQ processor
13.[ ] pnpm add @solana/pay @solana/web3.js qrcode
14.[ ] Test: buy STARTER pack on devnet → credits land
15.[ ] Switch to mainnet USDC
         ↑ PHASE 2 DONE — ship this, start charging
16.[ ] pnpm add x402
17.[ ] Extend CreditGuard with x402 payload on 402
18.[ ] Build X402 verification in guard
19.[ ] Test with a bot using a funded keypair
         ↑ PHASE 3 DONE — agents can pay autonomously
20.[ ] Build /dashboard/credits UI
21.[ ] Wire low-balance WebSocket notification
22.[ ] Admin credit grant tool
         ↑ PHASE 4 DONE — fully self-service
```

---

## OPEN QUESTIONS (Resolve Before Phase 1)

1. **Treasury wallet** — have you created it yet?
2. **Free credits on signup** — 100 confirmed, or different number?
3. **Credit pack pricing** — $15/$120/$900 or adjust?
4. **Credit expiry** — do unused credits expire? (Recommendation: no. Keeps trust.)
5. **Devnet testing first?** — strongly recommended before mainnet USDC
