# Classification Taxonomy Map

**Purpose**: Visual map of how wallet classification works - from raw metrics to final categories
**Last updated**: 2025-12-25
**Owner**: Classification system refactor

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         WALLET CLASSIFICATION SYSTEM                          │
│                                                                               │
│   Raw Metrics → Base KPIs → Derived Categories → Canonical Filter            │
│   (Transactions)  (Computed)   (Thresholds)        (strategyType)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## LEVEL 1: Raw Metrics (From Transaction History)

**Source**: Swap records from blockchain (FIFO processing)

| Metric | Calculation | Example |
|--------|-------------|---------|
| All buy→sell cycles (completed) | FIFO matched buy/sell pairs | 47 cycles |
| Median hold time (completed) | Median duration of completed cycles | 2.5 hours |
| Total buy count | Count of 'in' swaps | 150 buys |
| Total sell count | Count of 'out' swaps | 103 sells |
| Tokens with both buy+sell | Tokens that have ≥1 buy AND ≥1 sell | 42 tokens |
| Tokens with only buys | Tokens that have buys but NO sells | 8 tokens |
| Current hold durations | Duration of unsold positions | [24h, 48h, 72h, ...] |

**File**: `src/core/analysis/behavior/analyzer.ts` (lines ~900-1500)

---

## LEVEL 2: Base KPIs (Directly Computed)

### **KPI 1: Median Hold Time (Completed)**

**Definition**: Median duration of all completed buy→sell cycles (FIFO matched)

**Formula**: `median([duration1, duration2, ..., durationN])` where each duration is from buy to sell

**Unit**: Hours

**Example**:
- Completed cycles: [0.5h, 2h, 3h, 48h, 72h]
- **Median**: 3 hours

**Used for**: `speedCategory` derivation

**File**: `src/core/analysis/behavior/analyzer.ts:1091-1138` (`calculateFlipDurations`)

---

### **KPI 2: Buy/Sell Ratio**

**Definition**: Volume-weighted ratio of buy activity to sell activity

**Formula**: `totalBuyVolume / totalSellVolume`

**Range**: 0 to ∞ (higher = more buying)

**Example**:
- Total buys: 150, Total sells: 50
- **Ratio**: 3.0 (accumulator)

**Used for**: `flowPattern` derivation

**File**: `src/core/analysis/behavior/analyzer.ts` (computed in metrics)

---

### **KPI 3: Total Trade Count**

**Definition**: Sum of all buy + sell transactions

**Formula**: `totalBuyCount + totalSellCount`

**Example**: 150 + 50 = **200 trades**

**Used for**: Low activity gate, confidence scoring

---

### **KPI 4: Tokens With Both Buy+Sell**

**Definition**: Count of tokens that have at least 1 buy AND at least 1 sell

**Example**:
- Token A: 5 buys, 2 sells ✅
- Token B: 10 buys, 0 sells ❌
- Token C: 3 buys, 1 sell ✅
- **Result**: 2 tokens

**Used for**: Low activity gate (current requirement: ≥ 2)

---

### **KPI 5: Tokens With Only Buys** (NEW)

**Definition**: Count of tokens that have buys but NO sells (pure holding)

**Example**:
- 8 tokens have only buys
- **Result**: 8 tokens

**Used for**: Active hold signal, holder bypass

**File**: To be added in `src/core/analysis/behavior/analyzer.ts`

---

### **KPI 6: Median Current Hold Duration** (NEW)

**Definition**: Median duration of currently held positions (not yet sold)

**Formula**: `median([hold1, hold2, ..., holdN])` for active positions

**Unit**: Hours

**Example**:
- Active holds: [24h, 48h, 72h, 96h]
- **Median**: 60 hours (2.5 days)

**Used for**: Active hold signal, holder bypass

**File**: To be added in `src/core/analysis/behavior/analyzer.ts`

---

## LEVEL 3: Derived Categories (Threshold-Based)

### **CATEGORY A: speedCategory** (Time-Based Trading Speed)

**Definition**: How fast does this wallet exit positions?

**Source KPI**: Median Hold Time (Completed) - uses ONLY completed cycles

**Taxonomy**: 8 granular categories (plus null)

