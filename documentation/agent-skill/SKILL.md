---
name: sova-intel
description: On-chain intelligence API for Solana. Use when asked to analyze a wallet, score a trader, find token holders, detect coordinated wallets, or get PnL and behavioral data. Returns digested intelligence — not raw transactions. Pay per call via X402 (Solana wallet) or API key.
metadata:
  version: "1.2"
---

# Sova Intel

**Base:** `https://api.sova-intel.com/api/v1` | **Live pricing:** `GET /pricing` (free, no auth)

Raw Solana transaction history → actionable trader intelligence. Behavior type, win rate, hold times, PnL, holder maps, coordination detection — derived from full on-chain history. Use this instead of parsing raw transactions yourself.

---

## Wallet intelligence

Score a single wallet or batch-score up to 30.

**HUD signal** (1cr — sync, fastest):

```bash
curl https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS/hud \
  -H "X-Api-Key: ak_your_key"
```

Returns: `{ signalType, behaviorCode, winRate, trimmedMeanPnl, medianHoldTimeHours, avgTxValueSol, avgTradesPerDay, uniqueTokensPerDay, currentHoldingsSol, currentHoldingsUsd, typicalEntryMcapUsd, dominantEntryMcapBucket, dataQualityTier, isBot, isWhale, calculatedAt, provenance }`

`behaviorCode` is a compact single-letter code such as `W` (swing), `M` (momentum), `H` (holder), or `?` (unknown).

