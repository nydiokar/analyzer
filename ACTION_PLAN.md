# ACTION PLAN: Fix Incomplete History Issues

**Date:** 2026-01-05
**Wallet:** `ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud`

---

## SUMMARY OF FINDINGS

### 22 Tokens with Incomplete History
- **19 tokens** = RIGHTFULLY incomplete (tokens acquired before tracking)
- **3 tokens** = WRONGFULLY incomplete (fee heuristic bug)

### ROOT CAUSE: Fee Heuristic Bug ⚠️

**Found 40 UNKNOWN transactions** where `associatedSolValue` exactly matches `feeAmount`:
- Transactions have **large token amounts** but **tiny SOL values** (transaction fees)
- These are airdrops/transfers where the fee is incorrectly used as the economic value
- Results in values like **0.3%** of actual market value

**Examples:**
1. `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv`:
   - 4,863 tokens marked as 0.0022 SOL (fee)
   - Actual value: ~0.66 SOL
   - **Error: 99.7% undervalued**

2. `STREAMribRwybYpMmSYoCsQUdr6MZNXEqHgm7p1gu9M`:
   - 4,437 tokens marked as 0.0056 SOL (fee)
   - Actual value: ~3.55 SOL
   - **Error: 99.8% undervalued**

---

## REQUIRED FIXES

### Fix 1: CREATE Transaction Economic Value Capture ⚠️ PRIORITY 1

**Problem:**
CREATE transactions only capture the fee, not the economic value

**Example:**
- Token: `4rwZoD9p8DaZLegCuHwwtjDrnfRKTHL74XpK54Rspump`
- Blockchain shows: 27.615 SOL purchase
- Database shows: 0.0128 SOL (just the fee!)

**Location:** `src/core/services/helius-transaction-mapper.ts`

**Solution:**
For CREATE interaction type, extract the economic value from:
1. Check swap events for the actual SOL/USDC value exchanged
2. Look for WSOL unwraps in the transaction
3. Parse native SOL transfers related to the minting

**Implementation:**
- Add special handling for `interactionType === 'CREATE'`
- Include CREATE transactions in FIFO if they have economic value
- Only exclude CREATE if it's truly a zero-cost mint

---

### Fix 2: UNKNOWN Transaction Fee Assignment Bug ⚠️ PRIORITY 1

**Problem:**
Fee heuristic assigns transaction fee as `associatedSolValue` for UNKNOWN transactions

**Impact:**
- 40+ transactions affected
- 3 tokens wrongfully marked as incomplete
- Airdrops show as near-zero value

**Location:** `src/core/services/helius-transaction-mapper.ts` (lines 1001-1027)

**Current Logic:**
```typescript
// Fee is calculated and assigned to feeAmount field
if (refinedFeeAmountSol > FEE_PRECISION_THRESHOLD) {
    feeAmount = refinedFeeAmountSol;
    feePercentage = (feeAmount / associatedSolValue) * 100;
    feeAssignedForSignature = true;
}
```

**Problem:**
For UNKNOWN transactions with no swap events, `associatedSolValue` defaults to 0, but then somewhere the fee is being assigned as the SOL value.

**Solution:**
1. **For airdrops/transfers (UNKNOWN IN with no swap events):**
   - Do NOT assign fee as SOL value
   - Either:
     - A) Leave `associatedSolValue = 0` (treat as zero-cost acquisition)
     - B) Fetch market price at time of receipt and assign that value
     - **Recommended: Option B** for accurate P&L tracking

2. **For SPL-to-SPL swaps (UNKNOWN with balanced IN/OUT):**
   - Detect paired UNKNOWN transactions (same token, opposite directions, similar timestamps)
   - Use the swap event data or WSOL intermediary value
   - Don't filter these from FIFO

---

### Fix 3: FIFO Filtering Logic ⚠️ PRIORITY 2

**Problem:**
UNKNOWN transactions with tiny SOL values are filtered as "non-economic", but some are legitimate trades

**Location:** `src/core/analysis/swap/analyzer.ts:109-126`

