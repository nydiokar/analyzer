# Metrics and Analysis Services Assessment

This document outlines the assessment of various analysis services within the project. The goal is to improve the quality, logical grouping, and informativeness of metrics, ensuring consistency and identifying areas for enhancement.

## Phase 1: PNL and Advanced Statistics Analysis

This section covers services primarily responsible for calculating Profit and Loss (PNL) and related statistical measures.

### Services Analyzed:

1.  **`PnlAnalysisService` (`src/core/services/pnl-analysis-service.ts`)**: Orchestrates PNL and advanced stats calculations.
2.  **`SwapAnalyzer` (`src/core/analysis/swap/analyzer.ts`)**: Calculates per-token PNL and handles stablecoin flows.
3.  **`AdvancedStatsAnalyzer` (`src/core/analysis/stats/analyzer.ts`)**: Calculates portfolio-level advanced trading statistics.

### A. `PnlAnalysisService` Assessment

*   **Role**: Orchestrator.
*   **Inputs**: `SwapAnalysisInput[]` (raw swap data from DB for a wallet).
*   **Key Operations**:
    *   Invokes `SwapAnalyzer.analyze()` for per-token PNL.
    *   Aggregates overall PNL metrics from `SwapAnalyzer` results (see table below).
    *   Invokes `AdvancedStatsAnalyzer.analyze()` with non-stablecoin results from `SwapAnalyzer`.
    *   Persists `AnalysisResult` (per-token PNL) and `AdvancedStatsResult` (portfolio stats) to the database.
    *   Updates `Wallet.lastSignatureAnalyzed`.
*   **Primary Output Type**: `SwapAnalysisSummary` (details below).

### B. `SwapAnalyzer` Assessment

*   **Role**: Core PNL calculation per token.
*   **Inputs**: `SwapAnalysisInput[]`, `walletAddress`.
*   **Key Outputs (Per-Token in `OnChainAnalysisResult[]`)**:
    *   `tokenAddress`, `totalAmountIn`, `totalAmountOut`, `netAmountChange`
    *   `totalSolSpent`, `totalSolReceived`, `totalFeesPaidInSol`
    *   `netSolProfitLoss`, `adjustedNetSolProfitLoss` (currently identical)
    *   `estimatedPreservedValue` (for stablecoins)
    *   `isValuePreservation`, `preservationType`
    *   `transferCountIn`, `transferCountOut`
    *   `firstTransferTimestamp`, `lastTransferTimestamp`
*   **Key Aggregated Outputs (returned alongside per-token results)**:
    *   `processedSignaturesCount`
    *   `firstTimestamp` (overall from input)
    *   `lastTimestamp` (overall from input)
    *   `stablecoinNetFlow` (Net SOL flow to/from stablecoins)
*   **Notes**: Filters out WSOL and 'BURN' interaction types.

### C. `AdvancedStatsAnalyzer` Assessment

*   **Role**: Calculates portfolio-level statistical measures from PNL data.
*   **Inputs**: `OnChainAnalysisResult[]` (typically non-stablecoin results).
*   **Key Outputs (`AdvancedTradeStats` object)**:
    *   `medianPnlPerToken` (on non-zero PNLs)
    *   `trimmedMeanPnlPerToken`
    *   `tokenWinRatePercent`
    *   `standardDeviationPnl`
    *   `profitConsistencyIndex`
    *   `weightedEfficiencyScore`
    *   `averagePnlPerDayActiveApprox`
    *   `firstTransactionTimestamp` (from its input)
    *   `lastTransactionTimestamp` (from its input)

### Initial Thoughts & Potential Improvements (PNL & Advanced Stats):

1.  **Logical Grouping**: The current separation of concerns between `PnlAnalysisService` (orchestration & DB persistence), `SwapAnalyzer` (core per-token PNL), and `AdvancedStatsAnalyzer` (portfolio PNL statistics) is generally good.
2.  **Metric Clarity & Naming**:
    *   `OnChainAnalysisResult.adjustedNetSolProfitLoss`: Currently same as `netSolProfitLoss`. If no distinct future purpose, consider removing for simplicity. For now, assume it's a placeholder.
    *   `profitableSwaps` / `unprofitableSwaps` in `SwapAnalysisSummary`: These currently count *tokens*. Recommend renaming to `profitableTokens` / `unprofitableTokens`.
    *   `averagePnlPerDayActiveApprox` in `AdvancedTradeStats`: Consider a shorter alias for reporting if needed (e.g., "Avg PNL / Active Day").
3.  **Potential New Metrics / Enhancements for PNL Context**:
    *   `totalSwapsTraded`: Consider adding to `SwapAnalysisSummary`. This would be the sum of `transferCountIn + transferCountOut` for non-stablecoin tokens from `SwapAnalyzer` results.
    *   `averagePnlPerTrade`: Could be calculated in `PnlAnalysisService` as `realizedPnl / totalSwapsTraded` (for non-stablecoins). This provides a different view than PNL per token.
4.  **Timestamp Clarity**:
    *   `PnlAnalysisService` (via `SwapAnalysisSummary`) provides `overallFirstTimestamp` / `overallLastTimestamp` based on *all* swap inputs.
    *   `AdvancedStatsAnalyzer` calculates its own `firstTransactionTimestamp` / `lastTransactionTimestamp` based on its *input data* (usually non-stablecoin trades).
    *   This distinction is important and should be clear if timestamps from both sources are used in the same report. The `SwapAnalysisSummary` uses the broader timestamps.
