# Wallet Classification Guide

**Complete reference for understanding wallet trading behavior classifications**

---

## Overview

Our system classifies wallets across **two independent dimensions**:

1. **Trading Style** - How fast they trade (based on median hold time)
2. **Behavioral Pattern** - What they do with their capital (based on buy/sell ratio)

Combined together, these create a comprehensive profile like: **"Balanced Swing Trader"** or **"Accumulator Day Trader"**

---

## Part 1: Trading Style (Speed Classification)

Trading Style categorizes **how fast** a trader operates based on their **median hold time** across all positions.

> **Why Median?** Because it's robust to outliers. One 30-day hold won't turn a flipper into a position trader.

### Trading Style Categories

| **Category** | **Hold Time** | **Definition** |
|-------------|---------------|----------------|
| **ULTRA_FLIPPER** | < 3 minutes | Extreme bot-like behavior. Think MEV bots, sandwich attacks, or algorithmic arbitrage. Almost certainly automated. |
| **FLIPPER** | 3-10 minutes | Snipe-and-dump specialists. They buy new launches and exit within minutes. High-speed manual or semi-automated trading. |
| **FAST_TRADER** | 10-60 minutes | Intra-hour momentum players. They ride short-term price spikes and exit quickly. Active chart watchers. |
| **DAY_TRADER** | 1-24 hours | Classic day traders. They enter and exit within the same trading day. Never hold overnight. |
| **SWING_TRADER** | 1-7 days | Multi-day position holders. They look for bigger moves over several days. Patient but still active. |
| **POSITION_TRADER** | 7+ days | Long-term investors. They build positions and hold for weeks or months. Conviction-based trading. |
| **LOW_ACTIVITY** | N/A | Insufficient trading data to classify reliably. |

**Implementation:** `src/core/analysis/behavior/constants.ts:10-25`

---

## Part 2: Behavioral Pattern (Buy/Sell Characteristics)

Behavioral Pattern categorizes **what traders do** with their capital - are they accumulating, distributing, or balanced?

> **Key Metric:** `Buy/Sell Ratio = Total Buy Volume / Total Sell Volume`

### Behavioral Pattern Categories

| **Pattern** | **Criteria** | **Definition** |
|------------|------------|----------------|
| **HOLDER** | No sells | Only buys, never sells. True diamond hands or abandoned wallets. Could be accumulating for long-term or simply inactive. |
| **ACCUMULATOR** | Buy/Sell > 2.5<br>Buy Count > 2× Sell Count | Significantly more buying than selling. Building positions over time. Bullish on their picks. |
| **BALANCED** | Buy/Sell between 0.7-1.5 | Roughly equal buy and sell activity. Clean entry/exit cycles. Professional trading behavior. |
| **DISTRIBUTOR** | Buy/Sell < 0.4<br>Sell Count > 2× Buy Count | Significantly more selling than buying. Could be taking profits, reducing exposure, or distributing accumulated positions. |
| **DUMPER** | No buys | Only sells. Likely receiving tokens via airdrops, transfers, or team allocations and selling them. |

**Implementation:** `src/core/analysis/behavior/constants.ts:182-219`

---

## Part 3: Combined Classifications (What They Mean)

Here's what common combinations actually mean in plain English:

### 🔥 High-Activity Traders

**BALANCED FLIPPER**
- Buys new token launches and exits within 3-10 minutes
- Clean buy/sell cycles with equal volumes
- Professional sniper/scalper behavior
- **Example:** Buys memecoin at launch, sells 5 minutes later at 2x, repeats all day

**ACCUMULATOR FLIPPER**
- Fast trading (3-10 min holds) but buying more than selling
- Building positions through quick trades
- Likely using profits to accumulate core positions
- **Example:** Flips 10 tokens but keeps buying back the winners

**BALANCED FAST_TRADER**
- Holds for 10-60 minutes typically
- Equal buy/sell volumes
- Momentum trader riding intra-hour pumps
- **Example:** Buys on volume spike, sells 30 min later when momentum fades

