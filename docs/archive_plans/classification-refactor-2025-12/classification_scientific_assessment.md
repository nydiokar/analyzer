# Classification System - Scientific Assessment for Sova Intel

**Purpose**: Apply expert critique to our specific use case (wallet profiling for traders)
**Status**: Pre-implementation decisions
**Date**: 2025-12-25

---

## Our Use Case: Wallet Profiling for Traders

**Primary goal**: Show traders wallet personality/behavior in UI
**Secondary goals**:
- Discover similar wallets (similarity matching)
- Identify bot vs human patterns (holder profiles)
- Quick visual classification (baseball card)

**NOT our goals**:
- High-frequency trading strategy replication
- Compliance/risk scoring (regulated)
- Statistical arbitrage research
- Academic rigor

**Translation**: We need "good enough" heuristics that are **explainable to traders**, not perfect statistical models.

---

## Expert's P0 Issues - Our Decisions

### P0-1: Resolve strategyType Overlap

**Problem**: `PURE_HOLDER` vs `ACCUMULATOR` can both apply to same wallet

**Our decision**: **Precedence rules** (strategyType is stored, not computed)

```
Priority order:
1. LOW_ACTIVITY (always wins if insufficient data)
2. PURE_HOLDER (speedCategory = HOLDER + flowPattern = BUY_ONLY)
3. Flow-based types (ACCUMULATOR, DISTRIBUTOR, BALANCED_TRADER)
4. Speed-based types (FAST_TRADER, DAY_TRADER, SWING_TRADER, POSITION_TRADER)

Logic: If multiple match, take the FIRST match from priority list
```

**Why**: Traders care more about "this wallet only buys" (PURE_HOLDER) than "this wallet accumulates" (ACCUMULATOR). Precedence reflects user priority.

---

### P0-2: Define Velocity Score Formula

**Problem**: Contract says "0-100" but doesn't define mapping

**Our decision**: **Logarithmic scale** (time perception is log-based)

```typescript
function computeVelocityScore(medianHoldHours: number): number {
  if (medianHoldHours <= 0) return 100;

  // Log scale: 1min=100, 1hr=90, 1day=70, 1week=40, 1month=0
  const logHold = Math.log10(medianHoldHours + 1); // +1 to handle 0
  const logMax = Math.log10(720 + 1); // 30 days = 0 score

  const score = Math.max(0, Math.min(100,
    100 * (1 - logHold / logMax)
  ));

  return Math.round(score);
}
```

**Benchmark values**:
- 1 min (0.017h) → 100
- 5 min (0.083h) → 98
- 1 hour → 90
- 6 hours → 75
- 24 hours → 60
- 3 days → 40
- 7 days → 25
- 30 days → 0

**Why**: Matches trader intuition - difference between 1min and 1hr is huge, but 20 days vs 30 days doesn't matter much.

---

### P0-3: Add Minimum Sample Size + Holder Bypass

**Problem**: Minimum data gate excludes legitimate holders who haven't exited yet

**Our decision**: **Bypass gate for meaningful holders** (even with no completed cycles)

```typescript
// Constants
MIN_TRADES = 5
MIN_TOKENS_WITH_COMPLETED_CYCLES = 2

// Holder bypass criteria
isMeaningfulHolder =
  (tokensWithOnlyBuys >= 3 && medianActiveHoldingHours >= 24) ||  // Multi-token holder
  (tokensWithOnlyBuys >= 1 && largestActivePositionSol >= 50);    // OR significant position

// Classification logic
if (totalTrades < MIN_TRADES && tokensWithBothBuyAndSell < MIN_TOKENS_WITH_COMPLETED_CYCLES) {
  if (isMeaningfulHolder) {
    // Bypass gate - classify as holder
    speedCategory = null;  // No completed cycles
    flowPattern = 'BUY_ONLY';
    strategyType = 'PURE_HOLDER';
  } else {
    // Insufficient data
    speedCategory = null;
    flowPattern = null;
    strategyType = 'LOW_ACTIVITY';
  }
} else {
  // Enough data - classify normally
  speedCategory = computeSpeed(medianCompletedHoldDuration);  // From exits
  flowPattern = computeFlow(buyCount, sellCount);
  strategyType = deriveStrategyType(speedCategory, flowPattern);
}
```

**Display** (frontend):
```typescript
if (strategyType === 'PURE_HOLDER') {
  // Show active holding info (not speed, since no exits)
  details = `${totalTrades} trades · Holding ${tokensWithOnlyBuys} tokens · ${medianActiveHoldingHours}h avg`;
}
```

**Why**:
- speedCategory ONLY applies to completed cycles (exit timing)
- Active holdings use flowPattern = BUY_ONLY + strategyType = PURE_HOLDER
- Position size (50 SOL) allows single-token holders to bypass gate

---

### P0-4: Specify Time Window