5.  **Redundancy**: Minimal redundancy observed so far, aside from the `adjustedNetSolProfitLoss` point.

### Metric Mapping Table (PNL & Advanced Stats Focus)

| Metric                          | Source Analyzer/Service      | Output Structure/Type      | Notes                                                                 |
|---------------------------------|------------------------------|----------------------------|-----------------------------------------------------------------------|
| **Per-Token Metrics**           |                              |                            | (from `SwapAnalyzer`, part of `SwapAnalysisSummary.results`)          |
| `tokenAddress`                  | `SwapAnalyzer`               | `OnChainAnalysisResult`    |                                                                       |
| `totalAmountIn`                 | `SwapAnalyzer`               | `OnChainAnalysisResult`    |                                                                       |
| `totalAmountOut`                | `SwapAnalyzer`               | `OnChainAnalysisResult`    |                                                                       |
| `netAmountChange`               | `SwapAnalyzer`               | `OnChainAnalysisResult`    |                                                                       |
| `totalSolSpent`                 | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Gross SOL spent for the token                                         |
| `totalSolReceived`              | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Gross SOL received for the token                                      |
| `totalFeesPaidInSol`            | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Fees for this token's trades                                          |
| `netSolProfitLoss`              | `SwapAnalyzer`               | `OnChainAnalysisResult`    | (SOL received - SOL spent - Fees)                                     |
| `adjustedNetSolProfitLoss`      | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Currently same as `netSolProfitLoss`                                  |
| `estimatedPreservedValue`       | `SwapAnalyzer`               | `OnChainAnalysisResult`    | For stablecoins, current SOL value of net holdings                    |
| `isValuePreservation`           | `SwapAnalyzer`               | `OnChainAnalysisResult`    | True for stablecoins                                                  |
| `preservationType`              | `SwapAnalyzer`               | `OnChainAnalysisResult`    | 'stablecoin' or undefined                                             |
| `transferCountIn`               | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Number of buy transactions for the token                              |
| `transferCountOut`              | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Number of sell transactions for the token                             |
| `firstTransferTimestamp`        | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Timestamp of first trade for this token                               |
| `lastTransferTimestamp`         | `SwapAnalyzer`               | `OnChainAnalysisResult`    | Timestamp of last trade for this token                                |
| **Aggregated PNL Metrics**      |                              |                            | (Primarily in `SwapAnalysisSummary` by `PnlAnalysisService`)          |
| `processedSignaturesCount`      | `SwapAnalyzer`               | `SwapAnalysisSummary`      | Distinct signatures processed by `SwapAnalyzer`                       |
| `stablecoinNetFlow`             | `SwapAnalyzer`               | `SwapAnalysisSummary`      | Net SOL flow to/from all stablecoins                                  |
| `totalVolume`                   | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Sum of (totalSolSpent + totalSolReceived) across all tokens         |
| `totalFees`                     | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Sum of `totalFeesPaidInSol` across all tokens                       |
| `realizedPnl`                   | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Sum of `adjustedNetSolProfitLoss` (or `netSolProfitLoss`)             |
| `unrealizedPnl`                 | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Sum of `estimatedPreservedValue` for stablecoins                      |
| `netPnl`                        | `PnlAnalysisService`         | `SwapAnalysisSummary`      | `realizedPnl + unrealizedPnl`                                         |
| `profitableTokens`              | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Count of tokens with PNL > 0 (Proposed rename from `profitableSwaps`) |
| `unprofitableTokens`            | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Count of tokens with PNL < 0 (Proposed rename from `unprofitableSwaps`)|
| `averageSwapSize`               | `PnlAnalysisService`         | `SwapAnalysisSummary`      | `totalVolume / (profitableTokens + unprofitableTokens)`               |
| `overallFirstTimestamp`         | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Earliest timestamp from all input swap records                        |
| `overallLastTimestamp`          | `PnlAnalysisService`         | `SwapAnalysisSummary`      | Latest timestamp from all input swap records                          |
| **Advanced Stats Metrics**      |                              |                            | (From `AdvancedStatsAnalyzer`, in `SwapAnalysisSummary.advancedStats`)|
| `medianPnlPerToken`             | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Median PNL of non-zero PNL tokens                                     |
| `trimmedMeanPnlPerToken`        | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Mean PNL after trimming extremes                                      |
| `tokenWinRatePercent`           | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | % of tokens with PNL > WIN_THRESHOLD_SOL                              |
| `standardDeviationPnl`          | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Sample standard deviation of PNLs                                     |
| `profitConsistencyIndex`        | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Custom index: `(medianPnlPerToken * tokenWinRatePercent) / stdDevPnl` |
| `weightedEfficiencyScore`       | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Custom index based on avg PNL and win rate                            |
| `averagePnlPerDayActiveApprox`  | `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Proxy for PNL per day token was actively traded                       |
| `firstTransactionTimestamp (adv)`| `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Earliest timestamp from trades input to AdvancedStatsAnalyzer         |
| `lastTransactionTimestamp (adv)`| `AdvancedStatsAnalyzer`      | `AdvancedTradeStats`       | Latest timestamp from trades input to AdvancedStatsAnalyzer           |

