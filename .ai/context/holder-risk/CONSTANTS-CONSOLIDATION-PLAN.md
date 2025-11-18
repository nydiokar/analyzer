# Constants Consolidation Plan
**Date**: 2025-11-18
**Goal**: Consolidate all behavior classification thresholds into `src/core/analysis/behavior/constants.ts` as single source of truth

---

## 🎯 Problem Statement

Currently we have **3 different classification systems** with **hardcoded thresholds** scattered across the codebase:

1. **`constants.ts`** - DEFINED but NEVER USED (dead code)
2. **`analyzer.ts:1388-1400`** - TradingInterpretation.speedCategory (legacy, 6 categories, hardcoded)
3. **`analyzer.ts:277-293`** - WalletHistoricalPattern.behaviorType (NEW, 8 categories, hardcoded) ✅

**Risk**: One threshold change requires updating multiple locations. Easy to create inconsistencies.

---

## 📊 Current Threshold Comparison

### System #1: constants.ts (UNUSED)
```typescript
ULTRA_FLIPPER:   0.05h   (3 min)
FLIPPER:         0.167h  (10 min)
FAST_TRADER:     1h
DAY_TRADER:      24h
SWING_TRADER:    168h    (7 days)
// implicit POSITION_TRADER: 7+ days
```

### System #1: TradingInterpretation.speedCategory (analyzer.ts:1360)
```typescript
ULTRA_FLIPPER:   0.05h   (3 min)
FLIPPER:         0.167h  (10 min)
FAST_TRADER:     1h
DAY_TRADER:      24h
SWING_TRADER:    168h    (7 days)
POSITION_TRADER: 168h+   (7+ days)

Data Source: COMPLETED/EXITED positions (via historicalPattern.medianCompletedHoldTimeHours)
```

### System #2: WalletHistoricalPattern.behaviorType (analyzer.ts:265) ✅ TARGET
```typescript
SNIPER:      0.0167h  (1 min)
SCALPER:     0.0833h  (5 min)
MOMENTUM:    0.5h     (30 min)
INTRADAY:    4h
DAY_TRADER:  24h
SWING:       168h     (7 days)
POSITION:    720h     (30 days)
HOLDER:      720h+    (30+ days)

Data Source: COMPLETED/EXITED positions (via historicalPattern.medianCompletedHoldTimeHours)
```

---

## 🔄 Migration Strategy

### Phase 1: Expand constants.ts with New System ✅

**File**: `src/core/analysis/behavior/constants.ts`

