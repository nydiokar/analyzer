# FIFO PnL Design

## Goals
- Replace average-cost P&L with FIFO lot cost basis for partial sells.
- Compute realized, unrealized, and total P&L deterministically.
- Ensure total P&L matches the frontend "Total Profit" patch:
  `(totalSolReceived + currentHoldingsValueSol) - totalSolSpent` (gross, before fees).
- Preserve fee treatment semantics explicitly:
  - `totalSolSpent`/`totalSolReceived` are gross.
  - `totalFeesPaidInSol` remains separate.
  - `netSolProfitLoss = totalPnlSol - totalFeesPaidInSol`.
- Eliminate contamination by switching consumers to FIFO-derived fields.

## Data Model
### TokenLot (new)
Stores per-token lots for a wallet.
- `walletAddress`
- `tokenAddress`
- `amountBought`
- `costBasisSol` (gross SOL spent for this lot)
- `purchaseTimestamp`
- `amountRemaining`
- `status` (`OPEN`, `PARTIALLY_SOLD`, `CLOSED`)
- `sourceSignature`
- `createdAt`, `updatedAt`

### AnalysisResult (existing, augmented)
Add FIFO-derived fields:
- `realizedPnlSol` (gross, excludes fees)
- `unrealizedPnlSol` (gross, excludes fees)
- `totalPnlSol` (realized + unrealized, gross, excludes fees)
- `hasIncompleteHistory` (true if sells exceed available lots)

## FIFO Algorithm
### Ordering
Process swap inputs by:
1. `timestamp` ascending
2. `signature` ascending
3. `direction` (`in` before `out`) for deterministic lot creation before consumption

### BUY
Create a new lot with full `amountRemaining`:
```
costBasisSol = associatedSolValue
amountBought = amount
amountRemaining = amount
```

### SELL
Consume from oldest open lots:
- For each lot, consume `min(lot.amountRemaining, sellAmountRemaining)`.
- Cost basis consumed = `consumedAmount * (lot.costBasisSol / lot.amountBought)`.
- If sells exceed total remaining lots, mark `hasIncompleteHistory = true`.

### P&L Outputs
If history is complete:
- `realizedPnlSol = totalSolReceivedFromSales - realizedCostBasisSol`
- `remainingCostBasisSol = sum(lot.amountRemaining * unitCost)`
- `unrealizedPnlSol = currentHoldingsValueSol - remainingCostBasisSol` (when price is available)
- `totalPnlSol = realizedPnlSol + unrealizedPnlSol`
- `netSolProfitLoss = totalPnlSol - totalFeesPaidInSol`

If history is incomplete:
- Compute realized PnL for the matched portion only.
- Preserve `hasIncompleteHistory = true`.
- Unmatched sells do not contribute to proceeds.
- Consumers should flag these tokens as partial; ranking usage is a product choice.

## Fees Policy
- Fees remain separate and are subtracted only in `netSolProfitLoss`.
- Realized/unrealized/total are **gross** (pre-fee), matching the frontend "Total Profit" formula.

## Edge Cases
- Airdrops/transfers-in with zero SOL basis: create lots with `costBasisSol = 0`.
- Transfers-out without proceeds: consume lots at zero proceeds (realized loss).
- Same-timestamp ordering uses signature + direction for determinism.
- Negative balances / missing history: mark `hasIncompleteHistory` and exclude from ranking metrics.

## Migration / Reprocessing
1. Add `TokenLot` table and new AnalysisResult columns.
2. Backfill lots and FIFO P&L from historical swaps (timestamp order).
3. Update all reads to FIFO-derived fields.
4. Keep `netSolProfitLoss` as a correct legacy alias: `totalPnlSol - totalFeesPaidInSol`.

## Rollout Steps
1. Deploy schema + code that writes lots (reads still compatible).
2. Run backfill script to populate lots and FIFO P&L.
3. Switch consumers to FIFO-derived fields.
4. Monitor incomplete-history counts and exclude where necessary.
