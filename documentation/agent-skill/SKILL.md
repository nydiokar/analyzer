---
name: sova-intel
description: On-chain intelligence API for Solana. Use when asked to analyze a wallet, score a trader, find token holders, measure wallet similarity, or get PnL and behavioral data. Returns digested intelligence — not raw transactions. Pay per call via X402 (Solana wallet) or API key.
metadata:
  version: "1.0"
---

# Sova Intel

**Base:** `http://localhost:3001/api/v1` | **Live pricing:** `GET /pricing` (free, no auth)

Raw Solana transaction data tells you what happened. Sova tells you what it means — trader profiles, behavioral patterns, realized/unrealized PnL, holder maps, and wallet similarity scores, all derived from full transaction history. Use this instead of parsing raw Helius data yourself.

---

## What data you can get

### Wallet intelligence

```bash
curl http://localhost:3001/api/v1/intel/wallet/WALLET_ADDRESS \
  -H "X-Api-Key: ak_your_key"
```

Full profile — summary, behavior, PnL, HUD. Response:

```json
{
  "status": "ok",
  "walletAddress": "7xKXtg...",
  "summary": {
    "lastAnalyzedAt": "2026-03-03T11:30:00.000Z",
    "realizedPnl": 142.87,
    "profitableTradesCount": 34,
    "totalTradesCount": 51,
    "currentSolBalance": 4.21
  },
  "hud": {
    "pnlSignal": "positive",
    "behaviorCode": "SWING_TRADER",
    "winRate": 0.67,
    "dataQualityTier": "high",
    "isBotFlagged": false,
    "isWhaleFlagged": false
  },
  "behavior": {
    "tradingStyle": "swing",
    "speedCategory": "medium",
    "avgHoldTimeHours": 18.4,
    "medianHoldTimeHours": 12.1,
    "buySellRatio": 0.98,
    "exitPattern": "partial_exit"
  },
  "pnl": {
    "allTime": {
      "realizedPnlSol": 142.87,
      "unrealizedPnlSol": 9.3,
      "netPnlSol": 152.17,
      "winRate": 0.67
    }
  }
}
```

**HUD only** (1cr — use when you just need the signal):

```bash
curl http://localhost:3001/api/v1/intel/wallet/WALLET_ADDRESS/hud \
  -H "X-Api-Key: ak_your_key"
```

Returns: `{ pnlSignal, behaviorCode, winRate, isBotFlagged, isWhaleFlagged, medianPnlPerToken }`

**Per-token PnL table** (3cr — paginated, sortable):

```bash
curl "http://localhost:3001/api/v1/intel/wallet/WALLET_ADDRESS/tokens?pageSize=50&sortBy=netSolProfitLoss&sortOrder=DESC" \
  -H "X-Api-Key: ak_your_key"
```

Returns: `{ data: [{ tokenAddress, realizedPnlSol, unrealizedPnlSol, roi, totalSolSpent, winRate }], total, page, pageSize }`

---

### Batch & token intelligence

**HUD for up to 30 wallets** (5cr flat):

```bash
curl -X POST http://localhost:3001/api/v1/intel/wallets/batch-hud \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

Returns: `{ huds: { "ADDR_1": { pnlSignal, behaviorCode, winRate, isBotFlagged, ... } }, queued: [...], skipped: [...] }`
Wallets without fresh data appear in `queued` — poll those jobs then call again.

**Top N holders of a token** (20cr — async):

```bash
curl -X POST http://localhost:3001/api/v1/intel/token/TOKEN_MINT/holders \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"topN": 20}'
```

Returns: `{ jobId, requestId, monitoringUrl }` → poll → fetch `holder-profiles:result:<requestId>`

**Similarity analysis for 2–30 wallets** (20cr — async):

```bash
curl -X POST http://localhost:3001/api/v1/intel/wallets/similarity \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

Returns: `{ jobId, requestId, monitoringUrl }` → poll → fetch `similarity:result:<requestId>`

**Holders + similarity bundled** (35cr — saves 5cr vs separate calls — async):

Two independent jobs in one call: holder-profiles for the token's top N holders (server fetches them from Helius), and similarity for a wallet list you supply upfront. These are separate inputs — `wallets[]` does not have to match the token's holders.

```bash
curl -X POST http://localhost:3001/api/v1/intel/token/TOKEN_MINT/holders/deep \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"topN": 20, "wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

- `topN` — how many top holders to profile (1–50, default 20). Server fetches them from Helius.
- `wallets` — 2–30 addresses for the similarity job. You provide these — typically from prior knowledge or a previous `/holders` run.

Returns: `{ holderProfiles: { jobId, requestId }, similarity: { jobId, requestId } }` — poll both independently.

---

## Pricing

| Endpoint                               | Credits |    USD |
| :------------------------------------- | ------: | -----: |
| `GET /intel/wallet/:addr`              |       5 | $0.075 |
| `GET /intel/wallet/:addr/hud`          |       1 | $0.015 |
| `GET /intel/wallet/:addr/tokens`       |       3 | $0.045 |
| `POST /intel/wallets/batch-hud`        |       5 | $0.075 |
| `POST /intel/token/:mint/holders`      |      20 |  $0.30 |
| `POST /intel/wallets/similarity`       |      20 |  $0.30 |
| `POST /intel/token/:mint/holders/deep` |      35 | $0.525 |

1 credit = $0.015 USDC. Charged on data delivery (200), not on job acceptance (202).

---

## How to pay

### Option A — API key (simplest)

```bash
curl http://localhost:3001/api/v1/intel/wallet/WALLET_ADDRESS \
  -H "X-Api-Key: ak_your_key"