| Category | Time Range | Threshold | Typical Behavior | Example |
|----------|-----------|-----------|------------------|---------|
| **SNIPER** | < 1 minute | `< 0.0167h` | Bot/MEV, same-block exits | Median: 30 seconds |
| **SCALPER** | 1-5 minutes | `< 0.0833h` | Ultra-fast scalping | Median: 3 minutes |
| **MOMENTUM** | 5-30 minutes | `< 0.5h` | Momentum trading | Median: 15 minutes |
| **INTRADAY** | 30min - 4h | `< 4h` | Intraday sessions | Median: 2 hours |
| **DAY_TRADER** | 4-24 hours | `< 24h` | Same-day trading | Median: 12 hours |
| **SWING** | 1-7 days | `< 168h` | Multi-day holds | Median: 3 days |
| **POSITION** | 7-30 days | `< 720h` | Position trading | Median: 15 days |
| **HOLDER** | 30+ days | `≥ 720h` | Long-term holding | Median: 60 days |
| **(null)** | N/A | No completed cycles | Pure holder, never exited | No data |

**Code**: `src/core/analysis/behavior/constants.ts:152-172` (`classifyHolderBehavior()`)

**Thresholds**: `HOLDER_BEHAVIOR_THRESHOLDS_HOURS` (constants.ts:46-55)

**Important**: If wallet has NO completed cycles (only buys, never sold), `speedCategory = null`

---

### **CATEGORY B: flowPattern** (Buy/Sell Directional Bias)

**Definition**: What's the directional flow of trading activity?

**Source KPIs**: Buy/Sell Ratio, Buy Count, Sell Count

**Taxonomy**: 6 categories

| Category | Condition | Threshold Logic | Behavior | Example |
|----------|-----------|-----------------|----------|---------|
| **BUY_ONLY** | No sells | `totalSellCount === 0` | Pure accumulation | 50 buys, 0 sells |
| **SELL_ONLY** | No buys | `totalBuyCount === 0` | Pure distribution | 0 buys, 30 sells |
| **ACCUMULATOR** | Heavy buy bias | `ratio > 2.5 AND buys > sells * 2` | Buying much more | 100 buys, 20 sells (ratio 5.0) |
| **DISTRIBUTOR** | Heavy sell bias | `ratio < 0.4 AND sells > buys * 2` | Selling much more | 20 buys, 100 sells (ratio 0.2) |
| **BALANCED** | Symmetric | `symmetry > 0.7 AND consistency > 0.7` | Equal buy/sell | 50 buys, 48 sells (ratio 1.04) |
| **MIXED** | Everything else | Default fallback | No clear pattern | 60 buys, 40 sells (ratio 1.5) |

**Code**: `src/core/analysis/behavior/analyzer.ts:1576-1596` (to be updated)

**Thresholds**: `BEHAVIOR_CLASSIFICATION` (src/config/constants.ts:344-351)

**Important**: Renamed from `BehavioralPattern` - `HOLDER` → `BUY_ONLY`, `DUMPER` → `SELL_ONLY` (avoid collision with speed category)

---

### **CATEGORY C: activeHoldSignal** (Holder Detection Without Exits)

**Definition**: Does this wallet show meaningful holder activity despite having no completed exits?

**Source KPIs**: Tokens With Only Buys, Median Current Hold Duration

**Purpose**: Bypass "Low Activity" gate for legitimate holders

| Field | Type | Condition | Meaning |
|-------|------|-----------|---------|
| `hasActivePositions` | Boolean | `tokensWithOnlyBuys > 0` | Has at least one unsold token |
| `activeTokenCount` | Integer | Count of buy-only tokens | Number of tokens being held |
| `medianActiveHoldHours` | Float | Median of current holdings | How long they've been holding |
| **`isMeaningfulHolder`** | Boolean | `activeTokenCount ≥ 3 AND medianActiveHoldHours ≥ 24` | **Gate bypass criteria** |

**Code**: To be added in `src/core/analysis/behavior/analyzer.ts:1552` (gate bypass logic)

**Thresholds**:
- Minimum active tokens: **3** (enough signal)
- Minimum hold duration: **24 hours** (1 day - not dust)

