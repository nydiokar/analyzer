# Known Issues & TODOs

## Unrealized PNL - Missing SOL Price

### ✅ FIXED in pnl-overview.service.ts + SOL Price Caching
- `getPnlAnalysisForSummary()` now fetches SOL price before calling `analyzeWalletPnl()`
- This fixes the "Cannot calculate unrealized PNL without proper SOL price" errors in GET `/wallets/{address}` endpoint
- **SOL Price Caching (NEW)**: Implemented Redis caching with 30-second TTL in `DexscreenerService.getSolPriceCached()`
  - Reduces Dexscreener API calls from ~8-10 per analysis session to **1 per 30 seconds**
  - All services now use `getSolPriceCached()` instead of `getSolPrice()`
  - Logs show "Cache hit" vs "Cache miss, fetching from DexScreener" for visibility

### ⚠️ TODO: Similarity Operations Processor
**File**: `src/queues/processors/similarity-operations.processor.ts:391`

**Issue**: The similarity processor calls `analyzeWalletPnl(walletAddress)` without passing `solPriceUsd`, which means unrealized PNL calculations will fail for similarity analysis jobs.

**Fix needed**:
```typescript
// BEFORE (line 388-393)
const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
await Promise.all([
    this.pnlAnalysisService.analyzeWalletPnl(walletAddress),
    this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig),
]);

// AFTER - need to inject DexscreenerService and fetch SOL price:
const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
let solPriceUsd: number | undefined;
try {
  solPriceUsd = await this.dexscreenerService.getSolPrice();
} catch (error) {
  this.logger.warn(`Failed to fetch SOL price for similarity analysis: ${error}`);
}

await Promise.all([
    this.pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined, { solPriceUsd }),
    this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig),
]);
```

**Impact**: LOW - Similarity analysis still works, just missing unrealized PNL calculations
**Priority**: Medium - Should fix when working on similarity features next

