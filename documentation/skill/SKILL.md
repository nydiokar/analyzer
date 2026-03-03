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

Call `GET /intel/wallet/:addr` for a full profile of any Solana wallet:

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

**Cheaper focused reads** once you have the full profile:

- `GET /intel/wallet/:addr/hud` — HUD only (1cr). `pnlSignal`, `behaviorCode`, `winRate`, `isBotFlagged`, `isWhaleFlagged`.
- `GET /intel/wallet/:addr/tokens` — per-token PnL table (3cr). Paginated, sortable. Fields: `tokenAddress`, `realizedPnlSol`, `unrealizedPnlSol`, `roi`, `totalSolSpent`, `winRate`.

### Batch & token intelligence

`POST /intel/wallets/batch-hud` — HUD for up to 30 wallets in one call (5cr flat):

```json
{ "wallets": ["<addr1>", "<addr2>", "..."] }
```

Returns `{ huds: { "<addr>": { pnlSignal, behaviorCode, winRate, isBotFlagged, ... } }, queued: [...], skipped: [...] }`

`POST /intel/token/:mint/holders` — top N holders of a token, full profiles for each (20cr). Async:

```json
{ "topN": 20 }
```

Returns `{ jobId, requestId, monitoringUrl }`. Fetch result at `holder-profiles:result:<requestId>`.

`POST /intel/wallets/similarity` — similarity scores for 2–30 wallets (20cr). Async:

```json
{ "wallets": ["<addr1>", "<addr2>", "..."] }
```

Returns `{ jobId, requestId, monitoringUrl }`. Fetch result at `similarity:result:<requestId>`.

`POST /intel/token/:mint/holders/deep` — holders + similarity in one shot (35cr). Async:

```json
{ "topN": 20, "wallets": ["<addr1>", "<addr2>", "..."] }
```

Returns `{ holderProfiles: { jobId, requestId }, similarity: { jobId, requestId } }`. Poll both independently.

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

If you were given a key:

```
X-Api-Key: ak_<your-key>
```

No transaction building. Credits come from the key owner's account. Done.

### Option B — X402 (autonomous, self-funded Solana wallet)

Every endpoint returns HTTP 402 when called without auth. The 402 body tells you exactly what to send.

**402 body shape:**

```json
{
  "error": "insufficient_credits",
  "required": 5,
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxAmountRequired": "75000",
      "payTo": "<TREASURY_PUBKEY>",
      "maxTimeoutSeconds": 60
    }
  ]
}
```

**Flow:** send request → get 402 → build payment → resend with `X-Payment` header → get data.

Cache `accepts[0].payTo` after the first 402 — it never changes per deployment.

**Constants:**

```
USDC mint : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Decimals  : 6
Rate      : credits × 0.015 × 1_000_000 = base units  (5cr = 75000)
```

**X-Payment header:**

```
X-Payment: base64( JSON.stringify({
  x402Version: 1,
  scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  payload: { transaction: base64(signedTxBytes) }
}) )
```

Transaction must be a `transferChecked` from your USDC ATA to the treasury USDC ATA. Derive treasury ATA with `getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo))` — do not send to the raw pubkey.

**TypeScript:**

```typescript
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function buildXPayment(
  connection: Connection,
  keypair: Keypair,
  payTo: string,
  amountBaseUnits: bigint,
): Promise<string> {
  const agentAta = await getAssociatedTokenAddress(
    USDC_MINT,
    keypair.publicKey,
  );
  const treasuryAta = await getAssociatedTokenAddress(
    USDC_MINT,
    new PublicKey(payTo),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: keypair.publicKey,
  });
  tx.add(
    createTransferCheckedInstruction(
      agentAta,
      USDC_MINT,
      treasuryAta,
      keypair.publicKey,
      amountBaseUnits,
      6,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  tx.sign(keypair);
  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      payload: { transaction: tx.serialize().toString("base64") },
    }),
  ).toString("base64");
}
```

On success: response header `X-Payment-Receipt: <txSignature>`. Each signature is single-use (24h replay protection).

**X402 errors:**

| Message                                            | Fix                                      |
| :------------------------------------------------- | :--------------------------------------- |
| `transfer destination does not match treasury ATA` | Derive ATA, don't use raw `payTo` pubkey |
| `USDC amount N < required M`                       | Use `maxAmountRequired` from 402 body    |
| `transaction already used (replay attack)`         | Fresh tx + fresh blockhash per request   |
| `transaction confirmation failed`                  | Expired blockhash or RPC error — retry   |

---

## Async jobs

POST endpoints and `GET /intel/wallet/:addr` on a cold/stale wallet return **HTTP 202** — 0cr charged, job queued.

```json
{
  "status": "queued",
  "jobId": "123",
  "requestId": "intel-holders-123-abc",
  "monitoringUrl": "/api/v1/jobs/123"
}
```

Poll `GET /jobs/:jobId` every 5s with the same auth (free). Stop at `completed` or `failed`. Allow 1 min for holder/similarity jobs.

Retrieve result (valid 1 min after completion):

```
GET /jobs/result/by-key?key=holder-profiles:result:<requestId>
GET /jobs/result/by-key?key=similarity:result:<requestId>
```

`GET /intel/wallet/:addr` cold flow — always 5cr total:

```
→ 202 (0cr) → poll → call again → 200 (5cr)
```

---

## Agent loop

```
1. Do I have an API key?
   YES → set X-Api-Key header, skip to step 4
   NO  → proceed with X402

2. Call target endpoint (no auth)
   → 200/202: unexpected (already authed) — use response
   → 402: read accepts[0].payTo + maxAmountRequired

3. Build X-Payment header (buildXPayment above), resend request

4. Handle response:
   → 200: data returned, credits charged — done
   → 202: job queued (0cr) — poll GET /jobs/:jobId every 5s
         on completed: GET /jobs/result/by-key?key=<resultKey>
         on failed: retry once, then surface error
   → 402: payment failed — check X402 errors table
   → 404: wallet has no data — call GET /intel/wallet/:addr first, then retry
   → 422: system wallet — skip this address
   → 500: retry with exponential backoff (max 3 attempts)
```

---

## Errors

| Code | Meaning                     | Action                               |
| :--: | :-------------------------- | :----------------------------------- |
| 400  | Invalid address or bad body | Fix input                            |
| 402  | Payment required            | See "How to pay" above               |
| 403  | Wallet/key blocked          | Contact operator                     |
| 404  | No data for wallet          | Call `GET /intel/wallet/:addr` first |
| 422  | System/program wallet       | Not analyzable — skip                |
| 206  | Bundled job partial failure | 0cr charged; retry or split calls    |
| 500  | Server error                | Retry with backoff                   |
