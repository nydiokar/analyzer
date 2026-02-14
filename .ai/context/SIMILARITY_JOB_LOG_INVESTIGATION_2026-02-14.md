# Similarity Job Log Investigation (2026-02-14)

## Context

During the holder-profiles → similarity flow on **February 14, 2026 at ~11:12:33 PM**, logs for `sova-backend-api` showed:

- System wallet detection logged twice.
- `DatabaseService.getTransactionsForAnalysis()` fetched **19,416** records, then shortly after fetched **5,717** records for the “same 9 wallets”.
- Shared-token detection and similarity phases appeared to run multiple times.

This document explains what is happening, what is real vs just logging noise, and where there is actual wasted work / avoidable peak memory.

## What The Logs Show (High Level)

1. Similarity queue processor begins work and performs early system wallet detection.
2. Processor performs a transaction-data pre-check:
   - Fetches transaction data for wallets using `excludedMints: []` (no exclusions).
3. Processor calls `SimilarityApiService.runAnalysis(...)`.
4. API service fetches transaction data again:
   - Uses `DEFAULT_EXCLUDED_MINTS`.
5. API service runs similarity twice (in parallel):
   - One run for `vectorType=binary`
   - One run for `vectorType=capital`
6. Each run performs “shared tokens” analysis and other metrics, so logs repeat.

## Key Finding 1: 19,416 vs 5,717 Records Is Caused By Different Query Configs

The two fetches are **not equivalent**.

### Pre-check fetch (wide open)

In `src/queues/processors/similarity-operations.processor.ts`, the processor verifies wallets have transaction data:

- Calls `DatabaseService.getTransactionsForAnalysis(validWalletsWithBalances, { excludedMints: [] })`
- This explicitly disables exclusions.

This explains the larger result: **19,416 SwapAnalysisInput** rows.

### Actual analysis fetch (default exclusions)

In `src/api/services/similarity.service.ts`, `SimilarityApiService.runAnalysis()` creates:

- `config: { excludedMints: DEFAULT_EXCLUDED_MINTS }`

and then calls:

- `DatabaseService.getTransactionsForAnalysis(dto.walletAddresses, config)`

`DEFAULT_EXCLUDED_MINTS` includes WSOL/USDC/USDT and many wrapped/system tokens (`src/config/constants.ts`), which can dramatically reduce row counts. That explains **5,717**.

### Conclusion

The “catch” is: **we are fetching twice with different filters**, but `DatabaseService.getTransactionsForAnalysis()` logs only the wallet count and the row count, not the config. So the logs make it look like “same fetch, different result”.

## Key Finding 2: Shared Token Detection And Pair Count Logs Repeat Because The Service Runs Twice

`SimilarityApiService.runAnalysis()` runs two similarity computations via `Promise.all`:

- `SimilarityService.calculateWalletSimilarityFromTransactions(..., 'binary', ...)`
- `SimilarityService.calculateWalletSimilarityFromTransactions(..., 'capital', ...)`

Each invocation:

- Runs shared token detection (`analyzeSharedTokensInternal`)
- Runs shared token pair counts (`calculateWalletPairCounts`)
- Computes “primary filtered” cosine similarity for the chosen vector type
- Computes additional metrics (historical Jaccard-from-transactions, holdings-based similarity, and filtered holdings)

So the repeated blocks in logs are expected, and interleaving can make it look worse (because both runs are concurrent).

## Key Finding 3: “System Wallet Detection Complete” Appears Twice Due To Two Log Statements

There are two separate “complete” logs:

- One inside `detectSystemWalletsEarly()` (summary “valid wallets, wallets filtered”)
- Another in `processSimilarityFlow()` (summary “valid, invalid (system wallets)”)

This is redundant logging, not duplicate detection work.

## Key Finding 4: There Is Real Wasted Work (And Higher Peak Memory) Even If Nothing Is “Broken”

This is not just a log formatting problem. There are avoidable costs:

### A) Extra full transaction fetch during the processor “pre-check”

The pre-check fetch:

- Loads a potentially large dataset into memory (arrays of TransactionData),
- Uses `excludedMints: []` which maximizes result size,
- And is immediately followed by another fetch for the actual analysis (with exclusions).

If the goal is only “verify at least 2 wallets have any data”, this can be done with a cheap query (count / existence).

### B) Duplicate heavy computations because similarity is run twice

Running both `binary` and `capital` is intentional, but each run currently:

- Recomputes shared tokens / shared counts matrix
- Recomputes holdings similarity (Jaccard + cosine + filtered)
- Recomputes “historical” binary Jaccard-from-transactions

Some of these are either:

- identical across the two runs (holdings presence), or
- not needed twice for the combined result.

### C) Higher peak heap because both runs are concurrent

Because `binary` and `capital` are run with `Promise.all`, intermediate structures can overlap in time, increasing peak heap usage. For 9 wallets it’s likely fine; for larger wallet sets and dense histories it increases OOM risk.

## Risk Assessment

- **Correctness risk (scores wrong):** Low based on code read; the behavior matches code intent.
- **Performance risk:** Medium; repeated work can become significant with larger wallet sets or large transaction histories.
- **Memory risk:** Medium; extra fetch + parallel duplicated computation increases peak heap, even if averages look fine.

## Recommended Fixes (Ordered By Impact / Safety)

1. **Make the processor pre-check cheap and consistent**
   - Replace `getTransactionsForAnalysis(..., { excludedMints: [] })` with an existence check.
   - If you keep the pre-check, use the same exclusions as the analysis to avoid the confusing 19k vs 5.7k mismatch.

2. **Avoid recomputing holdings/historical/shared-token work twice**
   - Add options to skip holdings/historical/shared-token analysis when running the “secondary” vector type.
   - Or refactor to compute shared tokens + holdings similarity once and reuse in both result paths.

3. **Consider sequential execution to reduce peak heap**
   - Run `binary` then `capital` (or vice-versa) instead of `Promise.all` if peak memory becomes a problem.

4. **Improve observability**
   - Update `DatabaseService.getTransactionsForAnalysis()` logs to include:
     - excludedMints count (and maybe whether it’s “default” vs “empty”)
     - timeRange presence
   - This will make “19,416 vs 5,717” obviously explained in logs.

## Code Pointers

- Processor pre-check and call into API:
  - `src/queues/processors/similarity-operations.processor.ts`
- API service config (uses `DEFAULT_EXCLUDED_MINTS`) and dual-run:
  - `src/api/services/similarity.service.ts`
- DB transaction fetch and its logging:
  - `src/core/services/database-service.ts`
- Shared token detection and repeated metrics per run:
  - `src/core/analysis/similarity/similarity-service.ts`
- Excluded mints definition:
  - `src/config/constants.ts`

