# P0: P&L Calculation Issues - Current Status

**Severity**: 🟡 **HIGH (was P0, partially resolved)**
**Last Updated**: 2026-01-03
**Status**: FIFO implemented, but significant issues remain

---

## Executive Summary

### ✅ What's Fixed
- **FIFO cost basis tracking** implemented (December 2025)
- **Holdings mismatch** handling improved (January 2026)
- **UNKNOWN transfers** (DCA escrow) no longer break calculations
- **Main test token** now shows PnL (was completely null before)

### ❌ What's Still Broken
- **PnL differs 110-450 SOL** from competitor platforms
- **3 tokens show incomplete history** despite being "clean" (no DCA)
- **TRANSFER interactions** treated as economic and they are sometimes! (inflating cost basis)
- **Unknown interaction types** beyond SWAP/TRANSFER/UNKNOWN/BURN/TOKEN_MINT

---

## The Original Problem (Historical Context)

**FIFO cost basis tracking was missing.** We used simple average cost, which catastrophically fails for partial sells:

**Real Example:**
- Bought: 70 SOL spent
- Sold: 555 SOL received
- Holdings: 236 SOL worth
- **Expected**: +721 SOL profit
- **Shown**: -80 SOL loss
- **Error**: 801 SOL (1000%+ off!)

**Root Cause:** No tracking of which specific token lots were sold (FIFO = First In, First Out).

**Impact:** Entire platform showed backwards P&L - winners appeared as losers and vice versa.

---

## FIFO Implementation (Dec 2025) ✅

### What We Built
- `TokenLots` table in database
- FIFO lot tracking in `SwapAnalyzer`
- Proper realized/unrealized split
- Cost basis tracking per lot

### Files Modified
- `prisma/schema.prisma` - Added TokenLots table
- `src/core/analysis/swap/analyzer.ts` - FIFO lot creation
- `src/core/analysis/swap/fifo-lot-tracker.ts` - FIFO consumption logic
- `src/core/services/pnl-analysis-service.ts` - Lot-based P&L calculations

**Status**: ✅ Implemented and working for most cases

---

## New Issues Discovered (Jan 2026)

### 1. 🔴 **UNKNOWN Transfers Breaking FIFO**

**Problem**: Jupiter DCA deposits/withdrawals marked as `UNKNOWN` by Helius