## Phase 2: Behavior Analysis

This section covers services primarily responsible for analyzing wallet trading patterns and classifying behavior.

### Services Analyzed:

1.  **`BehaviorService` (`src/core/analysis/behavior/behavior-service.ts`)**: Orchestrates behavior analysis.
2.  **`BehaviorAnalyzer` (`src/core/analysis/behavior/analyzer.ts`)**: Calculates detailed behavioral metrics and classifies trading styles.
3.  **`KPIComparisonAnalyzer` (`src/core/analysis/behavior/kpi_analyzer.ts`)**: Formats and compares behavioral metrics for multiple wallets.

### D. `BehaviorService` Assessment

*   **Role**: Orchestrator.
*   **Inputs**: `walletAddress`, `BehaviorAnalysisConfig`, `DatabaseService`.
*   **Key Operations**:
    *   Fetches `SwapAnalysisInput[]` from `DatabaseService`.
    *   Instantiates and uses `BehaviorAnalyzer` to get `BehavioralMetrics`.
*   **Primary Output Type**: `BehavioralMetrics | null`.

### E. `BehaviorAnalyzer` Assessment

*   **Role**: Core calculation of behavioral metrics and trading style classification.
*   **Inputs**: `SwapAnalysisInput[]`, `BehaviorAnalysisConfig`.
*   **Primary Output Type**: `BehavioralMetrics` object, which includes:
    *   **Flipper Metrics**: `buySellRatio`, `buySellSymmetry`, `averageFlipDurationHours`, `medianHoldTime`, `sequenceConsistency`, `flipperScore`.
    *   **Activity Metrics**: `uniqueTokensTraded`, `tokensWithBothBuyAndSell`, `totalTradeCount`, `totalBuyCount`, `totalSellCount`, `completePairsCount`, `averageTradesPerToken`.
    *   **Time Distribution**: `tradingTimeDistribution` (object with % in time buckets like <30m, 1-4h, etc.), `percentTradesUnder1Hour`, `percentTradesUnder4Hours`.
    *   **Classification**: `tradingStyle`, `confidenceScore`.
    *   **Timestamps**: `firstTransactionTimestamp`, `lastTransactionTimestamp` (from input swaps).
    *   **Placeholder Metrics (Current State - Needs Review)**:
        *   `tradingFrequency`: Initialized to `{ daily: 0, weekly: 0, monthly: 0 }`.
        *   `tokenPreferences`: Initialized to `{ mostTraded: [], mostProfitable: [], mostHeld: [] }`.
        *   `riskMetrics`: Initialized to `{ averageTransactionSize: 0, largestTransaction: 0, diversificationScore: 0 }`.
        *   `profitMetrics`: Initialized to `{ totalPnL: 0, winRate: 0, averageProfitPerTrade: 0, profitConsistency: 0 }`.

### F. `KPIComparisonAnalyzer` Assessment

*   **Role**: Generates a formatted string report comparing `BehavioralMetrics` across multiple wallets.
*   **Inputs**: `Array<{ wallet: WalletInfo, metrics: BehavioralMetrics }>`.
*   **Key Operations**: Formats existing `BehavioralMetrics` into tables. Does not calculate new primary metrics.
*   **Primary Output Type**: `string` (formatted report).

### Initial Thoughts & Potential Improvements (Behavior Analysis):

1.  **Logical Grouping**: Generally good. The main concern is the placeholder metrics within `BehavioralMetrics`.
2.  **Placeholder Metrics in `BehavioralMetrics` - Recommendations**:
    *   **`profitMetrics` (totalPnL, winRate, etc.)**: **Strongly recommend removing these.** PNL data should be sourced from `PnlAnalysisService` by the calling layer if combined reporting is needed. `BehaviorAnalyzer` should focus solely on behavioral patterns derivable from trade sequences and timings.
    *   **`riskMetrics`**: 
        *   Implement `averageTransactionSizeSol`: Calculate from `associatedSolValue` in `SwapAnalysisInput`.
        *   Implement `largestTransactionSol`: Find max `associatedSolValue` from `SwapAnalysisInput`.
        *   `diversificationScore`: Clarify its definition. If it's just `uniqueTokensTraded`, then it's redundant. If it relates to capital distribution across tokens, it would require PNL data (SOL value per token), making it less of a pure behavioral metric based on swap inputs alone.
    *   **`tokenPreferences`**: 
        *   Implement `mostTradedTokens`: List of top N token mints by trade count (buy/sell).
        *   Remove `mostProfitableTokens`: Belongs to PNL analysis.
        *   For `mostHeldTokens`: If based on historical swaps, this could be `topNetPositiveAmountTokens` (tokens with the largest net positive `amount` change). This is derivable from swap inputs.
        *   **`tradingFrequency`**: Implement calculation of actual average daily, weekly, and monthly trade counts based on `SwapAnalysisInput` timestamps.
3.  **Clarity**: Core behavioral metrics (flipper score, symmetry, consistency, time distributions) are well-defined for behavioral assessment.
4.  **Overlap**: The main overlap is the PNL-related placeholders. Separating these will improve modularity.

