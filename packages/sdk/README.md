# @sova-intel/sdk

TypeScript SDK for the [Sova Intel API](https://docs.sova-intel.com) — on-chain intelligence for Solana wallets.

Get trader profiles, behavioral patterns, token holder maps, and wallet similarity scores. Pay per call with an API key or autonomously via [X402](https://x402.org) (Solana USDC).

**[API Docs →](https://docs.sova-intel.com)**

---

## Installation

```bash
npm install @sova-intel/sdk
# or
pnpm add @sova-intel/sdk
```

Node 18+ required. No external runtime dependencies — uses the built-in `fetch` API.

---

## Authentication

### Option A — API key (simplest)

```typescript
import { SovaIntelClient } from "@sova-intel/sdk";

const client = new SovaIntelClient({
  baseUrl: "https://api.sova-intel.com/api/v1",
  auth: {
    kind: "apikey",
    apiKey: "ak_your_key_here",
  },
});
```

Credits are deducted from the key owner's account on each successful call.

### Option B — X402 (autonomous Solana wallet)

Supply a `buildPayment` callback. The SDK calls it automatically when it receives a `402` response, passing the treasury address and required USDC amount. You sign and return a base64-encoded payment header.

```typescript
import { SovaIntelClient } from "@sova-intel/sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const connection = new Connection("https://api.mainnet-beta.solana.com");
const keypair = Keypair.fromSecretKey(/* your wallet bytes */);

const client = new SovaIntelClient({
  baseUrl: "https://api.sova-intel.com/api/v1",
  auth: {
    kind: "x402",
    buildPayment: async (payTo: string, amountBaseUnits: bigint) => {
      const agentAta    = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
      const treasuryAta = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(payTo));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
      tx.add(createTransferCheckedInstruction(
        agentAta, USDC_MINT, treasuryAta, keypair.publicKey, amountBaseUnits, 6, [], TOKEN_PROGRAM_ID,
      ));
      tx.sign(keypair);
      return Buffer.from(JSON.stringify({
        x402Version: 2,
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        payload: { transaction: tx.serialize().toString("base64") },
      })).toString("base64");
    },
  },
});
```

---

## Quickstart

### Get a wallet HUD (1 credit)

The fastest signal: behavior code, win rate, PnL, bot/whale flags.

```typescript
import { SovaIntelClient } from "@sova-intel/sdk";

const client = new SovaIntelClient({
  baseUrl: "https://api.sova-intel.com/api/v1",
  auth: { kind: "apikey", apiKey: process.env.SOVA_API_KEY! },
});

const hud = await client.getWalletHud("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

console.log(hud.behaviorCode);       // "SWING_TRADER"
console.log(hud.winRate);            // 0.67
console.log(hud.trimmedMeanPnl);     // 12.4 (SOL)
console.log(hud.isBot);              // false
console.log(hud.dataQualityTier);    // "GOLD"
```

The server holds the connection for cold wallets and returns data in the same call. If it times out, the SDK polls the queued job and re-calls automatically — you always receive a `WalletHud`.

### Analyze top holders of a token (20 credits)

Async job — the SDK queues it, polls until complete, and returns the full result.

```typescript
import { SovaIntelClient } from "@sova-intel/sdk";
import type { HolderProfilesResult } from "@sova-intel/sdk";

const client = new SovaIntelClient({
  baseUrl: "https://api.sova-intel.com/api/v1",
  auth: { kind: "apikey", apiKey: process.env.SOVA_API_KEY! },
});

const result = await client.pollHolderProfiles<HolderProfilesResult>(
  "So11111111111111111111111111111111111111112", // token mint
  20,                                             // top N holders
);

for (const holder of result.profiles) {
  console.log(holder.walletAddress, holder.behaviorType, holder.supplyPercent);
}
```

---

## All methods

| Method | Endpoint | Credits |
|:-------|:---------|--------:|
| `getWalletProfile(address)` | `GET /intel/wallet/:addr` | 5 |
| `getWalletHud(address)` | `GET /intel/wallet/:addr/hud` | 1 |
| `getWalletTokens(address, params?)` | `GET /intel/wallet/:addr/tokens` | 3 |
| `batchHud(wallets[])` | `POST /intel/wallets/batch-hud` | 5 flat |
| `queueHolderProfiles(mint, topN?)` | `POST /intel/token/:mint/holders` | 20 |
| `pollHolderProfiles(mint, topN?)` | same + auto-poll | 20 |
| `queueSimilarity(wallets[])` | `POST /intel/wallets/similarity` | 20 |
| `pollSimilarity(wallets[])` | same + auto-poll | 20 |

Full reference with schemas: **[docs.sova-intel.com](https://docs.sova-intel.com)**

---

## Error handling

```typescript
import { SovaIntelClient, SovaHttpError, X402PaymentError } from "@sova-intel/sdk";

try {
  const hud = await client.getWalletHud(address);
} catch (err) {
  if (err instanceof X402PaymentError) {
    // Payment failed — check err.body for details
    console.error("Payment error:", err.body);
  } else if (err instanceof SovaHttpError) {
    if (err.status === 422) console.error("System/program wallet — not analyzable");
    if (err.status === 404) console.error("Wallet not found or result expired");
    if (err.status === 500) console.error("Server error — retry with backoff");
  }
}
```

| Status | Meaning |
|:------:|:--------|
| 400 | Invalid address or request body |
| 402 | Payment required (X402 flow) |
| 403 | Key or wallet blocked |
| 404 | Not found or result key expired (15min TTL) |
| 422 | System/program wallet — not analyzable, skip |
| 500 | Server error — retry with exponential backoff |

---

## TypeScript types

All request and response shapes are exported:

```typescript
import type {
  WalletHud,
  WalletProfileResponse,
  HolderProfile,
  HolderProfilesResult,
  SimilarityResult,
  SimilarityPairResult,
  SimilarityGlobalMetrics,
  TokenPnlResponse,
  BatchHudResponse,
  JobAcceptedResponse,
  SovaIntelClientConfig,
  Auth,
} from "@sova-intel/sdk";
```

---

## Links

- [API Docs](https://docs.sova-intel.com)
- [npm package](https://www.npmjs.com/package/@sova-intel/sdk)