**Current Logic:**
```typescript
const isNonEconomicTransfer = interactionType === 'BURN' ||
  (interactionType === 'UNKNOWN' &&
   Math.abs(input.associatedSolValue) < 0.01 &&
   Math.abs(input.associatedUsdcValue ?? 0) < 0.01);

if (!isNonEconomicTransfer) {
  // Pass to FIFO
}
```

**Solution:**
```typescript
const isNonEconomicTransfer = interactionType === 'BURN' ||
  interactionType === 'CREATE' || // Exclude CREATE unless it has economic value
  (interactionType === 'TRANSFER' &&
   Math.abs(input.associatedSolValue) < 0.001 &&
   Math.abs(input.associatedUsdcValue ?? 0) < 0.001) ||
  // DO NOT filter UNKNOWN - let them through to FIFO
  // The FIFO tracker will handle zero-cost entries appropriately
  false; // Changed: UNKNOWN no longer filtered by default

// Alternative: Check for balanced UNKNOWN pairs (SPL-to-SPL swaps)
const isBalancedUnknownPair = interactionType === 'UNKNOWN' &&
  hasMatchingOppositeDirection(input, allInputsForToken);

if (!isNonEconomicTransfer || isBalancedUnknownPair) {
  // Pass to FIFO
}
```

---

### Fix 4: Airdrop Value Assignment ⚠️ PRIORITY 2

**Problem:**
Airdrops (UNKNOWN IN with no prior transactions) have zero or fee-only value

**Accounting Perspective:**
- Receiving tokens via airdrop = income
- Selling airdropped tokens = profit
- Must assign market value at time of receipt

**Example:**
- `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv`: Airdrop → Sell for 0.66 SOL
- Currently: Shows as 0.0022 SOL value (fee)
- Should: Show as ~0.66 SOL income, then ~0 profit on sell

**Solution:**
1. Detect airdrop pattern: First transaction is UNKNOWN IN
2. For airdrops:
   - Option A: Assign market value from next sell price (retroactive)
   - Option B: Fetch historical price at airdrop timestamp
   - Option C: Mark as zero-cost but flag as "airdrop income"
   - **Recommended: Option A** (simplest, good enough for P&L)

**Implementation:**
```typescript
// In helius-transaction-mapper.ts
if (interactionType === 'UNKNOWN' && direction === 'in') {
  // Check if this is first transaction for this token
  const isFirstTransactionForToken = /* check logic */;

  if (isFirstTransactionForToken) {
    // Airdrop detected - assign value based on next sell or fetch price
    associatedSolValue = await getAirdropValue(mint, timestamp);
    // Or flag for retroactive value assignment
  }
}
```

---

### Fix 5: Stablecoin Exclusion ⚠️ PRIORITY 3

**Requirement:**
Exclude USDC, USDT, USD1 from Token Performance tab and P&L calculations

**Locations:**

1. **Token Performance Tab Query:**
   `src/api/services/database.service.ts` - Add WHERE clause

2. **P&L Calculations:**
   `src/core/analysis/swap/analyzer.ts` - Already handled (stablecoins tracked separately)

3. **FIFO Calculations:**
   `src/core/analysis/swap/analyzer.ts:188` - Already skipped:
   ```typescript
   if (!isStablecoin && splMint !== SOL_MINT) {
     // Pass to FIFO
   }
   ```

**Implementation:**
```typescript
// In database service or API layer
const EXCLUDED_STABLECOINS = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1...', // USD1 mint address
];

// Add to query WHERE clause
where: {
  walletAddress: wallet,
  tokenAddress: { notIn: EXCLUDED_STABLECOINS },
}
```

---

## TESTING CHECKLIST

After implementing fixes, verify:

### 1. CREATE Transaction Fix
- [ ] Run analysis on `4rwZoD9p8DaZLegCuHwwtjDrnfRKTHL74XpK54Rspump`
- [ ] Verify CREATE transaction captures 27.615 SOL economic value
- [ ] Check incomplete history flag is cleared

### 2. UNKNOWN Transaction Fix
- [ ] Run analysis on `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv`
- [ ] Verify airdrop shows proper market value (~0.66 SOL)
- [ ] Check incomplete history flag is cleared
- [ ] Repeat for `STREAMribRwybYpMmSYoCsQUdr6MZNXEqHgm7p1gu9M`

