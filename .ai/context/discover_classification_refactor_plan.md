# Discover Classification Refactor - Current State, Contract, and Migration Plan

**Status:** Draft / For Implementation
**Scope:** Classification taxonomy and filter contract for Discover (no PnL changes here)
**Last updated:** 2025-01-__

---

## 1) Why This Exists

The Discover page needs **filterable, explainable, and stable** wallet classifications. The current implementation uses **overlapping taxonomies** and a **composite string** (`tradingStyle`) that mixes speed and buy/sell pattern. This prevents precise filters and causes mislabeling for holders (especially buy-only wallets) due to minimum trade constraints.

This document defines a single centralized classification contract and a migration path that:
- preserves backward compatibility,
- keeps speed and flow behavior separate,
- avoids the HOLDER naming collision,
- integrates current-hold behavior without forcing “Low Activity”.

---

## 2) Current State (What Actually Exists)

### 2.1 DB Storage (WalletBehaviorProfile)
- Stored fields are **raw metrics + `tradingStyle` string** only.
- No stored `speedCategory`, `flowPattern`, `strategyType`, or active-hold fields.

**Schema refs**:
- `prisma/schema.prisma` (`WalletBehaviorProfile`): holds `tradingStyle`, `uniqueTokensTraded`, `totalBuyCount`, `totalSellCount`, `medianHoldTime`, etc.

### 2.2 Classification Logic (Analyzer)
There are **two speed taxonomies** and **one pattern taxonomy**:

1) **TradingSpeedCategory** (ULTRA_FLIPPER → POSITION_TRADER)
- Used to compute `speedCategory` in `tradingStyle`.
- Derived from `medianHoldHours` (flip durations from completed buy→sell pairs).
- **Active holdings do NOT feed this speed.**

2) **HolderBehaviorType** (SNIPER → HOLDER)
- Derived from `medianCompletedHoldTimeHours` (completed positions only).
- Stored in `metrics.historicalPattern.behaviorType`.
- Intended for holder/exit modeling.

3) **BehavioralPattern** (ACCUMULATOR / DISTRIBUTOR / BALANCED / HOLDER / DUMPER)
- Derived from buy/sell ratios and counts.
- Mixed into `tradingStyle` string.

**Where it happens:**
- `src/core/analysis/behavior/analyzer.ts`
- `src/core/analysis/behavior/constants.ts`

### 2.3 Discover Filtering
- Discover filters use the **composite `tradingStyle` string**.
- This merges speed + flow pattern and creates ambiguity.

**Where it happens:**
- `src/api/services/discover.service.ts`
- `dashboard/src/app/discover/page.tsx`

### 2.4 Holder Edge Case
- There is a **low-activity gate** that requires minimum trades AND minimum tokens with both buy+sell.
- Pure holders frequently fall into **Low Activity** despite being active buyers.

**Where it happens:**
- `src/core/analysis/behavior/analyzer.ts` (minimum trade gate)

---

## 3) Root Problems (Why Discover Filtering Is Broken)

1) **Composite String = Ambiguous Filter**
   - `"DAY_TRADER (ACCUMULATOR)"` mixes speed and flow, so a “style” filter is not a style.

2) **HOLDER Collision**
   - `HOLDER` appears in both speed taxonomy and flow pattern taxonomy but with different meanings.

3) **Two Speed Systems Compete**
   - `ULTRA_FLIPPER...POSITION_TRADER` vs `SNIPER...HOLDER`.
   - Only one should be canonical for Discover filters.

4) **Current Holdings Not Represented**
   - Current holding durations are computed but not stored.
   - Buy-only wallets get “Low Activity” because classification requires completed cycles.

5) **Derived “behaviorType” from strings** (cache reconstruction)
   - Substring parsing from `tradingStyle` is incorrect because the string does not contain SNIPER/SCALPER/etc.

---

## 4) Proposed Contract (Centralized, Explicit, Filterable)

### 4.1 Canonical Fields

