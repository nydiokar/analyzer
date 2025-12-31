# P0: P&L Contamination - Misleading Data Across Entire Platform

**Severity**: 🔴 **CRITICAL - P0**
**Discovered**: 2025-12-30
**Status**: DOCUMENTED - Needs immediate fix
**Impact**: Entire platform shows misleading P&L data, affecting trading decisions

---

## TL;DR - The Problem

**The entire platform is showing WRONG P&L calculations for any wallet with partial sells.**

When a wallet:
1. Buys tokens at different prices over time
2. Sells SOME of those tokens (partial exit)
3. Still holds remaining tokens

We show them as **LOSING money when they're actually WINNING**.

### Real Example That Exposed The Bug

**Token**: The Official 67 Coin
**Wallet Activity**:
- Bought: 70 SOL spent total
- Sold: 555 SOL received
- Current Holdings: 236 SOL worth of tokens still held
- **EXPECTED Total Profit**: (555 + 236) - 70 = **+721 SOL** 🟢
- **ACTUAL Shown**: **-80 SOL** 🔴

**We're off by 801 SOL!** That's not a rounding error, that's catastrophic.

### Why This Matters (A LOT)

This is a **trading intelligence tool**, not an accounting tool. People use it to:
- Find profitable wallets to copy
- Avoid wallets that are losing
- Track performance of smart money

**If our P&L is backwards, they're following losers and ignoring winners.**

As the user put it: "everybody is fucking losing big if they hold something and it's price is going up :D if they are losing we will be mostly correct :D ahahha"

---

## Root Cause: No FIFO Cost Basis Tracking

### What We're Missing

We don't track **which specific tokens were sold** (FIFO = First In, First Out).

When someone:
- Buys 100 tokens at $1 each → cost basis: $100
- Buys 100 more at $2 each → cost basis: $200
- Total: 200 tokens, $300 spent, avg cost: $1.50/token

Then sells 100 tokens at $3 each:
- **We calculate**: Sold 100 @ avg $1.50 = cost of $150, profit = $300 - $150 = **+$150**
- **Reality (FIFO)**: Sold the FIRST 100 bought at $1 = cost of $100, profit = $300 - $100 = **+$200**
- **Remaining 100 tokens**: Should have cost basis of $200 (the $2 batch), but we think it's $150

Result: **Realized P&L is wrong, Unrealized P&L is wrong, Total P&L is wrong.**

### Current Broken Formula

```typescript
// WRONG - treats ALL spent as if it was for sold tokens
const avgCostPerToken = totalSolSpent / totalAmountIn;
const costBasisForSoldTokens = totalAmountOut * avgCostPerToken;
realizedPnlSol = solReceivedFromSales - costBasisForSoldTokens - feesPaid;
```

This assumes ALL the cost is for the sold portion, ignoring that we still hold tokens!

### Correct Approach (What We Need)

Track individual token "lots":
```typescript
interface TokenLot {
  tokenAddress: string;
  amountBought: number;
  costBasis: number;  // SOL spent for THIS batch
  timestamp: number;
  amountRemaining: number;  // Decreases as we sell
}
```

When selling, use FIFO to determine which lots are consumed and calculate true realized P&L.

---

## Full Contamination Map

### ✅ PATCHED (Frontend Band-Aid)
1. **Token Performance Tab - Total Profit Column**
   - Location: `dashboard/src/components/dashboard/TokenPerformanceTab.tsx:170-197`
   - Fix: `totalProfit = (totalReceived + currentHoldingsValue) - totalSpent`
   - Status: Shows correct TOTAL without FIFO
   - Limitation: Realized/Unrealized split still wrong

### ❌ INFECTED (Still Showing Wrong Data)

#### 2. Token Performance Tab - Realized Column
- Location: `dashboard/src/components/dashboard/TokenPerformanceTab.tsx:215-229`
- Uses: `item.realizedPnlSol` from backend
- Source: `token-performance.service.ts` uses wrong `netSolProfitLoss`
- Impact: **Shows incorrect realized P&L for every partial sell**

#### 3. Account Summary Card
- Location: `dashboard/src/components/layout/WalletProfileLayout.tsx`
- Uses: `WalletPnlSummary.realizedPnl` (aggregates all tokens)
- Impact: **Wallet header shows wrong total P&L summary**

#### 4. Discover Page - Wallet P&L Metrics
- Location: `dashboard/src/app/discover/page.tsx:779-899`
- Uses: `wallet.metrics.realizedPnl`, `wallet.metrics.unrealizedPnl`
- Impact: **All wallet rankings by P&L are backwards**
- Critical: Users copy wallets based on this data!

