# Helius Transaction Mapper

## Overview

The Helius Transaction Mapper (`src/core/services/helius-transaction-mapper.ts`) is a critical component that transforms raw Helius transaction data into structured `SwapAnalysisInput` records for database storage and analysis. It handles complex swap detection, value attribution, fee calculation, and various edge cases in Solana DeFi transactions.

## Core Responsibilities

1. **Transaction Parsing**: Convert Helius `HeliusTransaction` objects into normalized database records
2. **Value Attribution**: Associate SOL/USDC values with token transfers using multiple heuristics
3. **Swap Detection**: Identify SPL-to-SPL swaps, including those using WSOL as an intermediary
4. **Fee Calculation**: Calculate and attribute network fees and protocol fees to trades
5. **Deduplication**: Prevent duplicate records from being created for the same transaction
6. **Self-Healing**: Auto-correct data inconsistencies from external APIs (see Helius Bug Mitigation below)

## Main Function Signature

```typescript
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): MappingResult
```

**Returns**: `MappingResult` containing:
- `analysisInputs`: Array of `SwapAnalysisInputCreateData` ready for database insertion
- `stats`: `MappingStats` object with detailed processing statistics

## Processing Pipeline

### 1. Transaction Validation
- Skip transactions with errors (`transactionError !== null`)
- Apply liquidity operation filtering (configurable via `ENABLE_LIQUIDITY_FILTERING`)
- Detect and skip liquidity add/remove operations that aren't actual swaps

### 2. User Account Discovery
Build a `Set<string>` of all accounts belonging to the user:
- Main wallet address
- All token accounts (ATAs) from `accountData` and `tokenTransfers`

### 3. Net Balance Calculation
Calculate net changes across the transaction:
```typescript
finalNetUserSolChange = netNativeSolChange + wsolChange
finalNetUserUsdcChange = usdcChange
```

These values serve as ground truth for validation and self-healing.

### 4. WSOL Movement Analysis

**⚠️ HELIUS API BUG MITIGATION (Critical)**

Helius documentation claims `tokenAmount` in `tokenTransfers` is human-readable (already scaled by decimals), but **sometimes provides raw lamport values** for WSOL instead. This can cause catastrophic errors like assigning -20 million SOL to a wallet for a 0.02 SOL swap.

**Self-Healing Logic** (Lines 489-512, 775-806):

```typescript
if (wsolAmount > 100000) {
    // Likely raw lamports - validate against native balance changes
    const expectedSolChange = Math.abs(finalNetUserSolChange);
    const scaledAmount = wsolAmount / LAMPORTS_PER_SOL;

    // Cross-validate with 20% tolerance
    const tolerance = 0.20;
    const lowerBound = expectedSolChange * (1 - tolerance);
    const upperBound = expectedSolChange * (1 + tolerance);

    if (scaledAmount >= lowerBound && scaledAmount <= upperBound) {
        // CONFIRMED: Raw lamports detected, auto-correct
        wsolAmount = scaledAmount;
        logger.warn(`Helius API bug detected - auto-corrected`);
    } else {
        // Genuine whale transfer (>100k SOL), keep as-is
    }
}
```

**Why 100,000 SOL threshold?**
- Raw lamports are always in millions (1 SOL = 1e9 lamports)
- Legitimate single WSOL transfers rarely exceed 100k SOL
- Provides clear separation between data errors and genuine whale activity

**Why 20% tolerance?**
- Network fees cause small discrepancies
- Multiple WSOL wraps/unwraps in same transaction
- Accounts for routing through intermediary accounts

This validation runs in **two locations**:
1. **Line 489-512**: When calculating `largestWsolTransfer` (used for intermediary pricing)
2. **Line 775-806**: When processing individual WSOL token transfers

### 5. SPL-to-SPL Swap Detection

Detects token-to-token swaps that use WSOL as an intermediary:

```typescript
const hasTokensInBothDirections =
    userNonWsolTokensOut.size > 0 && userNonWsolTokensIn.size > 0;
const isApproximatelyDouble =
    Math.abs(absSolChange - (2 * largestWsolTransfer)) / absSolChange < 0.20;

if (hasTokensInBothDirections && largestWsolTransfer > 0 &&
    (isApproximatelyDouble || hasReasonableTokenCount)) {
    isSplToSplSwap = true;
    correctSolValueForSplToSpl = largestWsolTransfer;
}
```

**Heuristic**: If user sends Token A and receives Token B, and the net SOL change is approximately double the largest WSOL transfer, it indicates:
1. Wrapped SOL to buy intermediate WSOL
2. Swapped WSOL for target token
3. Unwrapped remaining WSOL back to SOL

### 6. Event Matcher

Attempts to find consistent intermediary SOL/USDC values from `tx.events.swap.innerSwaps`:

```typescript
const eventResult = findIntermediaryValueFromEvent(tx, userAccounts, stats);
```