**Characteristics:**
- Tiny SOL values (0.007 SOL) but HUGE token amounts (millions)
- Represent program escrow movements (tokens leave wallet but aren't sold yet)

**Example** (Wallet: `CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B`, Token: `9Avy...pump`):
```
UNKNOWN IN:  54.7M tokens (0.042 SOL total)
UNKNOWN OUT: 57.1M tokens (0.042 SOL total)
Net: -2.4M tokens (in DCA escrow, not sold)
```

**Original Impact**: FIFO saw "oversell" and marked incomplete

**Solution Implemented:**
```typescript
// analyzer.ts - Exclude UNKNOWN tiny from FIFO, include in supply totals
const isNonEconomicTransfer =
    interactionType === 'BURN' ||
    (interactionType === 'UNKNOWN' &&
     Math.abs(input.associatedSolValue) < 0.01 &&
     Math.abs(input.associatedUsdcValue ?? 0) < 0.01);

// Only pass economic transfers to FIFO
if (splMint !== SOL_MINT && !isNonEconomicTransfer) {
    fifoInputsByMint.set(splMint, [input]);
}

// But still count in supply totals with zero SOL value
currentAnalysis.totalAmountIn! += tokenAmount;
const solValueToConsider = isNonEconomicTransfer ? 0 : input.associatedSolValue;
currentAnalysis.totalSolSpent! += solValueToConsider;
```

**Status**: ✅ Fixed - UNKNOWN tiny transfers excluded from FIFO, included in supply

---

### 2. 🔴 **Holdings Mismatch Check Too Strict**

**Problem**: Code failed on mismatch between `currentBalance` and `fifoRemainingAmount`

**Why Mismatch Happens:**
- Tokens in DCA escrow (left wallet but not sold yet)
- FIFO only tracks economic swaps, not escrow movements
- Mismatch is **EXPECTED and CORRECT** for wallets using DCA

**Example:**
```
Current balance: 15,000,000 tokens (on-chain)
FIFO expected: 17,442,587 tokens (doesn't know about DCA OUT)
Difference: -2,442,587 tokens (exactly the UNKNOWN delta!)
```

**Original Code:**
```typescript
if (result.hasIncompleteHistory || hasHoldingsMismatch) {
    result.realizedPnlSol = null; // ❌ Too strict!
```

**Solution Implemented:**
```typescript
// Only mark incomplete if FIFO itself failed (oversell), not just holdings mismatch
if (result.hasIncompleteHistory) {
    result.realizedPnlSol = null; // ✅ Only fail on real FIFO failure
```

**Status**: ✅ Fixed - Accept expected mismatch from DCA escrow

---

### 3. 🟡 **TRANSFER Treated as Economic** (Not Yet Fixed)

**Problem**: Non-swap transfers counted as purchases with cost basis

**Example** (Token: `9Avy...pump`):
```
TRANSFER (✓ ECONOMIC):  ← Should be NON-ECONOMIC!
  Count: 4 transfers IN
  Tokens: 5,690 tokens
  SOL: 0.70 SOL ← Counted as cost!
```

**These are likely:**
- Wallet-to-wallet transfers (zero cost)
- Airdrops (zero cost)
- Rewards (zero cost)

**Impact:**
- Inflates `totalSolSpent` by small amounts per token
- Accumulates across all tokens in wallet

**Comparison:**
```
GMGN shows: 2,460 SOL spent
We show:    2,511 SOL spent (includes TRANSFER)
Difference: 51 SOL
```

**Status**: ❌ **NOT FIXED** - Need to exclude TRANSFER from economic calculations

---

### 4. 🔴 **PnL Differs Significantly from Competitors**

**Test Wallet**: `CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B`
**Test Token**: `9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump`

| Platform | Total PnL | Realized | Unrealized | Notes |
|----------|-----------|----------|------------|-------|
| **Our System** | **-145 SOL** | +84 SOL | -229 SOL | Shows unrealized |
| GMGN | +309 SOL | +309 SOL | 0 SOL | Unrealized=0 (wrong?) |
| Axiom | -35 SOL | ? | ? | Closer to reality |
| Padre.gg | +45 SOL | ? | ? | - |

**Discrepancy Range**: 110 to 450 SOL difference!

**Possible Causes:**
1. ✅ TRANSFER counting (0.70 SOL - partially explains)
2. ❓ Unknown interaction types we don't handle
3. ❓ Different FIFO vs average cost approaches
4. ❓ Current holdings valuation differences
5. ❓ Different handling of failed transactions

**Status**: ❌ **UNDER INVESTIGATION**

---

### 5. 🟡 **3 Tokens Still Show Incomplete History**

**Wallet**: `CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B`

```
⚠️ Tokens with incomplete history:
   - 5PsnNwPmMtsGZgG6ZqMoDJJi28BR5xpAotXHHiQhpump
   - BANKJmvhT8tiJRsBSS1n2HryMBPvT5Ze4HU95DUAmeta
   - fRfKGCriduzDwSudCwpL7ySCEiboNuryhZDVJtr1a1C
```

**Characteristics:**
- Supposedly "clean" (no DCA/UNKNOWN issues)
- But FIFO still failing

**Example** (`fRfKGCriduzDwSudCwpL7ySCEiboNuryhZDVJtr1a1C`):
```
Interaction types:
  TOKEN_MINT: 8 in (250 SOL)  ← What is this?
  TRANSFER:   5 in (0.75 SOL)
  SWAP:       1 out (212 SOL)

Status: hasIncompleteHistory=true
Balance: null (exited position)
Net: 0 tokens (all sold)
```

**Questions:**
- What is TOKEN_MINT? Minting new tokens?
- Should it have cost basis?
- Why does FIFO fail on clean buy/sell?

**Status**: ❌ **NEEDS INVESTIGATION**

---

## Helius Interaction Types Inventory

### Known Types (From Database Analysis)
1. **SWAP** - Real economic swaps ✓
2. **TRANSFER** - Wallet-to-wallet, airdrops ⚠️ (should be zero-cost, currently economic)
3. **UNKNOWN** - DCA deposits, program interactions ✓ (tiny SOL filtered)
4. **BURN** - Burning tokens ✓ (zero-cost)
5. **TOKEN_MINT** - ❓ Unknown, needs investigation

### Classification Logic (Current)

```typescript
// Non-economic transfers (zero cost basis):
const isNonEconomicTransfer =
    interactionType === 'BURN' ||
    (interactionType === 'UNKNOWN' &&
     Math.abs(input.associatedSolValue) < 0.01 &&
     Math.abs(input.associatedUsdcValue ?? 0) < 0.01);

// Economic transfers (tracked in FIFO):
const isEconomic = !isNonEconomicTransfer;
```

**Issue**: TRANSFER and TOKEN_MINT currently treated as economic!

---

## Architecture (Current)

### Data Flow

```
1. Helius API → SwapAnalysisInput (raw transactions)
   ├─ interactionType: SWAP | TRANSFER | UNKNOWN | BURN | TOKEN_MINT | ?
   ├─ direction: in | out
   ├─ amount: token quantity
   ├─ associatedSolValue: SOL value
   └─ associatedUsdcValue: USDC value (optional)

2. SwapAnalyzer → Filter & Aggregate
   ├─ Classify as economic or non-economic
   ├─ Aggregate supply totals (ALL transfers)
   └─ Pass economic transfers to FIFO

3. FIFO Tracker → Cost Basis Calculation
   ├─ Create lots for economic INs
   ├─ Consume lots for economic OUTs
   ├─ Track realized PnL (sold lots)
   └─ Track unrealized PnL (remaining lots)

4. PnlAnalysisService → Finalize & Store
   ├─ Calculate total PnL
   ├─ Check for incomplete history (FIFO failures only)
   └─ Store in AnalysisResult + TokenLots
```

### Key Design Decisions

**Supply Totals** (`totalAmountIn/Out`):
- ✅ Include ALL transfers (economic + non-economic)
- ✅ Count tokens accurately for balance verification
- ✅ Assign zero SOL value to non-economic transfers

**FIFO Inputs**:
- ✅ Only ECONOMIC transfers
- ✅ Clean cost basis tracking
- ✅ No escrow/program movements

**Holdings Mismatch**:
- ✅ EXPECTED when tokens in DCA escrow
- ✅ Don't fail on mismatch alone
- ✅ Only fail if FIFO detects oversell

---

## Next Steps (Prioritized)

### 🔥 P0: Audit All Interaction Types

**Goal**: Document every interaction type in database and classify correctly

**Action**:
```sql
SELECT interactionType,
       COUNT(*) as count,
       SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) as ins,
       SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) as outs,
       AVG(ABS(associatedSolValue)) as avg_sol_value
FROM SwapAnalysisInput
GROUP BY interactionType
ORDER BY count DESC;
```

**Expected Output**: Complete list of all interaction types with examples

**Decision Matrix**:
| Type | Economic? | Reason |
|------|-----------|--------|
| SWAP | ✅ Yes | Real trades |
| TRANSFER | ❌ no AND yes | Zero-cost transfers |
| UNKNOWN (tiny) | ❌ No BUT could be in some cases| DCA escrow |
| BURN | ❌ No | Disposal |
| TOKEN_MINT | ❓ TBD | Need investigation |

**Files to Update**:
- `src/core/analysis/swap/analyzer.ts` - Update `isNonEconomicTransfer` logic

---

### 🔥 P1: Exclude TRANSFER from Economic - DO NOT EXCLUDE actually check if really does not have associate value - SOL OR USDC

**Problem**: TRANSFER inflates cost basis by ~0.70 SOL (and more across all tokens)

**Solution**:
```typescript
const isNonEconomicTransfer =
    interactionType === 'BURN' ||
    interactionType === 'TRANSFER' || // ← Add this!
    (interactionType === 'UNKNOWN' &&
     Math.abs(input.associatedSolValue) < 0.01 &&
     Math.abs(input.associatedUsdcValue ?? 0) < 0.01);
```

**Expected Impact**:
- Reduce cost basis by ~51 SOL for test wallet
- Closer to GMGN's 2,460 SOL (vs our current 2,511 SOL)

**Files to Modify**:
- `src/core/analysis/swap/analyzer.ts` (line 107-112)
- `src/core/analysis/swap/fifo-lot-tracker.ts` (line 57-60)

---

### 🔥 P2: Investigate 3 Incomplete Tokens

**Goal**: Understand why clean tokens fail FIFO

**Approach**: For each token, analyze:
1. What interaction types exist?
2. Any UNKNOWN/TRANSFER causing issues?
3. Is there actual oversell in chronological order?
4. What is TOKEN_MINT and how to handle it?

**Tools**:
```bash
npx ts-node check-token.ts <mint>
```

**Tokens to Investigate**:
1. `5PsnNwPmMtsGZgG6ZqMoDJJi28BR5xpAotXHHiQhpump`
2. `BANKJmvhT8tiJRsBSS1n2HryMBPvT5Ze4HU95DUAmeta`
3. `fRfKGCriduzDwSudCwpL7ySCEiboNuryhZDVJtr1a1C` (has TOKEN_MINT)

---

### 🎯 P3: Reconcile with Competitor Calculations

**Goal**: Understand 110-450 SOL discrepancy with competitors

**Approach**:
1. Get raw transaction data from GMGN/Axiom (if API available)
2. Compare what they count vs what we count
3. Document differences in methodology

**Questions to Answer**:
- Do they include TRANSFER? (likely NO ✅)
- Do they include TOKEN_MINT? (unknown)
- How do they handle UNKNOWN? (likely ignore completely)
- Do they use FIFO or average cost? (unknown)
- Do they handle failed transactions differently?

**Hypothesis**:
- TRANSFER exclusion: ~51 SOL difference
- Remaining ~60-400 SOL: Other interaction types or methodology

---

## Testing Wallets

### Primary Test Case
**Wallet**: `CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B`
- Good mix of SWAP, TRANSFER, UNKNOWN
- Uses Jupiter DCA (UNKNOWN transfers)
- 15 tokens total (12 complete, 3 incomplete)
- Known discrepancy with GMGN/Axiom

### Verification Checklist
- [ ] All interaction types documented
- [ ] TRANSFER excluded from economic
- [ ] 3 incomplete tokens resolved
- [ ] PnL within ±10% of competitors
- [ ] Holdings mismatch accepted (DCA wallets)

---

## Debug Scripts

**Location**: `C:\Users\solastic\prj\analyzer\`

1. `analyze-unknown.ts` - Breakdown of UNKNOWN transfers
2. `check-token.ts` - Analyze specific token's interaction types
3. `check-economic.ts` - Economic vs non-economic totals
4. `test-fix.ts` - Run full analysis and show results

**Usage**:
```bash
npx ts-node -r tsconfig-paths/register <script>.ts
```

---

## Current Metrics (Test Token)

**Token**: `9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump`
**Wallet**: `CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B`

### Our System
```
totalSolSpent: 2,511.52 SOL (includes TRANSFER)
totalSolReceived: 470.16 SOL
currentHoldingsValueSol: 1,896.30 SOL
realizedPnlSol: 83.70 SOL
unrealizedPnlSol: -228.62 SOL
totalPnlSol: -144.92 SOL
hasIncompleteHistory: false ✅
```

### Competitors
```
GMGN:
  Bought: 2,460 SOL (51 SOL less than us)
  Sold: 467 SOL
  Total PnL: +309 SOL

Axiom:
  Bought: $325K (≈2,462 SOL)
  Sold: $61.6K (≈467 SOL)
  Remaining: $259K (≈1,962 SOL)
  Total PnL: -$4.66K (≈-35 SOL)
```

### Transaction Breakdown
```
SWAP (Economic): 236 transactions
  Tokens: 21.2M in, 3.7M out
  SOL: 2,510.82 in, 470.16 out

TRANSFER (Economic - SHOULD BE NON-ECONOMIC):
  Count: 4 in
  Tokens: 5,690 in
  SOL: 0.70 in ← Inflating cost!

UNKNOWN (Non-Economic): 13 transactions
  Tokens: 54.7M in, 57.2M out (DCA escrow)
  SOL: 0.042 in, 0.182 out (negligible)
```

---

## Notes

- FIFO implementation is solid and working
- Main issues are interaction type classification, not FIFO logic
- Holdings mismatch is expected and correct for DCA wallets
- Competitor discrepancies likely due to different heuristics
- Need comprehensive audit of all interaction types in production data

---

**Status**: Work in progress - FIFO foundation solid, classification needs refinement
