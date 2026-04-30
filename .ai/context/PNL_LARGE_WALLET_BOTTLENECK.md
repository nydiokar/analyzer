# PnL Analysis Bottleneck — Large Wallet Choking

**Date:** 2026-04-30  
**Trigger:** Wallet `BM9CcyErJcu2mjrFvUsRRrD3snGeHDDVirJLvL6EjvMN` — 51,400 transactions → 5,012 tokens → analysis choked/killed

---

## Root Causes

### 1. Monolithic DB Load (Primary)
**File:** `src/core/services/pnl-analysis-service.ts:250`  
**File:** `src/core/services/database-service.ts:2106-2138`

`getSwapAnalysisInputs()` uses `findMany()` with **no limit, no pagination, no streaming** — loads all 51,400 rows into a single Node.js array (~25-30 MB) before any processing begins.

Then at **line 624** it fires a **second** `findMany()` query for the USD FIFO pass — another ~30 MB load of the same data.

### 2. O(n²) FIFO Lot Tracking
**File:** `src/core/analysis/swap/fifo-lot-tracker.ts:100`

```typescript
const nextLot = lots.find(lot => lot.amountRemaining > LOT_FINDING_TOLERANCE);
```

`lots.find()` is a linear scan through all remaining in-lots on every "out" transaction. For a token with thousands of trades, this becomes hundreds of millions of comparisons total.

### 3. Duplicate FIFO Pass (SOL + USD)
**File:** `src/core/services/pnl-analysis-service.ts:624-725`

The FIFO algorithm runs **twice** — once SOL-denominated (line 297 via `SwapAnalyzer.analyze()`) and once USD-denominated (lines 661-725). Same 51,400 records, same algorithm, separate passes.

### 4. All Maps Held Simultaneously
**Files:** `src/core/analysis/swap/analyzer.ts:48-58`, `pnl-analysis-service.ts:390-772`

10+ maps (`fifoInputsByMint`, `fifoLotsByMint`, `analysisBySplMint`, `holdingValueByMint`, `entryMcapByMint`, etc.) all held in heap simultaneously for all 5,012 tokens. No cleanup between token processing.

**Total heap at peak: ~50-65 MB** (plus GC overhead).

### 5. SmartFetch Cap Commented Out
**File:** `src/core/services/helius-sync-service.ts:197-223`

Bot/whale detection that would limit large wallets to 1k-3k signatures is **commented out**, allowing unlimited transaction ingestion for any wallet.

### 6. Timeout Too Short
**File:** `src/config/constants.ts:163`

`DASHBOARD_DEEP_TIMEOUT_MINUTES: 5` — O(n²) FIFO on 51k transactions easily exceeds 5 minutes.

---

## Fix Plan (Priority Order)

### Fix 1 — Per-Token Streaming Analysis (load-bearing fix)
**Effort:** Medium | **Impact:** Eliminates the 60 MB spike entirely

Replace the bulk `getSwapAnalysisInputs()` call with a mint-by-mint loop:

```
1. SELECT DISTINCT mint FROM SwapAnalysisInput WHERE walletAddress = X
2. For each mint:
   a. SELECT * FROM SwapAnalysisInput WHERE walletAddress = X AND mint = Y
   b. Run FIFO (SOL + USD merged, single pass)
   c. Upsert result
   d. GC those rows → move to next token
```

Peak memory drops from ~60 MB → ~10 KB. Analysis becomes a streaming pipeline.

**New methods to add to `database-service.ts`:**
- `getDistinctMintsForWallet(walletAddress: string): Promise<string[]>`
- `getSwapInputsForMint(walletAddress: string, mint: string): Promise<SwapAnalysisInput[]>`

**Change in `pnl-analysis-service.ts:250`:** replace single bulk query with the mint-by-mint loop.

### Fix 2 — Merge SOL + USD into Single FIFO Pass
**Effort:** Medium | **Impact:** Halves CPU and memory

Run both SOL-denominated and USD-denominated FIFO in one pass over the data instead of two separate passes. Eliminates the second `findMany()` at line 624 and the duplicate FIFO logic at lines 661-725.

### Fix 3 — O(n²) → O(n) FIFO Pointer
**Effort:** Small | **Impact:** Fixes worst-case CPU blowup

Replace `lots.find()` with a `nextLotIndex` integer that only moves forward. Since FIFO lots are already timestamp-ordered, a moving pointer is always correct.

```typescript
// Before
const nextLot = lots.find(lot => lot.amountRemaining > LOT_FINDING_TOLERANCE);

// After
while (nextLotIndex < lots.length && lots[nextLotIndex].amountRemaining <= LOT_FINDING_TOLERANCE) {
    nextLotIndex++;
}
const nextLot = lots[nextLotIndex];
```

### Fix 4 — Re-enable SmartFetch Cap
**Effort:** Small | **Impact:** Prevents future accumulation

Uncomment the SmartFetch limit in `helius-sync-service.ts:197-223`. Cap bot/whale wallets at 5k-10k max signatures unless explicitly overridden. Wallets with >10k transactions are either bots or whales — full ingestion is rarely useful.

---

## Summary Table

| Fix | File | Lines | Effort | Impact |
|-----|------|-------|--------|--------|
| Per-token streaming | pnl-analysis-service.ts, database-service.ts | 250, 2106 | Medium | Eliminates 60 MB heap spike |
| Single-pass FIFO | pnl-analysis-service.ts | 624-725 | Medium | Halves CPU + memory |
| O(n) FIFO pointer | fifo-lot-tracker.ts | 100 | Small | Fixes O(n²) worst case |
| SmartFetch cap | helius-sync-service.ts | 197-223 | Small | Prevents future overload |