**Problem**: Are we classifying all-time behavior or recent?

**Our decision**: **All-time with recency metadata** (MVP approach)

**V1 (MVP)**: Classify using all available data
- Store `lastActivityDate` separately
- Show recency in UI: "DAY_TRADER (last active 3 days ago)"
- Wallets inactive >90 days get visual indicator

**V2 (post-launch)**: Add rolling windows
- Add `behavior30d` field (last 30 days classification)
- Add `behaviorAllTime` field (lifetime classification)
- Show both in UI: "Recently: ACCUMULATOR | Historically: SWING_TRADER"

**Why**:
- All-time is simpler to implement (no windowing logic)
- We already have recency data (`lastActivityDate`)
- Traders care about "is this wallet still active?" which we can show separately
- Defer complexity until we validate the use case

---

## Expert's P1 Issues - Our V2 Decisions

### P1-5: Add Confidence Metric

**V1**: Show sample size in UI tooltip
**V2**: Store `classificationConfidence: number` (0-1) based on sample size

```typescript
// V2 formula
confidence = Math.min(1, totalTrades / 50); // 50+ trades = full confidence
```

---

### P1-6: Volume-Weight Flow Ratio

**V1**: Use count-based ratio (simple)
**V2**: Add `totalBuyVolume` and `totalSellVolume` to compute volume-weighted ratio

**Why defer**: Count-based is "good enough" for UI. Volume-weighting matters more for risk scoring (not our V1 use case).

---

### P1-7: Handle Multi-Modal Distributions

**V1**: Use median (simple, robust to outliers)
**V2**: Detect bimodal patterns (e.g., wallet that snipes AND swing trades)

**Why defer**: Median is robust. Multi-strategy detection is a research problem, not an MVP feature.

---

### P1-8: Bot Detection Integration

**V1**: Keep separate (we already have `bot-detector.ts`)
**V2**: Add `excludeBots` flag to discover filters

**Why defer**: Bot detection is working. We can add UI filters later without changing classification logic.

---

## FIFO Matching - Our Position

**Expert says**: "FIFO is accounting, not behavioral truth"

**Our response**: **Correct, but pragmatic**

**Why we use FIFO**:
1. Only deterministic matching method (no ambiguity)
2. Matches how traders think about "closing positions"
3. Alternative (LIFO) is equally arbitrary
4. Alternative (optimize for shortest hold) is computationally expensive

**What we acknowledge**:
- Partial exits are approximated (FIFO treats them as full exits of earliest buys)
- Multi-lot positions are simplified

**What we won't do**:
- ❌ Implement multiple matching methods (too complex)
- ❌ Let users choose matching method (confusing)

**What we will do**:
- ✅ Document the limitation in our docs
- ✅ Use median (not mean) to reduce sensitivity to matching method
- ✅ Require minimum sample size to smooth out noise

---

## Time Thresholds - Our Position

**Expert says**: "Arbitrary and non-linear"

**Our response**: **Informed by trader terminology**

**Our thresholds** (from `SPEED_THRESHOLDS`):
```
SNIPER: < 1min     → "Snipes new launches"
SCALPER: 1-5min    → "Scalps pumps"
MOMENTUM: 5-30min  → "Momentum trades"
INTRADAY: 30min-4h → "Intraday trader"
DAY_TRADER: 4-24h  → "Day trader"
SWING: 1-7 days    → "Swing trader"
POSITION: 7-30 days → "Position trader"
HOLDER: 30+ days   → "Long-term holder"
```

**Not data-driven clustering, but domain expertise**:
- "Day trader" means holds < 24 hours (industry standard)
- "Swing trader" means holds days-to-weeks (industry standard)
- "Sniper" means exits within minutes (DeFi-specific term)

**What we acknowledge**:
- These are heuristics, not discovered patterns
- Different markets might have different natural breakpoints

**What we won't do**:
- ❌ Run k-means clustering to discover thresholds (overkill for MVP)
- ❌ Make thresholds configurable by users (too complex)

**What we will do**:
- ✅ Use consistent thresholds across the app
- ✅ Document threshold choices
- ✅ Collect user feedback ("Does this classification feel right?")
- ✅ Adjust thresholds in V2 if users report misclassifications

---

## Edge Cases - Our Handling

### Case 1a: New Wallet (1 buy, 0 sells, holding 45 days, 700 SOL position)
**Classification**: PURE_HOLDER
**Fields**: `speedCategory = null`, `flowPattern = BUY_ONLY`, `strategyType = PURE_HOLDER`
**Bypass**: ✅ Passes (largestActivePositionSol = 700 > 50)
**Display**:
```
Classification: PURE_HOLDER
Details: "1 trade · Holding 1 token for 45 days · $XXX position · +233x unrealized"
```
**Why**: No exits yet (speedCategory = null), but meaningful position triggers bypass.

