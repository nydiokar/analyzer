# Script Refactoring Strategy for Enhanced Reusability

This document outlines a strategy to refactor existing and future analysis scripts to promote modularity, reusability, and easier integration into various systems, including the Telegram bot.

## Core Principles

1.  **Separation of Concerns:** Each module, function, or class should have a single, well-defined responsibility.
    *   **Data Fetching & Preparation:** Logic for fetching data (from APIs, databases) and transforming it into a common format should be isolated in dedicated services/modules.
    *   **Core Analysis Logic:** Algorithms and business rules for analysis (e.g., correlation, KPI calculation, similarity scoring) should be pure functions or classes that operate on prepared data.
    *   **Reporting/Output:** Formatting data for presentation (e.g., console output, Telegram messages, file generation) should be separate from the analysis logic.
2.  **Clear Interfaces:** Functions and modules should have clear, well-documented input parameters and return types. TypeScript interfaces are crucial here.
3.  **Configuration Management:** Configurations (thresholds, API keys, constants) should be externalized (e.g., into `config/constants.ts` or environment variables) and passed into functions/classes, not hardcoded.
4.  **Composability:** Design functions and modules so they can be easily combined to create more complex workflows.
5.  **Testability:** Isolated functions with clear inputs/outputs are easier to unit test.

## Proposed Refactoring Steps for Existing Scripts

The goal is to transform each script (e.g., `activityCorrelator.ts`, `walletSimilarity.ts`) from a monolithic execution flow into a collection of reusable functions/modules.

### 1. Identify Core Logic Blocks

For each script, identify distinct stages:
    *   Data acquisition (e.g., fetching transactions from `DatabaseService`).
    *   Data filtering and preprocessing.
    *   Core analytical computations.
    *   Result aggregation and PNL calculation.
    *   Output generation (console logs, file writing).

### 2. Extract Logic into Reusable Functions/Modules

*   **Data Fetching & Preprocessing:**
    *   If not already in a service, move data fetching logic (e.g., getting transactions for a list of wallets) into shared services like `DatabaseService` or a new domain-specific service.
    *   Ensure these services return data in a consistent, well-typed format (e.g., `CorrelatorTransactionData[]`).
    *   Filtering logic (like the bot activity filter in `activityCorrelator.ts`) can become a utility function that takes transactions and configuration as input.
