# SOP: Market Context Enrichment for Wallet Transaction Analysis

## Mission Statement

**Goal**: Enrich every wallet swap transaction with the token's price and market cap at the time of trade — derived entirely from data we already have — so we can categorize wallet behavior not just by timing and hold duration, but by *what market cap range they trade in*.

**Outcome**: For every row in `SwapAnalysisInput`, we can answer: "When this wallet bought this token, was it a $200K microcap or a $50M midcap?" This unlocks a new dimension of wallet analysis: are they a microcap degen? Do they only buy after $10M? Do they perform better in small caps vs large caps?

**Cost**: $0 additional. All data is derived from existing transaction data + free APIs + existing Helius RPC.

---

## Context: What We Already Have

The `SwapAnalysisInput` table already stores, for every swap:

| Field               | What it contains                                      |
|---------------------|-------------------------------------------------------|
| `walletAddress`     | The wallet that made the trade                        |
| `signature`         | Transaction signature                                 |
| `timestamp`         | Unix timestamp of the trade                           |
| `mint`              | The SPL token mint address                            |
| `amount`            | Number of SPL tokens received/sent                    |
| `direction`         | "buy" or "sell"                                       |
| `associatedSolValue`| SOL amount the wallet paid (buy) or received (sell)   |
| `associatedUsdcValue`| USDC value if routed through USDC (nullable)         |
| `interactionType`   | Type of interaction                                   |

**Key insight**: The price is already embedded in the transaction. If a wallet paid 2 SOL for 1,000,000 tokens, and SOL was $150 that day, the token price = `(2 × 150) / 1,000,000 = $0.0003`. We just need SOL's USD price (free, trivial) and the token's total supply (on-chain, free via Helius RPC we already pay for).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  ENRICHMENT PIPELINE                     │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                    │
│  │ SolDailyPrice│    │TokenSupply   │                    │
│  │   Cache      │    │   Cache      │                    │
│  │ (DeFiLlama)  │    │ (Helius RPC) │                    │
│  └──────┬───────┘    └──────┬───────┘                    │
│         │                   │                            │
│         ▼                   ▼                            │
│  ┌──────────────────────────────────────┐                │
│  │        SwapAnalysisInput             │                │
│  │  + solPriceUsd                       │                │
│  │  + tokenPriceUsd                     │                │
│  │  + marketCapUsd                      │                │
│  │  + mcapBucket                        │                │
│  │  + usdValue                          │                │
│  │  + enrichedAt                        │                │
│  └──────────────────┬───────────────────┘                │
│                     │                                    │
│                     ▼                                    │
│  ┌──────────────────────────────────────┐                │
│  │   Downstream: WalletBehaviorProfile  │                │
│  │   Downstream: AnalysisResult         │                │
│  │   Downstream: WalletPnlSummary       │                │
│  │   Downstream: McapBehaviorProfile    │ (new, optional)│
│  └──────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Schema Migration

### 1.1 — New Models

Add these two cache tables to `schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Market Context — SOL/USD daily price cache (source: DeFiLlama, free)
// Stores one row per calendar day. Populated on startup, appended daily.
// ---------------------------------------------------------------------------
model SolDailyPrice {
  date      String   @id          // format: "YYYY-MM-DD" (UTC)
  priceUsd  Float                 // SOL/USD closing price for that day
  fetchedAt DateTime @default(now())
}

// ---------------------------------------------------------------------------
// Market Context — SPL token supply cache (source: Helius RPC, already paid)
// One row per token mint. Most memecoin supplies are fixed at creation,
// so this rarely needs updating. Refresh periodically for edge cases.
// ---------------------------------------------------------------------------
model TokenSupplyCache {
  mint         String   @id       // SPL mint address
  totalSupply  Float              // decimal-adjusted total supply (uiAmount)
  decimals     Int?               // token decimals (useful for verification)
  fetchedAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([fetchedAt])
}
```

### 1.2 — Extend SwapAnalysisInput

Add these nullable columns to the existing `SwapAnalysisInput` model:

```prisma
model SwapAnalysisInput {
  // ... all existing fields stay unchanged ...

  // --- Market Context (enrichment) ---
  solPriceUsd    Float?     // SOL/USD price at time of trade
  usdValue       Float?     // total USD value of the trade (associatedSolValue × solPriceUsd)
  tokenPriceUsd  Float?     // per-token USD price: usdValue / amount
  marketCapUsd   Float?     // fully diluted: tokenPriceUsd × totalSupply
  mcapBucket     String?    // "micro" | "small" | "mid" | "large" | "mega"
  enrichedAt     DateTime?  // when this row was enriched (null = not yet)
}
```

