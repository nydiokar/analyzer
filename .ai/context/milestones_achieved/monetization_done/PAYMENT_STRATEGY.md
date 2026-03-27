# PAYMENT STRATEGY — Solana-Native, No Stripe

**Decision**: Skip Stripe. Build on Solana Pay + USDC. Credit pack model.

---

## WHY NO STRIPE

- KYC requirements and payout delays
- 2.9% + $0.30 per transaction
- Legal/compliance exposure (EU, crypto restrictions)
- Chargebacks and failed payment handling complexity
- Subscription billing complexity for a credit-based system
- Our users are crypto-native — they already have Phantom/Solflare open

---

## ARCHITECTURE: CREDIT PACKS via SOLANA PAY

Instead of subscriptions, sell prepaid credit packs.
User pays → credits appear → they use them → top up when low.
No recurring billing. No failed payments. No churn handling.

### Credit Pack Pricing
```
STARTER    1,000 credits   = $15 USDC
BUILDER   10,000 credits   = $120 USDC
PRO      100,000 credits   = $900 USDC
CUSTOM   500,000+ credits  = negotiate
```

### Credit Costs Per Endpoint (unchanged)
```
TIER 1: Free (1 credit)
├─ /discover/wallets
├─ /wallets/search
└─ /token-info

TIER 2: Cached Insights (2-5 credits)
├─ /wallets/{address}/summary (2)
├─ /wallets/{address}/token-performance (2)
├─ /wallets/{address}/pnl-overview (3)
├─ /wallets/{address}/classification (2)
└─ /wallets/{address}/hud (3)

TIER 3: Computed Analysis (5-10 credits)
├─ /wallets/{address}/behavior-analysis (5)
├─ /token-info/{mint}/top-holders (5)
└─ /wallets/{address}/exit-timing-tokens/* (3)

TIER 4: Background Jobs (10-50 credits)
├─ /analyses/wallets/dashboard-analysis
│   ├─ flash: 10 credits
│   ├─ working: 25 credits
│   └─ deep: 50 credits
├─ /analyses/holder-profiles (50 + 5/holder)
└─ /users/me/favorites (auto-analysis: 10)

TIER 5: Heavy Compute (100+ credits)
└─ /analyses/similarity/queue (100 + 10/wallet)
```

---

## HOW HELIUS DOES IT (REFERENCE)

Helius built this themselves on top of standard Solana Pay protocol.
Their checkout flow:

1. Backend generates a PaymentIntent with a unique ID (pi_...)
2. Constructs Solana Pay URL:
   `solana:WALLET?amount=363.64&spl-token=USDC_MINT&memo=pi_...&label=Helius`
3. Encodes as QR code — user scans with Phantom/Solflare
4. Frontend polls `/checkout/{id}/status` every ~3 seconds
5. Backend watches Solana chain for tx with memo=paymentId to their wallet
6. On confirmation → activates subscription

This is ~200-300 lines of TypeScript. Not a third-party service.

---

## DATABASE SCHEMA

```prisma
model CreditBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  credits   Int      @default(100)  // 100 free on signup
  updatedAt DateTime @updatedAt
}

model CreditPack {
  id       String @id @default(cuid())
  name     String   // "Starter", "Builder", "Pro"
  credits  Int      // 1000, 10000, 100000
  priceUsd Float    // 15, 120, 900 (USDC, 1:1 with USD)
  active   Boolean  @default(true)
}

model PaymentIntent {
  id                String    @id @default(cuid())
  userId            String
  credits           Int
  amountUsdc        Float
  status            String    @default("pending") // pending|confirmed|expired
  solanaPayUrl      String
  destinationWallet String
  memo              String    @unique  // = id, used for on-chain lookup
  createdAt         DateTime  @default(now())
  expiresAt         DateTime
  confirmedAt       DateTime?
  txSignature       String?
}
```

---

## API ENDPOINTS (NEW)

```
POST /payments/checkout
  Body: { packId: "builder" }
  Response: {
    id: "pi_xxx",
    solanaPayUrl: "solana:WALLET?amount=120&spl-token=USDC&memo=pi_xxx",
    qrCodeDataUrl: "data:image/png;base64,...",
    expiresAt: "2026-02-23T20:38:41Z",
    amount: 120,
    credits: 10000
  }

GET /payments/:id/status
  Response: {
    status: "pending" | "confirmed" | "expired",
    phase: "waiting" | "confirming" | "complete",
    credits?: number,  // only on confirmed
    message: "Waiting for payment..."
  }

GET /payments/packs
  Response: CreditPack[]

GET /users/me/credits
  Response: { credits: number, updatedAt: string }
```

---

## CONFIRMATION WORKER (BULLMQ)

