# Classification System - Target State Contract

**What we're building**: Explicit, enum-based classification stored in DB

---

## Data Flow (Raw → Derived → Stored → Exposed)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. RAW DATA (computed by analyzer.ts)                          │
├─────────────────────────────────────────────────────────────────┤
│ • Transactions (buys/sells from Solana)                         │
│ • FIFO matching → completed trade cycles                       │
│ • medianHoldDurationHours (per cycle)                          │
│ • tokensWithBothBuyAndSell (completed cycles)                  │
│ • tokensWithOnlyBuys (active holdings)                         │
│ • buyCount, sellCount                                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 2. CLASSIFICATION (computed by analyzer.ts)                     │
├─────────────────────────────────────────────────────────────────┤
│ speedCategory: SNIPER | SCALPER | MOMENTUM | INTRADAY |        │
│                DAY_TRADER | SWING | POSITION | HOLDER | null   │
│                                                                 │
│ flowPattern: BUY_ONLY | SELL_ONLY | ACCUMULATOR |              │
│              DISTRIBUTOR | BALANCED | MIXED                     │
│                                                                 │
│ strategyType: FAST_TRADER | DAY_TRADER | SWING_TRADER |        │
│               POSITION_TRADER | PURE_HOLDER | ACCUMULATOR |    │
│               DISTRIBUTOR | BALANCED_TRADER | LOW_ACTIVITY      │
│                                                                 │
│ velocityScore: 0-100 (continuous metric, NOT a category)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 3. STORAGE (WalletBehaviorProfile table)                       │
├─────────────────────────────────────────────────────────────────┤
│ speedCategory        String?   -- enum stored as string        │
│ flowPattern          String?   -- enum stored as string        │
│ strategyType         String    -- canonical filter field       │
│ velocityScore        Int        -- 0-100                        │
│ tradingStyleLabel    String    -- display only (deprecated)    │
│                                                                 │
│ Indexes: strategyType, speedCategory, flowPattern              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 4. API LAYER (DTOs)                                             │
├─────────────────────────────────────────────────────────────────┤
│ GET /api/wallets/:address/behavior                              │
│   → { speedCategory, flowPattern, strategyType, velocityScore }│
│                                                                 │
│ GET /api/discover/wallets?strategyType=FAST_TRADER              │
│   → Uses exact enum match (not substring search)               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 5. FRONTEND (Display)                                           │
├─────────────────────────────────────────────────────────────────┤
│ Baseball card: Shows speedCategory + flowPattern               │
│ Discover filters: Dropdown with strategyType enum values       │
│ Behavioral tab: Shows velocityScore as progress bar            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Constants Location

**Single source of truth**: `src/core/analysis/behavior/constants.ts`

```typescript
// Time thresholds (hours)
export const SPEED_THRESHOLDS = {
  SNIPER: 1/60,      // < 1 min
  SCALPER: 5/60,     // 1-5 min
  MOMENTUM: 0.5,     // 5-30 min
  INTRADAY: 4,       // 30min-4h
  DAY_TRADER: 24,    // 4-24h
  SWING: 168,        // 1-7 days
  POSITION: 720,     // 7-30 days
  HOLDER: Infinity   // 30+ days (or active hold)
};

// Flow thresholds (buy/sell ratio)
export const FLOW_THRESHOLDS = {
  STRONG_BUY: 2.0,     // 2:1 buy bias → ACCUMULATOR
  STRONG_SELL: 0.5,    // 1:2 sell bias → DISTRIBUTOR
  // Between = BALANCED
};

// Activity gates
export const MINIMUM_DATA = {
  trades: 5,
  tokensWithCompletedCycles: 2
};

// Holder bypass (for wallets without completed cycles)
export const HOLDER_BYPASS = {
  multiToken: {
    minTokens: 3,
    minHoldHours: 24
  },
  singleToken: {
    minPositionSol: 50  // Significant position threshold
  }
};
```

**No other file contains thresholds** - all import from here.

---

## Classification Logic

### speedCategory (8 levels) - ONLY for Completed Cycles

```typescript
// speedCategory measures EXIT TIMING (how fast they sell)
// Only applies to wallets with completed buy→sell cycles

if (tokensWithCompletedCycles >= 2) {
  const medianHoldDuration = median(completedCycleDurations);

  if (medianHoldDuration < 1/60)  speedCategory = 'SNIPER';    // < 1 min
  if (medianHoldDuration < 5/60)  speedCategory = 'SCALPER';   // 1-5 min
  if (medianHoldDuration < 0.5)   speedCategory = 'MOMENTUM';  // 5-30 min
  if (medianHoldDuration < 4)     speedCategory = 'INTRADAY';  // 30min-4h
  if (medianHoldDuration < 24)    speedCategory = 'DAY_TRADER';// 4-24h
  if (medianHoldDuration < 168)   speedCategory = 'SWING';     // 1-7 days
  if (medianHoldDuration < 720)   speedCategory = 'POSITION';  // 7-30 days
  else                            speedCategory = 'HOLDER';    // 30+ days
} else {
  speedCategory = null;  // No completed cycles
}
```

