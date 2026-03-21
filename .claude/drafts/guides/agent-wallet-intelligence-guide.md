---
title: "Add Wallet Behavioral Intelligence to Your Solana AI Agent in 10 Minutes"
review_status: DRAFT — awaiting founder review
date: 2026-03-19
updated: 2026-03-21
author: technical-content-writer
campaign: W1D1 — GTM integration guide series
---

# Add Wallet Behavioral Intelligence to Your Solana AI Agent in 10 Minutes

Your agent can swap tokens. It can check prices, execute routes on Jupiter, and manage a wallet. What it cannot do is look at a wallet address and tell you what kind of trader is behind it.

That gap matters more than it sounds. A wallet that just bought $50k of a new token could be a sniper who will dump it in 40 seconds. It could be a swing trader planning to hold for three days. It could be a position trader who hasn't sold a single token in a month. Same wallet, same transaction — completely different implications for what happens to the price after.

Sova Intel gives your agent the ability to answer that question. This guide shows you how to wire it in, starting with a single API call and ending with a working decision function you can drop into your agent's logic today.

---

## What You're Adding

Sova Intel is a behavioral intelligence API for Solana wallets. It classifies wallets into one of eight trader types based on completed exit cycles — not heuristics, not labels, but calculated from actual hold time patterns across a wallet's trading history.

The eight types, by median hold time: `SNIPER` (< 1 min), `SCALPER` (1–5 min), `MOMENTUM` (5–30 min), `INTRADAY` (30 min–4 hr), `DAY_TRADER` (4–24 hr), `SWING` (1–7 days), `POSITION` (7–30 days), `HODLER` (30+ days).

Every result also carries a `dataQualityTier` — a confidence assessment based on completed exit cycles found for that wallet: `GOLD` (10+), `SILVER` (5–9), `BRONZE` (3–4, use with caution), `INSUFFICIENT` (fewer than 3, not classifiable). Your agent needs to know when to trust a signal and when to discount it.

---

## Setup

Install the SDK:

```bash
npm install @sova-intel/sdk
```

Set your API key as an environment variable:

```bash
export SOVA_API_KEY=your_api_key_here
```