```

No transaction building. Credits come from the key owner's account. Done.

### Option B — X402 (autonomous, self-funded Solana wallet)

Every endpoint returns HTTP 402 when called without auth. The 402 body tells you exactly what to send.

**Step 1 — probe (no auth):**

```bash
curl -i http://localhost:3001/api/v1/intel/wallet/WALLET_ADDRESS
# → HTTP 402
```

**402 body:**

```json
{
  "error": "insufficient_credits",
  "required": 5,
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "maxAmountRequired": "75000",
    "payTo": "<TREASURY_PUBKEY>",
    "maxTimeoutSeconds": 60
  }]
}
```

Cache `accepts[0].payTo` — it never changes per deployment.

**Step 2 — build payment + resend:**

```
X-Payment: base64( JSON.stringify({
  x402Version: 1,
  scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  payload: { transaction: base64(signedTxBytes) }
}) )
```

Transaction: `transferChecked` from your USDC ATA → treasury USDC ATA (derive with `getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo))`). Do not use the raw `payTo` pubkey as destination.

**Constants:**

```
USDC mint : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Decimals  : 6
Amount    : read maxAmountRequired from 402 body (string → BigInt)
```

**TypeScript:**

```typescript
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function buildXPayment(
  connection: Connection,
  keypair: Keypair,
  payTo: string,           // accepts[0].payTo from 402 body
  amountBaseUnits: bigint, // BigInt(accepts[0].maxAmountRequired)
): Promise<string> {
  const agentAta    = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo));
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
  tx.add(createTransferCheckedInstruction(
    agentAta, USDC_MINT, treasuryAta, keypair.publicKey, amountBaseUnits, 6, [], TOKEN_PROGRAM_ID,
  ));
  tx.sign(keypair);
  return Buffer.from(JSON.stringify({
    x402Version: 1, scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payload: { transaction: tx.serialize().toString("base64") },
  })).toString("base64");
}
```

On success: response header `X-Payment-Receipt: <txSignature>`. Each signature is single-use (24h replay protection).

**X402 errors:**

| Message | Fix |
|:--------|:----|
| `transfer destination does not match treasury ATA` | Derive ATA, don't use raw `payTo` pubkey |
| `USDC amount N < required M` | Use `maxAmountRequired` from 402 body |
| `transaction already used (replay attack)` | Fresh tx + fresh blockhash per request |
| `transaction confirmation failed` | Expired blockhash or RPC error — retry |

---

## Async jobs

POST endpoints and `GET /intel/wallet/:addr` on a cold/stale wallet return **HTTP 202** — 0cr charged, job queued.

```json
{ "status": "queued", "jobId": "123", "requestId": "intel-holders-123-abc", "monitoringUrl": "/api/v1/jobs/123" }
```

**Poll** every 5s — free, same auth:

```bash
curl http://localhost:3001/api/v1/jobs/JOB_ID \
  -H "X-Api-Key: ak_your_key"
# → { "status": "active" | "completed" | "failed", "progress": 80 }
```

**Retrieve result** once `completed` (results expire after 15 minutes):

```bash
curl "http://localhost:3001/api/v1/jobs/result/by-key?key=holder-profiles:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"

curl "http://localhost:3001/api/v1/jobs/result/by-key?key=similarity:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"
```

`GET /intel/wallet/:addr` cold flow — always 5cr total:

```
→ 202 (0cr) → poll jobId → call again → 200 (5cr)
```

---

## Agent loop

```
1. Do I have an API key?
   YES → attach X-Api-Key header on every request, skip to step 3
   NO  → proceed with X402

2. Call target endpoint without auth → 402
   Read accepts[0].payTo (cache it) + maxAmountRequired
   Build X-Payment header → resend request

3. Handle response:
   200 → data ready, credits charged — done
   202 → job queued (0cr)
         poll GET /jobs/:jobId every 5s
         on completed → GET /jobs/result/by-key?key=<type>:result:<requestId>
         on failed    → retry once, then surface error
   402 → payment failed — check X402 errors above
   404 → no data yet — call GET /intel/wallet/:addr first, then retry
   422 → system/program wallet — skip this address
   500 → retry with exponential backoff, max 3 attempts
```

---

## Errors

| Code | Meaning | Action |
|:----:|:--------|:-------|
| 400 | Invalid address or bad body | Fix input |
| 402 | Payment required | See "How to pay" above |
| 403 | Wallet/key blocked | Contact operator |
| 404 | No data for wallet | Call `GET /intel/wallet/:addr` first |
| 422 | System/program wallet | Not analyzable — skip |
| 206 | Bundled job partial failure | 0cr charged; retry or split calls |
| 500 | Server error | Retry with backoff |