### Metric Mapping Table (Behavior Analysis Focus)

| Metric                          | Source Analyzer/Service      | Output Structure/Type      | Notes                                                                    |
|---------------------------------|------------------------------|----------------------------|--------------------------------------------------------------------------|
| **Flipper Metrics**             |                              |                            | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                        |
| `buySellRatio`                  | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Overall ratio of total buys to total sells.                              |
| `buySellSymmetry`               | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Avg. buy/sell count symmetry per token (for tokens with both).         |
| `averageFlipDurationHours`      | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Avg. time between buy and subsequent sell.                               |
| `medianHoldTime`                | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Median time for buy-sell flips.                                          |
| `sequenceConsistency`           | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Avg. ratio of actual completed pairs to max possible pairs per token.    |
| `flipperScore`                  | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Score (0-1) indicating flipper-like behavior.                            |
| **Activity Metrics**            |                              |                            | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                        |
| `uniqueTokensTraded`            | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Count of unique tokens in any trade.                                     |
| `tokensWithBothBuyAndSell`      | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Count of tokens with at least one buy AND one sell.                      |
| `totalTradeCount`               | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Total buy and sell transactions.                                         |
| `totalBuyCount`                 | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Total buy transactions.                                                  |
| `totalSellCount`                | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Total sell transactions.                                                 |
| `completePairsCount`            | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Total buy-then-sell round trips across all tokens.                       |
| `averageTradesPerToken`         | `BehaviorAnalyzer`           | `BehavioralMetrics`        | `totalTradeCount / uniqueTokensTraded`.                                  |
| **Time Distribution**           |                              |                            | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                        |
| `tradingTimeDistribution`       | `BehaviorAnalyzer`           | `BehavioralMetrics`        | % of flips in time buckets (ultraFast, veryFast, fast, etc.).            |
| `percentTradesUnder1Hour`       | `BehaviorAnalyzer`           | `BehavioralMetrics`        | % flips < 1 hour.                                                        |
| `percentTradesUnder4Hours`      | `BehaviorAnalyzer`           | `BehavioralMetrics`        | % flips < 4 hours.                                                       |
| **Classification**              |                              |                            | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                        |
| `tradingStyle`                  | `BehaviorAnalyzer`           | `BehavioralMetrics`        | e.g., "True Flipper", "Accumulator".                                     |
| `confidenceScore`               | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Confidence in `tradingStyle`.                                            |
| **Timestamps**                  |                              |                            | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                        |
| `firstTransactionTimestamp`     | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Earliest timestamp from input swaps.                                     |
| `lastTransactionTimestamp`      | `BehaviorAnalyzer`           | `BehavioralMetrics`        | Latest timestamp from input swaps.                                       |
| **Placeholder/To Be Implemented**|                              |                            | (In `BehavioralMetrics`, recommendations above)                          |
| `tradingFrequency`              | `BehaviorAnalyzer`           | `BehavioralMetrics`        | *Implement*: avg daily/weekly/monthly trades.                          |
| `tokenPreferences.mostTradedTokens`| `BehaviorAnalyzer`        | `BehavioralMetrics`        | *Implement*: list of top N tokens by trade count.                        |
| `tokenPreferences.mostProfitableTokens`| `PnlAnalysisService` | `BehavioralMetrics`        | *Remove*: Source from PNL.                                               |
| `tokenPreferences.mostHeldTokens`| `BehaviorAnalyzer`           | `BehavioralMetrics`        | *Consider*: `topNetPositiveAmountTokens`.                                |
| `riskMetrics.averageTransactionSizeSol`| `BehaviorAnalyzer`    | `BehavioralMetrics`        | *Implement*: from `associatedSolValue`.                                  |
| `riskMetrics.largestTransactionSol`| `BehaviorAnalyzer`        | `BehavioralMetrics`        | *Implement*: max `associatedSolValue`.                                   |
| `riskMetrics.diversificationScore`| `BehaviorAnalyzer`        | `BehavioralMetrics`        | *Clarify/Remove*: If not `uniqueTokensTraded`.                           |
| `profitMetrics.*`               | `PnlAnalysisService`         | `BehavioralMetrics`        | *Remove All*: Source from PNL.                                           |

## Phase 3: Action Plan for Metric Refinement (PNL, Advanced Stats, Behavior)

This section outlines specific actions to consolidate, clarify, and enhance the metrics from PNL, Advanced Stats, and Behavior analysis modules, aiming for a more cohesive and informative output suitable for dashboarding. The "Status" column in the tables below reflects the outcome of this action plan.

### 3.1. PNL & Advanced Statistics (`PnlAnalysisService`, `SwapAnalyzer`, `AdvancedStatsAnalyzer`)

**Objective**: Ensure PNL metrics are comprehensive, clearly named, and provide sufficient context for wallet performance assessment.

**Actions & Refinements:**

1.  **Metric Naming Clarity (in `SwapAnalysisSummary` and dependent types):**
    *   **Target Metrics**: `profitableSwaps`, `unprofitableSwaps`.
    *   **Action**: Rename to `profitableTokensCount` and `unprofitableTokensCount` respectively.
    *   **Rationale**: These metrics count tokens with net positive/negative PNL, not individual swap transactions.
    *   **Impacted Files**: `PnlAnalysisService` (aggregation logic where these are summed up), type definition for `SwapAnalysisSummary` (e.g., in `helius-api.ts`), any reporting utilities consuming these.