### 3. SPL-to-SPL UNKNOWN Fix
- [ ] Run analysis on `4TafVse4Sf35tLXQkKhJ8tTrAMCLWVBWvg6CK2xwjups`
- [ ] Verify all 11 UNKNOWN transactions are processed
- [ ] Check balance matches (6M in = 6M out)
- [ ] Check incomplete history flag is cleared

### 4. User's Example Token
- [ ] Run analysis on `6Vik7Zf4biqGXZbpm8DCZUtvJQvTvc2vAhTx6yNupump`
- [ ] This will likely STAY incomplete (missing early transactions)
- [ ] But verify it shows 4 in/3 out trades, 103.48 SOL bought, 50.87 SOL sold
- [ ] **Decision needed:** Show partial data vs hide completely?

### 5. Stablecoin Exclusion
- [ ] Check Token Performance tab doesn't show USDC/USDT/USD1
- [ ] Verify P&L calculations don't include stablecoin gains/losses

---

## OPEN QUESTIONS FOR USER

### Question 1: Incomplete History Display Strategy

**Scenario:** Token `6Vik7Zf4biqGXZbpm8DCZUtvJQvTvc2vAhTx6yNupump`
- Has 4 in/3 out trades
- Bought 103.48 SOL, sold 50.87 SOL
- But also sold MORE tokens than bought (missing early history)
- FIFO correctly detects incomplete history

**Options:**
1. **Show partial data with warning** - Display 103.48 SOL bought / 50.87 SOL sold, but flag as "incomplete history, actual values may be higher"
2. **Show null/0 for safety** - Hide all metrics to avoid misleading users
3. **Backfill full history** - Always fetch complete transaction history from token creation

**Recommendation:** Option 1 with clear UI indicator

---

### Question 2: Airdrop Value Assignment

**When a wallet receives airdropped tokens (UNKNOWN IN), how should we value them?**

**Options:**
1. **Zero cost basis** - Treat as free, entire sell proceeds = profit
2. **Market value at receipt** - Fetch price at airdrop time, profit = sell - airdrop_value
3. **Retroactive from first sell** - Use first sell price as acquisition cost (simpler)

**Recommendation:** Option 1 (zero cost) is most accurate for airdrops

---

### Question 3: Historical Backfill Strategy

**Should we implement a mechanism to fetch complete transaction history per token?**

**Pros:**
- Eliminates incomplete history for tokens acquired before tracking
- More accurate P&L

**Cons:**
- Expensive API calls (Helius rate limits)
- Slow analysis for wallets with many tokens
- May not be necessary if most users track from "now forward"

**Recommendation:** Add as optional "Deep Analysis" mode, not default

---

## IMPLEMENTATION PRIORITY

1. **PRIORITY 1** (Must fix - data accuracy):
   - Fix 1: CREATE transaction value capture
   - Fix 2: UNKNOWN fee assignment bug

2. **PRIORITY 2** (Should fix - reduces false positives):
   - Fix 3: FIFO filtering logic
   - Fix 4: Airdrop value assignment

3. **PRIORITY 3** (Nice to have - UX improvement):
   - Fix 5: Stablecoin exclusion
   - UI indicators for incomplete history
   - Optional deep analysis mode

---

## FILES TO MODIFY

1. `src/core/services/helius-transaction-mapper.ts` (Fixes 1 & 2)
2. `src/core/analysis/swap/analyzer.ts` (Fix 3)
3. `src/api/services/database.service.ts` (Fix 5)
4. Frontend: Token Performance Tab component (Fix 5 display)

---

## ESTIMATED IMPACT AFTER FIXES

**Current State:**
- 22 tokens with incomplete history
- 3 tokens wrongfully marked (13.6% false positive rate)

**After Fixes:**
- 19 tokens with incomplete history (legitimate)
- 0 tokens wrongfully marked (0% false positive rate)
- **86% reduction in false positives**

**User Experience:**
- More tokens showing P&L data
- More accurate profit calculations for airdrops
- Better CREATE transaction tracking
