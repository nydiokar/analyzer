# Wallet Analyzer Components Map

This document outlines the core components of the Wallet Analyzer system, their functionalities, and how they interact.

```
+-------------------------------------------------------------------------------------------------D-+
|                               WALLET ANALYZER SYSTEM (Core Modules Flow)                        |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|   LEVEL 0: Raw/Fetched Data Inputs (Conceptual - from DatabaseService/Prisma)                     |
|   +---------------------------------+     +---------------------------------------------------+   |
|   | `SwapAnalysisInput` (raw swaps) |     | `TransactionData`, `WalletInfo` (processed/context) |   |
|   +--------------+--+---------------+     +----------------------+------------------------------+   |
|                  |  |                                            |      |                           |
|   LEVEL 1:       |  | Initial Processing & Direct Analysis       |      |                           |
|   +--------------V--V---------------+     +----------------------V------------------------------+   |
|   |       `SwapAnalyzer`          |     |             `SimilarityAnalyzer`                    |   |
|   | (P/L, SOL flow per token)     |     |             (Token vector similarity scores)          |   |
|   +--------------+----------------+     +---------------------------------------------------+   |
|                  |                                                                                |
|   +--------------V----------------+                            +------------------------------V   |
|   |    `BehaviorAnalyzer`         |                            |            `CorrelationAnalyzer` |   |
|   | (Trade patterns, style class.)|                            |            (Shared non-obvious |   |
|   | +--------------+----------------+                            |             tokens, sync trades,|   |
|   |                  |                                             |             clusters, global    |   |
|   |   LEVEL 2:       | Derived & Aggregated Analysis / Reporting   |             token stats)        |   |
|   |   +--------------V----------------+                            +-------------------------------+   |
|   |   |  `AdvancedStatsAnalyzer`      |                                                               |   |
|   |   |  (Overall trading stats, PCI) |                                                               |   |
|   |   +-------------------------------+                                                               |   |
|   |                                                                                                   |
|   |   +--------------V----------------+                                                               |   |
|   |   | `KPIComparisonAnalyzer`       |                                                               |   |
|   |   | (Comparative behavior report) |                                                               |   |
|   |   +-------------------------------+                                                               |   |
|   |                                                                                                   |
|   | Lower-Level (Closer to raw data) ---> Higher-Level (More abstract/aggregated analysis & reporting)  |
|   +---------------------------------------------------------------------------------------------------+
```

## Core Analysis Modules (`src/wallet_analysis/core`)

The core analysis functionalities are broken down into several distinct modules, each focusing on a specific aspect of wallet analysis.

### 1. Swap Analysis (`core/swap`)

*   **Component**: `swap/analyzer.ts` -> `SwapAnalyzer`
*   **Functionality**:
    *   Analyzes raw swap transaction inputs (`SwapAnalysisInput` from Prisma).
    *   Calculates Profit/Loss (P/L) in SOL for each SPL token.
    *   Tracks SOL spent to acquire tokens and SOL received from selling them.
    *   Specifically handles stablecoins to monitor SOL flow in/out of stable positions.
    *   Filters out "BURN" type interactions and transactions involving Wrapped SOL (WSOL).
*   **Inputs**:
    *   `SwapAnalysisInput[]`: An array of pre-processed swap records for a wallet.
    *   `walletAddress: string`: The address of the wallet being analyzed.
*   **Outputs**:
    *   An object containing:
        *   `results: OnChainAnalysisResult[]`: Detailed P/L, amounts, and timestamps per token.
        *   `processedSignaturesCount: number`: Number of unique transaction signatures processed.
        *   `firstTimestamp: number`, `lastTimestamp: number`: Earliest and latest transaction timestamps.
        *   `stablecoinNetFlow: number`: Net SOL flow into/out of stablecoins.
*   **Dependencies**:
    *   `@/utils/logger`
    *   `@/types/helius-api` (for `OnChainAnalysisResult`)
    *   `@prisma/client` (for `SwapAnalysisInput` type)
