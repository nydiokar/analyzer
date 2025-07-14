# Wallet Analysis Debug Log

This document tracks observations, identified problems, and proposed solutions for refining the wallet analysis metrics.

## Actionable Next Steps & Remaining Issues
*(Updated based on latest analysis and reports)*

1.  **Reporting/Display Layer Adjustments:**
    *   **Percentage Display**: Metrics like `ActivityFocusScore`, window `percentageOfTotalTrades`, and `percentageOfUnpairedTokens` are currently displayed with an apparent extra x100 factor in reports (e.g., a calculated 39.25% is shown as 3925.0%). This needs correction in the report generation/rendering code to display the correct percentage values.
    *   **Trading Window Timestamps**: `IdentifiedTradingWindow.startTimeUTC` and `endTimeUTC` are calculated as hour numbers (0-23) by `BehaviorAnalyzer.ts`. Reports display these as full `1970-01-01T...` timestamps. The report generation should be updated to format these as hour-of-day strings (e.g., "02:00 UTC", "15:00 UTC").

2.  **Type Definitions & Report Template Updates:**
    *   The `BehavioralMetrics` type definition (likely in `src/types/behavior.d.ts`) must be updated to include `tokensWithOnlyBuys: number;` and `tokensWithOnlySells: number;`. These fields were added to the `BehaviorAnalyzer.ts` calculation logic.
    *   The behavior report template should be updated to display these new `tokensWithOnlyBuys` and `tokensWithOnlySells` metrics for better clarity on token activity patterns.

3.  **`EXCLUDED_TOKEN_MINTS` List (Ongoing Verification):**
    *   While foundational filtering for SPL tokens is in place (Problem 1.3) and major discrepancies with PNL service counts appear resolved (Problems 5.1, 5.2, based on new reports), the `EXCLUDED_TOKEN_MINTS` list in `BehaviorAnalyzer.ts` should be periodically reviewed and updated if new or uncommon utility/stablecoin mints are found to be inappropriately influencing behavioral metrics.

## 2. Behavioral Metrics: Trading Frequency & Volume

*   **Problem 1.1**: `tradesPerDay` reported as excessively high (e.g., "204 trades per day" from a sample of ~500 transactions over a few days).
    *   **Status**: [RESOLVED]
    *   **Action Taken (BehaviorAnalyzer.ts)**: Modified `tradesPerDay` calculation in `BehaviorAnalyzer.ts`. If activity spans less than 1 actual day, `tradesPerDay` is `totalTradeCount` (normalized over 1 day). Otherwise, `totalTradeCount / actualDurationDays`.
    *   **Observation from latest report (JDAFfL...)**: `Trades per Day: 163.73` for `~2.44 days` of activity with `400` total trades. This calculation (`400 / 2.44 ≈ 163.93`) is consistent and addresses the previous concern about inflation for short periods.

*   **Problem 1.2**: `tradesPerWeek` and `tradesPerMonth` seem to be direct multiples of `tradesPerDay`... not calculated from actual trading activity spread over those periods.
    *   **Status**: [RESOLVED]
    *   **Action Taken (BehaviorAnalyzer.ts)**: Modified logic in `BehaviorAnalyzer.ts`. If `actualDurationDays` is less than the respective period (7 days for a week, ~30.44 days for a month), the metric now shows `totalTradeCount` for that period. Otherwise, it's a calculated rate based on `tradesPerDay`.
    *   **Observation from latest report (JDAFfL...)**: For `~2.44 days` of activity, `Trades per Week: 400.00` and `Trades per Month: 400.00` (matching `Total Swaps Recorded: 400`). This correctly reflects the total activity within these shorter-than-period observation times.