**Important**: All new fields are nullable. Existing data is untouched. The enrichment process fills them in progressively.

### 1.3 — Migration Commands

```bash
npx prisma migrate dev --name add-market-context-enrichment
```

If you are in production and need a safe migration:

```bash
npx prisma migrate deploy
```

---

## Phase 2: SOL Price Cache

### 2.1 — Populate Historical SOL Prices

**Source**: DeFiLlama Coins API (free, no API key, no auth).

**Endpoint**: `GET https://coins.llama.fi/prices/historical/{unixTimestamp}/coingecko:solana`

**Strategy**:
- On first run, backfill the last 90 days (90 API calls, one per day).
- After that, append one new price per day (cron or on app startup).
- Rate limit: be polite, ~200ms between calls. 90 calls takes ~18 seconds.

### 2.2 — Implementation: `src/services/market-context/sol-price-cache.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const DEFILLAMA_BASE = "https://coins.llama.fi";
const ONE_DAY = 86400;

/**
 * Fetch SOL/USD price at a specific unix timestamp from DeFiLlama.
 * FREE — no API key needed.
 */
export async function fetchSolPriceAtTimestamp(
  unixTimestamp: number
): Promise<number | null> {
  const url = `${DEFILLAMA_BASE}/prices/historical/${unixTimestamp}/coingecko:solana`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`DeFiLlama returned ${res.status} for timestamp ${unixTimestamp}`);
    return null;
  }

  const data = await res.json();
  return data.coins?.["coingecko:solana"]?.price ?? null;
}

/**
 * Backfill SOL daily prices for the last N days.
 * Skips dates that already exist in the database.
 */
export async function backfillSolPrices(
  prisma: PrismaClient,
  lookbackDays: number = 90
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;

  // Get existing dates to skip them
  const existing = await prisma.solDailyPrice.findMany({
    select: { date: true },
  });
  const existingDates = new Set(existing.map((r) => r.date));

  for (let i = 0; i < lookbackDays; i++) {
    const dayTimestamp = now - i * ONE_DAY;
    const dateKey = timestampToDateKey(dayTimestamp);

    if (existingDates.has(dateKey)) continue;

    const price = await fetchSolPriceAtTimestamp(dayTimestamp);

    if (price !== null) {
      await prisma.solDailyPrice.upsert({
        where: { date: dateKey },
        update: { priceUsd: price },
        create: { date: dateKey, priceUsd: price },
      });
      inserted++;
      console.log(`  SOL ${dateKey}: $${price.toFixed(2)}`);
    }

    // Respect the free API — 200ms delay
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`SOL price cache: inserted ${inserted} new days.`);
  return inserted;
}

/**
 * Append today's SOL price. Call on startup or via daily cron.
 */
export async function appendTodaySolPrice(
  prisma: PrismaClient
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dateKey = timestampToDateKey(now);

  const exists = await prisma.solDailyPrice.findUnique({
    where: { date: dateKey },
  });
  if (exists) return;

  const price = await fetchSolPriceAtTimestamp(now);
  if (price !== null) {
    await prisma.solDailyPrice.create({
      data: { date: dateKey, priceUsd: price },
    });
    console.log(`Appended SOL price for ${dateKey}: $${price.toFixed(2)}`);
  }
}

/**
 * Look up SOL/USD price for a given transaction timestamp.
 * Returns the exact day's price, or the nearest available day.
 */
export async function getSolPrice(
  prisma: PrismaClient,
  unixTimestamp: number
): Promise<number | null> {
  const dateKey = timestampToDateKey(unixTimestamp);

  // Try exact date first
  const exact = await prisma.solDailyPrice.findUnique({
    where: { date: dateKey },
  });
  if (exact) return exact.priceUsd;

  // Fallback: nearest date within ±3 days
  const nearbyDate = new Date(unixTimestamp * 1000);
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const minDate = new Date(nearbyDate.getTime() - threeDaysMs)
    .toISOString()
    .split("T")[0];
  const maxDate = new Date(nearbyDate.getTime() + threeDaysMs)
    .toISOString()
    .split("T")[0];

  const nearest = await prisma.solDailyPrice.findFirst({
    where: { date: { gte: minDate, lte: maxDate } },
    orderBy: { date: "desc" },
  });

  return nearest?.priceUsd ?? null;
}