*   **Consumed By**: Likely by `AdvancedStatsAnalyzer` (takes `OnChainAnalysisResult` as input).

### 2. Advanced Statistics (`core/stats`)

*   **Component**: `stats/analyzer.ts` -> `AdvancedStatsAnalyzer`
*   **Functionality**:
    *   Calculates a suite of advanced trading statistics based on per-token P/L results.
    *   Metrics include:
        *   Median P/L per Token (calculated on non-zero P/L tokens).
        *   Trimmed Mean P/L per Token.
        *   Token Win Rate (percentage of tokens with P/L > 0).
        *   Standard Deviation of P/L.
        *   Profit Consistency Index (PCI).
        *   Weighted Efficiency Score.
        *   Average P/L Per Day Active (approximated).
*   **Inputs**:
    *   `results: OnChainAnalysisResult[]`: Typically the output from `SwapAnalyzer`.
*   **Outputs**:
    *   `AdvancedTradeStats | null`: An object containing the calculated advanced metrics, or null if input is invalid.
*   **Dependencies**:
    *   `@/utils/logger`
    *   `@/types/helius-api` (for `OnChainAnalysisResult`, `AdvancedTradeStats`)

### 3. Similarity Analysis (`core/similarity`)

Contains components to measure similarity between different wallets based on their trading patterns.

*   **Component**: `similarity/analyzer.ts` -> `SimilarityAnalyzer`
    *   **Functionality**:
        *   Core logic for calculating similarity.
        *   Creates token vectors for wallets:
            *   'capital': Based on the percentage of capital allocated to each token.
            *   'binary': Based on the presence (1) or absence (0) of traded tokens.
        *   Calculates pairwise cosine similarity between wallet vectors.
        *   Includes a method for Jaccard similarity (though cosine is primary for matrix).
    *   **Inputs (for `calculateSimilarity` method)**:
        *   `walletTransactions: Record<string, TransactionData[]>`: Transaction data for multiple wallets. (`TransactionData` is a shared type, see `@/types/correlation`).
        *   `vectorType: 'capital' | 'binary'`: Specifies the type of vector to generate.
    *   **Outputs**: `Promise<SimilarityMetrics>` (pairwise similarities, global metrics).
    *   **Dependencies**: `@/types/analysis`, `@/types/similarity`, `@/types/correlation` (for `TransactionData`), `@/utils/logger`, `compute-cosine-similarity` (external lib).

*   **Component**: `similarity/similarity-service.ts` -> `SimilarityService`
    *   **Functionality**:
        *   Orchestrates the end-to-end similarity analysis.
        *   Fetches `TransactionData` for specified wallets using `DatabaseService`.
        *   Uses `SimilarityAnalyzer` to perform the primary cosine similarity calculation.
        *   Additionally calculates a Jaccard similarity matrix.
        *   Analyzes and counts tokens shared between wallet pairs.
        *   Provides a comprehensive result including various similarity scores and contextual data.
    *   **Inputs (for `calculateWalletSimilarity` method)**:
        *   `walletAddresses: string[]`: Array of wallet addresses.
        *   `vectorType: 'capital' | 'binary'`: For the primary cosine similarity.
    *   **Outputs**: `Promise<ComprehensiveSimilarityResult | null>` (extends `SimilarityMetrics` with Jaccard matrix, shared token lists, etc.).
    *   **Dependencies**: `DatabaseService`, `SimilarityAnalyzer` (from `./analyzer`), `@/types/*`, `@/utils/logger`.

### 4. Correlation Analysis (`core/correlation`)

Focuses on identifying wallets that exhibit correlated trading behavior, potentially indicating coordinated activity.