**Example**:
- Wallet A: 5 buy-only tokens, median hold 48h → `isMeaningfulHolder = true` ✅ (bypass gate)
- Wallet B: 1 buy-only token, median hold 72h → `isMeaningfulHolder = false` ❌ (insufficient tokens)
- Wallet C: 5 buy-only tokens, median hold 2h → `isMeaningfulHolder = false` ❌ (too short)

---

## LEVEL 4: Canonical Filter (strategyType)

**Definition**: Single enumeration for UI filtering and business logic

**Purpose**: Stable, filterable category that combines speed + flow + holder signals

**Source**: Derived from `speedCategory + flowPattern + activeHoldSignal`

**Taxonomy**: 9 categories

| Strategy Type | Derivation Logic | User Label | Use Case |
|---------------|------------------|------------|----------|
| **FAST_TRADER** | `speedCategory IN [SNIPER, SCALPER, MOMENTUM]` | "Fast Trader" | Exits in < 30 minutes |
| **DAY_TRADER** | `speedCategory IN [INTRADAY, DAY_TRADER]` | "Day Trader" | Exits within same day (< 24h) |
| **SWING_TRADER** | `speedCategory = SWING` | "Swing Trader" | Holds for days (1-7 days) |
| **POSITION_TRADER** | `speedCategory IN [POSITION, HOLDER]` | "Position Trader" | Long-term (7+ days, eventual exit) |
| **PURE_HOLDER** | `flowPattern = BUY_ONLY` | "Pure Holder" | Never exits, only accumulates |
| **ACCUMULATOR** | `flowPattern = ACCUMULATOR AND speedCategory NOT NULL` | "Accumulator" | Heavy buy bias (any speed) |
| **DISTRIBUTOR** | `flowPattern = DISTRIBUTOR AND speedCategory NOT NULL` | "Distributor" | Heavy sell bias (any speed) |
| **BALANCED_TRADER** | `flowPattern = BALANCED` | "Balanced Trader" | Equal buy/sell activity |
| **LOW_ACTIVITY** | Insufficient data | "Low Activity" | < 5 trades, < 2 complete tokens, NOT holder |

---

### **Derivation Algorithm (Deterministic)**

**Order matters - first match wins**:

1. **Check minimum data gate**:
   - `totalTradeCount ≥ 5` AND `tokensWithBothBuyAndSell ≥ 2`
   - **NEW**: If gate fails BUT `isMeaningfulHolder = true`, continue (bypass)
   - Else: `strategyType = LOW_ACTIVITY`

2. **Pure holders** (no exits):
   - If `flowPattern = BUY_ONLY`: `strategyType = PURE_HOLDER`

3. **Flow-dominant patterns**:
   - If `flowPattern = ACCUMULATOR`: `strategyType = ACCUMULATOR`
   - If `flowPattern = DISTRIBUTOR` OR `SELL_ONLY`: `strategyType = DISTRIBUTOR`

4. **Speed-based classification** (requires completed exits):
   - If `speedCategory = null` (no exits): check balanced, else `LOW_ACTIVITY`
   - If `speedCategory IN [SNIPER, SCALPER, MOMENTUM]`: `strategyType = FAST_TRADER`
   - If `speedCategory IN [INTRADAY, DAY_TRADER]`: `strategyType = DAY_TRADER`
   - If `speedCategory = SWING`: `strategyType = SWING_TRADER`
   - If `speedCategory IN [POSITION, HOLDER]`: `strategyType = POSITION_TRADER`

5. **Fallback**:
   - If `flowPattern = BALANCED`: `strategyType = BALANCED_TRADER`
   - Else: `strategyType = LOW_ACTIVITY`

**Code**: To be added in `src/core/analysis/behavior/analyzer.ts`

---

## LEVEL 5: Display Labels (UI Only)

**Definition**: Human-readable strings for display (NEVER used for filtering)

**Format**: `"{SpeedCategory} ({FlowPattern})"` or descriptive text

**Field Name**: `tradingStyleLabel` (replaces current `tradingStyle` usage)

**Examples**:

| speedCategory | flowPattern | tradingStyleLabel | strategyType (filter) |
|---------------|-------------|-------------------|----------------------|
| MOMENTUM | ACCUMULATOR | "Momentum (ACCUMULATOR)" | FAST_TRADER |
| DAY_TRADER | BALANCED | "Day Trader (BALANCED)" | DAY_TRADER |
| null | BUY_ONLY | "Unknown Speed (BUY_ONLY)" | PURE_HOLDER |
| HOLDER | BUY_ONLY | "Holder (BUY_ONLY)" | POSITION_TRADER |
| null | MIXED | "Low Activity" | LOW_ACTIVITY |
| SWING | DISTRIBUTOR | "Swing (DISTRIBUTOR)" | SWING_TRADER |