#### 5. Trackers Page - Portfolio Overview
- Location: `dashboard/src/app/trackers/page.tsx:118-127, 689-710`
- Aggregates: `totalPnl = sum(wallet.pnl)`
- Impact: **Portfolio performance tracking is wrong**

#### 6. Holder Profiles - Exit Timing Cohort Analysis
- Location: `src/queues/processors/analysis-operations.processor.ts:1308-1316`
- Contamination Path:
  ```typescript
  pnlMap = new Map(
    pnlResults.map(r => [
      r.tokenAddress,
      { pnl: r.netSolProfitLoss, capital: r.totalSolSpent }
    ])
  );
  // Passed to BehaviorAnalyzer → enrichedHoldTimeDistribution
  // Displayed as Win Rate & ROI per time bucket
  ```
- Impact: **Win rates and ROI by exit speed are incorrect**
- Shows in: WalletBaseballCard exit timing tables

---

## The Data Flow (How Contamination Spreads)

```
1. Swap Analyzer calculates P&L
   └─> Stores in AnalysisResult.netSolProfitLoss (WRONG for partial sells)

2. Token Performance Service reads netSolProfitLoss
   └─> Returns to frontend as realizedPnlSol

3. WalletPnlSummary aggregates across all tokens
   └─> Sums up wrong individual values

4. Discover/Trackers pages query WalletPnlSummary
   └─> Display wrong aggregated metrics

5. Holder Profiles builds pnlMap from AnalysisResult
   └─> Calculates wrong win rates and ROI by cohort

6. Frontend displays all this contaminated data
   └─> Users make trading decisions based on wrong information
```

**Single point of failure**: `AnalysisResult.netSolProfitLoss`
**Contamination radius**: Literally everything that shows P&L

---

## Impact Assessment

### Who Gets Hurt

1. **Users tracking "smart money" wallets**
   - Copy wallets that appear profitable but are actually losing
   - Avoid wallets that appear to be losing but are actually winning

2. **Users analyzing token holder cohorts**
   - Wrong win rates by exit timing
   - Wrong ROI by behavioral category
   - Misleading insights about which strategies work

3. **Portfolio tracking**
   - Can't trust aggregate performance metrics
   - Can't compare collections properly
   - Can't track own wallet performance

### Why Simple Averaging Fails

The simple average cost formula breaks when:
- Token price changes significantly during accumulation
- Partial sells happen at different price points
- Large price movements between buy/sell events

It's especially broken for volatile tokens (which is... all crypto).

---

## Solution Options

### Option A: Quick Frontend Patches (BAND-AID)
**Time**: 2-3 hours
**Approach**: Apply same fix as Total Profit to all infected areas
```typescript
// Use available data to compute correct totals
const totalProfit = (totalReceived + currentHoldingsValue) - totalSpent;
```
**Pros**: Fast, shows correct TOTAL profit
**Cons**: Still can't split realized vs unrealized correctly
**Verdict**: ⚠️ Temporarily fixes headlines, doesn't fix root cause

### Option B: Backend Aggregation Fixes (BETTER BAND-AID)
**Time**: 4-6 hours
**Approach**: Fix `WalletPnlSummary` calculations, improve formulas
**Pros**: Centralized fix, affects all consumers
**Cons**: Still fundamentally limited without FIFO
**Verdict**: ⚠️ Reduces error magnitude but doesn't eliminate it

### Option C: Proper FIFO Implementation (THE FIX) ⭐
**Time**: 2-3 days
**Approach**: Implement lot-based cost tracking in swap analyzer

**Changes Required**:
1. **Database Schema**:
   ```sql
   CREATE TABLE TokenLots (
     id SERIAL PRIMARY KEY,
     walletAddress VARCHAR(44),
     tokenAddress VARCHAR(44),
     amountBought DECIMAL,
     costBasisSol DECIMAL,
     purchaseTimestamp INTEGER,
     amountRemaining DECIMAL,  -- Decreases with sells
     lotStatus VARCHAR(20),    -- OPEN, PARTIALLY_SOLD, CLOSED
     ...
   );
   ```

2. **Swap Analyzer Logic**:
   - On BUY: Create new TokenLot
   - On SELL: Consume oldest lots first (FIFO)
   - Track remaining balance per lot
   - Calculate true realized P&L from consumed lots
   - Calculate unrealized P&L from remaining lots