*   **Component**: `correlation/analyzer.ts` -> `CorrelationAnalyzer`
    *   **Functionality**:
        *   Calculates global token statistics to distinguish between "popular" (common) and "non-obvious" (less common) tokens.
        *   Analyzes pairs of wallets to find:
            *   Shared "non-obvious" tokens they both traded.
            *   Synchronized trading events (e.g., buying/selling the same non-obvious token within a configured time window).
        *   Scores wallet pairs based on these correlation factors.
        *   Identifies clusters of correlated wallets using a Depth-First Search (DFS) algorithm on the network of high-scoring pairs.
    *   **Inputs**:
        *   `transactions: Record<string, TransactionData[]>` (for global stats, correlation analysis).
        *   `wallets: WalletInfo[]` (for iterating through pairs in correlation analysis).
        *   `correlatedPairs: CorrelatedPairData[]` (for cluster identification).
        *   Constructor takes `CLUSTERING_CONFIG`.
    *   **Outputs**:
        *   `GlobalTokenStats`
        *   `Promise<CorrelatedPairData[]>`
        *   `Promise<WalletCluster[]>`
    *   **Dependencies**: `../../../config/constants` (for `CLUSTERING_CONFIG`), `@/types/wallet`, `@/types/correlation` (for `TransactionData`, etc.), `@/utils/logger`.

*   **Component**: `correlation/correlation-service.ts` -> `CorrelationService`
    *   **Functionality**:
        *   Orchestrates the full correlation analysis pipeline.
        *   Fetches `WalletInfo` and `TransactionData` using `DatabaseService`.
        *   Applies a filter to remove wallets suspected of bot activity (based on high daily unique token trading).
        *   Calculates P&L for the filtered wallets using `@/utils/pnl_calculator`.
        *   Uses `CorrelationAnalyzer` to perform the core correlation and clustering on the filtered data.
    *   **Inputs (for `runCorrelationAnalysis` method)**:
        *   `walletAddresses: string[]`.
    *   **Outputs**: `Promise<CorrelationMetrics & { walletPnLs?: Record<string, number> } | null>`.
    *   **Dependencies**: `DatabaseService`, `CorrelationAnalyzer` (from `./analyzer`), `@/types/*`, `@/utils/logger`, `@/utils/pnl_calculator`.

### 5. Behavioral Analysis (`core/behavior`)

This module analyzes the trading patterns and habits of individual wallets to classify their behavior.

*   **Component**: `behavior/analyzer.ts` -> `BehaviorAnalyzer`
    *   **Functionality**:
        *   Analyzes `SwapAnalysisInput` records for a single wallet.
        *   Builds chronological sequences of trades for each token.
        *   Calculates various behavioral metrics:
            *   Buy/sell ratios and symmetry.
            *   Average flip duration, median hold times.
            *   Sequence consistency in trading patterns (e.g., buy-sell-buy-sell).
            *   Distribution of trade durations (e.g., percentage of trades under 1 hour, 4 hours).
            *   Counts of unique tokens, total trades, buy/sell counts, complete buy-sell pairs.
        *   Calculates a "flipper score" indicating propensity for short-term trades.
        *   Classifies the wallet's overall trading style (e.g., "True Flipper", "Fast Trader", "Day Trader", "Swing Trader", "Position Trader", "Accumulator", "Distributor") based on the derived metrics.
    *   **Inputs (for `analyze` method)**:
        *   `swapRecords: SwapAnalysisInput[]`.
        *   Constructor takes `BehaviorAnalysisConfig`.
    *   **Outputs**: `BehavioralMetrics` (a comprehensive object of all calculated metrics and the classified style).
    *   **Dependencies**: `@/types/analysis`, `@/types/behavior`, `@prisma/client` (for `SwapAnalysisInput`), `@/utils/logger`.