---

### 📊 Day Trading Profiles

**BALANCED DAY_TRADER**
- Enters and exits within the same day (1-24 hours)
- Equal buy/sell activity
- Classic day trading behavior, never holds overnight
- **Example:** Buys at 9 AM, sells at 6 PM, repeats daily

**ACCUMULATOR DAY_TRADER**
- Day trading timeframes but net buying over time
- Building positions through daily trading
- Likely has a core portfolio they're growing
- **Example:** Day trades 5 tokens but keeps accumulating 2 favorites

**DISTRIBUTOR DAY_TRADER**
- Day trading timeframes but net selling over time
- Taking profits systematically
- Could be reducing exposure or living off trading profits
- **Example:** Daily sells portions of positions, rarely re-enters

---

### 📈 Swing Trading Profiles

**BALANCED SWING_TRADER**
- Holds positions for 1-7 days typically
- Equal buy/sell volumes
- Looking for multi-day price movements
- **Example:** Buys Monday, sells Friday based on weekly patterns

**ACCUMULATOR SWING_TRADER**
- Multi-day holds with net buying bias
- Building long-term positions through swing trades
- Patient accumulation strategy
- **Example:** Buys dips over several days, rarely sells winners

**DISTRIBUTOR SWING_TRADER**
- Multi-day holds but net selling over time
- Systematic profit-taking from swing positions
- Could be exiting a large accumulated position slowly
- **Example:** Sells portions weekly to avoid dumping price

---

### 🏔️ Long-Term Profiles

**BALANCED POSITION_TRADER**
- Holds for weeks or months (7+ days)
- Equal buy/sell volumes over time
- Long-term conviction trades with planned exits
- **Example:** Researches projects, enters, holds 2-4 weeks, exits at target

**ACCUMULATOR POSITION_TRADER** / **HOLDER**
- Long holds with net buying or no selling at all
- True conviction investor
- Building generational wealth or betting on moonshots
- **Example:** DCA into favorite tokens monthly, never sells

**DISTRIBUTOR POSITION_TRADER**
- Long holds but systematically distributing
- Could be early investor/team member selling vested tokens
- Or whale reducing large position over time
- **Example:** Holds for months then sells 10% weekly to preserve price

---

### 🤖 Bot/Automated Behavior

**BALANCED ULTRA_FLIPPER**
- Sub-3-minute holds with perfect buy/sell symmetry
- Almost certainly a bot (MEV, arbitrage, sandwich attacks)
- Superhuman speed and consistency
- **Example:** Sandwich bot front-running transactions for profit

---

## Part 4: Hold Time Metrics Explained

We track TWO different hold time metrics because they tell different stories:

### Median Hold Time (Typical Behavior)
**What it means:** What the trader *usually* does day-to-day

**Example:**
```
10 flips @ 1 hour each
1 outlier @ 30 days

Median = 1 hour (classification: FAST_TRADER)
```
This trader is typically a fast trader, even though they have one long position.

### Weighted Average Hold Time (Economic Reality)
**What it means:** Where the trader's *money* actually goes

**Example:**
```
10 flips @ 1 SOL each @ 1 hour = 10 SOL
1 position @ 100 SOL @ 30 days = 100 SOL

Weighted Average = ~27 days
```
Economically, this is a position trader (most capital in long holds).

### Economic Risk Assessment
Based on weighted average, we determine holder risk:

- **CRITICAL** (< 1 hour): Most capital exits extremely fast
- **HIGH** (1-24 hours): Most capital exits same-day
- **MEDIUM** (1-7 days): Most capital in swing trades
- **LOW** (7+ days): Most capital in long-term holds

**Why this matters:** A "BALANCED FLIPPER" with LOW economic risk means they flip often but put real money into positions. Much less risky for holders than a CRITICAL flipper.

---

## Part 5: Holder-Specific Classification (Exit Predictions)