**Storage**: Still stored in DB as `tradingStyle` for backward compat, but marked as DEPRECATED for filtering

---

## BONUS: Velocity Score (Replaces "Flipper")

**Definition**: Trading speed intensity score (NOT a category - continuous metric)

**Previous name**: `flipperScore` (DEPRECATED)

**New name**: `velocityScore` (professional terminology)

**Type**: Float (0-100)

**Meaning**: Percentage of trades executed in ultra-fast time buckets (< 1 hour)

**Formula**:
```typescript
velocityScore = (
  ultra_fast_count * 0.85 +
  very_fast_count * 0.10 +
  fast_count * 0.05
) * 100
```

**Interpretation**:
- 0-30: Slow (position/swing traders)
- 30-60: Moderate (day traders)
- 60-80: Fast (momentum traders)
- 80-100: Ultra-fast (snipers/scalpers)

**Code**: `src/core/analysis/behavior/analyzer.ts:1514-1529` (to be renamed)

**Constants**: `VELOCITY_SCORE` (was `FLIPPER_SCORE`)

---

## Complete Threshold Reference

| Constant | Value | Unit | Purpose | File |
|----------|-------|------|---------|------|
| **MIN_TRADES_FOR_ANALYSIS** | 5 | trades | Low activity gate | constants.ts:324 |
| **MIN_TOKENS_WITH_TRADES** | 2 | tokens | Low activity gate (both buy+sell) | constants.ts:325 |
| **HOLDER_BYPASS_MIN_TOKENS** | 3 | tokens | Active holder detection (NEW) | **To be added** |
| **HOLDER_BYPASS_MIN_HOURS** | 24 | hours | Active holder detection (NEW) | **To be added** |
| **SNIPER_MAX_HOURS** | 0.0167 | hours (1 min) | Speed category | constants.ts:47 |
| **SCALPER_MAX_HOURS** | 0.0833 | hours (5 min) | Speed category | constants.ts:48 |
| **MOMENTUM_MAX_HOURS** | 0.5 | hours (30 min) | Speed category | constants.ts:49 |
| **INTRADAY_MAX_HOURS** | 4 | hours | Speed category | constants.ts:50 |
| **DAY_TRADER_MAX_HOURS** | 24 | hours | Speed category | constants.ts:51 |
| **SWING_MAX_HOURS** | 168 | hours (7 days) | Speed category | constants.ts:52 |
| **POSITION_MAX_HOURS** | 720 | hours (30 days) | Speed category | constants.ts:53 |
| **ACCUMULATOR_RATIO_MIN** | 2.5 | ratio | Flow pattern | constants.ts:348 |
| **DISTRIBUTOR_RATIO_MAX** | 0.4 | ratio | Flow pattern | constants.ts:349 |
| **BALANCED_SYMMETRY_MIN** | 0.7 | score (0-1) | Flow pattern | constants.ts:346 |
| **BALANCED_CONSISTENCY_MIN** | 0.7 | score (0-1) | Flow pattern | constants.ts:347 |

---

## Visual Dataflow

```
RAW TRANSACTIONS
    ↓
FIFO PROCESSING (buy→sell matching)
    ↓
┌─────────────────┬──────────────────┬────────────────────┐
│  Completed      │  Buy/Sell        │  Active Holdings   │
│  Cycles         │  Counts          │  (unsold)          │
└────────┬────────┴────────┬─────────┴─────────┬──────────┘
         │                 │                   │
    median(durations)  ratio(buys/sells)   median(holds)
         │                 │                   │
         ↓                 ↓                   ↓
   speedCategory      flowPattern      activeHoldSignal
         │                 │                   │
         └─────────────────┴───────────────────┘
                          │
                          ↓
                   strategyType
                 (Canonical Filter)
                          │
                          ↓
                  tradingStyleLabel
                   (Display Only)
```

---

## Example Wallets

### **Example 1: Pure Holder (No Exits)**