*   **Component**: `behavior/behavior-service.ts` -> `BehaviorService`
    *   **Functionality**:
        *   Orchestrates behavioral analysis for a single wallet.
        *   Fetches `SwapAnalysisInput` records for the wallet (and optional time range) using `DatabaseService`.
        *   Uses `BehaviorAnalyzer` to perform the analysis and classification.
    *   **Inputs (for `analyzeWalletBehavior` method)**:
        *   `walletAddress: string`.
        *   `timeRange?: { startTs?: number; endTs?: number }`.
    *   **Outputs**: `Promise<BehavioralMetrics | null>`.
    *   **Dependencies**: `DatabaseService`, `BehaviorAnalyzer` (from `./analyzer`), `@/types/*`, `@/utils/logger`.

*   **Component**: `behavior/kpi_analyzer.ts` -> `KPIComparisonAnalyzer`
    *   **Functionality**:
        *   Takes `BehavioralMetrics` for multiple wallets and generates a comparative report.
        *   Formats the report in markdown with tables for:
            *   Trading Style Classification.
            *   Buy/Sell Patterns.
            *   Trading Time Distribution.
            *   Activity Summary.
        *   Includes a "KEY INSIGHTS" section that automatically highlights wallets fitting specific profiles (e.g., "True Flippers", "Accumulators").
    *   **Inputs (for `generateComparisonReport` method)**:
        *   `walletMetrics: Array<{ wallet: WalletInfo, metrics: BehavioralMetrics }>`.
    *   **Outputs**: A formatted string (markdown report).
    *   **Dependencies**: `@/types/behavior`, `@/utils/logger`. (Note: Defines a local `WalletInfo` which might need consolidation with `@/types/wallet`).

## Key Shared Elements

*   **`DatabaseService` (@/services/database-service)**: External service used by `SimilarityService`, `CorrelationService`, and `BehaviorService` to fetch necessary on-chain data (like `TransactionData` and `SwapAnalysisInput`) and wallet metadata.
*   **`TransactionData` (@/types/correlation/index.ts)**: A crucial shared data structure representing standardized transaction information. Used as input by `SimilarityAnalyzer`, `SimilarityService`, `CorrelationAnalyzer`, and `CorrelationService`.
*   **`SwapAnalysisInput` (@prisma/client)**: Represents more raw or Prisma-defined swap data. Used by `SwapAnalyzer` and `BehaviorAnalyzer`.
*   **Configuration Objects** (e.g., `SimilarityAnalysisConfig`, `CorrelationAnalysisConfig`, `BehaviorAnalysisConfig`, `CLUSTERING_CONFIG`): Each module/service often takes specific configuration parameters to tailor its analysis.
*   **Utility Functions** (e.g., `@/utils/logger`, `@/utils/pnl_calculator`): Shared helper functions for logging, P&L calculation, etc.

## Overall Flow (Conceptual)

1.  **Data Ingestion**: `DatabaseService` (or similar) fetches raw transaction and wallet data.
2.  **Preprocessing/Transformation**:
    *   Raw data might be transformed into `SwapAnalysisInput` for P/L and behavior.
    *   Data is also processed into `TransactionData` for similarity and correlation.
3.  **Analysis Execution (often via Services)**:
    *   `BehaviorService` -> `BehaviorAnalyzer` for individual wallet behavior.
    *   `SwapAnalyzer` (often a precursor) -> `AdvancedStatsAnalyzer` for detailed P/L stats.
    *   `SimilarityService` -> `SimilarityAnalyzer` for inter-wallet similarity.
    *   `CorrelationService` -> `CorrelationAnalyzer` for identifying correlated activity and clusters. (This service also includes PNL calculation).
4.  **Reporting/Output**:
    *   `KPIComparisonAnalyzer` takes `BehavioralMetrics` from multiple wallets to generate comparative reports.
    *   Other services/analyzers output their specific metrics (`AdvancedTradeStats`, `ComprehensiveSimilarityResult`, `CorrelationMetrics`) for further use or display.

This map provides a high-level overview. The actual implementation details within each function determine the precise data transformations and logical steps.