```
Every 3 seconds per pending PaymentIntent:
1. Call Helius getSignaturesForAddress(destinationWallet)
2. For each signature, getTransaction() and check memo field
3. If memo === paymentIntent.id AND amount >= expected AND token === USDC:
   - Mark PaymentIntent confirmed
   - Add credits to CreditBalance
   - Emit WebSocket event to user
4. If expiresAt passed → mark expired
```

Uses `findReference` from `@solana/pay` — this is built-in.

---

## PACKAGES

```bash
npm install @solana/pay @solana/web3.js qrcode
# That's it. Apache 2.0, no telemetry.
```

USDC mint on Solana mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

---

## CREDIT GATE MIDDLEWARE

```typescript
// Decorator
@RequireCredits(5)
async getBehaviorAnalysis() { ... }

// Guard checks balance BEFORE, deducts AFTER success
// Failed analyses do not charge credits
```

---

## PAYMENT METHOD GRAPH

```
                        ┌─────────────────────────────────────┐
                        │         PAYMENT METHODS             │
                        └─────────────────┬───────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
              ▼                           ▼                           ▼
    ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
    │  HUMAN USERS     │       │   AI AGENTS      │       │  ENTERPRISE      │
    │  (Traders, Devs) │       │  (Bots, MCP)     │       │  (Funds, Platforms│
    └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
             │                          │                           │
             ▼                          ▼                           ▼
    ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
    │  SOLANA PAY      │       │  X402 PROTOCOL   │       │  INVOICE /       │
    │  (QR Code)       │       │  (HTTP 402)      │       │  MANUAL USDC     │
    │                  │       │                  │       │                  │
    │  - Phantom scan  │       │  - Agent hits API│       │  - Monthly USDC  │
    │  - Solflare scan │       │  - Gets 402      │       │  - Bulk credits  │
    │  - USDC only     │       │  - Auto-pays     │       │  - Custom deal   │
    │  - QR + connect  │       │  - Retries req   │       │                  │
    └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
             │                          │                           │
             └──────────────┬───────────┘                          │
                            │                                       │
                            ▼                                       ▼
                ┌───────────────────────┐             ┌────────────────────────┐
                │   CREDIT BALANCE      │◄────────────│   CREDIT BALANCE       │
                │   (DB + Redis)        │             │   (bulk allocation)    │
                └───────────┬───────────┘             └────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   CREDIT GUARD        │
                │   (NestJS middleware) │
                │   @RequireCredits(N)  │
                └───────────┬───────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
              ▼                            ▼
    ┌──────────────────┐        ┌──────────────────┐
    │  ALLOWED         │        │  REJECTED        │
    │  → process req   │        │  402 + top-up    │
    │  → deduct after  │        │  URL returned    │
    └──────────────────┘        └──────────────────┘
```

---

## PAYMENT FLOW (USER PERSPECTIVE)

```
1. User clicks "Buy 10,000 credits — $120 USDC"
2. QR code appears (+ wallet connect button as fallback)
3. Scan with Phantom → approve in 2 seconds
4. Status polling confirms in ~3-5 seconds
5. "10,000 credits added" → redirect to dashboard

No credit card. No Stripe redirect. No email confirmation.
```

---

## X402 PROTOCOL (FOR AI AGENTS)

X402 is HTTP 402 "Payment Required" implemented for crypto.
Built on Solana by Coinbase in 2025. Open source.

```
Agent requests API endpoint
  ↓
Server returns: HTTP 402
  {
    "x402Version": 1,
    "accepts": [{
      "scheme": "exact",
      "network": "solana-mainnet",
      "maxAmountRequired": "5000000",  // 5 USDC (6 decimals)
      "resource": "/wallets/abc/behavior-analysis",
      "description": "5 credits for behavior analysis",
      "mimeType": "application/json",
      "payTo": "YOUR_TREASURY_WALLET",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    }]
  }
  ↓
Agent signs and sends USDC transaction
  ↓
Agent retries request with payment proof header
  ↓
Server verifies on-chain, serves response
```

This enables autonomous AI agents to consume your API with zero human involvement.
This is the agentic economy path.

---

## IMPLEMENTATION ORDER

```
1. CreditBalance + PaymentIntent schema (Prisma migration)
2. CreditGuard middleware + @RequireCredits decorator
3. POST /payments/checkout + GET /payments/:id/status
4. Confirmation worker (BullMQ, polls Helius RPC)
5. Frontend checkout modal (QR + polling)
6. Free 100 credits on signup (hook users)
7. X402 layer on top (for AI agents, Phase 2)
```

---

## WHAT YOU DON'T NEED

- Stripe — at all
- Any third-party payment processor
- Subscription/recurring billing logic
- KYC approval from any processor
- Ocean Protocol (add much later)

---

## OPEN QUESTIONS TO RESOLVE BEFORE CODING

1. **Treasury wallet address** — dedicated wallet, not your personal one
2. **Free tier credits on signup** — 100? 500?
3. **Pack pricing** — $15/$120/$900 or different?
4. **Credit expiry** — do unused credits expire? (recommend: no, keeps trust)