*   **Problem 1.3 (Critical Filter)**: Metrics seem to be including non-SPL tokens (USDC, USDT, SOL, wSOL). **Requirement**: All behavioral metrics must be calculated *only* on the basis of actual SPL tokens the wallet has *bought or sold*.
    *   **Status**: [INVESTIGATED - MECHANISM IN PLACE, SIGNIFICANTLY IMPROVED/LIKELY RESOLVED FOR MAJOR CASES]
    *   **Findings**: `BehaviorAnalyzer.ts` has an `EXCLUDED_TOKEN_MINTS` list (which includes common utility tokens like SOL, USDC, USDT) and applies this filter at the start of its `analyze` method. The latest reports (Problems 5.1, 5.2) show that PNL service and Behavior service counts for total swaps and unique tokens now align, suggesting that the filtering of these major utility tokens is consistent and effective.
    *   **Action Taken**: No change to the filtering logic in `BehaviorAnalyzer.ts` as it was already present and seems effective for common cases. If other specific non-SPL tokens are found to be issues, their mint addresses would need to be added to the `EXCLUDED_TOKEN_MINTS` list.

*   **Investigation Needed (Original)**:
    *   How are `enrichedTransactions` (input to `BehaviorAnalyzer`) filtered before or during `calculateTradingFrequency`?
        *   **Answer**: Filtered at the start of `BehaviorAnalyzer.analyze` method using the `EXCLUDED_TOKEN_MINTS` list before any metric calculation.
    *   What is the exact definition of a "trade" for this metric? Is it one Helius transaction, or one "swap event" within a transaction?
        *   **Answer**: For `BehaviorAnalyzer`'s `totalTradeCount` (reported as `Total Swaps Recorded`), a "trade" corresponds to one `SwapAnalysisInput` record after filtering. This generally represents a single token movement (an 'in' or 'out' event).
    *   How is the "active trading period" determined for normalizing `tradesPerDay`? If the wallet was active for 2 days, is it total trades / 2?
        *   **Answer**: It's determined by `lastTransactionTimestamp - firstTransactionTimestamp` from the filtered set of transactions. The normalization logic for `tradesPerDay` has been updated as noted in Problem 1.1.
    *   Confirm how `tradesPerWeek`/`tradesPerMonth` are derived. If the data span is less than a week/month, simple multiplication is misleading.
        *   **Answer**: Derivation logic has been updated as noted in Problem 1.2 to show total counts for short spans, addressing the misleading multiplication.

## 3. Behavioral Metrics: Active Trading Periods

*   **Problem 2.1**: `activityFocusScore` reported as `2700%` (latest report shows `5475.0%`). Expected range was 0-1 or 0-100%.
    *   **Status**: [INVESTIGATED - EXTERNAL ISSUE (REPORTING)]
    *   **Findings**: The calculation in `BehaviorAnalyzer.ts` is `(tradesInAllWindows / totalTrades) * 100`, which correctly produces a percentage value (e.g., the latest report data implies `(219 relevant trades / 400 total trades) * 100 = 54.75%`). The report displaying `5475.0%` indicates an extraneous x100 factor applied during reporting/display.
    *   **Action Taken**: None to `BehaviorAnalyzer.ts` calculation logic. The fix lies in the reporting layer.

*   **Problem 2.2**: `identifiedWindows` in `activeTradingPeriods` shows only one window, and the `startTimeUTC` and `endTimeUTC` are `1970-01-01T...`. This indicates a date parsing or initialization error.
    *   **Status**: [INVESTIGATED - EXTERNAL ISSUE (REPORTING/TYPE USAGE)]
    *   **Findings**: `BehaviorAnalyzer.ts` calculates `startTimeUTC` and `endTimeUTC` for these windows as hour numbers (0-23). The report displaying these as full `1970-01-01T...` timestamps (e.g., `1970-01-01 00:00:02 UTC` for hour 2) suggests these hour numbers are being misinterpreted as full Unix timestamps (seconds from epoch) by the reporting layer or due to how the `IdentifiedTradingWindow` type is defined and consumed. Input timestamp processing (`new Date(ts * 1000)`) in `BehaviorAnalyzer` is correct if input `ts` is in seconds.
    *   **Action Taken**: None to `BehaviorAnalyzer.ts` logic regarding hour calculation. The fix is likely in how these hour numbers are typed, stored, and ultimately displayed in reports.

