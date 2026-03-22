---
name: sova-intel
description: On-chain intelligence API for Solana. Use when asked to analyze a wallet, score a trader, find token holders, measure wallet similarity, or get PnL and behavioral data. Returns digested intelligence — not raw transactions. Pay per call via X402 (Solana wallet) or API key.
metadata:
  version: "1.1"
---

# Sova Intel

**Base:** `https://api.sova-intel.com/api/v1` | **Live pricing:** `GET /pricing` (free, no auth)

Raw Solana transaction data tells you what happened. Sova tells you what it means — trader profiles, behavioral patterns, realized/unrealized PnL, holder maps, and wallet similarity scores, all derived from full transaction history. Use this instead of parsing raw Helius data yourself.

---

## What data you can get

### Wallet intelligence

```bash
curl https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS \
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
    "behaviorCode": "SWING_TRADER",
    "winRate": 0.67,
    "trimmedMeanPnl": 12.4,
    "dataQualityTier": "GOLD",
    "isBot": false,
    "isWhale": false,
    "medianHoldTimeHours": 12.1
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
curl https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS/hud \
  -H "X-Api-Key: ak_your_key"
```

Returns: `{ behaviorCode, winRate, trimmedMeanPnl, medianHoldTimeHours, avgTxValueSol, avgTradesPerDay, uniqueTokensPerDay, currentHoldingsSol, dataQualityTier, isBot, isWhale, calculatedAt }`

**Per-token PnL table** (3cr — paginated, sortable):

```bash
curl "https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS/tokens?pageSize=50&sortBy=realizedPnlSol&sortOrder=DESC" \
  -H "X-Api-Key: ak_your_key"
```

Query params: `page` (default 1), `pageSize` (default 20, max 100), `sortBy` (`netSolProfitLoss` | `realizedPnlSol` | `roi` | `totalSolSpent`), `sortOrder` (`ASC` | `DESC`)

Returns:

```json
{
  "data": [
    {
      "tokenAddress": "EPjFWdd5...",
      "realizedPnlSol": 28.4,
      "unrealizedPnlSol": 2.1,
      "roi": 1.85,
      "totalSolSpent": 40.2,
      "winRate": 0.72
    }
  ],
  "total": 84,
  "page": 1,
  "pageSize": 20
}
```

---

### Batch & token intelligence

**HUD for up to 30 wallets** (5cr flat):

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/wallets/batch-hud \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

Returns: `{ huds: { "ADDR_1": { behaviorCode, winRate, trimmedMeanPnl, dataQualityTier, isBot, isWhale, calculatedAt } }, queued: [{ walletAddress, jobId, monitoringUrl }], skipped: [...] }`
Wallets without fresh data appear in `queued` as objects with `walletAddress`, `jobId`, and `monitoringUrl` — poll those jobs then call again.

**Top N holders of a token** (20cr — async):

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/token/TOKEN_MINT/holders \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"topN": 20}'
```

Returns: `{ jobId, requestId, monitoringUrl }` → poll → fetch `holder-profiles:result:<jobId>`

**Similarity analysis for 2–30 wallets** (20cr — async):

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/wallets/similarity \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

Returns: `{ jobId, requestId, monitoringUrl }` → poll → fetch `similarity:result:<requestId>`

**Holders + similarity bundled** — `POST /intel/token/:mint/holders/deep` — **coming soon (temporarily unavailable)**

This endpoint returns `501`. Use the two-step alternative:

1. `POST /intel/token/:mint/holders` — get holder addresses from the job result
2. `POST /intel/wallets/similarity` — run similarity on those addresses

---

## Pricing

| Endpoint                               | Credits |    USD |
| :------------------------------------- | ------: | -----: |
| `GET /intel/pricing`                   |       0 |  free  |
| `GET /intel/wallet/:addr`              |       5 | $0.075 |
| `GET /intel/wallet/:addr/hud`          |       1 | $0.015 |
| `GET /intel/wallet/:addr/tokens`       |       3 | $0.045 |
| `POST /intel/wallets/batch-hud`        |       5 | $0.075 |
| `POST /intel/token/:mint/holders`      |      20 |  $0.30 |
| `POST /intel/wallets/similarity`       |      20 |  $0.30 |
| `POST /intel/token/:mint/holders/deep` |      35 | $0.525 | _(coming soon — returns 501)_ |

1 credit = $0.015 USDC.

Charging model:
- GET Intel endpoints (`/intel/wallet/:addr`, `/hud`, `/tokens`) charge on successful `200`.
- GET fallback `202` (timeout path) does not charge immediately; re-call uses prepaid marker flow.
- Async POST endpoints charge on accepted `202` job acceptance.

---

## How to pay

### Option A — API key (simplest)

```bash
curl https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS \
  -H "X-Api-Key: ak_your_key"