**(A) speedCategory**
- Enum: `SNIPER | SCALPER | MOMENTUM | INTRADAY | DAY_TRADER | SWING | POSITION | HOLDER`
- Source: **completed positions only** (`medianCompletedHoldTimeHours`).
- If no completed cycles, value should be `null` (unknown speed).

**(B) flowPattern** (rename of behavioralPattern)
- Enum: `BUY_ONLY | SELL_ONLY | ACCUMULATOR | DISTRIBUTOR | BALANCED | MIXED`
- Source: buy/sell counts and ratios.
- Avoids the `HOLDER` collision.

**(C) strategyType** (single “style” filter)
- Enum example:
  - `HOLDER` (flowPattern = BUY_ONLY)
  - `FAST_TRADER` (speedCategory in SNIPER/SCALPER/MOMENTUM)
  - `DAY_TRADER` (speedCategory = DAY_TRADER)
  - `SWING_TRADER` (speedCategory = SWING)
  - `POSITION_TRADER` (speedCategory in POSITION/HOLDER)
  - `ACCUMULATOR` (flowPattern = ACCUMULATOR)
  - `DISTRIBUTOR` (flowPattern = DISTRIBUTOR)
  - `BALANCED_TRADER` (flowPattern = BALANCED)
  - `LOW_ACTIVITY` (only when truly insufficient trade evidence)

**(D) tradingStyleLabel** (display only)
- Human-readable label composed from the above.
- Never used for filtering.

### 4.2 Why This Works
- Speed and flow are separate dimensions.
- Strategy is a stable, UI-friendly filter.
- Holders are handled by flowPattern, not forced into low activity.

---

## 5) Integration of Current Holdings (Without Breaking Speed)

Current holdings should never “rewrite” speedCategory.

### 5.1 Define Holder Signals
Use existing metrics + new derived values:
- `tokensWithOnlyBuys` (already computed in analyzer)
- `percentOfValueInCurrentHoldings` (computed, not stored)
- `medianCurrentHoldingDurationHours` (computed, not stored)

### 5.2 New Holder Signal (Derived)
Introduce `activeHoldSignal` (internal):
- `true` if `tokensWithOnlyBuys > 0` **and** `medianCurrentHoldingDurationHours >= HOLDING_THRESHOLDS`
- This signal can influence strategyType:
  - If no completed cycles, but `activeHoldSignal` is true → `strategyType = HOLDER` rather than `LOW_ACTIVITY`.

### 5.3 Avoiding False “Low Activity”
- Update classification rules so **buy-only wallets are not gated out** when they have:
  - meaningful trade count, and
  - active holding durations above dust thresholds.

---

## 6) Centralized Classification Rule Set (Proposed)

Order of classification (deterministic):

1) **Insufficient data**
   - If `totalTradeCount < MIN_TRADES_FOR_ANALYSIS` AND `activeHoldSignal = false`, set `strategyType = LOW_ACTIVITY` and stop.

2) **Pure buy-only holders**
   - If `flowPattern = BUY_ONLY`, set `strategyType = HOLDER`.

3) **Speed-based strategy**
   - If `speedCategory` exists:
     - SNIPER/SCALPER/MOMENTUM → `FAST_TRADER`
     - INTRADAY/DAY_TRADER → `DAY_TRADER`
     - SWING → `SWING_TRADER`
     - POSITION/HOLDER → `POSITION_TRADER`

4) **Flow-based fallback**
   - If no speedCategory:
     - ACCUMULATOR/DISTRIBUTOR/BALANCED/MIXED → corresponding strategyType

This yields deterministic output and avoids mixing unrelated labels.

---

## 7) DB/Storage Strategy

### 7.1 Short-term (non-breaking)
- Keep `tradingStyle` as-is for backward compatibility.
- Add computed fields to API response (not DB yet):
  - `speedCategory`, `flowPattern`, `strategyType`, `tradingStyleLabel`.

### 7.2 Medium-term (preferred)
Persist classification fields in `WalletBehaviorProfile`:
- `speedCategory`
- `flowPattern`
- `strategyType`
- `tradingStyleLabel`
- `medianCurrentHoldingDurationHours`
- `percentOfValueInCurrentHoldings`