For predicting when holders will exit specific tokens, we use a **MORE GRANULAR** system based on **completed positions only**.

> ⚠️ **Key Difference from Trading Style:**
> - **Trading Style** uses ALL positions (active + completed) and median for general classification
> - **Holder Behavior** uses ONLY completed/exited positions for accurate exit predictions
> - This is more granular (8 categories vs 6) to better predict exit timing

### Holder Behavior Categories

| **Type** | **Hold Time** | **What It Means** | **Exit Prediction** |
|---------|---------------|-------------------|---------------------|
| **SNIPER** | < 1 minute | Bot/MEV/sandwich attack behavior. Instant entry and exit, usually automated. | Will exit current token within minutes of profit |
| **SCALPER** | 1-5 minutes | Ultra-fast manual/semi-automated scalping. Snipes launches and dumps immediately on first pump. | Will exit within 1-5 minutes of entry or first green candle |
| **MOMENTUM** | 5-30 minutes | Short-term momentum trader. Rides initial pumps and exits before consolidation. | Will exit within 5-30 minutes, likely on first momentum fade |
| **INTRADAY** | 30 min - 4 hours | Short-term intraday trader. Plays multi-hour price movements within same trading session. | Will exit same session (within 1-4 hours), won't hold overnight |
| **DAY_TRADER** | 4-24 hours | Full day trading cycle. Enters and exits within 24 hours, rarely holds overnight. | Will exit within 24 hours, high risk of overnight dump |
| **SWING** | 1-7 days | Multi-day swing trader. Holds through daily volatility for bigger moves. | Will exit within a week, moderate holder risk |
| **POSITION** | 7-30 days | Month-long position trader. Has conviction for weeks but not months. | Will exit within 30 days, lower but notable risk |
| **HOLDER** | 30+ days | Long-term conviction holder. Holds through major volatility. | Likely to hold indefinitely, lowest exit risk |

### Where You'll See This

**UI Components:**
- `BehavioralPatternsTab` → Historical pattern section (shows holder type)
- `HolderProfilesTable` → Holder classification column
- Token analysis pages → Individual holder risk scores

**API Responses:**
- `BehavioralMetrics.historicalPattern.behaviorType` → Returns SNIPER | SCALPER | MOMENTUM | etc.
- `WalletTokenPrediction.behaviorType` → Used for exit time predictions

**Database:**
- `BehaviorAnalysis.historicalPattern` JSON field
- Contains `behaviorType` classification for each wallet

**Implementation:** `src/core/analysis/behavior/constants.ts:35-55`

---

### Holder Behavior vs Trading Style: Side-by-Side Comparison

Understanding when to use which classification:

| **Aspect** | **Trading Style** (General) | **Holder Behavior** (Exit Prediction) |
|-----------|---------------------------|-----------------------------------|
| **Purpose** | General wallet classification | Exit timing prediction for specific tokens |
| **Data Source** | ALL positions (active + completed) | ONLY completed/exited positions |
| **Metric Used** | Median hold time | Median of completed holds only |
| **Categories** | 6 speed categories | 8 granular timing categories |
| **Granularity** | Broad (minutes to weeks) | Precise (1-min increments at low end) |
| **UI Display** | Wallet overview, general stats | Holder risk tables, exit predictions |
| **Use Case** | "What kind of trader is this?" | "When will they dump this token?" |
| **Example** | FLIPPER (3-10 min holds) | SCALPER (1-5 min completed exits) |

**Why Two Systems?**

1. **Trading Style** is for understanding overall behavior - includes current positions
2. **Holder Behavior** is for predicting exits - only looks at historical completions

**Example Scenario:**
```javascript
Wallet X:
- Trading Style: FAST_TRADER (median 45 min across all positions)
- Holder Behavior: MOMENTUM (median 20 min for completed exits)

Translation:
- Overall, they hold for ~45 minutes on average
- But when they DO exit, it's typically around 20 minutes
- Active positions might be outliers (held longer than usual)
- Exit prediction: Expect dumps within 20-30 minutes based on historical pattern
```