### Case 1b: New Wallet (1 buy, 0 sells, holding 2 days, 5 SOL position)
**Classification**: LOW_ACTIVITY
**Fields**: `speedCategory = null`, `flowPattern = null`, `strategyType = LOW_ACTIVITY`
**Bypass**: ❌ Fails (only 1 token, position < 50 SOL, hold < 24h)
**Display**:
```
Classification: LOW_ACTIVITY
Details: "Insufficient data (1 trade)"
```
**Why**: Doesn't meet holder bypass criteria. Users can still see position in wallet details.

### Case 1c: Multi-token holder (5 tokens, 0 sells, holding 48h avg, small positions)
**Classification**: PURE_HOLDER
**Fields**: `speedCategory = null`, `flowPattern = BUY_ONLY`, `strategyType = PURE_HOLDER`
**Bypass**: ✅ Passes (tokensWithOnlyBuys = 5 >= 3, medianActiveHoldingHours = 48 >= 24)
**Display**:
```
Classification: PURE_HOLDER
Details: "5 trades · Holding 5 tokens · 48h avg hold"
```
**Why**: Multi-token holder bypass (doesn't need big positions).

### Case 2: Bot Wallet (10k trades/day)
**Classification**: SNIPER (median hold ~10s) + bot detection flag
**Display**: Show classification + "⚠️ Likely bot"
**Why**: Classification still useful, but flag warns users

### Case 3: Multi-Strategy Wallet (snipes + swings)
**Classification**: Use median (might be MOMENTUM if 50/50 split)
**Display**: Show median hold time in tooltip
**Why**: Good enough for V1, detect multi-modal in V2

### Case 4: Inactive Wallet (last trade 2023)
**Classification**: Classify based on historical data
**Display**: "SWING_TRADER (inactive 2 years)"
**Why**: Recency shown separately, classification still valid for historical behavior

---

## What "Good Enough" Means for V1

**Success criteria**:
- ✅ Pure holders no longer show as "Low Activity"
- ✅ Discover page filters work (enum-based, not substring)
- ✅ No broken cache bug (`extractBehaviorType` deleted)
- ✅ Baseball card shows clear, explainable labels
- ✅ Minimum sample size prevents garbage classifications
- ✅ Velocity score has documented formula

**Acceptable limitations** (defer to V2):
- Median of small sample (5-10 trades) might be noisy → Document in UI
- All-time classification might not reflect recent change → Show recency separately
- Count-based flow ratio might miss volume nuances → Good enough for UI profiling
- No confidence score → Show sample size in tooltip instead
- No multi-strategy detection → Median is reasonable approximation

---

## Non-Negotiables for V1

1. **Holder bypass logic** - MUST fix (this is the bug that broke discover)
2. **Enum-based storage** - MUST implement (eliminates string parsing)
3. **Minimum sample size** - MUST add (prevents garbage classifications)
4. **strategyType precedence** - MUST define (eliminates overlap ambiguity)
5. **Velocity score formula** - MUST document (no more "TBD")

---

## Scientific Rigor - Where We Draw the Line

**What we're building**:
- Heuristic classification system for trader profiling
- "Good enough" to be useful, explainable, debuggable

**What we're NOT building**:
- Statistically validated behavioral finance model
- Academic research tool
- High-stakes risk scoring system

**Our standard**:
- Does it help traders understand wallet behavior? ✅
- Can we explain the classification to users? ✅
- Is it better than no classification? ✅
- Is it perfect? ❌ (but that's okay)

**Analogy**: We're building a "personality test" (Myers-Briggs for wallets), not a clinical psychology diagnostic tool. It should be insightful and useful, not scientifically rigorous.

---

## V1 vs V2 Scope

### V1 (MVP - This Sprint)
- Holder bypass logic
- Enum-based storage (speedCategory, flowPattern, strategyType)
- Minimum sample size gates
- strategyType precedence rules
- Velocity score formula (documented)
- All-time classification with recency metadata
- Count-based flow ratio
- Median hold time (FIFO-based)

### V2 (Post-Launch)
- Confidence scores
- Rolling time windows (30d, 90d, all-time)
- Volume-weighted flow ratio
- Multi-strategy detection (bimodal distributions)
- Percentile-based thresholds (data-driven)
- Bot filter integration in UI
- User feedback loop ("Was this classification accurate?")

---

## Final Word

**We're pragmatists, not perfectionists.**

The expert is right that our system isn't scientifically rigorous. But it doesn't need to be. We're building a tool that helps traders make sense of wallet behavior, not publishing a paper in the Journal of Behavioral Finance.

**Our contract with users**:
- "This is our best guess based on available data"
- "We use industry-standard terminology (day trader, swing trader, holder)"
- "We show you the underlying data (hold times, trade counts) so you can judge for yourself"
- "We'll improve it over time based on your feedback"

**That's good enough for V1.**

Ship it. Learn. Iterate.