*   **Investigation Needed (Original)**:
    *   Review the calculation logic for `activityFocusScore` in `BehaviorAnalyzer.calculateSessionMetrics` or its helpers. - **Done**. Logic seems sound for a 0-100 value.
    *   Trace how `startTimeUTC` and `endTimeUTC` for `IdentifiedTradingWindow` are derived in `_identifyActiveTradingWindows`. Look for issues with timestamp conversion or default date values. - **Done**. Derived as numbers 0-23 representing UTC hours.

## 4. Behavioral Metrics: Token Preferences

*   **Problem 3.1**: `mostTradedTokens` (and potentially other token preference lists) might be including wSOL or other utility/gas tokens.
    *   **Status**: [INVESTIGATED - MECHANISM IN PLACE]
    *   **Findings**: `mostTradedTokens` in `BehaviorAnalyzer.ts` are derived from `tokenSequences`, which are built from `swapRecords` that have *already* been filtered by the `EXCLUDED_TOKEN_MINTS` list. This should prevent listed utility tokens from appearing. If they still do, the `EXCLUDED_TOKEN_MINTS` list may need an update for specific mints not covered, or the input `mint` data might be inconsistent.
    *   **Action Taken**: None to `BehaviorAnalyzer.ts` logic for this, as the filtering is applied prior to this calculation.

*   **Investigation Needed (Original)**:
    *   Examine `BehaviorAnalyzer.calculateTokenPreferences` (this logic is within `calculateBehavioralMetrics`). - **Done**.
    *   How are token lists (e.g., for `mostTradedTokens`) generated? - **Done**. Derived from filtered `tokenSequences`, sorted by trade count.
    *   Is there a common utility function or list of "excluded tokens" that can be applied consistently? - **Yes**, `EXCLUDED_TOKEN_MINTS` applied at the start of `analyze()`.

## 5. Behavioral Metrics: Activity Summary & Patterns

*   **Problem 4.1 (Mismatch/Clarity)**: `activitySummary.completeBuySellPairs` reported as 65, while `activitySummary.uniqueTokensTraded` is 60. (Latest report: 117 pairs vs. 112 unique tokens).
    *   **Status**: [INVESTIGATED - CLARIFIED, LOGIC SOUND]
    *   **Findings**: It is arithmetically possible and logical for the total count of "complete buy/sell pairs" to exceed the number of "unique tokens traded," as a single token can undergo multiple buy-sell cycles. The logic in `BehaviorAnalyzer.ts` for `completePairsCount` appears sound.
    *   **Action Taken**: None to `BehaviorAnalyzer.ts` calculation.

*   **Problem 4.2 (Mismatch/Clarity)**: `patternsAndInteraction.tokensWithOnlyBuysNoSells` is 14, while `completeBuySellPairs` is 65. How do these relate?
    *   **Status**: [PARTIALLY RESOLVED - METRICS ADDED TO ANALYZER FOR CLARITY]
    *   **Findings**: These are different types of metrics (a count of *tokens* with a specific pattern vs. a total count of *pair events*). To provide better context:
    *   **Action Taken (BehaviorAnalyzer.ts)**: Added `tokensWithOnlyBuys: number;` and `tokensWithOnlySells: number;` to the `BehavioralMetrics` structure and calculation logic in `BehaviorAnalyzer.ts`. These new fields will allow for a full accounting: `uniqueTokensTraded = tokensWithBothBuyAndSell + tokensWithOnlyBuys + tokensWithOnlySells`.
    *   **Follow-up Needed**: The `BehavioralMetrics` type definition needs updating, and report templates need to be modified to display these new metrics.
    *   **Observation from latest report**: The `Percentage of Unpaired Tokens: 714.3%` also appears to have the x100 display issue (calculated as `((112-104)/112)*100 = 7.14%`).