---

## Part 6: Hold Time Distribution Buckets

We break down ALL holds into 8 time buckets for granular analysis:

| **Bucket** | **Time Range** | **What It Captures** |
|-----------|----------------|----------------------|
| **instant** | < 0.36 seconds | Same transaction (MEV, sandwich attacks) |
| **ultraFast** | < 1 minute | Bot-driven instant exits |
| **fast** | 1-5 minutes | Pure scalping |
| **momentum** | 5-30 minutes | Momentum plays |
| **intraday** | 30 min - 4 hours | Short-term intraday |
| **day** | 4-24 hours | Day trading range |
| **swing** | 1-7 days | Swing trading range |
| **position** | 7+ days | Position/long-term holds |

### Enriched Metrics Per Bucket

For each bucket, we track:
- **Count:** Number of tokens held in this timeframe
- **Win Rate:** % of profitable tokens (0-100%)
- **Total PnL (SOL):** Sum of all profits/losses
- **Average PnL (SOL):** PnL per token
- **ROI %:** Return on investment percentage
- **Total Capital (SOL):** Capital invested in this timeframe

**Example Use:** A trader might be a "DAY_TRADER" but have 80% win rate in the "swing" bucket - meaning they make more money when they hold longer than usual.

**Implementation:** `src/types/behavior.ts:64-115`

---

## Part 7: Real-World Examples

### Example 1: Professional Memecoin Trader
```
Trading Style: BALANCED FAST_TRADER
Median Hold: 45 minutes
Weighted Avg: 2 hours
Economic Risk: HIGH

Distribution:
- ultraFast: 5% (win rate 40%)
- fast: 30% (win rate 65%)
- momentum: 50% (win rate 75%)  ← Sweet spot!
- intraday: 15% (win rate 60%)
```

**Translation:** They trade 10-60 minute momentum plays, with equal buy/sell volumes. Most profitable when holding 5-30 minutes. High economic risk because most money exits same-day. Professional scalper behavior.

---

### Example 2: Strategic Accumulator
```
Trading Style: ACCUMULATOR SWING_TRADER
Median Hold: 4 days
Weighted Avg: 45 days
Economic Risk: LOW

Distribution:
- swing: 40% (win rate 55%)
- position: 60% (win rate 70%)  ← Most capital here!
```

**Translation:** Typically holds 1-7 days, but puts BIG money into longer positions (7+ days). More buying than selling (accumulating). Low risk to holders because weighted average shows commitment. Smart money behavior.

---

### Example 3: Bot/Sniper
```
Trading Style: BALANCED ULTRA_FLIPPER
Median Hold: 2 minutes
Weighted Avg: 2.5 minutes
Economic Risk: CRITICAL

Distribution:
- instant: 15%
- ultraFast: 70%  ← Almost everything!
- fast: 15%
```

**Translation:** Almost certainly a bot. Perfect buy/sell balance, exits within minutes, consistent timing. CRITICAL risk to holders - they'll dump immediately. Avoid being exit liquidity for this wallet.

---

### Example 4: Early Investor Distributing
```
Trading Style: DISTRIBUTOR POSITION_TRADER
Median Hold: 20 days
Weighted Avg: 60 days
Economic Risk: LOW

Buy Count: 5
Sell Count: 45
```

**Translation:** Holds long-term but sells WAY more than buys. Likely an early investor, team member, or whale distributing a large position slowly. Low economic risk but dilutive to holders over time.

---

## Part 8: Confidence Scores

Every classification includes a confidence score (0-1) based on:

1. **Sample Size:** More completed trading cycles = higher confidence
   - High: 10+ completed cycles
   - Medium: 5-9 completed cycles
   - Low: 3-4 completed cycles

2. **Data Quality:** Clean, consistent data = higher confidence