Returns:
- `solValue` or `usdcValue`: The matched intermediary value
- `primaryOutMint`: Token user sold
- `primaryInMint`: Token user bought

**Logic**:
1. Identify user's primary IN/OUT tokens from top-level transfers
2. Scan `innerSwaps` for WSOL/USDC amounts associated with these tokens
3. Check consistency: amounts from "sell" leg should match "buy" leg (within 1% tolerance)
4. Return matched value if consistent, otherwise return zeros

### 7. Native SOL Transfer Processing

Process native SOL transfers (lamport movements) as distinct records:

```typescript
// Filter dust amounts
if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue;

const amount = lamportsToSol(rawLamports);
const associatedSolValue = amount; // Native SOL's value is itself
```

### 8. Fee Payer Heuristic

When the tracked wallet is the `feePayer` for a swap, attribute the swap to them even if token accounts don't directly show ownership:

**Use Case**: Jupiter/routing contracts where user pays fees but tokens route through intermediary accounts.

```typescript
if (isFeePayerWalletA && tx.events?.swap) {
    const heuristicAssociatedSolValue = /* derive from swap event */;

    // Attribute INPUT tokens as 'out' from user
    // Attribute OUTPUT tokens as 'in' to user
}
```

### 9. Token Transfer Processing & Value Attribution

For each SPL token transfer involving the user:

**Tiered Value Attribution Strategy**:

```typescript
if (isWsol) {
    // Apply self-healing bug mitigation (see section 4)
    associatedSolValue = wsolAmount;
} else if (isUsdc) {
    associatedUsdcValue = usdcAmount;
} else {
    // Non-WSOL/USDC tokens - use tiered logic:

    // Tier 1: SPL-to-SPL swap detection
    if (isSplToSplSwap) {
        associatedSolValue = correctSolValueForSplToSpl;
    }
    // Tier 2: Event matcher
    else if (eventResult.solValue > 0 && matchesPrimaryMints) {
        associatedSolValue = eventResult.solValue;
    }
    // Tier 3: Total movement heuristic
    else if (totalWsolMovement >= threshold) {
        associatedSolValue = totalWsolMovement;
    }
    // Tier 4: Net user change fallback
    else {
        associatedSolValue = Math.abs(finalNetUserSolChange);
    }
}
```

### 10. Fee Calculation

For non-WSOL/USDC transfers with associated SOL value:

```typescript
let refinedFeeAmountSol = 0;

// Network fee
if (tx.fee > 0 && tx.feePayer === walletAddress) {
    refinedFeeAmountSol += tx.fee / LAMPORTS_PER_SOL;
}

// Small native transfers OUT (tips, routing fees)
for (const nativeTransfer of tx.nativeTransfers) {
    if (isFromUser && amountSol < FEE_TRANSFER_THRESHOLD_SOL) {
        refinedFeeAmountSol += amountSol;
    }
}

feePercentage = (refinedFeeAmountSol / associatedSolValue) * 100;
```

### 11. Small Outgoing Transfer Heuristic

Identifies likely fee transfers using comparative analysis:

```typescript
// If this transfer is < 5% of the largest transfer of the same mint
if (currentAmount < TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmountForMint) {
    // Likely a fee/tip, zero out value to prevent double-counting
    associatedSolValue = 0;
    associatedUsdcValue = 0;
}
```

### 12. Proportional Value Redistribution

**NEW (2025-06-24)**: After all records for a transaction are created, redistribute values proportionally across multiple chunks of the same `mint+direction`:

```typescript
// For each mint+direction bucket with multiple transfers:
const valuePerToken = bucket.totalSol / valueDistributionAmount;

// Redistribute proportionally by amount
row.associatedSolValue = Math.abs(row.amount) * valuePerToken;
```

**Purpose**: Ensures aggregate SOL/USDC value is correct when the same token appears in multiple transfer chunks, preventing under/over-counting.

### 13. Filtering & Cleanup

**Definitive Filtering Rules**:

1. **Remove SOL/USDC from DeFi transactions**:
   - If transaction involves any non-SOL/USDC token, remove SOL/USDC records
   - Rationale: SOL/USDC movements are pricing mechanisms, not assets

2. **Remove SOL/USDC dust transfers**:
   - Filter `TRANSFER` type with amount < `SOL_DUST_TRANSFER_THRESHOLD`

3. **Scam token filtering**:
   - Remove tokens with `associatedSolValue < 0.001 SOL` (unless USDC/USDT)
   - Prevents spam airdrop tokens from polluting analysis

## Configuration Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `NATIVE_SOL_LAMPORT_THRESHOLD` | Configurable | Minimum lamports for native transfer to be recorded |
| `FEE_PRECISION_THRESHOLD` | 0.000000001 | Avoid assigning near-zero fees |
| `FEE_TRANSFER_THRESHOLD_SOL` | 0.1 SOL | Native transfers OUT below this = likely fees/tips |
| `TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD` | 0.05 (5%) | Small outgoing transfer detection |
| `FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_SOL` | 0.1 SOL | Min SOL value for fee-payer heuristic |
| `SOL_DUST_TRANSFER_THRESHOLD` | Configurable | Min SOL for standalone transfer record |