function timestampToDateKey(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString().split("T")[0];
}
```

### 2.3 — Testing the SOL Price Cache

```typescript
// Test script: scripts/test-sol-price-cache.ts
import { PrismaClient } from "@prisma/client";
import { backfillSolPrices, getSolPrice } from "../src/services/market-context/sol-price-cache";

async function test() {
  const prisma = new PrismaClient();

  // 1. Backfill
  console.log("Backfilling SOL prices...");
  await backfillSolPrices(prisma, 90);

  // 2. Verify: look up a known date
  const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
  const price = await getSolPrice(prisma, threeDaysAgo);
  console.log(`SOL price 3 days ago: $${price?.toFixed(2) ?? "NOT FOUND"}`);

  // 3. Count cached rows
  const count = await prisma.solDailyPrice.count();
  console.log(`Total cached days: ${count}`);

  await prisma.$disconnect();
}

test().catch(console.error);
```

**Expected outcome**: ~90 rows in `SolDailyPrice`, each with a realistic SOL/USD price. Run takes ~18 seconds.

---

## Phase 3: Token Supply Cache

### 3.1 — Fetch Supply from Helius RPC

**Source**: Standard Solana RPC `getTokenSupply` method, via your existing Helius endpoint.

**Strategy**:
- For each unique `mint` in `SwapAnalysisInput` that doesn't already exist in `TokenSupplyCache`, fetch the supply once.
- Store it. For memecoins (vast majority), supply is fixed at mint time and never changes.
- Optional: re-fetch supplies older than 30 days for tokens that might have minting authority.

### 3.2 — Implementation: `src/services/market-context/token-supply-cache.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const HELIUS_RPC = process.env.HELIUS_RPC_URL; // should already exist in your env

/**
 * Fetch total supply for an SPL token mint via Solana RPC.
 * Uses your existing Helius RPC — no additional cost.
 */
export async function fetchTokenSupply(
  mintAddress: string
): Promise<{ totalSupply: number; decimals: number } | null> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenSupply",
    params: [mintAddress],
  };

  const res = await fetch(HELIUS_RPC!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) {
    console.warn(`RPC error for ${mintAddress}: ${data.error.message}`);
    return null;
  }

  const supply = data.result?.value;
  if (!supply || !supply.uiAmount) return null;

  return {
    totalSupply: supply.uiAmount,
    decimals: supply.decimals,
  };
}

/**
 * Ensure supplies are cached for all provided mint addresses.
 * Only fetches mints not already in the cache.
 */
export async function ensureSuppliesCached(
  prisma: PrismaClient,
  mintAddresses: string[]
): Promise<number> {
  // Deduplicate
  const uniqueMints = [...new Set(mintAddresses)];

  // Find which ones we already have
  const existing = await prisma.tokenSupplyCache.findMany({
    where: { mint: { in: uniqueMints } },
    select: { mint: true },
  });
  const existingMints = new Set(existing.map((r) => r.mint));

  const missing = uniqueMints.filter((m) => !existingMints.has(m));
  if (missing.length === 0) return 0;

  console.log(`Fetching supply for ${missing.length} new tokens...`);
  let fetched = 0;

  for (const mint of missing) {
    try {
      const result = await fetchTokenSupply(mint);
      if (result) {
        await prisma.tokenSupplyCache.create({
          data: {
            mint,
            totalSupply: result.totalSupply,
            decimals: result.decimals,
          },
        });
        fetched++;
      }
    } catch (err: any) {
      console.warn(`Failed to fetch supply for ${mint.slice(0, 12)}...: ${err.message}`);
    }

    // Rate limit: Helius free tier is generous but be polite
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`Token supply cache: fetched ${fetched} new tokens.`);
  return fetched;
}

/**
 * Get cached supply for a mint. Returns null if not cached.
 */
export async function getTokenSupply(
  prisma: PrismaClient,
  mint: string
): Promise<number | null> {
  const cached = await prisma.tokenSupplyCache.findUnique({
    where: { mint },
  });
  return cached?.totalSupply ?? null;
}
```

---

## Phase 4: The Enrichment Engine

This is the core. It reads un-enriched `SwapAnalysisInput` rows, applies the formula, and writes the market context fields back.

### 4.1 — The Formulas

```
tokenPriceUsd  = (associatedSolValue × solPriceUsd) / amount

   If associatedUsdcValue is available and associatedSolValue is 0:
     tokenPriceUsd = associatedUsdcValue / amount
     usdValue      = associatedUsdcValue