3. **Migration Strategy**:
   - Reprocess existing swap data to create historical lots
   - Use transaction timestamps for FIFO ordering
   - Handle edge cases (airdrops, transfers)

**Pros**:
- Fixes EVERYTHING properly
- Accurate realized vs unrealized split
- Tax reporting becomes possible
- Foundation for advanced features (tax-loss harvesting insights)

**Cons**:
- Requires schema changes
- Need to reprocess historical data
- More complex ongoing calculations

**Verdict**: ✅ **THIS IS THE WAY** - It's P0, so invest the 2-3 days now

### Option D: Document Limitations (UNACCEPTABLE)
**Verdict**: ❌ Hell no. This is a trading tool showing backwards P&L. Can't ship this.

---

## Recommended Action Plan

### Phase 1: Immediate Mitigation (Today)
1. ✅ Document the issue (this file)
2. ⚠️ Consider adding warnings to infected UI areas:
   ```tsx
   <TooltipContent>
     ⚠️ P&L calculations for partial positions may be inaccurate.
     Total profit is correct, but realized/unrealized split uses
     average cost basis instead of FIFO tracking.
   </TooltipContent>
   ```

### Phase 2: Proper FIFO Implementation (This Week)
1. **Design** (4 hours):
   - Schema design for TokenLots table
   - FIFO consumption algorithm
   - Migration strategy for historical data

2. **Implementation** (12 hours):
   - Database migration
   - Update swap analyzer to create/consume lots
   - Update P&L calculation logic
   - Reprocess historical swaps

3. **Testing** (4 hours):
   - Verify against known examples (The Official 67 Coin, VWANCE)
   - Test edge cases (same-day round trips, partial sells)
   - Validate totals match current Total Profit formula

4. **Deployment** (2 hours):
   - Run migration on production database
   - Reprocess all wallet swap data
   - Verify metrics update correctly

**Total**: ~3 days of focused work
**Payoff**: Correct P&L across entire platform, forever

---

## Files to Modify (Phase 2)

### Database
- `prisma/schema.prisma` - Add TokenLots table
- New migration file

### Core Logic
- `src/core/analysis/swap-analyzer.ts` - Implement FIFO lot tracking
- `src/core/services/pnl-analysis-service.ts` - Use lot-based calculations

### Backend Services
- `src/api/services/token-performance.service.ts` - Query from TokenLots
- `src/api/services/wallet-pnl-summary.service.ts` - Aggregate lot-based P&L

### Data Migration
- New script: `src/scripts/migrate-to-fifo-lots.ts`
- Reprocess all existing AnalysisResult records

---

## Testing Strategy

### Test Cases
1. **Simple FIFO**:
   - Buy 100 @ $1, Buy 100 @ $2, Sell 100 @ $3
   - Expected: Realized +$200, Unrealized with $200 cost basis

2. **Multiple Partial Sells**:
   - Buy 100 @ $1, Buy 100 @ $2, Sell 50 @ $3, Sell 50 @ $2.5
   - Verify FIFO order is preserved

3. **Same-Day Round Trip**:
   - Buy and sell same token same day
   - Should close lots properly

4. **The Official 67 Coin** (Real Data):
   - Bought 70 SOL, Sold 555 SOL, Holdings 236 SOL
   - Expected Total: +721 SOL (or close after fees)

5. **VWANCE** (Real Data):
   - Bought 49.35 SOL, Sold 13.37 SOL, Holdings 51 SOL
   - Expected Total: ~+15 SOL

### Validation
- Compare new Total P&L with current "patched" Total Profit formula
- Should match within rounding errors
- Realized + Unrealized should = Total

---

## Why This Is P0

1. **Core Product Value**: Platform exists to identify profitable wallets
2. **Data Integrity**: Wrong P&L = wrong decisions = lost user trust
3. **Blast Radius**: Every page with P&L data is affected
4. **User Impact**: People are copying losing wallets thinking they're winners
5. **Competitive Risk**: Other tools with correct P&L will steal users

No amount of UI polish fixes showing backwards profit/loss data.

---

## Notes

- Frontend "Total Profit" patch in TokenPerformanceTab is correct and should be kept
- FIFO implementation will replace realized/unrealized calculations
- Consider adding "Tax Report" feature once FIFO is in place (nice upsell)
- User quote: "everybody is fucking losing big if they hold something and it's price is going up" 😂💀

---

**Last Updated**: 2025-12-30
**Priority**: P0 - Block everything else
**Owner**: TBD (user plans to work on this)