This avoids recomputation at read time and keeps Discover fast.

---

## 8) Discover Filtering Rules

**Filters must target enums only**:
- `speedCategory`: time-based behavior from exited positions.
- `flowPattern`: buy/sell bias.
- `strategyType`: primary style.

**Never filter by `tradingStyleLabel`.**

Example queries:
- “Fast accumulators”: `speedCategory IN (SNIPER, SCALPER, MOMENTUM)` + `flowPattern = ACCUMULATOR`
- “Pure holders”: `strategyType = HOLDER` OR `flowPattern = BUY_ONLY`
- “Swing distributors”: `speedCategory = SWING` + `flowPattern = DISTRIBUTOR`

---

## 9) Known Pitfalls to Avoid

1) **Parsing strings for behavior**
   - Substring parsing from `tradingStyle` is already incorrect. Remove once enums exist.

2) **Overwriting speed with active holdings**
   - Speed must remain **exited-only**. Use a separate holder signal for active positions.

3) **Low Activity swallowing holders**
   - Update gating logic to respect active holdings.

4) **Mixed signals in one label**
   - Do not collapse speed + flow into a single enum.

5) **Silent behavior changes**
   - Any change to thresholds must be documented and versioned because it affects filters and UI.

---

## 10) Validation Checklist (Post-Refactor)

- Buy-only wallet with active holding duration:
  - `flowPattern = BUY_ONLY`
  - `strategyType = HOLDER`
  - `speedCategory = null`

- Active trader with exits:
  - `speedCategory` present, `flowPattern` computed
  - `strategyType` derived by speed

- Mixed exits + holdings:
  - `speedCategory` still based on exits only
  - `strategyType` derived by speed; holder signal shown separately

- Discover filters return expected results without string parsing.

---

## 11) Usage Map (Where Classification Is Consumed)

This is a non-exhaustive map of every consumer of classification-related fields. It is the impact surface for refactors.

### 11.1 Backend (API / Services)

- Discover filtering and sorting use `tradingStyle` string.  
  `src/api/services/discover.service.ts`
- Discover response includes `tradingStyle` and derives reasons from it.  
  `src/api/services/discover.service.ts`
- Behavior cache reconstruction infers `behaviorType` via substring matching on `tradingStyle` (currently incorrect).  
  `src/api/services/behavior.service.ts`
- Wallet summary API returns `behaviorClassification = tradingStyle`.  
  `src/api/controllers/wallets.controller.ts`
- Behavior analysis response DTO exposes `speedCategory`, `behavioralPattern`, `behaviorType`, `tradingStyle`, `tradingInterpretation`, `historicalPattern`.  
  `src/api/shared/dto/behavior-analysis-response.dto.ts`
- Discover query DTO documents style filter as `tradingStyle`.  
  `src/api/shared/dto/discover-wallet.dto.ts`

### 11.2 Backend (Queues / Processing)

- `analysis-operations.processor` uses `historicalPattern` and `behaviorType` for holder risk analytics and insights.  
  `src/queues/processors/analysis-operations.processor.ts`
- Job payloads reference `behaviorType`.  
  `src/queues/jobs/types/index.ts`

### 11.3 Types / Contracts

- Core behavior types define `behaviorType`, `speedCategory`, `behavioralPattern`, `tradingStyle`.  
  `src/types/behavior.ts`
- Client API types mirror the same fields.  
  `dashboard/src/types/api.ts`
- Discover types include `tradingStyle`.  
  `dashboard/src/types/discover.ts`

### 11.4 Dashboard UI

- Discover page uses `tradingStyle` for display and fallback labels.  
  `dashboard/src/app/discover/page.tsx`
- Behavioral Patterns tab uses `tradingInterpretation` and `historicalPattern` with tooltips referencing thresholds.  
  `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`
- Holder profile v2 uses `behaviorType` for labels and fallback “holder” logic when exits are missing.  
  `dashboard/src/components/holder-profiles/v2/*`

### 11.5 Scripts / Offline Reports