```

No transaction building. Credits come from the key owner's account. Done.

### Option B — X402 (autonomous, self-funded Solana wallet)

Every endpoint returns HTTP 402 when called without auth. The payment contract is x402 v2.

**Step 1 — probe (no auth):**

```bash
curl -i https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS
# → HTTP 402
```

**402 response contract:**

- Header: `PAYMENT-REQUIRED: <base64-json>`
- Body: `{"error":"Payment required","required":<credits>}`

Decoded `PAYMENT-REQUIRED` JSON example:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": "75000",
    "payTo": "<TREASURY_PUBKEY>",
    "maxTimeoutSeconds": 60
  }]
}
```

Cache `accepts[0].payTo` — it never changes per deployment.

**Step 2 — build payment + resend:**

```
payment-signature: base64( JSON.stringify({
  x402Version: 2,
  scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  payload: { transaction: base64(signedTxBytes) }
}) )
```

`x-payment` is still accepted as a legacy fallback header.

Transaction: `transferChecked` from your USDC ATA → treasury USDC ATA (derive with `getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo))`). Do not use the raw `payTo` pubkey as destination.

**Constants:**

```
USDC mint : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Decimals  : 6
Amount    : read amount from PAYMENT-REQUIRED header payload (string → BigInt)
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
  amountBaseUnits: bigint, // BigInt(accepts[0].amount)
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
    x402Version: 2, scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payload: { transaction: tx.serialize().toString("base64") },
  })).toString("base64");
}
```

On success: response header `X-Payment-Response: <txSignature>`. Each signature is single-use (24h replay protection).

**X402 errors:**

| Message | Fix |
|:--------|:----|
| `transfer destination does not match treasury ATA` | Derive ATA, don't use raw `payTo` pubkey |
| `USDC amount N < required M` | Use `amount` from PAYMENT-REQUIRED payload |
| `transaction already used (replay attack)` | Fresh tx + fresh blockhash per request |
| `transaction confirmation failed` | Expired blockhash or RPC error — retry |

---

## Async jobs

POST endpoints return **HTTP 202** (async accepted).
`GET /intel/wallet/:addr` and `GET /intel/wallet/:addr/hud` use synchronous hold and only return **HTTP 202** on timeout/failure fallback.

```json
{ "status": "queued", "jobId": "123", "requestId": "intel-holders-123-abc", "monitoringUrl": "/api/v1/jobs/123" }
```

**Poll** every 5s — free:

```bash
curl https://api.sova-intel.com/api/v1/jobs/JOB_ID
# → { "status": "active" | "completed" | "failed", "progress": 80 }
```

`GET /jobs/:jobId` is public for status polling. Unauthenticated callers get status/progress metadata; authenticated callers may receive full payload.

**Retrieve result** once `completed` (results expire after 15 minutes):

```bash
curl "https://api.sova-intel.com/api/v1/jobs/result/by-key?key=holder-profiles:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"

curl "https://api.sova-intel.com/api/v1/jobs/result/by-key?key=similarity:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"
```

`GET /intel/wallet/:addr` cold/stale flow (PAY-8) — always 5cr total:

```
→ hold up to 30s
→ if completed: 200 (5cr) in same call
→ if timeout: 202 (0cr) + prepaidJobId
→ poll jobId → call again with X-Prepaid-Job-Id → 200 (total still 5cr)
```

---

## Agent loop

```
1. Do I have an API key?
   YES → attach X-Api-Key header on every request, skip to step 3
   NO  → proceed with X402

2. Call target endpoint without auth → 402
   Read PAYMENT-REQUIRED header payload (`accepts[0].payTo`, `accepts[0].amount`)
   Build payment header (`payment-signature`) → resend request

3. Handle response:
   200 → data ready, credits charged — done
   202 from GET /intel/wallet* timeout fallback → poll GET /jobs/:jobId every 5s
         on completed → re-call same Intel GET with X-Prepaid-Job-Id header
   202 from async POST endpoints → poll GET /jobs/:jobId every 5s
         on completed → GET /jobs/result/by-key?key=<type>:result:<requestId or jobId>
         on failed    → retry once, then surface error
   402 → payment failed — check X402 errors above
   404 → verify base URL/route or result key
   422 → system/program wallet — skip this address
   500 → retry with exponential backoff, max 3 attempts
```

---

## Errors

| Code | Meaning | Action |
|:----:|:--------|:-------|
| 400 | Invalid address or bad body | Fix input |
| 401 | Unauthorized | API key missing or malformed |
| 402 | Payment required | See "How to pay" above |
| 403 | Wallet/key blocked | Contact operator |
| 404 | Route or result key not found | Verify base URL/route/key |
| 422 | System/program wallet | Not analyzable — skip |
| 206 | Bundled job partial failure | 0cr charged; retry or split calls |
| 500 | Server error | Retry with backoff |