## Statistics Tracked

The `MappingStats` object tracks 20+ metrics including:

- Transaction counts (received, processed, skipped, errors)
- Transfer type counts (native, WSOL, USDC, other SPL)
- Heuristic application counts (fee payer, small outgoing, SPL-to-SPL)
- Value attribution sources (event matcher, net change, movement, etc.)
- Event matcher statistics (attempts, successes, ambiguous, failures)
- Interaction type breakdown (SWAP, TRANSFER, CREATE_POOL, etc.)

## Performance Characteristics

- **Complexity**: O(N) where N = number of token transfers
- **Memory**: Linear with transaction count
- **Speed**: Processes ~1000 transactions/second on modern hardware
- **Bottleneck**: Database insertion, not mapping logic

## Known Edge Cases

### 1. Multi-Hop Swaps
**Issue**: Token A → WSOL → USDC → Token B shows multiple intermediaries
**Handling**: Event matcher picks most consistent value, proportional redistribution ensures correctness

### 2. Liquidity Operations
**Issue**: Add/remove liquidity looks like token swaps
**Handling**: Liquidity filtering detects same-direction token flows and excludes them

### 3. Wrapped SOL Wrap/Unwrap
**Issue**: Wrapping SOL → WSOL shows as token transfer
**Handling**: WSOL transfers get `associatedSolValue = amount` directly

### 4. Routing Through Multiple Accounts
**Issue**: Swap routes through intermediary accounts not owned by user
**Handling**: Fee payer heuristic attributes tokens to the user who paid for the transaction

### 5. Helius API Inconsistencies
**Issue**: WSOL `tokenAmount` sometimes provided as raw lamports instead of scaled
**Handling**: Self-healing validation against native balance changes (see section 4)

## Debugging

### Using the Debug Mapper Script

```bash
npm run debug:mapper -- <txId> -w <walletAddress>
```

**Outputs**:
- `debug_output/<txId>_raw.json`: Raw Helius transaction data
- `debug_output/<txId>_database_rows.json`: Mapped records
- `debug_output/<txId>_stats.json`: Mapping statistics

**Console Output**: Table view of mapped records showing all fields

### Common Issues

**Issue**: Negative SOL balance
**Cause**: Value double-counted across multiple transfer chunks
**Fix**: Proportional redistribution (already implemented)

**Issue**: Missing SOL value for token
**Cause**: No WSOL movement, no event data, zero net change
**Fix**: Check if token was received via airdrop (legitimate zero-value case)

**Issue**: Millions of SOL assigned
**Cause**: Helius API bug (raw lamports in `tokenAmount`)
**Fix**: Self-healing logic auto-corrects (implemented Oct 2025)

## Related Files

- `src/types/helius-api.ts`: TypeScript interfaces for Helius data
- `src/config/constants.ts`: Configuration thresholds
- `scripts/debug_mapper.ts`: Debug script for testing
- `src/core/utils/logger.ts`: Logging utility

## Maintenance Notes

### When to Update This Mapper

1. **Helius API Changes**: If Helius modifies transaction data structure
2. **New Swap Patterns**: When new DEXes introduce unique routing patterns
3. **Fee Structure Changes**: If Solana network fees or DEX fees change significantly
4. **Performance Issues**: If processing speed degrades on large transaction volumes

### Testing New Changes

Always test with `debug_mapper` script before deploying:

```bash
# Test problematic transaction
npm run debug:mapper -- <txId> -w <wallet>

# Verify:
# 1. associatedSolValue is reasonable (not millions)
# 2. No duplicate records
# 3. Fees calculated correctly
# 4. Stats show expected heuristic applications
```

## Changelog

### October 2025 - WSOL Self-Healing
- **Issue**: Helius occasionally provides raw lamports instead of human-readable WSOL amounts
- **Solution**: Cross-validation against native balance changes with 20% tolerance
- **Impact**: Prevents catastrophic balance calculation errors
- **Files Modified**: Lines 489-512, 775-806

### June 2025 - Proportional Redistribution
- **Issue**: Multiple transfer chunks of same token caused double-counting
- **Solution**: Aggregate then redistribute values proportionally by amount
- **Impact**: Ensures accurate SOL value attribution across chunked transfers

### May 2025 - Scam Token Filtering
- **Issue**: Airdrop spam tokens polluting analysis
- **Solution**: Filter tokens with `associatedSolValue < 0.001 SOL`
- **Impact**: 10-30% reduction in database records, cleaner analysis

---

**Last Updated**: October 27, 2025
**Maintainer**: Core Team
**Related Docs**:
- [Helius API Reference](https://docs.helius.dev/)
- [Database Schema](../database/README.md)
- [Configuration Guide](../../config/README.md)