3. **Pattern Consistency:** Clear patterns = higher confidence
   - Buy/sell symmetry
   - Sequence consistency (clean buy→sell→buy→sell patterns)

**Example:**
```
Trading Style: BALANCED DAY_TRADER (0.85 confidence)
```
High confidence means this classification is very reliable (10+ cycles, clean patterns).

```
Trading Style: ACCUMULATOR SWING_TRADER (0.45 confidence)
```
Low confidence means insufficient data - take classification with grain of salt.

**Implementation:** `src/core/analysis/behavior/constants.ts:261-283`

---

## Part 9: Quick Reference Cheat Sheet

### Speed → Behavior Interpretation

| **If you see...** | **It means...** |
|------------------|-----------------|
| BALANCED + FLIPPER | Professional sniper: clean fast trades with equal buy/sell |
| ACCUMULATOR + SWING_TRADER | Building positions patiently over days/weeks |
| DISTRIBUTOR + POSITION_TRADER | Whale/early investor slowly exiting large position |
| BALANCED + ULTRA_FLIPPER | Bot (MEV/arbitrage): superhuman speed + perfect symmetry |
| HOLDER + SWING_TRADER | Accumulates over weeks, rarely/never sells |
| BALANCED + DAY_TRADER | Classic day trader: in/out same day, never holds overnight |
| ACCUMULATOR + FAST_TRADER | Quick trades but net buying (using profits to accumulate) |
| DISTRIBUTOR + DAY_TRADER | Day trading but taking more profits than adding capital |

---

## Part 10: Data Sources & Implementation

### Primary Type Definitions
- **Trading Style Types:** `src/core/analysis/behavior/constants.ts:60-67`
- **Behavioral Pattern Types:** `src/core/analysis/behavior/constants.ts:85-90`
- **Holder Behavior Types:** `src/core/analysis/behavior/constants.ts:72-80`
- **Complete Metrics Interface:** `src/types/behavior.ts:167-245`

### Classification Functions
- **Trading Speed Classification:** `src/core/analysis/behavior/constants.ts:128-142`
- **Holder Behavior Classification:** `src/core/analysis/behavior/constants.ts:152-172`
- **Behavioral Pattern Classification:** `src/core/analysis/behavior/constants.ts:182-219`
- **Trading Style Description Generator:** `src/core/analysis/behavior/constants.ts:230-249`

### Analyzer Implementation
- **Main Analysis Orchestrator:** `src/core/analysis/behavior/analyzer.ts:57-167`
- **Historical Pattern Calculator:** `src/core/analysis/behavior/analyzer.ts:177-400`
- **Trading Interpretation Generator:** `src/core/analysis/behavior/analyzer.ts:1648-1694`

---

## Summary: The Complete Picture

When you see: **"BALANCED SWING_TRADER"**

**It means:**
- **SWING_TRADER** (Speed): They typically hold positions for 1-7 days
- **BALANCED** (Pattern): They have roughly equal buy and sell volumes
- **Combined:** A patient trader who takes multi-day positions with clean entry/exit cycles. Not a flipper, not a long-term holder. Professional swing trading behavior.

**Economic Context:**
- Check **Weighted Average Hold Time** to see where the real money goes
- Check **Economic Risk** to understand holder impact
- Check **Distribution Buckets** to see their win rate by timeframe
- Check **Confidence Score** to know how reliable the classification is

**Holder Impact:**
- Moderate - they'll hold for days, not hours or minutes
- If economic risk is LOW and weighted avg is high, even better (big positions held longer)
- Much safer than FLIPPER or DAY_TRADER profiles

---

## Need More Help?

- **API Documentation:** See `docs/technical/api/README.md`
- **Metric Definitions:** See `docs/2. metrics_map.md`
- **Usage Examples:** See `docs/usage/wallet-behavior-kpis.md`
- **Type Definitions:** See `src/types/behavior.ts`

**Questions?** Check the inline code documentation or reach out to the dev team.