**Key insight**: speedCategory describes TRADING behavior (exit timing), not HOLDING behavior.

### flowPattern (6 patterns)
```
IF tokensWithOnlyBuys > 0 AND tokensWithSells = 0 → BUY_ONLY
IF tokensWithSells > 0 AND tokensWithBuys = 0     → SELL_ONLY
IF buyCount/sellCount >= 2.0                      → ACCUMULATOR
IF buyCount/sellCount <= 0.5                      → DISTRIBUTOR
IF 0.5 < ratio < 2.0                              → BALANCED
Otherwise                                         → MIXED
```

### strategyType (canonical filter) - Derivation Algorithm

```typescript
// Step 1: Check minimum data gate
if (totalTrades < 5 && tokensWithCompletedCycles < 2) {
  // Check holder bypass
  const isMeaningfulHolder =
    (tokensWithOnlyBuys >= 3 && medianActiveHoldingHours >= 24) ||  // Multi-token
    (tokensWithOnlyBuys >= 1 && largestActivePositionSol >= 50);    // Big position

  if (!isMeaningfulHolder) {
    return strategyType = 'LOW_ACTIVITY';  // Gate fails
  }
  // Else: bypass gate, continue classification
}

// Step 2: Pure holders (no exits)
if (flowPattern === 'BUY_ONLY') {
  return strategyType = 'PURE_HOLDER';
}

// Step 3: Flow-dominant patterns
if (flowPattern === 'ACCUMULATOR') return strategyType = 'ACCUMULATOR';
if (flowPattern === 'DISTRIBUTOR' || flowPattern === 'SELL_ONLY') {
  return strategyType = 'DISTRIBUTOR';
}

// Step 4: Speed-based (requires completed cycles)
if (speedCategory === null) {
  // No exits, not BUY_ONLY - check balanced
  if (flowPattern === 'BALANCED') return strategyType = 'BALANCED_TRADER';
  return strategyType = 'LOW_ACTIVITY';
}

if (['SNIPER', 'SCALPER', 'MOMENTUM'].includes(speedCategory)) {
  return strategyType = 'FAST_TRADER';
}
if (['INTRADAY', 'DAY_TRADER'].includes(speedCategory)) {
  return strategyType = 'DAY_TRADER';
}
if (speedCategory === 'SWING') return strategyType = 'SWING_TRADER';
if (['POSITION', 'HOLDER'].includes(speedCategory)) {
  return strategyType = 'POSITION_TRADER';
}

// Step 5: Fallback
if (flowPattern === 'BALANCED') return strategyType = 'BALANCED_TRADER';
return strategyType = 'LOW_ACTIVITY';
```

**First match wins** - order matters for precedence.

### velocityScore (0-100)
```
Maps medianHoldDuration to continuous scale:
- < 1 min    → 100 (maximum velocity)
- 1 hour     → 90
- 6 hours    → 70
- 24 hours   → 50
- 7 days     → 30
- 30+ days   → 0 (minimum velocity)

NOT a category - it's a metric.
```

---

## What Changes

| Component | Before | After |
|-----------|--------|-------|
| **DB Schema** | `tradingStyle String` | `speedCategory String?`<br>`flowPattern String?`<br>`strategyType String`<br>`velocityScore Int` |
| **analyzer.ts** | Uses 6-category taxonomy<br>Excludes pure holders | Uses 8-category taxonomy<br>Includes holder bypass |
| **behavior.service.ts** | Broken `extractBehaviorType()` | Deleted - read from DB |
| **discover.service.ts** | `tradingStyle: { contains: ... }` | `strategyType: { equals: ... }` |
| **Frontend** | Displays composite string | Displays explicit enums |
| **Scripts** | Parse strings | Read typed fields |

---

## What Stays the Same

- FIFO matching logic (no changes)
- Transaction fetching (no changes)
- Bot detection (no changes)
- Baseball card component structure (just uses new fields)
- API endpoints (same routes, different response fields)

---

## Success Criteria

✅ **No more string parsing** - all classification is explicit enums
✅ **Pure holders classified correctly** - buy-only wallets get HOLDER + BUY_ONLY
✅ **Precise filtering** - Discover uses enum equality, not substring search
✅ **Single source of truth** - all thresholds in one constants file
✅ **Professional terminology** - "velocity score" not "flipper score"
✅ **Cache works** - no broken extraction methods
✅ **Backward compatible** - old `tradingStyle` field kept for 6 months

---

## The Contract

**Input**: Wallet address
**Process**: Fetch txs → FIFO match → Classify by thresholds
**Output**: Typed enums (speedCategory, flowPattern, strategyType, velocityScore)
**Storage**: Postgres with indexes
**Exposure**: REST API with exact enum filters
**Display**: React components showing explicit categories

**No ambiguity. No string parsing. No guessing.**