2.  **Contextual PNL Metrics (New Additions to `SwapAnalysisSummary`):**
    *   **Metric**: `totalExecutedSwapsCount` (New)
        *   **Definition**: Total number of buy and sell operations for non-stablecoin tokens.
        *   **Calculation**: In `PnlAnalysisService`, sum `transferCountIn` and `transferCountOut` from all `OnChainAnalysisResult` items where `isValuePreservation` is `false`.
        *   **Rationale**: Provides a clear count of trading activities directly contributing to realized PNL.
    *   **Metric**: `averageRealizedPnlPerExecutedSwap` (New)
        *   **Definition**: Average PNL achieved per executed non-stablecoin swap.
        *   **Calculation**: In `PnlAnalysisService`, calculate as `realizedPnl / totalExecutedSwapsCount` (ensure `totalExecutedSwapsCount > 0`).
        *   **Rationale**: Offers a trade-level performance view, complementing token-level PNL.
    *   **Impacted Files**: `PnlAnalysisService` (implement new calculations), type definition for `SwapAnalysisSummary`.

3.  **Review `OnChainAnalysisResult.adjustedNetSolProfitLoss`:**
    *   **Action**: **Remove** `adjustedNetSolProfitLoss` from `OnChainAnalysisResult` (and consequently from `SwapAnalyzer`'s output and DB storage).
    *   **Rationale**: Per critique, minimises complexity unless a specific, near-term adjustment logic (IL, complex slippage) is planned. `netSolProfitLoss` will be the sole PNL figure per token.
    *   **Impacted Files**: `SwapAnalyzer`, `OnChainAnalysisResult` type definition, Prisma schema for `AnalysisResult`.

4.  **Timestamp Consistency & Reporting:**
    *   **Clarification**: Reports combining PNL data with other analyses must clearly distinguish timestamp contexts.
    *   `SwapAnalysisSummary.overallFirstTimestamp` and `overallLastTimestamp` (from `PnlAnalysisService` based on *all* `SwapAnalysisInput`) represent the broadest period.
    *   `AdvancedTradeStats.firstTransactionTimestamp` and `lastTransactionTimestamp` (from `AdvancedStatsAnalyzer`) cover only the subset of trades (usually non-stablecoin) used for its specific statistical calculations.
    *   `BehavioralMetrics.firstTransactionTimestamp` and `lastTransactionTimestamp` (from `BehaviorAnalyzer`) cover all trades input to it.
    *   **Recommendation**: For dashboard views, prioritize the broadest relevant time window or allow user selection with clear labeling of what data subset a given timestamp range applies to. Strongly recommend defining clear data ownership for timestamps or using a shared `TimeWindow` object if multiple layers report them to prevent desync drift.

5.  **New PNL Efficiency Metric (to `SwapAnalysisSummary`):**
    *   **Metric**: `realizedPnlToTotalVolumeRatio: number`
    *   **Definition**: `realizedPnl / totalVolume` (ensure `totalVolume !== 0`).
    *   **Rationale**: Measures PNL efficiency per unit of total SOL volume transacted. A higher ratio indicates more PNL generated per SOL moved. Complements existing gross PnL stats.
    *   **Derivation**: Uses `realizedPnl` and `totalVolume`, which are already calculated in `PnlAnalysisService` for `SwapAnalysisSummary`.
    *   **Impacted Files**: `PnlAnalysisService` (add calculation), `SwapAnalysisSummary` type definition.

### 3.2. Behavior Analysis (`BehaviorService`, `BehaviorAnalyzer`)

**Objective**: Streamline behavioral metrics to focus on unique behavioral patterns, remove PNL overlap, and implement meaningful placeholder metrics.

**Note on `BehaviorAnalyzer` Scope:** While `BehaviorAnalyzer` is currently planned to house all detailed behavioral calculations for efficiency (leveraging a single pass over trade data where possible), its scope has grown with the inclusion of diverse metric categories (core patterns, token interactions, session analysis). If future additions significantly increase its complexity or if specific parts (like session analysis) prove broadly reusable, consider refactoring it into more specialized sub-analyzers (e.g., `FlipPatternAnalyzer`, `SessionAnalyzer`, `TokenInteractionAnalyzer`) to maintain clarity, testability, and adherence to the Single Responsibility Principle.

**Actions & Refinements (primarily within `BehaviorAnalyzer` and the `BehavioralMetrics` type):**

1.  **Remove PNL Overlap:**
    *   **Target Metrics**: Entire `profitMetrics` field (`{ totalPnL, winRate, averageProfitPerTrade, profitConsistency }`).
    *   **Action**: **Remove** from `BehavioralMetrics` type and `getEmptyMetrics()` in `BehaviorAnalyzer`.
    *   **Rationale**: PNL data must be sourced from `PnlAnalysisService`. Keeps `BehaviorAnalyzer` focused on non-PNL behavioral patterns.
    *   **Impacted Files**: `BehaviorAnalyzer`, `BehavioralMetrics` type definition (e.g., in `behavior.ts`).

2.  **Implement and Refine `riskMetrics` (in `BehavioralMetrics`):**
    *   **Metric**: `averageTransactionValueSol` (Replaces `averageTransactionSize`)
        *   **Definition**: Average SOL value of all buy and sell transactions.
        *   **Calculation**: In `BehaviorAnalyzer`, sum `transaction.associatedSolValue` for all `SwapAnalysisInput` records, then divide by `totalTradeCount` (if `totalTradeCount > 0`).
    *   **Metric**: `largestTransactionValueSol` (Replaces `largestTransaction`)
        *   **Definition**: The largest SOL value observed in a single transaction.
        *   **Calculation**: In `BehaviorAnalyzer`, find `Math.max(transaction.associatedSolValue)` from all `SwapAnalysisInput` records.
    *   **Metric**: `diversificationScore`
        *   **Action**: **Remove.**
        *   **Rationale**: Per critique, analytically weak without a robust definition (e.g., capital risk weighting) and risks redundancy or being misleading.
    *   **Impacted Files**: `BehaviorAnalyzer` (update calculations, remove `diversificationScore`), `BehavioralMetrics` type definition.

3.  **Implement and Refine `tokenPreferences` (in `BehavioralMetrics`):**
    *   **Metric**: `mostTradedTokens` (`string[]`, replaces `mostTraded`)
        *   **Definition**: List of top N (e.g., 3-5) token mints by total trade count (buys + sells).
        *   **Calculation**: In `BehaviorAnalyzer` (likely within/after `buildTokenSequences`), aggregate trade counts per mint, sort, and take top N.
    *   **Metric**: `mostProfitableTokens`
        *   **Action**: **Remove.**
        *   **Rationale**: PNL-dependent; should be derived from `PnlAnalysisService` data by the application/dashboard if needed.
    *   **Metric**: `topNetPositiveAmountTokens` (`string[]`, replaces `mostHeld`)
        *   **Action**: **Postpone or Re-evaluate.**
        *   **Rationale**: Per critique, raw net positive amount can be misleading (airdrops, junk). If implemented later, requires careful annotation or refined calculation (e.g., volume-weighting, user-initiated only). For now, focus on clearer metrics.
    *   **Impacted Files**: `BehaviorAnalyzer`, `BehavioralMetrics` type definition.

4.  **Implement `tradingFrequency` (in `BehavioralMetrics`):**
    *   **Metrics**: `tradesPerDay: number`, `tradesPerWeek: number`, `tradesPerMonth: number`.
    *   **Definition**: Average number of trades over different periods.
    *   **Calculation**: In `BehaviorAnalyzer`, using `firstTransactionTimestamp`, `lastTransactionTimestamp`, and `totalTradeCount`:
        *   `durationDays = (lastTransactionTimestamp - firstTransactionTimestamp) / (60 * 60 * 24)`. If `durationDays <= 0`, treat as `1` for daily average to avoid division by zero or negative durations with minimal data.
        *   `tradesPerDay = totalTradeCount / durationDays`.
        *   `tradesPerWeek = tradesPerDay * 7`.
        *   `tradesPerMonth = tradesPerDay * 30.44` (avg days per month).
    *   **Impacted Files**: `BehaviorAnalyzer`, `BehavioralMetrics` type definition.

5.  **New Behavioral Metrics (to `BehavioralMetrics` via `BehaviorAnalyzer`):**
    *   **Metric**: `reentryRate: number`
        *   **Definition**: `tokensWithMultipleCycles / tokensWithBothBuyAndSell` (if `tokensWithBothBuyAndSell > 0`).
        *   **Rationale**: Reveals tendency to re-trade the same token, indicating confidence, obsession, or bot looping.
        *   **Derivation**: `tokensWithBothBuyAndSell` is existing. `tokensWithMultipleCycles` is a new count of tokens that have more than one completed buy-sell pair (e.g., `tokenSequence.completedPairTimestamps.length > 1`). Calculated in `BehaviorAnalyzer`.
    *   **Metric**: `percentageOfUnpairedTokens: number`
        *   **Definition**: `((uniqueTokensTraded - tokensWithBothBuyAndSell) / uniqueTokensTraded) * 100` (if `uniqueTokensTraded > 0`).
        *   **Rationale**: Shows ratio of incomplete cycles (buy-only or sell-only). Critical to detect accumulation, rage exits, or farming.
        *   **Derivation**: Uses existing `uniqueTokensTraded` and `tokensWithBothBuyAndSell` from `BehavioralMetrics`.
    *   **Impacted Files (for both above)**: `BehaviorAnalyzer`, `BehavioralMetrics` type definition.

6.  **New Session-Based Behavioral Metrics (to `BehavioralMetrics` via `BehaviorAnalyzer`):**
    *   **Session Definition**: A session is a sequence of trades where the time gap between consecutive trades is less than or equal to a defined threshold (e.g., 60 minutes).
    *   **Metric**: `sessionCount: number`
        *   **Definition**: Number of distinct trading sessions.
        *   **Rationale**: Exposes episodic vs. continuous trading.
    *   **Metric**: `avgTradesPerSession: number`
        *   **Definition**: `totalTradeCount / sessionCount` (if `sessionCount > 0`).
        *   **Rationale**: Average number of trades within a typical session.
    *   **Metric**: `activeHoursDistribution: Record<number, number>` (e.g., `{0: tradeCount, ..., 23: tradeCount}`)
        *   **Definition**: Distribution of trade timestamps across 24 hours of the day (UTC).
        *   **Rationale**: Detects habitual trading times, potential bot activity, or human rhythms.
    *   **Metric**: `averageSessionStartHour: number`
        *   **Definition**: Average start hour (0-23 UTC) of identified trading sessions.
        *   **Rationale**: Reveals typical trading window start.
    *   **Metric**: `averageSessionDurationMinutes: number`
        *   **Definition**: Average length of trading sessions in minutes.
        *   **Rationale**: Reveals typical trading window length.
    *   **Derivation (for all session metrics)**:
        *   Sort all `SwapAnalysisInput` by timestamp.
        *   Iterate through sorted trades to identify sessions based on the time gap threshold.
        *   For `activeHoursDistribution`, iterate all trades and group by hour.
        *   For session-specific metrics, iterate identified sessions.
    *   **Impacted Files (for all session metrics)**: `BehaviorAnalyzer`, `BehavioralMetrics` type definition.

7.  **Future Consideration: Behavioral Volatility/Consistency Metrics (in `BehavioralMetrics`):** (Renumbered from 5)
    *   **Metric Idea**: `flipDurationStandardDeviation`
        *   **Definition**: Standard deviation of flip durations (output of `calculateFlipDurations`).
        *   **Calculation**: In `BehaviorAnalyzer`, after `calculateTimeDistributions` (which already gets `allDurations`), calculate standard deviation on `allDurations`.
        *   **Rationale**: Measures consistency in holding/flipping times. This can be a valuable addition for a richer behavioral profile.
    *   **Metric Idea**: `tradeValueStandardDeviationSol` (Moved from 3.2.2)
        *   **Definition**: Standard deviation of `associatedSolValue` for all trades.
        *   **Calculation**: In `BehaviorAnalyzer`, calculate standard deviation of the list of `associatedSolValue` from all `SwapAnalysisInput`.
        *   **Rationale**: Adds a basic measure of consistency/volatility in trade sizing.
    *   **Note**: These are flagged as future considerations to enrich the behavioral analysis. PNL volatility per token would be a separate effort, likely for `AdvancedStatsAnalyzer`.

6.  **No Change Metrics**: Core behavioral metrics like `buySellRatio`, `buySellSymmetry`, `averageFlipDurationHours`, `medianHoldTime`, `sequenceConsistency`, `flipperScore`, time distributions, `tradingStyle`, `confidenceScore`, `uniqueTokensTraded`, `tokensWithBothBuyAndSell`, `totalTradeCount`, `completePairsCount`, `averageTradesPerToken` are considered well-defined and will remain.

### 3.3. Updated Metric Mapping Tables

The following tables reflect the planned changes from this action plan.

**PNL & Advanced Stats Focus - Updated Table**

| Metric                             | Source Analyzer/Service | Output Structure/Type   | Status & Notes                                                                    |
|------------------------------------|-------------------------|-------------------------|-----------------------------------------------------------------------------------|
| **Per-Token Metrics**              |                         |                         | (from `SwapAnalyzer`, part of `SwapAnalysisSummary.results`)                        |
| `tokenAddress`                     | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `totalAmountIn`                    | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `totalAmountOut`                   | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `netAmountChange`                  | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `totalSolSpent`                    | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `totalSolReceived`                 | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `totalFeesPaidInSol`               | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `netSolProfitLoss`                 | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `adjustedNetSolProfitLoss`         | `SwapAnalyzer`          | `OnChainAnalysisResult` | **To Be Removed**                                                                 |
| `estimatedPreservedValue`          | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented (for stablecoins)                                                     |
| `isValuePreservation`              | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `preservationType`                 | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `transferCountIn`                  | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `transferCountOut`                 | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `firstTransferTimestamp`           | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| `lastTransferTimestamp`            | `SwapAnalyzer`          | `OnChainAnalysisResult` | Implemented                                                                       |
| **Aggregated PNL Metrics**         |                         |                         | (Primarily in `SwapAnalysisSummary` by `PnlAnalysisService`)                      |
| `processedSignaturesCount`         | `SwapAnalyzer`          | `SwapAnalysisSummary`   | Implemented                                                                       |
| `stablecoinNetFlow`                | `SwapAnalyzer`          | `SwapAnalysisSummary`   | Implemented                                                                       |
| `totalVolume`                      | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `totalFees`                        | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `realizedPnl`                      | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented (will use `netSolProfitLoss` after `adjustedNetSolProfitLoss` removal) |
| `unrealizedPnl`                    | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `netPnl`                           | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `profitableTokensCount`            | `PnlAnalysisService`    | `SwapAnalysisSummary`   | **Renamed** (from `profitableSwaps`) & Implemented                                |
| `unprofitableTokensCount`          | `PnlAnalysisService`    | `SwapAnalysisSummary`   | **Renamed** (from `unprofitableSwaps`) & Implemented                              |
| `averageSwapSize`                  | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `overallFirstTimestamp`            | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `overallLastTimestamp`             | `PnlAnalysisService`    | `SwapAnalysisSummary`   | Implemented                                                                       |
| `totalExecutedSwapsCount`          | `PnlAnalysisService`    | `SwapAnalysisSummary`   | **To Be Implemented** (New)                                                       |
| `averageRealizedPnlPerExecutedSwap`| `PnlAnalysisService`    | `SwapAnalysisSummary`   | **To Be Implemented** (New)                                                       |
| `realizedPnlToTotalVolumeRatio`    | `PnlAnalysisService`    | `SwapAnalysisSummary`   | **To Be Implemented** (New; PNL efficiency)                                     |
| **Advanced Stats Metrics**         |                         |                         | (From `AdvancedStatsAnalyzer`, in `SwapAnalysisSummary.advancedStats`)            |
| `medianPnlPerToken`                | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `trimmedMeanPnlPerToken`           | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `tokenWinRatePercent`              | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `standardDeviationPnl`             | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `profitConsistencyIndex`           | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `weightedEfficiencyScore`          | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `averagePnlPerDayActiveApprox`     | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented                                                                       |
| `firstTransactionTimestamp (adv)`  | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented (covers subset of trades)                                             |
| `lastTransactionTimestamp (adv)`   | `AdvancedStatsAnalyzer` | `AdvancedTradeStats`    | Implemented (covers subset of trades)                                             |

**Behavior Analysis Focus - Updated Table**

| Metric                             | Source Analyzer/Service | Output Structure/Type | Status & Notes                                                                        |
|------------------------------------|-------------------------|-----------------------|---------------------------------------------------------------------------------------|
| **Flipper Metrics**                |                         |                       | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                                       |
| `buySellRatio`                     | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `buySellSymmetry`                  | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `averageFlipDurationHours`         | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `medianHoldTime`                   | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `sequenceConsistency`              | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `flipperScore`                     | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| **Activity Metrics**               |                         |                       | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                                       |
| `uniqueTokensTraded`               | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `tokensWithBothBuyAndSell`         | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `totalTradeCount`                  | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `totalBuyCount`                    | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `totalSellCount`                   | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `completePairsCount`               | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `averageTradesPerToken`            | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| **Time Distribution**              |                         |                       | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                                       |
| `tradingTimeDistribution`          | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `percentTradesUnder1Hour`          | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `percentTradesUnder4Hours`         | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| **Classification**                 |                         |                       | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                                       |
| `tradingStyle`                     | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `confidenceScore`                  | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| **Timestamps**                     |                         |                       | (From `BehaviorAnalyzer`, in `BehavioralMetrics`)                                       |
| `firstTransactionTimestamp`        | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| `lastTransactionTimestamp`         | `BehaviorAnalyzer`      | `BehavioralMetrics`   | Implemented                                                                         |
| **Refined/New Behavioral Metrics** |                         |                       |                                                                                       |
| `tradingFrequency.tradesPerDay`    | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined)                                         |
| `tradingFrequency.tradesPerWeek`   | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined)                                         |
| `tradingFrequency.tradesPerMonth`  | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined)                                         |
| `tokenPreferences.mostTradedTokens`| `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined, replaces `mostTraded`)                  |
| `riskMetrics.averageTransactionValueSol`| `BehaviorAnalyzer` | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined, replaces `averageTransactionSize`)        |
| `riskMetrics.largestTransactionValueSol`| `BehaviorAnalyzer`  | `BehavioralMetrics`   | **To Be Implemented** (Calculation defined, replaces `largestTransaction`)            |
| `reentryRate`                      | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; token re-trade tendency)                              |
| `percentageOfUnpairedTokens`       | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; ratio of incomplete buy/sell token cycles)              |
| `sessionCount`                     | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; count of trade sessions)                                |
| `avgTradesPerSession`              | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; trades per session)                                   |
| `activeHoursDistribution`          | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; `Record<number, number>` of trades per hour) OR representing windows of trading (between 6-12 AM UTC, between 5 and 11 PM even more granular or well though)          |
| `averageSessionStartHour`          | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; avg session start hour)                               |
| `averageSessionDurationMinutes`    | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Implemented** (New; avg session length in minutes)                        |
| **Removed/Postponed Metrics**      |                         |                       |                                                                                       |
| `profitMetrics.*`                  | `N/A (was Behavior)`    | `BehavioralMetrics`   | **To Be Removed** (All fields from `BehavioralMetrics`)                             |
| `riskMetrics.diversificationScore` | `BehaviorAnalyzer`      | `BehavioralMetrics`   | **To Be Removed**                                                                   |
| `tokenPreferences.mostProfitableTokens`| `N/A (was Behavior)`| `BehavioralMetrics`   | **To Be Removed**                                                                   |
| `tokenPreferences.topNetPositiveAmountTokens`| `BehaviorAnalyzer`| `BehavioralMetrics`   | **Postponed/Re-evaluate** (Was `mostHeld`; note concerns about interpretation)        |
| **Future Considerations (Volatility)**|                       |                       |                                                                                       |
| `flipDurationStandardDeviation`    | `BehaviorAnalyzer`      | `BehavioralMetrics`   | *Future Consideration*: Measure consistency in flip times.                            |
| `tradeValueStandardDeviationSol`   | `BehaviorAnalyzer`      | `BehavioralMetrics`   | *Future Consideration*: Measure consistency in trade sizing (SOL value).              |

---