- `validate-behavior-metrics`, `generate-holder-analysis`, `validate-holder-risk`, and prediction reports depend on `historicalPattern` and `behaviorType`.  
  `src/scripts/*`

---

## 12) Threshold Map (Current Sources of Truth)

This section enumerates every threshold that affects classification or display. Today, these live in multiple places and sometimes diverge. The contract should define a single canonical source to prevent drift.

### 11.1 Speed Taxonomies

**A) TradingSpeedCategory (ULTRA_FLIPPER -> POSITION_TRADER)**\n
Source: `src/core/analysis/behavior/constants.ts`\n
Used by: `classifyTradingSpeed()` -> `tradingStyle`\n

```
ULTRA_FLIPPER < 0.05h (3m)
FLIPPER       < 0.167h (10m)
FAST_TRADER   < 1h
DAY_TRADER    < 24h
SWING_TRADER  < 168h
POSITION_TRADER >= 168h
```

**B) HolderBehaviorType (SNIPER -> HOLDER)**\n
Source: `src/core/analysis/behavior/constants.ts`\n
Used by: `classifyHolderBehavior()` -> `historicalPattern.behaviorType`\n

```
SNIPER    < 1m
SCALPER   < 5m
MOMENTUM  < 30m
INTRADAY  < 4h
DAY_TRADER < 24h
SWING     < 7d
POSITION  < 30d
HOLDER    >= 30d
```

### 11.2 Hold-Time Bucket Thresholds (Distribution)

Source: `src/config/constants.ts` (TIME_BUCKETS)\n
Used by: hold-time distributions and token maps (not the main speed classifier)\n

```
INSTANT  < 0.0001h (~0.36s)
ULTRA_FAST < 1m
VERY_FAST  < 1m (alias)
FAST    < 5m
MOMENTUM < 30m
MODERATE < 1h
INTRADAY < 4h
DAY_TRADER < 8h
DAY     < 24h
SWING   < 7d
POSITION >= 7d
```

### 11.3 Flow Pattern Thresholds (Buy/Sell Bias)

**Central config:** `src/config/constants.ts` (BEHAVIOR_CLASSIFICATION)\n
```
ACCUMULATOR_RATIO_MIN = 2.5
DISTRIBUTOR_RATIO_MAX = 0.4
BALANCED_SYMMETRY_MIN = 0.7
BALANCED_CONSISTENCY_MIN = 0.7
HOLDER_RATIO_MIN = 1.5
```

**Duplicate logic exists in:** `src/core/analysis/behavior/constants.ts` (classifyBehavioralPattern)\n
This is a drift risk because it hard-codes similar thresholds instead of referencing config.

### 11.4 Low-Activity Gate

Source: `src/config/constants.ts` (TRADING_ANALYSIS)\n
```
MIN_TRADES_FOR_ANALYSIS = 5
MIN_TOKENS_WITH_TRADES = 2
```

Used by: `src/core/analysis/behavior/analyzer.ts` to short-circuit classification.\n
This currently suppresses buy-only wallets unless a holder signal bypass is added.

---

## 13) Open Questions / Decisions Needed

1) **Canonical speed taxonomy**
   - Adopt granular `SNIPER..HOLDER` as canonical speedCategory? (Recommended)

2) **Enum names**
   - `BUY_ONLY` vs `BUY_HEAVY`, `SELL_ONLY` vs `SELL_HEAVY`

3) **Holder signal thresholds**
   - Define minimum holding duration and value to qualify as active holder.

4) **Where classification is stored**
   - Add to DB vs compute per request.

---

## 14) Summary

The root of the Discover classification confusion is **one composite string** that combines **two different taxonomies** and a **flow pattern** that reuses the word “HOLDER.” The fix is to **separate speed, flow, and strategy**, centralize classification in the analyzer, and store explicit enums for filtering. Current-hold behavior should be a signal that prevents buy-only wallets from being misclassified as low activity, not a replacement for exited-position speed.

This plan avoids breaking consumers while enabling clean filters and accurate wallet discovery.