*   **Core Analysis Functions:**
    *   The main analysis part of each script (e.g., the correlation scoring, clustering in `activityCorrelator.ts`, or similarity calculation in `walletSimilarity.ts`) should be extracted into its own function or class.
    *   **Inputs:** These functions should accept the prepared data and any necessary configuration parameters (e.g., `ANALYSIS_CONFIG`).
    *   **Outputs:** They should return structured analysis results (e.g., `CorrelatedPairData[]`, cluster information, similarity scores). These return types should be clearly defined with interfaces.
    *   These functions should be pure if possible (no side effects like logging directly, unless it's through a passed-in logger instance).
*   **PNL Calculation:**
    *   If PNL calculation is common across multiple analyses, consider making it a reusable utility function or part of a financial calculations service.
*   **Reporting Adapters:**
    *   The part of the script that formats and prints results to the console or a file should be a separate function.
    *   For the bot, a different "adapter" function (like the `generateTelegramReport` method) would take the same structured analysis results and format them for Telegram.

### 3. Example: Refactoring `activityCorrelator.ts`

**Current (Simplified Structure):**
```typescript
// activityCorrelator.ts
async function main() {
  // 1. Define wallets, fetch transactions from DB
  // 2. Filter wallets (e.g., daily token activity)
  // 3. Calculate global token stats (popular, non-obvious)
  // 4. Perform pairwise correlation scoring
  // 5. Build clusters
  // 6. Calculate PNLs
  // 7. Print detailed report to console/file
}
main();
```

**Refactored (Conceptual):**

*   `src/wallet_analysis/services/transaction-service.ts` (or enhance `database-service.ts`)
    *   `fetchTransactionsForWallets(addresses: string[]): Promise<Transaction[]>`
    *   `filterWalletsByActivity(wallets: WalletData[], transactions: Transaction[], config: ActivityFilterConfig): WalletData[]`
*   `src/wallet_analysis/core/correlation-analyzer.ts`
    *   `interface CorrelationConfig { ... }`
    *   `interface CorrelationResult { pairs: CorrelatedPairData[], clusters: WalletCluster[], globalTokenStats: ... }`
    *   `function analyzeWalletCorrelation(transactionsByWallet: Record<string, Transaction[]>, config: CorrelationConfig): CorrelationResult`
*   `src/wallet_analysis/utils/pnl-calculator.ts`
    *   `function calculatePnlForWallets(transactionsByWallet: Record<string, Transaction[]>): Record<string, number>`
*   `src/scripts/activityCorrelator.ts` (becomes a "driver" or "entry point")
    *   Imports functions from services and core analyzers.
    *   Orchestrates the flow: fetch -> filter -> analyze -> calculate PNL.
    *   Uses a `ConsoleReporter` to format and print output.
```typescript
// src/scripts/activityCorrelator.ts (New Structure)
import { fetchTransactionsForWallets, filterWalletsByActivity } from '../wallet_analysis/services/transaction-service';
import { analyzeWalletCorrelation } from '../wallet_analysis/core/correlation-analyzer';
import { calculatePnlForWallets } from '../wallet_analysis/utils/pnl-calculator';
import { ANALYSIS_CONFIG } from '../config/constants'; // Assuming this holds all relevant configs

async function runActivityCorrelationScript(walletAddresses: string[]) {
  const rawTransactions = await fetchTransactionsForWallets(walletAddresses, DEFAULT_RECENT_TRANSACTION_COUNT);
  const {
    walletTransactionsMap,
    filteredWallets // Wallets after activity filter
  } = await preprocessAndFilterTransactions( // This would encapsulate filtering and preparing map
        walletAddresses,
        ANALYSIS_CONFIG.MAX_DAILY_TOKENS_FOR_FILTER
    );

  if (Object.keys(walletTransactionsMap).length < 2) {
    console.log("Not enough valid wallets remaining after filtering for correlation.");
    return;
  }

  const correlationResult = analyzeWalletCorrelation(walletTransactionsMap, ANALYSIS_CONFIG);
  const walletPnLs = calculatePnlForWallets(walletTransactionsMap);

  // Format and log to console/file (specific to script's needs)
  generateConsoleReport(correlationResult, walletPnLs, filteredWallets.length);
}

// Script execution
const walletsToAnalyze = ["address1", "address2", ...];
runActivityCorrelationScript(walletsToAnalyze);
```

*   `src/wallet_analysis/bot/commands.ts`
    *   Imports and uses `fetchTransactionsForWallets`, `filterWalletsByActivity`, `analyzeWalletCorrelation`, `calculatePnlForWallets`.
    *   Uses its own `generateTelegramReport` to format `CorrelationResult` and PNLs for Telegram.

### 4. Mediator Layer (Service Facade or Orchestrator) - Optional but Recommended

For complex scenarios or if you want a single point of interaction for different analysis types, you could introduce a "Wallet Analysis Service":

*   `src/wallet_analysis/wallet-analysis-service.ts`
    *   `class WalletAnalysisService {`
    *   `  constructor(dbService, heliusClient) {}`
    *   `  async runCorrelation(addresses: string[], config): Promise<CorrelationResult> { ... }`
    *   `  async calculateSimilarity(addresses: string[], config): Promise<SimilarityResult> { ... }`
    *   `}`

The bot commands and scripts would then interact with this service. This provides a cleaner abstraction.

## Benefits

*   **Reusability:** Core analysis logic can be imported and used by scripts, the bot, or potentially an API.
*   **Maintainability:** Changes to one part (e.g., data fetching) are less likely to break others.
*   **Testability:** Smaller, focused functions are easier to test in isolation.
*   **Clarity:** The purpose of each piece of code becomes clearer.
*   **Scalability:** Easier to add new analysis types or modify existing ones.

## Timeline & Iteration

This refactoring can be done incrementally:
1.  Start with the most frequently used or complex script (e.g., `activityCorrelator.ts`).
2.  Focus on extracting its core analysis logic first.
3.  Then, update the bot to use this extracted logic.
4.  Apply the same pattern to other scripts.

This approach allows for continuous improvement without a massive upfront rewrite. 