*   **Investigation Needed (Original)**:
    *   Review `BehaviorAnalyzer.calculateOverallActivityPatterns` (relevant logic is within `calculateBehavioralMetrics`). - **Done**.
    *   Clarify the definition of a "complete buy/sell pair." - **Done**. Logic counts sequential buy-then-sell events for each token.
    *   Ensure the counting logic for `uniqueTokensTraded`, `tokensWithOnlyBuysNoSells`, `tokensWithOnlySellsNoBuys`, and `completeBuySellPairs` is distinct and accurate. - **Done**. Logic for existing metrics is distinct. New metrics `tokensWithOnlyBuys` and `tokensWithOnlySells` added for comprehensive, distinct counts.

## 6. PNL Report vs. Behavior Report Discrepancies

*   **Problem 5.1 (Swap Counts)**:
    *   PNL Report (`SwapAnalysisSummary`): `totalExecutedSwapsCount` (was 136).
    *   Behavior Report (`BehavioralMetrics`): `activitySummary.totalTradeCount` (derived from ~474 raw records).
    *   **Status**: [RESOLVED (Based on latest reports)]
    *   **Findings from latest reports (JDAFfL...)**:
        *   PNL Report: `Total Executed Swaps: 400`.
        *   Behavior Report: `Total Swaps Recorded: 400`.
        *   **The counts now match.** This indicates that the filtering mechanisms in both PNL (`isValuePreservation` via `SwapAnalyzer`) and Behavior (`EXCLUDED_TOKEN_MINTS`) services are now yielding consistent total transaction counts.
    *   **Action Taken**: Investigation previously confirmed differing definitions. The alignment in new reports suggests this is resolved at the data/filtering level.

*   **Problem 5.2 (Token Counts for Win Rate)**: PNL report mentions a "base of token win rate" of 36 tokens. How does this relate to `uniqueTokensTraded` (60) from the behavior report.
    *   **Status**: [RESOLVED (Based on latest reports)]
    *   **Findings from latest reports (JDAFfL...)**:
        *   PNL Report: "Token Win Rate: 21.4% (based on 112 tokens)".
        *   Behavior Report: `Unique Tokens Traded: 112`.
        *   **The token counts used as a base now match.** This suggests the set of tokens considered for PNL calculations and behavioral analysis (after respective filtering) is now consistent.
    *   **Action Taken**: Investigation previously confirmed differing definitions. Alignment in new reports suggests this is resolved.

*   **Investigation Needed (Original)**:
    *   **Crucial**: Re-verify the exact definition of `totalExecutedSwapsCount` in `PnlAnalysisService`. - **Done**. It's the sum of `transferCountIn` and `transferCountOut` for tokens not flagged as `isValuePreservation`.
    *   Compare this with how "trades" or "swaps" are counted for behavioral metrics. - **Done**. Behavior's `totalTradeCount` is the sum of all filtered `SwapAnalysisInput` records. The new reports show these two counts are now aligned at 400.
    *   Understand how the "36 tokens" for win rate calculation are selected. - **Done**. This was the PNL service's count of tokens not flagged as `isValuePreservation`. The new reports show this count is now 112, aligning with Behavior's `uniqueTokensTraded`.

## General Approach for Investigation

For each problem area:
1.  **Locate**: Find the primary function(s) in the codebase responsible for the metric.
2.  **Understand**: Read the code to understand the current implementation, data sources, and any filtering or transformation logic.
3.  **Hypothesize**: Formulate a hypothesis for why the observed behavior is occurring.
4.  **Propose Solution**: Suggest specific code changes or clarifications to address the issue.
5.  **Verify**: (After implementation) Check new reports to confirm the fix.

---
*(Original "Next steps" section of the document can be considered superseded by the "Actionable Next Steps & Remaining Issues" at the top).*