The API holds the request up to 30s for a live result. If it times out it returns HTTP 202 — see [Async jobs](#async-jobs).

**Full profile** (5cr — sync): `GET /intel/wallet/:addr`

Returns all of the above plus `summary` (realizedPnl, tradeCount, solBalance), `behavior` (speedCategory, exitPattern, buySellRatio), `pnl.allTime` (realizedPnlSol, unrealizedPnlSol, netPnlSol), and `kol` identity if the wallet belongs to a known trader.

**Per-token PnL table** (3cr — paginated):

`GET /intel/wallet/:addr/tokens?sortBy=realizedPnlSol&sortOrder=DESC&pageSize=50`

Returns `{ data: [{ tokenAddress, realizedPnlSol, unrealizedPnlSol, roi, totalSolSpent, winRate }], total, page, pageSize }`

**Batch HUD — up to 30 wallets** (1cr flat):

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/wallets/batch-hud \
  -H "X-Api-Key: ak_your_key" -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

Returns: `{ huds: { "ADDR_1": { behaviorCode, winRate, ... } }, queued: [{ walletAddress, jobId, monitoringUrl }], skipped: [] }`

`queued` contains wallets without fresh data that have been kicked off in the background — informational only, the ready HUDs are already in `huds`.

---

## Token holder profiles — agent ★

**Use this endpoint.** Same analysis as `/holders` but the result is purpose-built for agent consumption: aggregate-first, ~10× smaller payload, no debug fields.

**5cr — async** — POST, returns HTTP 202:

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/token/TOKEN_MINT/holders/agent \
  -H "X-Api-Key: ak_your_key" -H "Content-Type: application/json" \
  -d '{"topN": 20}'
```

202 response: `{ jobId, requestId, monitoringUrl, resultKey, agentResultKey }`

Poll `GET /jobs/:jobId` → on `completed` fetch:

```bash
curl "https://api.sova-intel.com/api/v1/jobs/result/by-key?key=holder-profiles:agent:result:JOB_ID" \
  -H "X-Api-Key: ak_your_key"
```

Result shape:

```json
{
  "aggregate": {
    "totalHolders": 20,
    "analyzedHolders": 18,
    "top1SupplyPct": 3.2,
    "top5SupplyPct": 12.8,
    "behaviorDistribution": [
      { "behaviorType": "SWING_TRADER", "count": 7, "supplyPct": 22.4 },
      { "behaviorType": "HODLER", "count": 4, "supplyPct": 14.1 },
      { "behaviorType": "FRESH", "count": 3, "supplyPct": 8.7 }
    ],
    "avgWalletPnlSol": 34.2
  },
  "profiles": [
    {
      "walletAddress": "ADDR_1", "rank": 1, "supplyPercent": 3.2,
      "behaviorType": "SWING_TRADER", "exitPattern": "partial_exit",
      "medianHoldTimeHours": 18.0, "dataQualityTier": "GOLD",
      "confidence": 0.91, "walletPnlSol": 91.5, "solBalance": 12.1,
      "holdingsSummary": {
        "totalPositions": 14, "totalCurrentHoldingsValueSol": 28.4,
        "topHoldings": [{ "tokenAddress": "TOKEN_A", "valueSol": 12.1 }]
      }
    }
  ],
  "metadata": { "tokenMint": "...", "totalHoldersRequested": 20, "totalHoldersAnalyzed": 18 }
}
```

`FRESH` in `behaviorDistribution` = analyzed wallets with too few exits to classify. `analysisSkipped: true` on a profile = known system wallet (LP, burn) — `knownLabel` explains why.

---

## Wallet similarity — agent ★

**Use this endpoint.** Same analysis as `/similarity` but returns a single `coordinationScore`, filtered pairs only, and coordination flags. Purpose-built for agent decisions.

**5cr — async** — POST, returns HTTP 202:

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/wallets/similarity/agent \
  -H "X-Api-Key: ak_your_key" -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", "ADDR_3"]}'
```

202 response: `{ jobId, requestId, monitoringUrl, resultKey, agentResultKey }`

Poll `GET /jobs/:jobId` → on `completed` fetch:

```bash
curl "https://api.sova-intel.com/api/v1/jobs/result/by-key?key=similarity:agent:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"
```

Result shape:

```json
{
  "coordinationScore": 0.74,
  "pairs": [
    {
      "walletA": "ADDR_1", "walletB": "ADDR_2",
      "similarityScore": 0.83, "sharedTokenCount": 22,
      "portfolioSizeA": 28, "portfolioSizeB": 31,
      "overlapPctA": 0.786, "overlapPctB": 0.710,
      "flag": "HIGH_SIMILARITY_AND_OVERLAP"
    }
  ],
  "globalMetrics": { "averageSimilarity": 0.74 },
  "metadata": { "walletsAnalyzed": 3, "totalPairs": 3, "meaningfulPairs": 2, "flaggedPairs": 1 }
}
```

`coordinationScore` 0–1 — single number for a buy/skip/flag decision. `pairs` only includes pairs with meaningful signal (combinedScore ≥ 0.15 or ≥20 shared tokens); noise pairs are dropped.

`flag` values: `HIGH_SIMILARITY` (score > 0.7) | `HIGH_OVERLAP` (>50% portfolio overlap or >20 shared tokens) | `HIGH_SIMILARITY_AND_OVERLAP`

`similarityScore` = binaryScore × 0.6 + capitalScore × 0.4.

---

## Bundled deep analysis (10cr)

Holder profiles + similarity in one call, server discovers holders itself. 10cr total.

```bash
curl -X POST https://api.sova-intel.com/api/v1/intel/token/TOKEN_MINT/holders/deep \
  -H "X-Api-Key: ak_your_key" -H "Content-Type: application/json" \
  -d '{"topN": 20}'
```

Returns two job descriptors immediately. `similarity.jobId` is `null` — the processor queues it after holder-profiles completes.

```json
{
  "holderProfiles": { "jobId": "hp-abc", "requestId": "...", "monitoringUrl": "...", "resultKey": "holder-profiles:result:hp-abc" },
  "similarity": { "jobId": null, "requestId": "sim-xyz", "resultKey": "similarity:result:sim-xyz" }
}
```

Polling: wait for `holderProfiles.jobId` to complete, then poll `similarity.resultKey` directly (it appears when the processor chains it). Both return the full developer shapes — not agent-optimised. Use `/holders/agent` + `/similarity/agent` separately if you need compact results.

---

## Standard holder profiles and similarity (full shape)

Available but verbose — use the `/agent` variants above for agent workflows.

`POST /intel/token/:mint/holders` (5cr) → `{ jobId, requestId, monitoringUrl }` → poll → `GET /jobs/result/by-key?key=holder-profiles:result:JOB_ID`

`POST /intel/wallets/similarity` (5cr) → `{ jobId, requestId, monitoringUrl }` → poll → `GET /jobs/result/by-key?key=similarity:result:REQUEST_ID`

Full result shapes are documented at https://docs.sova-intel.com/endpoints/batch-token.

---

## Pricing

| Endpoint | Credits | USD |
|:---------|--------:|----:|
| `GET /intel/wallet/:addr/hud` | 1 | $0.015 |
| `GET /intel/wallet/:addr` | 5 | $0.075 |
| `GET /intel/wallet/:addr/tokens` | 3 | $0.045 |
| `POST /intel/wallets/batch-hud` | 5 | $0.075 |
| `POST /intel/token/:mint/holders/agent` ★ | 20 | $0.30 |
| `POST /intel/wallets/similarity/agent` ★ | 20 | $0.30 |
| `POST /intel/token/:mint/holders/deep` | 35 | $0.525 |
| `POST /intel/token/:mint/holders` | 20 | $0.30 |
| `POST /intel/wallets/similarity` | 20 | $0.30 |

1 credit = $0.015 USDC. Async POST endpoints charge on 202 job acceptance. GET endpoints charge on 200.

---

## How to pay

### Option A — API key

```bash
curl https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS/hud \
  -H "X-Api-Key: ak_your_key"
```

### Option B — X402 (autonomous, no account needed)

Every endpoint returns HTTP 402 when called without auth.

**Step 1 — probe:**

```bash
curl -i https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS/hud
# → HTTP 402, header: PAYMENT-REQUIRED: <base64-json>
```

Decode `PAYMENT-REQUIRED` header — contains `accepts[0].payTo` and `accepts[0].amount`. Cache `payTo` — it never changes per deployment.

**Step 2 — build payment + resend:**

```
payment-signature: base64( JSON.stringify({
  x402Version: 2, scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  payload: { transaction: base64(signedTxBytes) }
}) )
```

Transaction: `transferChecked` from your USDC ATA → treasury USDC ATA. Derive destination with `getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo))` — do not use raw `payTo` as destination.

```
USDC mint : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  (decimals: 6)
Amount    : BigInt(accepts[0].amount) — read from header, don't hardcode
```

On success: `X-Payment-Response` header contains tx signature. Signatures are single-use (24h replay protection). `x-payment` header accepted as legacy fallback.

**X402 errors:**

| Message | Fix |
|:--------|:----|
| `transfer destination does not match treasury ATA` | Derive ATA, don't use raw `payTo` |
| `USDC amount N < required M` | Use `amount` from PAYMENT-REQUIRED, don't hardcode |
| `transaction already used` | Fresh tx + fresh blockhash per request |
| `transaction confirmation failed` | Expired blockhash or RPC error — retry |

---

## Async jobs

POST endpoints return HTTP 202 immediately. GET wallet endpoints hold up to 30s then return 202 on timeout.

**Poll status** (free, no auth):
```bash
curl https://api.sova-intel.com/api/v1/jobs/JOB_ID
# → { "status": "waiting" | "active" | "completed" | "failed", "progress": 80 }
```

**Fetch result** once `completed` (expires 15 minutes after completion):
```bash
curl "https://api.sova-intel.com/api/v1/jobs/result/by-key?key=KEY" \
  -H "X-Api-Key: ak_your_key"
```

Result keys are in the 202 response: `resultKey` for full shape, `agentResultKey` for agent shape (agent endpoints only).

**GET wallet timeout fallback** — always 5cr total:
```
→ hold up to 30s → 200 (5cr charged) if ready
→ timeout → 202 (0cr) + prepaidJobId
→ poll jobId → re-call with X-Prepaid-Job-Id header → 200 (total: 5cr)
```

---

## Agent loop

```
1. Auth?
   API key → X-Api-Key header on every request
   X402    → probe without auth → 402 → build payment-signature → resend

2. Handle response:
   200  → done, credits charged
   202 from GET /intel/wallet* → poll GET /jobs/:jobId every 5s
          completed → re-call with X-Prepaid-Job-Id header
   202 from POST → poll GET /jobs/:jobId every 5s
          completed → GET /jobs/result/by-key?key=<agentResultKey or resultKey>
          failed    → retry once, then surface error
   402  → payment failed — see X402 errors
   404  → bad route or result key expired (15-min TTL)
   422  → system/program wallet — skip this address
   500  → retry with exponential backoff, max 3 attempts
```

---

## Errors

| Code | Meaning | Action |
|:----:|:--------|:-------|
| 400 | Invalid address or bad body | Fix input |
| 401 | Unauthorized | API key missing or malformed |
| 402 | Payment required | See How to pay |
| 403 | Wallet/key blocked | Contact operator |
| 404 | Route or result key not found | Verify URL/key; result TTL is 15 min |
| 422 | System/program wallet | Not analyzable — skip |
| 500 | Server error | Retry with backoff |
