# Critical Logging Surface To Preserve During Refactor

These are the logs that **must survive** the refactor in some equivalent form
(start/end/error triplets and key domain events). Everything else is optional.

---

## 1. Bot Lifecycle & Security (bot.ts, index.ts, commands.ts)

- [Inference] **Bot startup result**
  - Bot successfully launched and connected to Telegram.
  - Bot failed to start (with reason).
  - Unhandled top-level error in main/index.
- [Inference] **Access control + security events**
  - Warning on missing/empty `ALLOWED_TELEGRAM_USER_IDS` (bot runs “open”).
  - Authorized access by user (ID + username).
  - Unauthorized access attempts (User ID + username).
  - Failure to notify admin of unauthorized access.
- [Inference] **Command-level entry points**
  - `/start` received (user ID).
  - Core commands invoked: `/correlation_analysis`, `/analyze_behavior`, `/analyze_advanced`,
    `/pnl_overview`, `/behavior_summary`, `/help` (user, text context).
- [Inference] **Bot shutdown signals**
  - Bot stopping due to signal.
  - Bot stopped gracefully.
- [Inference] **Command pipeline failures**
  - Top-level command handler errors in `analyzeWallets`, `analyzeWalletBehavior`,
    `analyzeAdvancedStats`, `getPnlOverview`, `getBehaviorSummary` (wallet + error).

---

## 2. Wallet Sync / Data Pipeline (helius-sync-service.ts, helius-api-client.ts)

- [Inference] **Per-wallet sync lifecycle**
  - Wallet entry ensured / sync starting for a wallet.
  - SmartFetch Phase 1 (Newer) completed: number of transactions processed.
  - SmartFetch Phase 2 (Older) completed: number of transactions processed.
  - StandardFetch completed with total transactions for wallet.
  - Final SmartFetch/StandardFetch completion per wallet (wallet, final count).
- [Inference] **Critical sync failures**
  - Cannot ensure wallet entry → sync aborted (wallet).
  - CRITICAL: aborting sync for wallet due to non-retryable RPC error (e.g. invalid account).
  - Errors during synchronization for wallet (wallet + cause).
  - Failed to mark wallet as invalid after WrongSize / structural issues.
  - Error getting DB transaction count for wallet.
- [Inference] **API-level phase boundaries (Helius client)**
  - Phase 1 telemetry summary: pages, credits, duration.
  - Phase 1 failure leading to “returning empty list”.
  - Filtered combined transactions down to N relevant transactions involving the target address.
  - High filtering rate WARN (percentage discarded).
  - Helius API client process finished: number of relevant transactions returned.
- [Inference] **Retry exhaustion / hard failures**
  - Max retries reached for:
    - fetching RPC signatures page
    - getTransactionsForAddress
    - batch fetches
    - generic RPC method calls
  - Unrecoverable client errors for RPC methods / batches (status + method).
- [Inference] **Feature degradation switches**
  - Helius V2 disabled (or getTransactionsForAddress V2 disabled) due to hard failure (code/message).
  - RPC signature fetch exceeded safety cap / signature hard limit.

---

## 3. Analysis & Correlation Core (analyzer.ts, correlation-service.ts, behavior-service.ts)

- [Inference] **Similarity / correlation lifecycle**
  - Starting similarity/correlation analysis for N wallets (with relevant config snippet).
  - Pairwise analysis completed with count of correlated pairs.
  - Built wallet clusters (count, min cluster score).
  - Global token analysis summary (unique tokens, popular tokens).
  - Correlation analysis completed successfully.
- [Inference] **Input/feasibility checks**
  - Need at least 2 wallets; cannot perform correlation/similarity (skip reasons).
  - No relevant tokens / no transaction data / less than 2 wallets after filtering.
  - No relevant transactions after full data pipeline for a wallet.
- [Inference] **Behavior analysis lifecycle**
  - Behavior analysis started for wallet.
  - No swap records in given time range.
  - Completed behavior analysis for wallet.
- [Inference] **Critical analysis failures**
  - Error analyzing behavior for wallet.
  - Error fetching data for correlation analysis.
  - Errors in mapping / advanced stats that break the analysis run.

---

## 4. PnL / Wallet State Analysis (pnl-analysis-service.ts, pnl_calculator.ts)