Get your key at [sova-intel.com](https://sova-intel.com) — free credits on signup.

---

## Example 1: Quick Wallet Signal (HUD Endpoint — 1 Credit)

The HUD endpoint is designed for high-frequency use cases. One call, one credit, instant behavioral read on any wallet.

```typescript
import { SovaIntelClient } from '@sova-intel/sdk';

const sova = new SovaIntelClient({
  baseUrl: 'https://api.sova-intel.com',
  auth: { kind: 'apikey', apiKey: process.env.SOVA_API_KEY! },
});

const hud = await sova.getWalletHud('WALLET_ADDRESS_HERE');

console.log(hud.behaviorCode);         // "SNIPER"
console.log(hud.dataQualityTier);      // "GOLD"
console.log(hud.medianHoldTimeHours);  // 0.009
console.log(hud.trimmedMeanPnl);       // 4.21
console.log(hud.isBot);               // false
console.log(hud.isWhale);             // true
```

Expected response shape:

```json
{
  "behaviorCode": "SNIPER",
  "dataQualityTier": "GOLD",
  "medianHoldTimeHours": 0.009,
  "trimmedMeanPnl": 4.21,
  "isBot": false,
  "isWhale": true
}
```

Your agent now knows: high-confidence sniper, real PnL signal, not a bot. If this wallet just bought a token you're looking at, that context changes your read on it.

**curl fallback:**

```bash
curl -H "X-Api-Key: $SOVA_API_KEY" \
  https://api.sova-intel.com/api/v1/intel/wallet/WALLET_ADDRESS_HERE/hud
```

---

## Example 2: Token Holder Behavioral Profiles (20 Credits, Async)

Before your agent takes a position, it can profile the top holders of the token it's considering. If 80% are snipers, that's a dump risk. If they're mostly swing traders with GOLD confidence, the holder base looks genuine.

This endpoint is async — it returns a `jobId` immediately and processes in the background. Poll until complete.

```typescript
import { SovaIntelClient } from '@sova-intel/sdk';

const sova = new SovaIntelClient({
  baseUrl: 'https://api.sova-intel.com',
  auth: { kind: 'apikey', apiKey: process.env.SOVA_API_KEY! },
});

async function profileTokenHolders(mintAddress: string) {
  // Submit the job and poll until complete
  const result = await sova.pollHolderProfiles(mintAddress, 20);

  // Analyze the behavioral distribution
  const profiles = result.profiles;
  const sniperCount = profiles.filter(h => h.behaviorType === 'SNIPER').length;
  const sniperPct = (sniperCount / profiles.length) * 100;

  if (sniperPct > 60) {
    console.log(`WARNING: ${sniperPct.toFixed(0)}% of top holders are snipers. High dump risk.`);
  }

  return result;
}
```

The job endpoint (`GET /jobs/:jobId`) is free — polling does not consume credits. Credits are charged when you submit the job.

Expected completed response shape:

```json
{
  "status": "complete",
  "profiles": [
    {
      "address": "WALLET_ADDRESS",
      "behaviorType": "SNIPER",
      "confidence": "GOLD",
      "completedCycleCount": 14,
      "walletPnlSol": 38.4
    }
  ]
}
```

---

## Example 3: Detect Coordinated Wallets (20 Credits, Async)

If your agent is evaluating a token and wants to check whether the top wallets are operating independently or as a coordinated group, the similarity endpoint does the work. Feed it 2–30 wallet addresses, get back pairwise similarity scores.

Same async pattern as holders — submit, poll, read results.

```typescript
import { SovaIntelClient } from '@sova-intel/sdk';

const sova = new SovaIntelClient({
  baseUrl: 'https://api.sova-intel.com',
  auth: { kind: 'apikey', apiKey: process.env.SOVA_API_KEY! },
});

async function detectCoordination(walletAddresses: string[]) {
  const simResult = await sova.pollSimilarity(walletAddresses);

  const pairs = simResult.pairwiseSimilarities;
  const highSimilarity = pairs.filter(p => p.binaryScore > 0.8);

  if (highSimilarity.length > 0) {
    console.log(
      `ALERT: ${highSimilarity.length} wallet pair(s) with >80% behavioral overlap detected.`
    );
    highSimilarity.forEach(pair => {
      console.log(
        `  ${pair.walletA.slice(0, 8)}... <-> ${pair.walletB.slice(0, 8)}...` +
        ` — binaryScore: ${pair.binaryScore}, sharedTokens: ${pair.binarySharedTokenCount}`
      );
    });
  }

  return simResult;
}
```

Expected completed response shape:

```json
{
  "status": "complete",
  "pairwiseSimilarities": [
    {
      "walletA": "ADDRESS_1",
      "walletB": "ADDRESS_2",
      "binaryScore": 0.91,
      "capitalScore": 0.87,
      "binarySharedTokenCount": 18
    }
  ],
  "globalMetrics": {
    "averageSimilarity": 0.64,
    "mostSimilarPairs": ["ADDRESS_1", "ADDRESS_2"]
  }
}
```

A `binaryScore` above 0.8 means these wallets overlap on more than 80% of the tokens they hold. A high `capitalScore` on top of that means the overlap is weighted by position size — the same tokens, at scale. That's a cluster signal worth acting on.

---

## Example 4: Autonomous Payment via x402 (No API Key Required)

If you're building a fully autonomous agent that manages its own wallet, it can pay Sova Intel directly in USDC via x402 — no API key, no account, no registration required.

Your agent reads the machine-readable skill descriptor at `https://sova-intel.com/skill.md`, which describes available endpoints, pricing, and payment terms in a format designed for agent consumption. The x402 protocol handles payment negotiation automatically.

This is the pattern for agents that need to operate without human credential management — the agent sees the price, pays, gets the intelligence.

---

## Wiring It Into Your Agent's Decision Loop

Here is a complete `shouldBuyToken()` function you can adapt for your agent:

```typescript
import { SovaIntelClient } from '@sova-intel/sdk';

const sova = new SovaIntelClient({
  baseUrl: 'https://api.sova-intel.com',
  auth: { kind: 'apikey', apiKey: process.env.SOVA_API_KEY! },
});

type HolderProfile = {
  behaviorType: string;
  confidence: string;
  completedCycleCount: number;
  walletPnlSol: number;
};

type BuyDecision = {
  proceed: boolean;
  reason: string;
  sniperPct: number;
  insufficientDataPct: number;
};

async function getHolderProfiles(mintAddress: string): Promise<HolderProfile[]> {
  const result = await sova.pollHolderProfiles(mintAddress, 20);
  return result.profiles;
}

async function shouldBuyToken(mintAddress: string): Promise<BuyDecision> {
  const profiles = await getHolderProfiles(mintAddress);

  const sniperCount = profiles.filter(h => h.behaviorType === 'SNIPER').length;
  const insufficientCount = profiles.filter(h => h.confidence === 'INSUFFICIENT').length;

  const sniperPct = (sniperCount / profiles.length) * 100;
  const insufficientDataPct = (insufficientCount / profiles.length) * 100;

  if (sniperPct > 60) {
    return {
      proceed: false,
      reason: `${sniperPct.toFixed(0)}% of top holders are snipers. High dump risk.`,
      sniperPct,
      insufficientDataPct,
    };
  }

  if (insufficientDataPct > 50) {
    return {
      proceed: false,
      reason: `${insufficientDataPct.toFixed(0)}% of holders have insufficient data. Signal too thin.`,
      sniperPct,
      insufficientDataPct,
    };
  }

  return {
    proceed: true,
    reason: 'Holder profile looks reasonable. Sniper concentration within acceptable range.',
    sniperPct,
    insufficientDataPct,
  };
}
```

Notes on the thresholds:
- The 60% sniper cutoff is a starting point. Tune it to your risk tolerance and token type — memecoins naturally skew sniper-heavy.
- `INSUFFICIENT` holders aren't classified — not enough exit cycle data. A high proportion means your signal is thin regardless of what the classified wallets show.
- `BRONZE` holders are classified but with low confidence (3–4 cycles). You can choose to weight these differently or exclude them from distribution calculations.

---

## Handling the Async Timeout Edge Case

Sync endpoints may return `202` with an `X-Prepaid-Job-Id` header under heavy load. The SDK handles this transparently. If you're making raw HTTP calls:

```bash
# If you get a 202, grab the job ID from the response header and poll:
curl -H "X-Api-Key: $SOVA_API_KEY" \
  https://api.sova-intel.com/api/v1/jobs/JOB_ID_HERE
```

---

## Credit Costs at a Glance

| Endpoint | Credits | USD |
|----------|---------|-----|
| `/intel/wallet/:addr/hud` | 1 | $0.015 |
| `/intel/wallet/:addr` (full profile) | 5 | $0.075 |
| `/intel/wallet/:addr/tokens` | 3 | $0.045 |
| `/intel/wallets/batch-hud` (up to 30) | 5 | $0.075 |
| `/intel/token/:mint/holders` | 20 | $0.30 |
| `/intel/wallets/similarity` | 20 | $0.30 |
| `/jobs/:jobId` (polling) | 0 | free |

Credits: $15 / 1,000 or $120 / 10,000. No subscription required.

---

## Get Started

Sign up and get free credits: [sova-intel.com](https://sova-intel.com)

API docs: [docs.sova-intel.com](https://docs.sova-intel.com)

SDK: `npm install @sova-intel/sdk`

x402 skill descriptor (autonomous agents): [sova-intel.com/skill.md](https://sova-intel.com/skill.md)

Questions or integrations: DM [@Sova_intel](https://x.com/Sova_intel) on X.

Your agent has hands. Now give it eyes.
