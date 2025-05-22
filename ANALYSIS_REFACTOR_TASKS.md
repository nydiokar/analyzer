## Analysis Refactoring Tasks (Based on Provided Feedback)

This file tracks the progress of addressing feedback points for the analysis and reporting code.

- [x] **Frequency metrics (`src/core/analysis/behavior/analyzer.ts`):**
    - [x] Fix `tradesPerMonth` and `tradesPerWeek` calculation to use consistent rate logic.
- [x] **Token-win-rate definition (`src/core/analysis/stats/analyzer.ts` and `src/core/services/pnl-analysis-service.ts`):**
    - [x] Unify the denominator for token win rate calculations between the summary and advanced stats.
- [x] **Buy-sell ratio (`src/core/analysis/behavior/analyzer.ts`):**
    - [x] Remove inversion from per-token `buySellRatio` in `groupSwapsByToken`.
- [-] **Net-change column (`src/core/reporting/report_utils.ts`):**
    - [-] Investigated: Current representation of `netAmountChange` (token units) is valid and distinct from P/L in SOL. No change planned.
- [x] **Frequency of zero divisions:**
    - [x] Add guard for `averageTradesPerToken` in `BehaviorAnalyzer`.
    - [x] Review other divisions (most seem handled).
- [x] **Efficiency metrics (`src/core/analysis/stats/analyzer.ts`):**
    - [x] Scale `weightedEfficiencyScore`.
- [-] **Median calculation (`src/core/analysis/stats/analyzer.ts`):**
    - [-] Investigated: Current definition (excluding zero PnL) is explicit. Will note for user consideration rather than changing directly.
- [-] **Trading-window detection (`src/core/analysis/behavior/analyzer.ts`):**
    - [-] Investigated: Caching `smoothedCounts` is a potential optimization. No immediate code change.
- [-] **Session duration (`src/core/analysis/behavior/analyzer.ts`):**
    - [-] Investigated: Current logic for `totalSessionDurationMinutes` appears correct. No change planned.
- [x] **Report generation (`src/core/reporting/report_utils.ts`):**
    - [x] Unify terminology ("trade", "swap", "flip"). Change "trade" to "swap" where general activity is referenced. Keep "flip" for specific behavioral metric.

---
**Legend:**
- [ ] To Do
- [x] Done
- [-] Skipped / No Change Needed After Investigation 