marketCapUsd   = tokenPriceUsd × totalSupply

mcapBucket:
   < $1,000,000         → "micro"
   $1M  – $10M          → "small"
   $10M – $100M         → "mid"
   $100M – $1B          → "large"
   > $1B                → "mega"
```

### 4.2 — Implementation: `src/services/market-context/enrichment-engine.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import { getSolPrice } from "./sol-price-cache";
import { getTokenSupply, ensureSuppliesCached } from "./token-supply-cache";

const MCAP_BUCKETS = [
  { label: "micro", max: 1_000_000 },
  { label: "small", max: 10_000_000 },
  { label: "mid", max: 100_000_000 },
  { label: "large", max: 1_000_000_000 },
  { label: "mega", max: Infinity },
] as const;

function classifyMcap(mcapUsd: number): string {
  for (const bucket of MCAP_BUCKETS) {
    if (mcapUsd < bucket.max) return bucket.label;
  }
  return "mega";
}

/**
 * Enrich a batch of SwapAnalysisInput rows with market context.
 *
 * @param batchSize - How many rows to process per run. Default 500.
 *                    Use smaller batches if running alongside other workloads.
 * @returns Number of rows successfully enriched.
 */
export async function enrichSwapBatch(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  // 1. Get un-enriched rows
  const rows = await prisma.swapAnalysisInput.findMany({
    where: { enrichedAt: null },
    orderBy: { timestamp: "desc" }, // newest first — most useful
    take: batchSize,
  });

  if (rows.length === 0) {
    console.log("No un-enriched swaps found.");
    return 0;
  }

  console.log(`Enriching ${rows.length} swap records...`);

  // 2. Pre-fetch all needed token supplies in one pass
  const uniqueMints = [...new Set(rows.map((r) => r.mint))];
  await ensureSuppliesCached(prisma, uniqueMints);

  // 3. Enrich each row
  let enriched = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Get SOL price for the trade's day
      const solPriceUsd = await getSolPrice(prisma, row.timestamp);
      if (!solPriceUsd) {
        errors++;
        continue;
      }

      // Calculate USD value of the trade
      let usdValue: number;
      if (row.associatedSolValue > 0) {
        usdValue = row.associatedSolValue * solPriceUsd;
      } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
        // USDC-routed trade: USDC value IS the USD value
        usdValue = row.associatedUsdcValue;
      } else {
        // No value to derive price from
        errors++;
        continue;
      }

      // Derive token price
      if (row.amount <= 0) {
        errors++;
        continue;
      }
      const tokenPriceUsd = usdValue / row.amount;

      // Get supply and derive market cap
      const totalSupply = await getTokenSupply(prisma, row.mint);
      const marketCapUsd = totalSupply ? tokenPriceUsd * totalSupply : null;
      const mcapBucket = marketCapUsd ? classifyMcap(marketCapUsd) : null;

      // Write back
      await prisma.swapAnalysisInput.update({
        where: { id: row.id },
        data: {
          solPriceUsd,
          usdValue,
          tokenPriceUsd,
          marketCapUsd,
          mcapBucket,
          enrichedAt: new Date(),
        },
      });

      enriched++;
    } catch (err: any) {
      console.warn(`Error enriching row ${row.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`Enriched: ${enriched} | Errors: ${errors} | Remaining: ${rows.length - enriched - errors}`);
  return enriched;
}

/**
 * Run enrichment until all rows are processed.
 * Processes in batches to avoid memory issues.
 */
export async function enrichAll(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  let totalEnriched = 0;
  let batchResult: number;

  do {
    batchResult = await enrichSwapBatch(prisma, batchSize);
    totalEnriched += batchResult;

    // Small pause between batches
    if (batchResult > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (batchResult > 0);

  console.log(`\nTotal enriched: ${totalEnriched} swap records.`);
  return totalEnriched;
}
```

### 4.3 — Handling Edge Cases

The enrichment engine must handle these scenarios:

| Scenario | How to handle |
|----------|---------------|
| `associatedSolValue` is 0 but `associatedUsdcValue` exists | Use USDC value directly as USD value |
| Both SOL and USDC values are 0 | Skip row, leave un-enriched |
| `amount` is 0 | Skip row (division by zero) |
| Token supply not available (account closed, burned, etc.) | Enrich price fields but leave `marketCapUsd` and `mcapBucket` null |
| SOL price not in cache for that date | Try fetching from DeFiLlama on-demand, or skip |
| Very old transactions (>90 days) | Extend backfill range, or fetch on-demand |
| Token with minting authority (supply changes) | Supply cache is a snapshot; acceptable accuracy for analysis |

---

## Phase 5: Sanity Check & Validation

### 5.1 — Cross-Reference with DexScreener

Your `TokenInfo` model already stores current `priceUsd` and `marketCapUsd` from DexScreener. Use this to validate the enrichment formula.

**Implementation**: `src/services/market-context/sanity-check.ts`

```typescript
import { PrismaClient } from "@prisma/client";

/**
 * Compare our derived current price with DexScreener's price
 * for recent transactions (last 24h).
 *
 * Acceptable variance: ±10% for liquid tokens, ±25% for microcaps.
 * Larger variance is expected for low-liquidity tokens with high spread.
 */
export async function runSanityCheck(prisma: PrismaClient): Promise<void> {
  // Get recently enriched transactions (last 24h)
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

  const recentEnriched = await prisma.swapAnalysisInput.findMany({
    where: {
      enrichedAt: { not: null },
      timestamp: { gte: oneDayAgo },
      tokenPriceUsd: { not: null },
    },
    take: 50,
    orderBy: { timestamp: "desc" },
  });

  if (recentEnriched.length === 0) {
    console.log("No recent enriched transactions to validate.");
    return;
  }

  console.log("=== SANITY CHECK: Derived vs DexScreener ===\n");

  let matches = 0;
  let mismatches = 0;
  let noReference = 0;

  for (const tx of recentEnriched) {
    const tokenInfo = await prisma.tokenInfo.findUnique({
      where: { tokenAddress: tx.mint },
    });

    if (!tokenInfo?.priceUsd) {
      noReference++;
      continue;
    }

    const dexPrice = parseFloat(tokenInfo.priceUsd);
    const derivedPrice = tx.tokenPriceUsd!;
    const variance = Math.abs(derivedPrice - dexPrice) / dexPrice;

    const status = variance < 0.25 ? "OK" : "MISMATCH";

    if (variance < 0.25) {
      matches++;
    } else {
      mismatches++;
      console.log(
        `  ${status} | ${tx.mint.slice(0, 12)}... | ` +
        `Derived: $${derivedPrice.toExponential(3)} | ` +
        `DexScreener: $${dexPrice.toExponential(3)} | ` +
        `Variance: ${(variance * 100).toFixed(1)}%`
      );
    }
  }

  console.log(`\nResults: ${matches} OK | ${mismatches} mismatch | ${noReference} no reference`);
  console.log(
    mismatches === 0
      ? "All checks passed."
      : "Some mismatches detected — check USDC-routed swaps or multi-hop Jupiter routes."
  );
}
```

### 5.2 — Manual Validation with Your Own Wallet

**Procedure**:

1. Make a small trade on Jupiter (buy any token with a known amount of SOL).
2. Wait for the transaction to be indexed by Helius into `SwapAnalysisInput`.
3. Run the enrichment on that specific transaction.
4. Compare:
   - Your `tokenPriceUsd` against the price shown on Birdeye/DexScreener at that moment.
   - Your `marketCapUsd` against the market cap shown on those same tools.
5. Variance under 5% for liquid tokens, under 15% for microcaps = formula is correct.

**Test script**: `scripts/test-enrichment-manual.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import { enrichSwapBatch } from "../src/services/market-context/enrichment-engine";
import { runSanityCheck } from "../src/services/market-context/sanity-check";

async function testWithOwnWallet() {
  const prisma = new PrismaClient();

  const YOUR_WALLET = "YOUR_WALLET_ADDRESS_HERE"; // <-- replace

  // Find your latest un-enriched swap
  const yourSwaps = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: YOUR_WALLET, enrichedAt: null },
    orderBy: { timestamp: "desc" },
    take: 5,
  });

  console.log(`Found ${yourSwaps.length} un-enriched swaps for your wallet.\n`);

  for (const swap of yourSwaps) {
    console.log(`  ${swap.direction} | ${swap.amount} tokens | ${swap.associatedSolValue} SOL | mint: ${swap.mint.slice(0, 12)}...`);
  }

  // Enrich them
  console.log("\nEnriching...");
  await enrichSwapBatch(prisma, 10);

  // Show results
  const enrichedSwaps = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: YOUR_WALLET, enrichedAt: { not: null } },
    orderBy: { timestamp: "desc" },
    take: 5,
  });

  console.log("\n=== ENRICHED RESULTS ===\n");
  for (const swap of enrichedSwaps) {
    console.log(`  ${swap.direction.toUpperCase()} ${swap.amount} tokens`);
    console.log(`    SOL spent: ${swap.associatedSolValue} SOL @ $${swap.solPriceUsd?.toFixed(2)}/SOL`);
    console.log(`    USD value: $${swap.usdValue?.toFixed(2)}`);
    console.log(`    Token price: $${swap.tokenPriceUsd?.toExponential(4)}`);
    console.log(`    Market cap: $${swap.marketCapUsd ? formatMcap(swap.marketCapUsd) : "N/A"}`);
    console.log(`    Bucket: ${swap.mcapBucket ?? "N/A"}`);
    console.log();
  }

  // Cross-reference with DexScreener
  await runSanityCheck(prisma);

  await prisma.$disconnect();
}

function formatMcap(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}

testWithOwnWallet().catch(console.error);
```

---

## Phase 6: Integration — Enrich on Ingest

Once validated, hook the enrichment into the existing transaction mapping pipeline so new swaps get enriched immediately.

### 6.1 — Where to Hook In

Find the existing code that writes rows to `SwapAnalysisInput` (the mapping/ingestion step). After a batch of swaps is written, call the enrichment:

```typescript
// In your existing mapping pipeline, after swaps are inserted:
import { enrichSwapBatch } from "./services/market-context/enrichment-engine";
import { appendTodaySolPrice } from "./services/market-context/sol-price-cache";

// Ensure today's SOL price is cached (idempotent, call freely)
await appendTodaySolPrice(prisma);

// Enrich the batch we just inserted
await enrichSwapBatch(prisma, batchSize);
```

### 6.2 — Startup Hook

On application startup, run these in order:

```typescript
// app startup or a dedicated init script
import { backfillSolPrices, appendTodaySolPrice } from "./services/market-context/sol-price-cache";

// 1. Ensure SOL price cache is populated
await appendTodaySolPrice(prisma);

// 2. On first-ever run, backfill 90 days
const solPriceCount = await prisma.solDailyPrice.count();
if (solPriceCount < 30) {
  await backfillSolPrices(prisma, 90);
}
```

### 6.3 — Backfill Script for Existing Data

For all the historical swaps already in the database that don't have market context yet:

```typescript
// scripts/backfill-market-context.ts
import { PrismaClient } from "@prisma/client";
import { backfillSolPrices } from "../src/services/market-context/sol-price-cache";
import { enrichAll } from "../src/services/market-context/enrichment-engine";

async function backfill() {
  const prisma = new PrismaClient();

  // Check how far back our data goes
  const oldest = await prisma.swapAnalysisInput.findFirst({
    where: { enrichedAt: null },
    orderBy: { timestamp: "asc" },
  });

  if (oldest) {
    const daysBack = Math.ceil((Date.now() / 1000 - oldest.timestamp) / 86400);
    console.log(`Oldest un-enriched swap: ${daysBack} days ago.`);
    console.log(`Backfilling SOL prices for ${daysBack} days...`);
    await backfillSolPrices(prisma, Math.min(daysBack + 5, 365)); // +5 buffer
  }

  // Enrich all un-enriched rows
  const total = await prisma.swapAnalysisInput.count({ where: { enrichedAt: null } });
  console.log(`\n${total} swap records to enrich. Starting...\n`);

  await enrichAll(prisma);

  await prisma.$disconnect();
}

backfill().catch(console.error);
```

---

## Phase 7: Downstream Enhancements

Once `SwapAnalysisInput` rows are enriched, several existing models can benefit from the new data. These are optional but unlock the full value of market context.

### 7.1 — Extend AnalysisResult with USD-Denominated PnL

The `AnalysisResult` model currently tracks PnL in SOL. With enriched data, we can derive USD PnL.

Add to `AnalysisResult`:

```prisma
  avgEntryPriceUsd         Float?  // weighted average token price at time of buys
  avgExitPriceUsd          Float?  // weighted average token price at time of sells
  avgEntryMcap             Float?  // weighted average market cap at time of buys
  avgExitMcap              Float?  // weighted average market cap at time of sells
  avgEntryMcapBucket       String? // most common mcap bucket at entry
  realizedPnlUsd           Float?  // total USD PnL (sells USD value - buys USD value)
```

**Derivation**: Query enriched `SwapAnalysisInput` rows for the same `walletAddress + mint`, aggregate buy-side and sell-side USD values.

### 7.2 — Extend WalletBehaviorProfile with Market Cap Preferences

Add to `WalletBehaviorProfile`:

```prisma
  mcapDistribution          Json?   // { "micro": 0.4, "small": 0.3, "mid": 0.2, "large": 0.1 }
  preferredMcapBucket       String? // the bucket where they trade most volume
  mcapBucketPnl             Json?   // { "micro": { roi: 1.5, count: 20 }, "small": { roi: -0.2, count: 5 } }
  avgEntryMcap              Float?  // across all tokens
```

This is the key unlock: "This wallet trades 60% in micro caps with 150% ROI, but loses money in midcaps."

### 7.3 — Extend TokenLot with Entry Market Cap

`TokenLot` already has `costBasisSol` and `purchaseTimestamp`. Add:

```prisma
  costBasisUsd    Decimal?  @db.Decimal(38, 18)
  entryPriceUsd   Float?
  entryMcapUsd    Float?
  entryMcapBucket String?
```

Derivation uses the same formula: look up SOL price at `purchaseTimestamp`, multiply `costBasisSol × solPrice` for USD cost, divide by `amountBought` for entry price, multiply by supply for mcap.

### 7.4 — Extend WalletPnlSummary with USD Metrics

Add to `WalletPnlSummary`:

```prisma
  realizedPnlUsd            Float?
  unrealizedPnlUsd          Float?
  netPnlUsd                 Float?
  totalVolumeUsd            Float?
```

---

## Phase 8: New Analysis Queries Unlocked

With enrichment in place, these queries become trivial:

### "What mcap range does this wallet prefer?"

```sql
SELECT mcap_bucket, COUNT(*) as trade_count,
       SUM(usd_value) as total_volume_usd
FROM "SwapAnalysisInput"
WHERE wallet_address = $1 AND direction = 'buy' AND mcap_bucket IS NOT NULL
GROUP BY mcap_bucket
ORDER BY total_volume_usd DESC;
```

### "What's their ROI per mcap bucket?"

```sql
WITH buys AS (
  SELECT mint, mcap_bucket, SUM(usd_value) as total_bought_usd
  FROM "SwapAnalysisInput"
  WHERE wallet_address = $1 AND direction = 'buy' AND usd_value IS NOT NULL
  GROUP BY mint, mcap_bucket
),
sells AS (
  SELECT mint, SUM(usd_value) as total_sold_usd
  FROM "SwapAnalysisInput"
  WHERE wallet_address = $1 AND direction = 'sell' AND usd_value IS NOT NULL
  GROUP BY mint
)
SELECT b.mcap_bucket,
       COUNT(DISTINCT b.mint) as tokens,
       SUM(b.total_bought_usd) as invested,
       SUM(COALESCE(s.total_sold_usd, 0)) as returned,
       SUM(COALESCE(s.total_sold_usd, 0)) - SUM(b.total_bought_usd) as pnl_usd
FROM buys b
LEFT JOIN sells s ON b.mint = s.mint
GROUP BY b.mcap_bucket
ORDER BY b.mcap_bucket;
```

### "Show wallets that consistently profit in microcaps"

```sql
-- Find wallets with >5 micro-cap trades and positive ROI
WITH wallet_mcap_pnl AS (
  SELECT wallet_address, mcap_bucket, direction,
         SUM(usd_value) as total_usd
  FROM "SwapAnalysisInput"
  WHERE mcap_bucket = 'micro' AND usd_value IS NOT NULL
  GROUP BY wallet_address, mcap_bucket, direction
)
SELECT b.wallet_address,
       b.total_usd as invested,
       COALESCE(s.total_usd, 0) as returned,
       COALESCE(s.total_usd, 0) / NULLIF(b.total_usd, 0) - 1 as roi
FROM wallet_mcap_pnl b
LEFT JOIN wallet_mcap_pnl s ON b.wallet_address = s.wallet_address AND s.direction = 'sell'
WHERE b.direction = 'buy' AND b.total_usd > 100
ORDER BY roi DESC
LIMIT 50;
```

---

## Execution Checklist

This is the ordered list of tasks. Each task is independently testable.

### Milestone 1: Foundation (do first, ~30 minutes)
- [ ] Add `SolDailyPrice` model to `schema.prisma`
- [ ] Add `TokenSupplyCache` model to `schema.prisma`
- [ ] Add enrichment fields to `SwapAnalysisInput` (all nullable)
- [ ] Run `npx prisma migrate dev --name add-market-context-enrichment`
- [ ] Verify migration succeeded: check tables exist in DB

### Milestone 2: SOL Price Cache (~15 minutes)
- [ ] Create `src/services/market-context/sol-price-cache.ts`
- [ ] Run backfill for 90 days
- [ ] Verify: `SELECT COUNT(*) FROM "SolDailyPrice"` returns ~90
- [ ] Verify: Prices look realistic (SOL should be in the $100-$250 range recently)

### Milestone 3: Token Supply Cache (~15 minutes)
- [ ] Create `src/services/market-context/token-supply-cache.ts`
- [ ] Test with a known token (e.g., BONK: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`)
- [ ] Expected BONK supply: ~93 trillion tokens
- [ ] Verify the cache populates correctly

### Milestone 4: Enrichment Engine (~30 minutes)
- [ ] Create `src/services/market-context/enrichment-engine.ts`
- [ ] Enrich a small batch (10 rows) and inspect results
- [ ] Verify: `tokenPriceUsd` makes sense (not absurdly high or zero)
- [ ] Verify: `marketCapUsd` is in a plausible range
- [ ] Verify: `mcapBucket` is assigned correctly

### Milestone 5: Sanity Check (~15 minutes)
- [ ] Create `src/services/market-context/sanity-check.ts`
- [ ] Run against recent transactions
- [ ] Compare derived prices with DexScreener prices from `TokenInfo`
- [ ] If variance > 25% on liquid tokens, debug the formula

### Milestone 6: Manual Test with Your Wallet (~10 minutes)
- [ ] Make a test trade on Jupiter
- [ ] Wait for indexing
- [ ] Run enrichment on your wallet
- [ ] Compare derived price/mcap with Birdeye/DexScreener live values

### Milestone 7: Backfill All Historical Data (~varies, run and walk away)
- [ ] Run `scripts/backfill-market-context.ts`
- [ ] Monitor progress: `SELECT COUNT(*) FROM "SwapAnalysisInput" WHERE enriched_at IS NOT NULL`
- [ ] Expected: 80-95% enrichment rate (some very old/obscure tokens may not have supply data)

### Milestone 8: Integration (~15 minutes)
- [ ] Hook `appendTodaySolPrice()` into app startup
- [ ] Hook `enrichSwapBatch()` into the existing mapping pipeline after swap insertion
- [ ] Verify new swaps are automatically enriched

### Milestone 9: Downstream Enhancements (optional, future)
- [ ] Add mcap fields to `AnalysisResult`
- [ ] Add mcap preference fields to `WalletBehaviorProfile`
- [ ] Add USD cost basis to `TokenLot`
- [ ] Add USD PnL to `WalletPnlSummary`

---

## File Structure Summary

```
src/services/market-context/
├── sol-price-cache.ts         # DeFiLlama SOL/USD daily prices
├── token-supply-cache.ts      # Helius RPC token supply fetcher
├── enrichment-engine.ts       # Core enrichment logic + batch processor
├── sanity-check.ts            # Cross-reference with DexScreener
└── index.ts                   # Re-exports for convenience

scripts/
├── backfill-market-context.ts # One-time backfill of all historical swaps
├── test-sol-price-cache.ts    # Test SOL price fetching
└── test-enrichment-manual.ts  # Manual validation with your own wallet
```

---

## Key Reminders for the Agent

1. **Never break existing functionality.** All new fields are nullable. Existing code that reads `SwapAnalysisInput` will be unaffected.
2. **The formula is**: `tokenPriceUsd = (associatedSolValue × solPriceUsd) / amount`. Do not overcomplicate it.
3. **USDC fallback**: If `associatedSolValue` is 0 but `associatedUsdcValue` is present, use it directly as USD value.
4. **DeFiLlama is free, no API key.** Do not add API key configuration for it.
5. **Helius RPC is already configured** in the project env vars. Use it for `getTokenSupply`.
6. **DexScreener data in `TokenInfo`** is for sanity-checking only, not for historical enrichment.
7. **Run tests at each milestone.** Do not proceed to the next milestone until the current one passes.
8. **Batch operations.** Never try to enrich all rows in a single database query. Process in batches of 500.
9. **The `enrichedAt` field** is the flag for "has this row been processed?" — null means no, timestamp means yes.
10. **Token supply is fetched once and cached.** Do not re-fetch on every enrichment run. The vast majority of SPL memecoins have immutable supply.
