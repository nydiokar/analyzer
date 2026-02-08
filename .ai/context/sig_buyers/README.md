# Significant Buyer Discovery - Working Solution

## Status: ✅ WORKING & VALIDATED

This script successfully finds all wallets that bought a token during a specific time window.

## Quick Start

```bash
npx ts-node -r tsconfig-paths/register .ai/context/sig_buyers/WORKING-wallet-discovery.ts
```

## What It Does

Finds wallets that:
- Bought a specific token mint during a time range
- Spent ≥1 SOL (configurable threshold)
- Returns ranked list by SOL spent

## How It Works

### 1. Fetch Signatures (RPC)
- Uses `getSignaturesForAddress` with time filtering
- **This is the ONLY method that works for mint time-filtering**
- Paginates through all signatures in the time range

### 2. Enrich Transactions (Enhanced API)
- Batch enriches signatures (100 at a time)
- Gets full transaction data with parsed events

### 3. Extract Wallets
- Parses `tokenTransfers` for the target mint
- Groups transactions by wallet address

### 4. Map & Aggregate (HeliusTransactionMapper)
- Runs mapper on each wallet's transactions
- Calculates SOL spent/received
- **KEY**: `direction: 'in'` = BUY = SOL SPENT
- **KEY**: `direction: 'out'` = SELL = SOL RECEIVED

### 5. Filter & Rank
- Filters by minimum SOL threshold
- Sorts by SOL spent descending

## Validated Results

**Test Case**: Token `DzrScTJ32QqLWNQz6UEwRe5QaTw9SJbAepAuh95wBAGS`
- Time: 2026-01-26 07:37 - 08:13 (36 minutes)
- ✅ Processed 4,681 transactions
- ✅ Found 1,355 unique wallets
- ✅ Identified 342 wallets spending ≥1 SOL
- ✅ Target wallet verified: `7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg` spent 2.24 SOL

## Configuration

Edit these values in the script:

```typescript
const config = {
  mintAddress: 'YOUR_TOKEN_MINT_HERE',
  startTime: 1769413020,  // Unix timestamp (seconds)
  endTime: 1769415180,
  minSolSpent: 1.0,
  targetWallets: ['wallet1...', 'wallet2...']  // Optional: for debugging
};
```

## Known Issues & Fixes

### ❌ Unique Constraint Error (Prisma)
**What**: Error about duplicate `(signature, mint, direction, amount)`
**Impact**: None - just noisy logs
**Cause**: Trying to save records that already exist
**Fix**: Ignore it OR remove the database save step (lines around 405-414 in original)

### ⚠️ Top Result is Program Address
**What**: `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC` appears as top wallet
**Impact**: This is likely a DEX/pool program, not a user wallet
**Fix**: Filter out known program addresses (future enhancement)

## Critical Don'ts

❌ **DO NOT** try to use Enhanced API `/v0/addresses/{address}/transactions` with time filters for mints
   - Time filters are IGNORED for mint addresses
   - You'll only get last ~30 seconds of data

❌ **DO NOT** cache signatures without loading cached transactions
   - Skipping enrichment without reconstruction = incomplete data

❌ **DO NOT** reverse the direction logic
   - `direction: 'in'` = tokens IN = SOL SPENT (this is correct!)

## Files

- `WORKING-wallet-discovery.ts` - Clean, documented working version
- `test-wallet-discovery.ts` - Original with debugging/extra features
- `diagnose.ts` - Diagnostic tool for troubleshooting

## Performance

- ~5-10 minutes for 4,000+ transactions
- ~40 RPS Helius API rate limit
- ~100 signatures per enrichment batch

## Next Steps

**To make production-ready:**

1. **Filter system wallets** - Exclude known DEX/program addresses
2. **Add caching properly** - Save and reload enriched transactions
3. **Export to CSV** - Already has code for this (around line 520-560)
4. **Add pagination** - For very large datasets
5. **Remove Prisma errors** - Wrap DB save in try-catch or skip duplicates

## Support

If it stops working, check:
1. Is HELIUS_API_KEY set?
2. Are you within rate limits?
3. Did the time range return any signatures?
4. Run `diagnose.ts` to check data availability