- [Inference] **PnL analysis lifecycle per wallet**
  - PnlAnalysisService instantiated (with/without Helius client).
  - Starting PnL analysis for wallet.
  - Retrieved / using stored or pre-fetched wallet state (SOL + token counts).
  - Successfully fetched wallet state (with basic SOL/token info).
  - Analysis completed for wallet (time range + transaction count).
  - Successfully marked AnalysisRun as COMPLETED (runId).
- [Inference] **Core summary metrics**
  - Calculating PNL for N wallets.
  - Per-wallet PNL debug line (`walletAddress`, PNL value).
- [Inference] **Important fallbacks / degradations**
  - Failed to fetch wallet state → proceeding without live balances.
  - WalletBalanceService not active (no Helius client) → skipping live balances.
  - No swap input records for wallet (time range info).
  - No non-stablecoin results for advanced stats (warn).
  - Skipping unrealized PnL due to missing SOL price or suspicious prices/tokens.
- [Inference] **Critical PnL failures**
  - Error fetching swap inputs for wallet.
  - Error in PnL logic for wallet.
  - Critical error during PnL analysis for wallet.
  - FAILED to update AnalysisRun to FAILED status.
  - Error in finally block updating AnalysisRun.

---

## 5. Reporting Surface (reportGenerator.ts, report_utils.ts)

- [Inference] **Report generation lifecycle**
  - ReportingService instantiated.
  - Generating behavior / correlation / similarity / comparison reports (wallet counts/types).
  - Generating individual behavior report / Swap PnL report / CSV for wallet.
- [Inference] **Report saved locations**
  - Saved individual report for wallet to path.
  - Saved comparative report to path.
  - Saved correlation report to path.
  - Saved similarity report to path.
  - Saved Swap PnL report / CSV to path.
  - Created reports directory at path.
- [Inference] **Report precondition warnings**
  - No wallets provided for comparison/correlation report.
  - No metrics/summary provided → cannot generate given report.
  - Report not generated because analysis produced no results.
- [Inference] **Report failures**
  - Error generating/saving comparison report.
  - Error generating/saving correlation report.
  - Error generating/saving similarity report.
  - Error generating/saving Swap PnL report or CSV.
  - Error unparsing CSV data.

---

## 6. Dex / Price / Metadata Fetching (dexscreener-service.ts, onchain-metadata.service.ts)

- [Inference] **DexScreener pipeline**
  - Pre-filter summary: tokens likely not in DexScreener (counts, ratios).
  - DexScreener progress (percentage, processed vs total tokens).
  - Final DexScreener results summary: API calls, tokens processed.
  - Error per chunk and final failure after retries for DexScreener fetches.
- [Inference] **Price fetch & reliability**
  - Using cached SOL price.
  - Successfully fetched SOL price from source (value).
  - Warnings for unreasonable/no price/failed fetch per source.
  - Final failure after max retries for price/token data fetch.
- [Inference] **On-chain metadata security checks**
  - Security violations (unsafe URIs, non-trusted gateways).
  - Truncation of strings/arrays and removal of dangerous keys from metadata.
  - Failed to fetch basic metadata from DAS.
  - Security validation failed for URI.
  - Retry attempts for metadata fetch with delay.

---

## 7. Display vs Logging Boundary (display-utils.ts, CLI tools)

- [Inference] **Keep as “output”, not “logs”**
  - Swap analysis summaries, tables, top tokens, gainers/losers, value preservation breakdowns.
  - Activity time range and formatted summaries intended for **human CLI consumption**.
- [Inference] **Rule**
  - These stay conceptually, but must migrate to:
    - dedicated “output/renderer” functions
    - or direct `stdout` / response bodies
  - They should **not** remain in the logging stream once refactoring is done.

---

## 8. Config / Sanity Warnings (bot.ts, cliUtils.ts, helius-sync-service.ts, mint-participants.ts)

- [Inference] **Config / environment sanity**
  - Missing or invalid `ALLOWED_TELEGRAM_USER_IDS`, `HELIUS_API_KEY`, etc.
  - Invalid CLI time range formats (start/end date).
- [Inference] **Sync/scan limits**
  - Owners hitting `MAX_PAGES` in mint participants scans (early stop).
  - SmartFetch / StandardFetch called with invalid `maxSignatures` (warn).
- [Inference] **General “can’t proceed usefully” warns**
  - No relevant transactions/tokens after heavy filtering where the flow “logically ends”.

