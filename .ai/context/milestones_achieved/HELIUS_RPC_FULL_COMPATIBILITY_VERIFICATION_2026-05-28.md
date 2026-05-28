# Helius RPC-Full Compatibility Verification Plan

Date: 2026-05-28

## Purpose

Verify whether Helius `getTransactionsForAddress` with `transactionDetails: "full"` can replace `/v0/transactions` for holder-profile wallet analysis without unacceptable behavior drift.

This is a verification task, not a production replacement task. Do not switch production sync behavior until the probe proves compatibility.

Current working conclusion: pure replacement is not proven. Enhanced `/v0/transactions` currently provides the exact `HeliusTransaction` shape consumed by `mapHeliusTransactionsToIntermediateRecords`, including `tokenTransfers`, `nativeTransfers`, `accountData`, `events.swap`, `type`, and `feePayer`. RPC-full returns standard transaction + `meta` data, so it must be normalized before the current mapper can consume it.

## Scope

- Target holder-profile wallet sync first.
- Do not change production sync behavior.
- Do not write shadow/probe rows to `SwapAnalysisInput`, `AnalysisResult`, `TokenLot`, `HolderProfileSnapshot`, wallet cursors, or wallet sync state.
- Do not read `.env` files or secrets.
- Use `HELIUS_API_KEY` only if already exported in the shell or explicitly provided by the operator.
- Use existing Enhanced fixtures in `debug_output/` as baseline where possible.
- Add a live read-only probe script only.
- Do not implement provider migration, Helius Wallet API, compressed Enhanced raw cache, or `getTransfersByAddress`.

## Current Repo Facts

- Holder profiles sync stale/missing wallets through `WalletPreparationService.prepareWallet(...)`, which calls `HeliusSyncService`.
- Holder-profile wallet sync currently uses `ANALYSIS_EXECUTION_CONFIG.HOLDER_PROFILES_MAX_SIGNATURES`; operator reduced prod env from `1000` to `700`.
- `HeliusApiClient.getTransactionsBySignatures(...)` calls `/v0/transactions`.
- `HeliusTransactionCache` only stores signature/timestamp, not raw Enhanced transactions.
- The existing mapper is the canonical serving path because downstream projections are built from `SwapAnalysisInput`.
- Existing projections that must not be bypassed:
  - `SwapAnalysisInput`
  - `AnalysisResult`
  - `TokenLot`
  - `WalletPnlSummary`
  - `WalletBehaviorProfile`
  - `HolderProfileSnapshot`

## Enhanced Data Currently Used

The mapper depends on these Enhanced fields:

| Enhanced field | Current use | Replacement risk |
|---|---|---|
| `tokenTransfers` with user/token accounts, mint, amount | Core token row generation, direction, amount, user token-account discovery | Must reconstruct from parsed token instructions and/or token balance deltas |
| `nativeTransfers` | SOL in/out, gross outflow, fee-like native transfers | Partially reconstructable from system instructions and balance deltas |
| `accountData.nativeBalanceChange` | net SOL change, fallback value attribution, WSOL bug mitigation | Reconstructable from `preBalances/postBalances` |
| `accountData.tokenBalanceChanges.userAccount` | wallet token-account discovery and WSOL/stable net changes | Partially reconstructable; may require `tokenAccounts: "balanceChanged"` |
| `events.swap.innerSwaps` | routed swap intermediary value matching | Not reliably reconstructable from RPC-full |
| `events.swap.tokenInputs/tokenOutputs/tokenFees/nativeFees` | fee-payer swap heuristic and route-level value attribution | Not directly available |
| Enhanced `type/source` | interaction type, liquidity filtering, transfer/order handling | Must derive locally and may drift |
| `fee` and `feePayer` | fee calculation and fee-payer heuristic | fee/finality available; heuristic may degrade without swap event |

## Functionality That Can Drift

If RPC-full cannot reconstruct the Enhanced shape accurately, these surfaces can change:

- `associatedSolValue` / `associatedUsdcValue`: routed swaps, stable routes, fee-payer swaps, complex DEX interactions.
- PnL and FIFO lots: cost/proceeds attribution changes affect realized PnL and lot cost basis.
- `currentHoldingsCostBasisSol`: derived from FIFO lots.
- USD enrichment and market-cap behavior: `usdValue`, `marketCapUsd`, `entryMcapUsd`, `typicalEntryMcapUsd`, mcap buckets.
- Holder profiles: `behaviorType`, `medianHoldTimeHours`, `completedCycleCount`, confidence, current-holding fallback behavior.
- Token trade history: buy/sell/transfer labels, SOL/USD values, fee display.
- Similarity capital vectors: uses `associatedSolValue`.
- HUD/profile mcap signals: downstream of enriched mapped rows.

