# Refactoring Plan: Phase 1 - Helius On-Chain Data

This document outlines the specific code changes required to implement Phase 1 of the Solana Wallet Swap Analysis pipeline, focusing on extracting on-chain data using the Helius API and removing P/L-specific logic.

**Goal:** Restructure the application to reliably fetch, process, and analyze SWAP transactions based on token movements, producing an intermediate dataset and on-chain reports.

**Key Changes Summary:**

*   Modify the transaction mapping to produce a lean `IntermediateSwapRecord` format, focusing only on token transfers within swaps.
*   Create a new CSV export for this intermediate data.
*   Refactor the analysis service and reporting to calculate and display on-chain metrics (net flow, counts, timestamps) instead of P/L.
*   Remove functions and types related to the previous P/L-focused analysis and detailed `TransferRecord` format.

--- 

## Changes by File:

**1. `src/services/helius-api-client.ts`**

*   **Status:** No changes required.
*   **Confirmation:** The existing two-step fetch process (`getSwapSignaturesForAddress` -> `getTransactionsBySignatures`) correctly fetches `HeliusTransaction[]` objects for `SWAP` type transactions.
*   **Output Confirmed:** It filters these transactions client-side (`tx.tokenTransfers && tx.tokenTransfers.length > 0`) before returning the array, ensuring the output contains only SWAPs relevant to token movements.

**2. `src/services/helius-transaction-mapper.ts`**

*   **Refactor:** `mapHeliusTransactionsToTransferRecords`
    *   **Input:** `walletAddress: string`, `transactions: HeliusTransaction[]` (Output from HeliusApiClient).
    *   **Output:** `IntermediateSwapRecord[]`.
    *   **Logic Change:**
        *   Iterate through each `HeliusTransaction` in the input array.
        *   For each transaction, iterate through its `tx.tokenTransfers` array.
        *   For *each* `tokenTransfer`, create one `IntermediateSwapRecord` object:
            *   `signature`: from `tx.signature`.
            *   `timestamp`: from `tx.timestamp`.
            *   `mint`: from `transfer.mint`.
            *   `amount`: from `transfer.tokenAmount` (ensure this is the raw amount).
            *   `decimals`: Extract from `tx.accountData` matching the `mint` (as currently done) or default if not found.
            *   `direction`: Determine if `'in'` or `'out'` based on comparing `transfer.toUserAccount`/`transfer.fromUserAccount` with `walletAddress`.
        *   **REMOVE** any logic processing `tx.nativeTransfers`.
        *   **REMOVE** date filtering options (simplification for Phase 1, can re-add later if needed).
*   **New Function:** `saveIntermediateRecordsToCsv(records: IntermediateSwapRecord[], walletAddress: string): string`
    *   **Input:** `IntermediateSwapRecord[]`, `walletAddress`.
    *   **Logic:**
        *   Create a CSV header: `signature,timestamp,mint,amount,decimals,direction`.
        *   Format each `IntermediateSwapRecord` into a CSV row.
        *   Create filename: `data/intermediate_swaps_{walletAddress}_{Date.now()}.csv`.
        *   Ensure the `data` directory exists.
        *   Write the CSV file.
    *   **Output:** Path to the saved CSV file.

**3. `src/services/transfer-analyzer-service.ts`**

*   **Delete Function:** `saveTransferRecordsToCsv`.
*   **Delete Function:** `isLikelyAirdrop`.
*   **Delete Function:** `aggregateTransactionTypes`.
*   **Delete Function/Rework:** `createWalletPerformanceSummary` (Remove entirely for Phase 1 simplicity).
*   **Refactor Function:** `analyzeTransferRecords` (Rename maybe to `analyzeSwapRecords`?)
    *   **Input:** `records: IntermediateSwapRecord[]`.
    *   **Output:** `OnChainAnalysisResult[]` (New interface defined in types).
    *   **Logic Change:**
        *   Group input records by `mint`.
        *   For each group (token):
            *   Calculate `totalAmountIn`, `totalAmountOut`, `netAmountChange` (summing `amount` based on `direction`).
            *   Calculate `transferCountIn`, `transferCountOut`.
            *   Find `firstTransferTimestamp` (min timestamp for this mint).
            *   Find `lastTransferTimestamp` (max timestamp for this mint).
        *   **REMOVE** all P/L calculation logic (`totalValueIn`, `totalValueOut`, `netValueChange`).
