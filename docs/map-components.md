# Component Migration Map

This document maps functionalities from the original scripts (`src/scripts/`) to their new locations in the refactored structure (`src/wallet_analysis/`).

## `activityCorrelator.ts`

| Original Functionality         | Status        | New Location / Target                     | Notes                                         |
| ------------------------------ | ------------- | ----------------------------------------- | --------------------------------------------- |
| Fetch Transactions             | Ported        | `DatabaseService`                         | Via `CorrelationService`                      |
| Global Token Stats Calc        | Ported        | `core/correlation/analyzer.ts`            | `CorrelationAnalyzer.getGlobalTokenStats`     |
| Pairwise Analysis (Score)      | Ported        | `core/correlation/analyzer.ts`            | `CorrelationAnalyzer.analyzeCorrelations`     |
| Clustering                     | Ported        | `core/correlation/analyzer.ts`            | `CorrelationAnalyzer.identifyClusters`        |
| Report Generation/Saving       | Ported        | `services/ReportingService` / `reporting/report_utils.ts` | Via `CorrelationService` / `generateCorrelationReport` |
| PNL Calculation                | Ported        | `utils/pnl_calculator.ts`                 | Via `CorrelationService`                      |
| Bot Filtering                  | Ported        | `services/CorrelationService`             | Internal method `filterWalletsByActivity`     |
| CLI Parsing                    | Script-Local  | `scripts/activityCorrelator.ts`           | Handles args, orchestrates service calls      |
| DB Interaction (Prisma)        | Ported        | `DatabaseService`                         | Via `CorrelationService`                      |

## `helius-analyzer.ts`

| Original Functionality         | Status        | New Location / Target                     | Notes                                                |
| ------------------------------ | ------------- | ----------------------------------------- | ---------------------------------------------------- |
| Helius API Client Usage        | Assumed Ported| `services/helius-api-client.ts`           | External client logic (as per plan)                  |
| Transaction Mapping            | Assumed Ported| `services/helius-transaction-mapper.ts`   | Transformation logic (as per plan)                 |
| Swap Record Analysis           | **Remaining** | TBD (e.g., `core/transfer/analyzer.ts`?)  | Plan mentions `transfer-analyzer-service`, missing    |
| Advanced Stats Calculation     | **Remaining** | TBD (e.g., `core/stats/analyzer.ts`?)     | Plan mentions `advanced-stats-service`, missing       |
| Database Interaction           | Ported        | `DatabaseService`                         | Linter errors indicate import issues need fixing |
| Reporting (TXT/CSV)            | **Remaining** | `services/ReportingService` / `reporting/report_utils.ts` | Needs integration                                |
| CLI Parsing                    | Script-Local  | N/A (Replaced by Service/API calls)       | -                                                    |
| Time Range/Period Handling     | **Remaining** | `services/*` / API Layer                  | Needs porting to service/API layer                   |
| Smart Fetch / Fetch Logic      | **Remaining** | Data Fetching Layer (DB Service/API Client) | Needs porting                                        |

## `wallet-behavior-analyzer.ts`

| Original Functionality         | Status                 | New Location / Target                     | Notes                                      |
| ------------------------------ | ---------------------- | ----------------------------------------- | ------------------------------------------ |
| Fetch Swap Inputs              | Ported                 | `DatabaseService`                         | Via `BehaviorService`                      |
| Token Sequence Building        | Ported                 | `core/behavior/analyzer.ts`            | `BehaviorAnalyzer` methods                 |
| Metrics Calculation            | Ported                 | `core/behavior/analyzer.ts`            | `BehaviorAnalyzer` methods                 |
| Trading Style Classification   | Ported                 | `core/behavior/analyzer.ts`            | `BehaviorAnalyzer.classifyTradingStyle`    |
| Report Generation/Saving       | Ported                 | `services/ReportingService` / `report_utils.ts` | `generateAndSaveIndividualBehaviorReport`   |
| CLI Parsing                    | Script-Local (Refactored) | `scripts/wallet-behavior-analyzer.ts`     | Handles args, orchestrates service calls      |
| Empty Metrics Getter           | Ported                 | `core/behavior/analyzer.ts`            | `BehaviorAnalyzer.getEmptyMetrics`         |

## `kpi-comparison-report.ts`

| Original Functionality         | Status                 | New Location / Target                     | Notes                                           |
| ------------------------------ | ---------------------- | ----------------------------------------- | ----------------------------------------------- |
| Multi-Wallet Behavior Analysis | Ported                 | `services/ReportingService`               | Uses `BehaviorService`                          |
| Individual Report Generation   | Ported                 | `services/ReportingService` / `report_utils.ts` | Handled within `generateComparativeBehaviorReport` |
| Comparative Report Generation  | Ported                 | `core/reporting/kpi_analyzer.ts`          | `KPIComparisonAnalyzer.generateComparisonReport`    |
| Report Saving                  | Ported                 | `services/ReportingService` / `report_utils.ts` | Handled within `generateComparativeBehaviorReport` |
| CLI Parsing                    | Script-Local (Refactored) | `scripts/kpi-comparison-report.ts`        | Handles args, orchestrates service calls        |

## `walletSimilarity.ts`

| Original Functionality         | Status        | New Location / Target                     | Notes                                         |
| ------------------------------ | ------------- | ----------------------------------------- | --------------------------------------------- |
| Fetch Transactions             | Ported        | `DatabaseService`                         | Via `SimilarityService`                       |
| Shared Token Analysis          | **Remaining** | TBD (Could be `core/similarity` or separate) | Not in current `SimilarityAnalyzer`         |
| Vector Creation (Capital/Bin)  | Ported        | `core/similarity/analyzer.ts`           | `SimilarityAnalyzer` methods                |
| Vector Creation (Simple)       | Not Ported    | N/A                                       | Deprecated/unused                             |
| Similarity Calculation (Cos)   | Ported        | `core/similarity/analyzer.ts`           | `SimilarityAnalyzer` methods                |
| Similarity Calculation (Jaccard)| Ported        | `core/similarity/analyzer.ts`           | `SimilarityAnalyzer.calculateJaccardSimilarity` |
| Report Generation/Saving       | **Remaining** | `services/ReportingService` / `reporting/report_utils.ts` | Needs integration                             |
| CLI Parsing                    | Script-Local  | N/A (Replaced by Service/API calls)       | -                                             |
