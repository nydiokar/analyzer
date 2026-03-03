# @sova/intel-sdk

TypeScript SDK for the [Sova Intel](http://localhost:3001/api/v1) on-chain intelligence API.

Covers all 7 Intel endpoints, both API key and X402 (on-chain USDC) auth flows, and async job polling.

---

## Install

```bash
npm install @sova/intel-sdk
# or
pnpm add @sova/intel-sdk
```

---

## Quick start — API key

`baseUrl` is required — set it to the live API base for your deployment.

```typescript
import { SovaIntelClient } from "@sova/intel-sdk";

const client = new SovaIntelClient({
  baseUrl: "https://api.sova.io/api/v1",
  auth: { kind: "apikey", apiKey: "ak_your_key" },
});

// Wallet full profile (5cr)
const profile = await client.getWalletProfile("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
console.log(profile.hud.behaviorCode);   // "SWING_TRADER"
console.log(profile.summary.realizedPnl); // 142.87

// HUD only (1cr)
const hud = await client.getWalletHud("7xKXtg...");
console.log(hud.pnlSignal, hud.winRate);

// Per-token PnL (3cr)
const tokens = await client.getWalletTokens("7xKXtg...", {
  pageSize: 50,
  sortBy: "netSolProfitLoss",
  sortOrder: "DESC",
});
console.log(tokens.data[0].realizedPnlSol);

// Batch HUD — up to 30 wallets (5cr flat)
const batch = await client.batchHud(["addr1", "addr2", "addr3"]);
console.log(batch.huds["addr1"]?.behaviorCode);
console.log(batch.queued); // addresses without fresh data
```

---

## X402 — autonomous on-chain payment

Use this when you want the SDK to pay per-call from a Solana wallet with no pre-funded API key.

```typescript
import { SovaIntelClient } from "@sova/intel-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const keypair = Keypair.fromSecretKey(/* your secret key bytes */);

async function buildPayment(payTo: string, amountBaseUnits: bigint): Promise<string> {
  const agentAta    = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo));
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
  tx.add(createTransferCheckedInstruction(
    agentAta, USDC_MINT, treasuryAta, keypair.publicKey, amountBaseUnits, 6, [], TOKEN_PROGRAM_ID,
  ));
  tx.sign(keypair);

  return Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payload: { transaction: tx.serialize().toString("base64") },
  })).toString("base64");
}

const client = new SovaIntelClient({
  baseUrl: "https://api.sova.io/api/v1",
  auth: { kind: "x402", buildPayment },
});

// Token holder profiles — probe returns 402, SDK builds payment, retries (20cr)
const holders = await client.pollHolderProfiles("TOKEN_MINT_ADDRESS", 20);
console.log(holders);
```

---

## Async job polling

POST endpoints and cold wallet GETs return HTTP 202 (job queued, 0cr charged). The `poll*` convenience methods handle the polling loop automatically:

```typescript
const client = new SovaIntelClient({
  baseUrl: "https://api.sova.io/api/v1",
  auth: { kind: "apikey", apiKey: "ak_your_key" },
  pollIntervalMs: 5000,   // default: 5s
  maxPollAttempts: 60,    // default: 60 (~5 min)
});

// Similarity analysis (20cr) — blocks until result ready
const result = await client.pollSimilarity(["addr1", "addr2", "addr3"]);
console.log(result);

// Holder profiles (20cr) — blocks until result ready
const profiles = await client.pollHolderProfiles("TOKEN_MINT", 20);

// Deep bundled analysis (35cr) — two jobs polled in parallel
const { holderProfiles, similarity } = await client.pollDeepAnalysis(
  "TOKEN_MINT",
  ["addr1", "addr2"],
  20,
);
```

If you want to manage job polling yourself, use the raw queue methods:

```typescript
const job = await client.queueSimilarity(["addr1", "addr2"]);
// job.jobId, job.requestId, job.monitoringUrl

// poll manually
import { pollAndFetch } from "@sova/intel-sdk";
const result = await pollAndFetch(/* http client — advanced use */);
```

---

## Endpoint reference

| Method | Endpoint | Credits | Returns |
|:-------|:---------|--------:|:--------|
| `getWalletProfile(addr)` | `GET /intel/wallet/:addr` | 5cr | Full profile |
| `getWalletHud(addr)` | `GET /intel/wallet/:addr/hud` | 1cr | HUD signal |
| `getWalletTokens(addr, params?)` | `GET /intel/wallet/:addr/tokens` | 3cr | Paginated PnL table |
| `batchHud(wallets[])` | `POST /intel/wallets/batch-hud` | 5cr | Up to 30 HUDs |
| `queueHolderProfiles(mint, topN?)` / `pollHolderProfiles(...)` | `POST /intel/token/:mint/holders` | 20cr | Async holder profiles |
| `queueSimilarity(wallets[])` / `pollSimilarity(...)` | `POST /intel/wallets/similarity` | 20cr | Async similarity scores |
| `queueDeepAnalysis(mint, wallets[], topN?)` / `pollDeepAnalysis(...)` | `POST /intel/token/:mint/holders/deep` | 35cr | Two async jobs |

1 credit = $0.015 USDC. Credits charged on data delivery (200), not job acceptance (202).

---

## Error handling

```typescript
import { SovaHttpError, X402PaymentError } from "@sova/intel-sdk";

try {
  const hud = await client.getWalletHud("addr");
} catch (err) {
  if (err instanceof X402PaymentError) {
    // Payment probe returned 402 and no payment was possible
    console.error("Payment required:", err.body.required, "credits");
  } else if (err instanceof SovaHttpError) {
    // 404 → no data yet, 422 → system wallet, 500 → server error
    console.error(`HTTP ${err.status}:`, err.body);
  }
}
```

| Code | Meaning | Action |
|:----:|:--------|:-------|
| 400 | Invalid address or bad body | Fix input |
| 402 | Payment required | Add credits or fund X402 wallet |
| 404 | No data for wallet | Call `getWalletProfile()` first |
| 422 | System/program wallet | Not analyzable — skip |
| 500 | Server error | Retry with backoff |

---

## Build

```bash
pnpm run build   # tsc → dist/
pnpm test        # vitest run
```