*   **Refactor Function:** `writeAnalysisResultsToCsv`
    *   **Input:** `results: OnChainAnalysisResult[]`, `walletAddress: string`.
    *   **Logic Change:**
        *   Update CSV filename convention if desired (e.g., `analysis_reports/onchain_report_{walletAddress}_{Date.now()}.csv`).
        *   Update CSV Headers: `Token Address`, `Total Amount In`, `Total Amount Out`, `Net Amount Change`, `Transfers In`, `Transfers Out`, `First Seen`, `Last Seen`.
        *   Format `OnChainAnalysisResult` data accordingly (convert amounts using decimals, format timestamps).
        *   **REMOVE** P/L columns and logic.
        *   **REMOVE** `possiblyAirdrop` column.
        *   **REMOVE** transaction type summary logic (deleted `aggregateTransactionTypes`).

**4. `src/scripts/helius-analyzer.ts`**

*   **Refactor:** `analyzeWalletWithHelius`
    *   **Flow Change:**
        1. Call `heliusClient.getAllTransactionsForAddress` -> `HeliusTransaction[]`
        2. Call `mapHeliusTransactionsToTransferRecords` (reworked) -> `IntermediateSwapRecord[]`
        3. Call `saveIntermediateRecordsToCsv` (new) -> Saves intermediate file.
        4. Call `analyzeTransferRecords` (reworked, using `IntermediateSwapRecord[]`) -> `OnChainAnalysisResult[]`
        5. Call `writeAnalysisResultsToCsv` (reworked, using `OnChainAnalysisResult[]`) -> Saves on-chain report CSV.
    *   **REMOVE** options/logic related to `excludeAirdrops`.
    *   **REMOVE** call to `aggregateTransactionTypes` and its display logic.
    *   **Update** calls to `displaySummary` / `displayDetailedResults` (from `cli/display-utils.ts`) to pass `OnChainAnalysisResult[]` and potentially update what they display.
    *   Adjust log messages and final report messages.

**5. `src/types/helius-api.ts`**

*   **New Interface:** `IntermediateSwapRecord`
    ```typescript
    interface IntermediateSwapRecord {
      signature: string;
      timestamp: number; 
      mint: string;
      amount: number; // Raw amount
      decimals: number;
      direction: 'in' | 'out';
    }
    ```
*   **New Interface:** `OnChainAnalysisResult`
    ```typescript
    interface OnChainAnalysisResult {
      tokenAddress: string; // mint
      // tokenSymbol?: string; // Optional: Can add later if we fetch symbols
      totalAmountIn: number; // Adjusted amount
      totalAmountOut: number; // Adjusted amount
      netAmountChange: number; // Adjusted amount
      transferCountIn: number;
      transferCountOut: number;
      firstTransferTimestamp: number; // Unix timestamp
      lastTransferTimestamp: number; // Unix timestamp
    }
    ```
*   **Delete Interface:** `TransferRecord`.
*   **Delete Interface:** `AnalysisResults`.

**6. `src/cli/display-utils.ts`**

*   **Refactor:** `displaySummary`
    *   Input: `results: OnChainAnalysisResult[]`, `walletAddress: string`.
    *   Logic: Display overall counts (e.g., number of unique tokens swapped) and maybe top tokens by interaction count or net amount change. Remove P/L display.
*   **Refactor/Delete:** `displayDetailedResults`
    *   Input: `results: OnChainAnalysisResult[]`.
    *   Logic: Update to display fields from `OnChainAnalysisResult`. Decide if this detailed view is still needed for Phase 1 or simplify/remove.

**7. `docs/` Directory**

*   **Add File:** `analysis_pipeline.md` (Created in previous step).
*   **Add File:** `refactoring_plan_phase1.md` (This file).

--- 

This plan provides a clear path to achieving the Phase 1 goal by modifying specific components and removing obsolete logic, setting a clean foundation for future enhancements. 