**Raw metrics**:
- 50 buys, 0 sells
- 10 tokens with only buys
- Median current hold: 72 hours (3 days)
- Median completed hold: N/A (no completed cycles)

**Derived classification**:
- `speedCategory = null` (no exits)
- `flowPattern = BUY_ONLY` (no sells)
- `activeHoldSignal.isMeaningfulHolder = true` (10 tokens ≥ 3, 72h ≥ 24h)
- `strategyType = PURE_HOLDER` (bypassed low activity gate)
- `tradingStyleLabel = "Unknown Speed (BUY_ONLY)"`
- `velocityScore = 0` (no completed trades)

**Filter**: `strategyType=PURE_HOLDER` ✅

---

### **Example 2: Fast Accumulator**

**Raw metrics**:
- 100 buys, 20 sells
- 47 completed cycles
- Median completed hold: 0.75 hours (45 minutes)
- Buy/sell ratio: 5.0

**Derived classification**:
- `speedCategory = MOMENTUM` (30min < 45min < 4h)
- `flowPattern = ACCUMULATOR` (ratio 5.0 > 2.5)
- `strategyType = FAST_TRADER` (MOMENTUM → FAST_TRADER)
- `tradingStyleLabel = "Momentum (ACCUMULATOR)"`
- `velocityScore = 72` (high velocity)

**Filter**: `strategyType=FAST_TRADER` ✅ OR `speedCategory=MOMENTUM` ✅ OR `flowPattern=ACCUMULATOR` ✅

---

### **Example 3: Balanced Swing Trader**

**Raw metrics**:
- 60 buys, 58 sells
- 52 completed cycles
- Median completed hold: 96 hours (4 days)
- Buy/sell ratio: 1.03

**Derived classification**:
- `speedCategory = SWING` (24h < 96h < 168h)
- `flowPattern = BALANCED` (symmetry high, consistent)
- `strategyType = SWING_TRADER` (speed-based)
- `tradingStyleLabel = "Swing (BALANCED)"`
- `velocityScore = 15` (low velocity)

**Filter**: `strategyType=SWING_TRADER` ✅

---

### **Example 4: Low Activity (True)**

**Raw metrics**:
- 3 buys, 1 sell
- 1 token with both buy+sell
- 0 active holdings

**Derived classification**:
- Fails minimum data gate (3 trades < 5, 1 token < 2)
- `activeHoldSignal.isMeaningfulHolder = false` (0 active tokens)
- `strategyType = LOW_ACTIVITY`
- `tradingStyleLabel = "Low Activity"`

**Filter**: `strategyType=LOW_ACTIVITY` ✅

---

### **Example 5: Low Activity BUT Holder Bypass**

**Raw metrics**:
- 3 buys, 0 sells
- 0 tokens with both buy+sell
- 5 active holdings, median hold 48 hours

**Derived classification**:
- Fails minimum data gate (3 trades < 5, 0 tokens < 2)
- **BUT** `activeHoldSignal.isMeaningfulHolder = true` (5 tokens ≥ 3, 48h ≥ 24h)
- Gate bypassed! ✅
- `speedCategory = null` (no exits)
- `flowPattern = BUY_ONLY`
- `strategyType = PURE_HOLDER` (bypassed gate)
- `tradingStyleLabel = "Unknown Speed (BUY_ONLY)"`

**Filter**: `strategyType=PURE_HOLDER` ✅ (NOT LOW_ACTIVITY!)

---

## Key Takeaways

1. **Speed vs Flow**: Separate dimensions, can be combined for filtering
2. **strategyType**: Single canonical filter for UI/API (use this!)
3. **Holder bypass**: Prevents buy-only wallets from being misclassified as "Low Activity"
4. **Null speedCategory**: Normal for pure holders (never exited, so no speed data)
5. **Velocity score**: Continuous metric (0-100), NOT a category - replaces "flipper"
6. **Display labels**: For UI only, NEVER filter on these
7. **Backward compat**: Old `tradingStyle` field still works but deprecated

---

**Related Documents**:
- Implementation Plan: `.ai/context/discover_classification_refactor_plan.md`
- Component Impact Map: `.ai/context/component_impact_map.md`
- Usage Analysis Script: `src/scripts/analyze-classification-usage.ts`
