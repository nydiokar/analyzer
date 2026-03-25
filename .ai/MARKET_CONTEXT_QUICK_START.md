# Market Context Enrichment — Quick Start

All code is scaffolded and ready. When PostgreSQL is available:

## Step 1: Deploy Schema

```bash
# In dev environment:
npx prisma migrate dev --name add-market-context-enrichment

# In production:
npx prisma migrate deploy
```

This creates:
- `SolDailyPrice` table (SOL/USD daily cache)
- `TokenSupplyCache` table (token supply snapshots)
- 6 new nullable columns on `SwapAnalysisInput`

## Step 2: Test SOL Price Cache

```bash
npx ts-node scripts/test-sol-price-cache.ts
```

Expected:
- ~90 rows inserted in `SolDailyPrice`
- SOL prices in the $100-$250 range
- Lookups working correctly

## Step 3: Test Enrichment with Your Wallet

1. Make a small trade on Jupiter (buy 1M tokens with some SOL)
2. Wait for Helius indexing (~30 seconds)
3. Update `YOUR_WALLET_ADDRESS_HERE` in `scripts/test-enrichment-manual.ts`
4. Run:
   ```bash
   npx ts-node scripts/test-enrichment-manual.ts
   ```

Expected:
- Your swap gets enriched
- `tokenPriceUsd` matches Birdeye/DexScreener
- `marketCapUsd` matches displayed market cap
- Variance < 5% for liquid tokens, < 15% for microcaps

## Step 4: Backfill Historical Data

```bash
npx ts-node scripts/backfill-market-context.ts
```

This:
- Auto-detects oldest un-enriched swap
- Backfills SOL prices for that period
- Processes all swaps in batches of 500
- Logs progress, can safely interrupt & resume

Monitor progress:
```sql
SELECT COUNT(*) FROM "SwapAnalysisInput" WHERE enriched_at IS NOT NULL;
```

Expected: 80-95% enrichment rate (some very old/obscure tokens may fail)

## Step 5: Hook Into App Startup

In your app init code:

```typescript
import { appendTodaySolPrice } from "./services/market-context/sol-price-cache";

// On app startup:
await appendTodaySolPrice(prisma);
```

This ensures today's SOL price is always cached.

## Step 6: Hook Into Mapping Pipeline

After your existing code that inserts into `SwapAnalysisInput`:

```typescript
import { enrichSwapBatch } from "./services/market-context/enrichment-engine";

// After inserting a batch of swaps:
await enrichSwapBatch(prisma, 500);
```

This automatically enriches new swaps as they're ingested.

---

## Verify It's Working

```sql
-- Check enrichment progress
SELECT COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched,
       COUNT(*) FILTER (WHERE enriched_at IS NULL) as pending,
       COUNT(*) as total
FROM "SwapAnalysisInput";

-- Check a recently enriched swap
SELECT id, mint, amount, token_price_usd, mcap_bucket, enriched_at
FROM "SwapAnalysisInput"
WHERE enriched_at IS NOT NULL
ORDER BY enriched_at DESC
LIMIT 5;
```

---

## Formula Reference

```
solPriceUsd = Look up SOL/USD for the day of the transaction

usdValue = associatedSolValue × solPriceUsd
           (or associatedUsdcValue if SOL value is 0)

tokenPriceUsd = usdValue / amount

totalSupply = Fetch from Helius RPC (cached)

marketCapUsd = tokenPriceUsd × totalSupply

mcapBucket = Classify marketCapUsd:
  < $1M      → "micro"
  $1M-$10M   → "small"
  $10M-$100M → "mid"
  $100M-$1B  → "large"
  > $1B      → "mega"
```

---

## Troubleshooting

**"No un-enriched swaps found"**
- All swaps are already enriched, nothing to do

**"DeFiLlama returned 404"**
- Very old timestamp (>90 days), extend backfill range

**"RPC error for {mint}"**
- Token supply not available on-chain (closed account, burned, etc.)
- Swap still enriched with price fields; `marketCapUsd` left null

**Variance > 25% on sanity check**
- Normal for low-liquidity tokens
- Check if swap was USDC-routed or multi-hop on Jupiter
- Formula is correct; variance is due to market conditions

---

## What Gets Unlocked

Once enriched, you can answer:
- "What mcap range does this wallet prefer?"
- "Do they perform better in microcaps or large caps?"
- "What's their ROI per mcap bucket?"
- "Which wallets consistently profit in microcaps?"

See `.ai/context/MARKET_CONTEXT_ENRICHMENT_SOP.md` Phase 8 for example SQL queries.

---

**Reference**: `.ai/context/MARKET_CONTEXT_ENRICHMENT_SOP.md`
**Implementation Summary**: `.ai/IMPLEMENTATION_SUMMARY.md`