Likely safer areas:

- Basic signature/timestamp coverage if RPC-full discovery includes token-account changes.
- Simple SOL-token swaps.
- Basic SPL transfers and airdrops.
- Current holdings and balances, since those come from balance fetching, not Enhanced transaction parsing.

## Mandatory RPC-Full Probe Shape

Use `getTransactionsForAddress` with:

```json
{
  "transactionDetails": "full",
  "encoding": "jsonParsed",
  "sortOrder": "desc",
  "limit": 100,
  "maxSupportedTransactionVersion": 0,
  "filters": {
    "status": "succeeded",
    "tokenAccounts": "balanceChanged"
  }
}
```

Important: `filters.tokenAccounts: "balanceChanged"` is mandatory for the probe. Without it, wallet-owned token-account activity may be missed, and the comparison can falsely reject RPC-full.

## Probe Script Requirements

Add a read-only script, for example:

```text
scripts/compare-rpc-full-vs-enhanced.ts
```

Inputs:

- `--wallet <address>`
- `--signatures <comma-separated signatures>` and/or `--fixture-dir debug_output`
- `--limit <n>`
- `--out /tmp/helius-rpc-full-compat-report.json`

Rules:

- Fail fast if `HELIUS_API_KEY` is missing from the environment.
- Do not print the API key.
- Do not read `.env`.
- Do not write to DB.
- Do not update wallet cursors or cache tables.
- Output report to `/tmp`.
- Prefer `npx ts-node -r tsconfig-paths/register` when running.

## Probe Algorithm

1. Load fixture signatures from `debug_output/*_raw.json` and matching `*_database_rows.json`, or from `--signatures`.
2. Fetch Enhanced transactions using `/v0/transactions` for the selected signatures.
3. Fetch RPC-full transactions for the wallet/window using `getTransactionsForAddress` with mandatory params above.
4. Match RPC-full results to requested signatures.
5. Normalize RPC-full transactions into the minimum `HeliusTransaction` compatibility shape:
   - `signature`
   - `slot`
   - `timestamp`
   - `fee`
   - `feePayer`
   - `transactionError`
   - `accountData.nativeBalanceChange`
   - `accountData.tokenBalanceChanges`
   - `tokenTransfers`
   - `nativeTransfers`
   - `instructions` and `innerInstructions`
   - conservative derived `type`
6. Run current mapper in memory:
   - `mapHeliusTransactionsToIntermediateRecords(wallet, enhancedTxs)`
   - `mapHeliusTransactionsToIntermediateRecords(wallet, normalizedRpcFullTxs)`
7. Compare mapper outputs, not persisted DB rows, for primary compatibility.
8. Optionally compare both outputs to existing `*_database_rows.json` fixture expectations to catch current fixture coverage gaps.
9. Write a JSON report and a short console summary.

## Normalizer Expectations

The normalizer should be explicit and conservative.

Required reconstruction:

- Native balance deltas from `meta.preBalances/postBalances` and account keys.
- Token balance deltas from `meta.preTokenBalances/postTokenBalances`.
- User token-account ownership from token balance owner fields when available.
- Parsed SPL token instructions as transfer candidates.
- Parsed system instructions as native transfer candidates.
- Program IDs/accounts from top-level and inner instructions.
- Transaction fee from `meta.fee`.
- Fee payer from first signer/account key.
- `transactionError` from `meta.err`.

Conservative interaction type derivation:

- `TRANSFER`: one-sided token movement with no meaningful value leg.
- `SWAP`: opposite-direction token/value movement involving wallet accounts.
- `CREATE_POOL`: only if instruction/program evidence is clear.
- `UNKNOWN`: ambiguous complex activity.

Do not invent `events.swap.innerSwaps` in v1. Record absence as a failure/limitation when it causes drift.

## Comparison Metrics

Report these globally and per signature:

- Signatures requested.
- Enhanced signatures fetched.
- RPC-full signatures found.
- RPC-full missing signatures.
- Enhanced mapped row count.
- RPC-full mapped row count.
- Exact row matches by `signature/mint/direction/amount`.
- Missing rows.
- Extra rows.
- Aggregate `associatedSolValue` drift by mint/direction.
- Aggregate `associatedUsdcValue` drift by mint/direction.
- `interactionType` drift.
- `feeAmount` / `feePercentage` drift.
- Failure classification:
  - `exact_match`
  - `acceptable_value_drift`
  - `missing_rows`
  - `extra_rows`
  - `value_drift`
  - `interaction_type_drift`
  - `fee_drift`
  - `unmappable`

## Compatibility Acceptance Criteria

Pure RPC-full replacement is acceptable only if:

- >= 99% signature coverage.
- >= 98% exact row match on `signature/mint/direction/amount`.
- <= 3% aggregate SOL/USD value drift per wallet, or absolute drift under `0.02 SOL` / `$2`.
- Economic/non-economic `interactionType` drift on <= 2% of rows.
- Holder-profile-level `behaviorType` unchanged for >= 95% of wallets tested.
- Complex routed swaps and fee-payer swaps do not dominate failures.

If simple swaps and transfers match but routed/fee-payer swaps drift, document RPC-full as suitable only for a cheaper behavior-lite profile, not full replacement.

If unmappable or high-drift signatures are common, do not implement primary RPC-full replacement.

## Required Final Report

The agent must produce a report that answers:

1. Which Enhanced fields cannot be reconstructed from RPC-full?
2. Which app features distort when those fields disappear?
3. What is the exact row match rate?
4. What is the SOL/USD value drift?
5. What is the interaction type drift?
6. Is pure RPC-full replacement viable?
7. If not viable, is behavior-lite viable?
8. If neither is viable, should we keep only telemetry plus reduced holder-profile cap?

## Cost Telemetry Add-On

This is additive and low risk. It can be implemented independently of RPC-full replacement.

Add Prometheus metrics:

- `helius_requests_total{endpoint,workflow,status}`
- `helius_estimated_credits_total{endpoint,workflow}`
- `helius_transactions_fetched_total{source,workflow}`

Add holder-profile structured logs:

- `jobId`
- `requestId`
- `walletCount`
- `walletsNeedingSync`
- `maxSignatures`
- `enhancedRequests`
- `rpcFullRequests`
- `estimatedCredits`
- `cacheOnly`

Keep Prometheus labels low-cardinality. Do not use wallet, signature, jobId, token mint, or requestId as metric labels.

## Execution Prompt For Next Agent

You are working in `/home/luna/analyzer`. Read `.ai/CONTEXT.md` first and follow AGENTS.md. Production app must stay up. Do not read `.env` files or secrets. Do not mutate production state.

Task: verify whether Helius `getTransactionsForAddress` with `transactionDetails: "full"` can replace `/v0/transactions` for holder-profile wallet analysis.

Start by reading:

- `.ai/context/HELIUS_RPC_FULL_COMPATIBILITY_VERIFICATION_2026-05-28.md`
- `src/core/services/helius-api-client.ts`
- `src/core/services/helius-transaction-mapper.ts`
- `src/core/services/helius-sync-service.ts`
- `src/queues/processors/analysis-operations.processor.ts`
- `src/core/analysis/swap/analyzer.ts`
- `src/core/services/pnl-analysis-service.ts`
- `debug_output/*_raw.json` and matching `*_database_rows.json`

Build a read-only compatibility probe. It must not write to DB and must not change production behavior. Use `HELIUS_API_KEY` only if already exported in the shell or explicitly provided by the operator.

The probe must fetch Enhanced `/v0/transactions` and RPC-full `getTransactionsForAddress` with:

- `transactionDetails: "full"`
- `encoding: "jsonParsed"`
- `maxSupportedTransactionVersion: 0`
- `filters.status: "succeeded"`
- `filters.tokenAccounts: "balanceChanged"`

Normalize RPC-full into the current `HeliusTransaction` mapper shape, run both Enhanced and normalized RPC-full transactions through `mapHeliusTransactionsToIntermediateRecords`, and produce a report in `/tmp`.

The report must answer:

- Which Enhanced fields cannot be reconstructed?
- Which app features drift if those fields disappear?
- Exact-match rate for mapped rows.
- Value drift for `associatedSolValue` and `associatedUsdcValue`.
- Interaction type drift.
- Whether pure RPC-full replacement is viable, only behavior-lite is viable, or neither is viable.

Do not implement the production replacement. Verification and report only.