Add new constants for **historical pattern classification** (System #3):

```typescript
/**
 * Historical Pattern Classification Thresholds
 * Used for WalletHistoricalPattern.behaviorType
 * Based on MEDIAN completed hold time (outlier-robust)
 */
export const HISTORICAL_PATTERN_THRESHOLDS_MINUTES = {
  SNIPER:      1,      // <1 min: Bot/MEV behavior
  SCALPER:     5,      // 1-5 min: Ultra-fast scalping
  MOMENTUM:    30,     // 5-30 min: Momentum trading
  INTRADAY:    240,    // 30min-4h: Short-term intraday (4h * 60 = 240)
  DAY_TRADER:  1440,   // 4-24h: Day trading (24h * 60 = 1440)
  SWING:       10080,  // 1-7 days: Swing trading (7d * 24 * 60 = 10080)
  POSITION:    43200,  // 7-30 days: Position trading (30d * 24 * 60 = 43200)
  // 30+ days = HOLDER
} as const;

export const HISTORICAL_PATTERN_THRESHOLDS_HOURS = {
  SNIPER:      1/60,     // 0.0167 hours
  SCALPER:     5/60,     // 0.0833 hours
  MOMENTUM:    0.5,      // 30 minutes
  INTRADAY:    4,        // 4 hours
  DAY_TRADER:  24,       // 24 hours
  SWING:       168,      // 7 days
  POSITION:    720,      // 30 days
  // 30+ days = HOLDER
} as const;

/**
 * Historical pattern behavior types
 */
export type HistoricalBehaviorType =
  | 'SNIPER'
  | 'SCALPER'
  | 'MOMENTUM'
  | 'INTRADAY'
  | 'DAY_TRADER'
  | 'SWING'
  | 'POSITION'
  | 'HOLDER';

/**
 * Classify historical behavior based on median completed hold time
 * Used for holder risk analysis and exit predictions
 *
 * @param medianHoldTimeHours - Median holding time from COMPLETED positions only
 * @returns Historical behavior classification
 */
export function classifyHistoricalBehavior(medianHoldTimeHours: number): HistoricalBehaviorType {
  const minutes = medianHoldTimeHours * 60;

  if (minutes < HISTORICAL_PATTERN_THRESHOLDS_MINUTES.SNIPER) {
    return 'SNIPER';
  } else if (minutes < HISTORICAL_PATTERN_THRESHOLDS_MINUTES.SCALPER) {
    return 'SCALPER';
  } else if (minutes < HISTORICAL_PATTERN_THRESHOLDS_MINUTES.MOMENTUM) {
    return 'MOMENTUM';
  } else if (medianHoldTimeHours < HISTORICAL_PATTERN_THRESHOLDS_HOURS.INTRADAY) {
    return 'INTRADAY';
  } else if (medianHoldTimeHours < HISTORICAL_PATTERN_THRESHOLDS_HOURS.DAY_TRADER) {
    return 'DAY_TRADER';
  } else if (medianHoldTimeHours < HISTORICAL_PATTERN_THRESHOLDS_HOURS.SWING) {
    return 'SWING';
  } else if (medianHoldTimeHours < HISTORICAL_PATTERN_THRESHOLDS_HOURS.POSITION) {
    return 'POSITION';
  } else {
    return 'HOLDER';
  }
}
```

### Phase 2: Migrate analyzer.ts ✅

**File**: `src/core/analysis/behavior/analyzer.ts`

**Line 277-293** - Replace hardcoded classification:

```typescript
// BEFORE (hardcoded):
const minutes = medianCompletedHoldTimeHours * 60;
if (minutes < 1) {
  behaviorType = 'SNIPER';
} else if (minutes < 5) {
  behaviorType = 'SCALPER';
}
// ... etc

// AFTER (using constants):
import { classifyHistoricalBehavior } from './constants';

const behaviorType = classifyHistoricalBehavior(medianCompletedHoldTimeHours);
```

**Line 1388-1400** - Replace hardcoded speedCategory:

```typescript
// BEFORE (hardcoded):
let speedCategory: string;
if (medianHoldHours < 0.05) {
  speedCategory = 'ULTRA_FLIPPER';
}
// ... etc

// AFTER (using constants):
import { classifyTradingSpeed } from './constants';

const speedCategory = classifyTradingSpeed(medianHoldHours);
```

### Phase 3: Update Type Definitions ✅

**File**: `src/types/behavior.ts`

Import and use the type from constants:

```typescript
import type { HistoricalBehaviorType } from '../core/analysis/behavior/constants';

export interface WalletHistoricalPattern {
  // ... other fields
  behaviorType: HistoricalBehaviorType;  // Instead of inline union type
  // ... other fields
}
```

### Phase 4: Consolidate Documentation ✅

Update `.ai/CONTEXT.md` to reflect the new single source of truth:

```markdown
- [x] **Constants Consolidation**: ✅ **COMPLETE** (2025-11-18)
  - All behavior classification thresholds consolidated into `src/core/analysis/behavior/constants.ts`
  - Two classification systems (both actively used):
    1. `classifyTradingSpeed()` - Legacy speed categories (6 types) for TradingInterpretation
    2. `classifyHistoricalBehavior()` - Granular holder risk categories (8 types) for WalletHistoricalPattern
  - All hardcoded thresholds removed from `analyzer.ts`
  - Single source of truth: Changing thresholds requires updating only `constants.ts`
```

---

## 🎨 What Changes for Users?

### Behavior Classifications (WalletHistoricalPattern.behaviorType)

**NO CHANGE** - The thresholds remain exactly the same, just moved to constants:

| Category | Threshold | Example | Change? |
|----------|-----------|---------|---------|
| SNIPER | <1 min | Bot/MEV | ✅ Same |
| SCALPER | 1-5 min | Ultra-fast | ✅ Same |
| MOMENTUM | 5-30 min | Momentum plays | ✅ Same |
| INTRADAY | 30min-4h | Intraday | ✅ Same |
| DAY_TRADER | 4-24h | Day trading | ✅ Same |
| SWING | 1-7 days | Swing trading | ✅ Same |
| POSITION | 7-30 days | Position | ✅ Same |
| HOLDER | 30+ days | Long-term | ✅ Same |

### Speed Categories (TradingInterpretation.speedCategory)

**NO CHANGE** - Legacy system remains as-is:

| Category | Threshold | Change? |
|----------|-----------|---------|
| ULTRA_FLIPPER | <3 min | ✅ Same |
| FLIPPER | 3-10 min | ✅ Same |
| FAST_TRADER | 10-60 min | ✅ Same |
| DAY_TRADER | 1-24h | ✅ Same |
| SWING_TRADER | 1-7 days | ✅ Same |
| POSITION_TRADER | 7+ days | ✅ Same |

---

## ✅ Benefits

1. **Single Source of Truth**: All thresholds in one file
2. **Easy to Modify**: Change one constant, affects all classifications
3. **Type Safety**: TypeScript types exported from constants
4. **Testable**: Can unit test classification functions in isolation
5. **Documented**: Clear comments explaining each threshold
6. **No Breaking Changes**: Existing API responses unchanged

---

## 🧪 Testing Plan

1. **Unit Tests**: Test `classifyHistoricalBehavior()` with edge cases:
   - 0.9 min → SNIPER
   - 1.0 min → SCALPER
   - 4.99 min → SCALPER
   - 5.0 min → MOMENTUM
   - etc.

2. **Integration Tests**: Validate analyzer output unchanged:
   - Run against test wallets
   - Compare before/after classifications
   - Verify 100% match

3. **Validation Script**: Use existing `validate-holder-risk.ts` to test real wallets

---

## 📁 Files to Modify

1. ✅ `src/core/analysis/behavior/constants.ts` - Add new constants + helper
2. ✅ `src/core/analysis/behavior/analyzer.ts` - Replace hardcoded logic (2 locations)
3. ✅ `src/types/behavior.ts` - Import and use types from constants
4. ✅ `.ai/CONTEXT.md` - Document consolidation complete
5. ⚠️ OPTIONAL: Update DTOs to import types from constants (for consistency)

---

## 🚀 Rollout

1. Implement changes
2. Run unit tests
3. Run integration tests on 19 test wallets
4. Rebuild backend + frontend
5. Deploy
6. Monitor for any classification changes (should be zero)

---

## 🔮 Future: Config-Driven Thresholds

**Later enhancement** (not in this migration):

```typescript
// Could make thresholds configurable via environment variables
export const HISTORICAL_PATTERN_THRESHOLDS_HOURS = {
  SNIPER: parseFloat(process.env.THRESHOLD_SNIPER_HOURS || '0.0167'),
  SCALPER: parseFloat(process.env.THRESHOLD_SCALPER_HOURS || '0.0833'),
  // etc.
} as const;
```

This would allow tuning without code changes. But for now, constants are fine.

---

**Status**: Ready to implement
**Risk**: Low (pure refactor, no logic changes)
**Estimated Time**: 2-3 hours
**Breaking Changes**: None
