# Discover Classification Refactor - Complete Implementation Plan

**Status:** Ready for Implementation
**Scope:** Classification taxonomy refactor + cache bug fixes + flipper deprecation
**Last updated:** 2025-12-25
**Estimated effort:** 8-10 days (1 engineer)

---

## Executive Summary

**Problem**: Classification system is broken at multiple levels:
1. Pure holders misclassified as "Low Activity" (minimum trade gate excludes buy-only wallets)
2. Cache reconstruction broken (tries to parse keywords that don't exist in stored strings)
3. Filtering imprecise (substring matching on composite labels instead of explicit enums)
4. "Flipper" terminology is vague and unprofessional
5. Two competing speed taxonomies create confusion

**Solution**: Centralize classification into explicit, filterable dimensions (speed + flow + strategy), fix cache bugs, deprecate "flipper" terminology.

**Impact**: ~27 files, ~1,500-2,000 LOC, backward compatible via v1/v2 dual support

**Critical path**: Fix cache bug → Add holder bypass → Add DB fields → Update consumers

---

## 1) Why This Exists

The Discover page revealed fundamental classification problems:
- **Composite strings used as filter keys** (`"DAY_TRADER (ACCUMULATOR)"` parsed with ILIKE)
- **Pure holders excluded by minimum trade gate** (requires 2+ tokens with both buy+sell)
- **Cache reconstruction broken** (parses `behaviorType` from string that doesn't contain it)
- **"Flipper" used inconsistently** (sometimes score, sometimes category, always vague)

This refactor establishes a **single source of truth** for classification:
- Speed (time-based) vs Flow (buy/sell bias) vs Strategy (canonical filter)
- Explicit DB fields instead of string parsing
- Professional terminology (velocity instead of flipper)
- Holder-friendly gates (bypass for meaningful holding activity)

---

## 2) Current State (What Actually Exists - AUDITED 2025-12-25)

### 2.1 DB Storage (WalletBehaviorProfile)

**File**: `prisma/schema.prisma:143-182`

**Stored fields**:
- `tradingStyle String` - Composite label like `"DAY_TRADER (ACCUMULATOR)"` (ONLY classification field!)
- Raw metrics: `buySellRatio`, `medianHoldTime`, `totalBuyCount`, `totalSellCount`, etc.
- Optional JSON: `holdTimeTokenMap`, `enrichedHoldTimeDistribution`

**NOT stored**:
- `speedCategory` (must recompute from `medianHoldTime`)
- `flowPattern` (must recompute from `buySellRatio`)
- `strategyType` (doesn't exist yet)
- `behaviorType` (only exists in optional `historicalPattern` JSON, not a column)
- `tokensWithOnlyBuys` (computed but not stored)
- `medianCurrentHoldingDurationHours` (computed but not stored)

**Problem**: Discover filtering requires substring parsing because explicit fields don't exist.

---

### 2.2 Classification Logic (Analyzer)

**File**: `src/core/analysis/behavior/analyzer.ts`

**Three competing systems**:

1. **TradingSpeedCategory** (6 categories: ULTRA_FLIPPER → POSITION_TRADER)
   - Used in `classifyTradingSpeed()` (constants.ts:128)
   - NOT used in final classification (deprecated by granular taxonomy)

2. **HolderBehaviorType** (8 categories: SNIPER → HOLDER) **← CANONICAL**
   - Used in `classifyHolderBehavior()` (constants.ts:152)
   - Stored in `metrics.historicalPattern.behaviorType`
   - This is the CORRECT taxonomy (granular, exit-focused)

3. **BehavioralPattern** (5 categories: ACCUMULATOR / DISTRIBUTOR / BALANCED / HOLDER / DUMPER)
   - Derived in `classifyTradingStyle()` (analyzer.ts:1576)
   - Mixed into composite string
   - **HOLDER collision** with speed taxonomy

**Current flow** (analyzer.ts:1539-1643):
```typescript
classifyTradingStyle(metrics) {
  // Gate: requires 5+ trades AND 2+ tokens with both buy+sell
  if (totalTradeCount < 5 || tokensWithBothBuyAndSell < 2) {
    metrics.tradingStyle = 'Low Activity';  // ← PROBLEM: Excludes pure holders
    return;
  }

  speedCategory = classifyTradingSpeed(medianHoldTime);  // Uses 6-category (wrong)
  behavioralPattern = deriveBehavioralPattern(...);      // Includes HOLDER (collision)

  metrics.tradingStyle = `${speedCategory} (${behavioralPattern})`;  // Composite string
}
```

**Problems**:
- Uses 6-category `TradingSpeedCategory` instead of 8-category `HolderBehaviorType`
- Pure holders (no sells) fail `tokensWithBothBuyAndSell < 2` check
- Creates composite string instead of explicit fields
- No `strategyType` derivation

---

### 2.3 Cache Reconstruction (CRITICAL BUG)

**File**: `src/api/services/behavior.service.ts:86-155`

**Broken code** (lines 143-155):
```typescript
private extractBehaviorType(tradingStyle: string): any {
  if (tradingStyle.includes('SNIPER')) return 'SNIPER';
  if (tradingStyle.includes('SCALPER')) return 'SCALPER';
  // ... more checks ...
  return 'DAY_TRADER'; // Default fallback
}
```

**Why it's broken**:
- `tradingStyle` format: `"DAY_TRADER (ACCUMULATOR)"`
- Granular types (SNIPER, SCALPER, etc.) are NEVER in this string
- Always falls back to `'DAY_TRADER'`
- All cached `behaviorType` values are **corrupted**

**Impact**: Every wallet loaded from cache has wrong `behaviorType`

---

### 2.4 Discover Filtering

**File**: `src/api/services/discover.service.ts:93-102`

**Current implementation**:
```typescript
if (style) {
  where.behaviorProfile = {
    is: {
      tradingStyle: { contains: normalizedStyle, mode: 'insensitive' }
    }
  };
}
```

**Problems**:
- Substring matching (imprecise)
- Can't filter for "fast traders who are NOT accumulators"
- Can't combine filters (speed + flow)

---

### 2.5 "Flipper" Problem

**Locations**:
- `flipperScore` metric (analyzer.ts:1514-1529)
- Discover reason derivation (discover.service.ts:300-302)
- Scripts (validate-behavior-metrics.ts, generate-holder-analysis.ts)

**Issues**:
1. **Vague meaning**: "Flipper" could mean anything
2. **Inconsistent usage**:
   - Score (0-100) vs category
   - Sometimes means ULTRA_FLIPPER (< 3 min)
   - Sometimes means fast traders (< 30 min)
3. **Unprofessional**: Sounds like dolphins or casual trading
4. **Code confusion**:
   ```typescript
   const isFlipper = ['SNIPER', 'SCALPER', 'MOMENTUM'].includes(speedCategory);
   ```
   This is THREE distinct speeds (1min, 5min, 30min) lumped together

**What it actually measures**: Percentage of trades in ultra-fast buckets (continuous metric, NOT a category)

---

## 3) Root Problems (Comprehensive List)

1. **Composite String = Ambiguous Filter** (`"DAY_TRADER (ACCUMULATOR)"`)
2. **HOLDER Collision** (speed taxonomy vs flow taxonomy)
3. **Two Speed Systems Compete** (6-category vs 8-category - should use 8)
4. **Cache Reconstruction Broken** (parses keywords that don't exist)
5. **Low Activity Gate Excludes Holders** (requires completed cycles)
6. **Current Holdings Not Stored** (computed but lost)
7. **"Flipper" Terminology Vague** (score vs category, unprofessional)
8. **No Canonical Filter Key** (`strategyType` doesn't exist)

---

## 4) Proposed Solution (Centralized Classification Contract)

### 4.1 Canonical Fields (What We're Adding to DB)

**Add to `WalletBehaviorProfile` schema**:

```prisma
model WalletBehaviorProfile {
  // ... existing fields ...

  // NEW: Explicit classification (nullable for backward compat)
  speedCategory             String?  // 'SNIPER' | 'SCALPER' | ... | 'HOLDER' | null
  flowPattern               String?  // 'BUY_ONLY' | 'ACCUMULATOR' | ... | 'MIXED'
  strategyType              String?  // 'FAST_TRADER' | 'PURE_HOLDER' | ... | 'LOW_ACTIVITY'

  // NEW: Active holding metrics (for holders without exits)
  tokensWithOnlyBuys        Int?
  tokensWithOnlySells       Int?
  medianCurrentHoldingDurationHours Float?
  percentOfValueInCurrentHoldings   Float?

  // NEW: Rename flipper → velocity (professional terminology)
  velocityScore             Float?   // 0-100, measures trading speed intensity

  // DEPRECATED: Keep for backward compat, mark as display-only
  flipperScore              Float?   // Alias for velocityScore (v1 compat)
  tradingStyle              String   // Display label, NOT for filtering
}
```

**Indexes** (for filtering performance):
```sql
CREATE INDEX idx_wallet_behavior_strategy ON "WalletBehaviorProfile"("strategyType");
CREATE INDEX idx_wallet_behavior_speed ON "WalletBehaviorProfile"("speedCategory");
CREATE INDEX idx_wallet_behavior_flow ON "WalletBehaviorProfile"("flowPattern");
```

---

### 4.2 Classification Dimensions

**(A) speedCategory** - Time-based behavior from COMPLETED trades

- **Enum**: `SNIPER | SCALPER | MOMENTUM | INTRADAY | DAY_TRADER | SWING | POSITION | HOLDER`
- **Source**: `medianCompletedHoldTimeHours` (FIFO-matched buy→sell cycles)
- **Thresholds**: See `HOLDER_BEHAVIOR_THRESHOLDS_HOURS` (constants.ts:46-55)
- **Null case**: No completed trades (pure holder)

**(B) flowPattern** - Buy/sell directional bias

- **Enum**: `BUY_ONLY | SELL_ONLY | ACCUMULATOR | DISTRIBUTOR | BALANCED | MIXED`
- **Source**: `buySellRatio`, `totalBuyCount`, `totalSellCount`
- **Rename**: `BehavioralPattern.HOLDER` → `BUY_ONLY` (avoid collision)
- **Thresholds**: See `BEHAVIOR_CLASSIFICATION` (constants.ts:344-351)

**(C) strategyType** - Canonical filter key (NEW)

- **Enum**: `FAST_TRADER | DAY_TRADER | SWING_TRADER | POSITION_TRADER | PURE_HOLDER | ACCUMULATOR | DISTRIBUTOR | BALANCED_TRADER | LOW_ACTIVITY`
- **Source**: Derived from `speedCategory + flowPattern + activeHoldSignal`
- **Purpose**: Single filterable field for UI/API

**(D) activeHoldSignal** - Holder bypass logic (NEW)

```typescript
interface ActiveHoldSignal {
  hasActivePositions: boolean;          // tokensWithOnlyBuys > 0
  activeTokenCount: number;             // Count of buy-only tokens
  medianActiveHoldHours: number | null; // Median of current holds
  isMeaningfulHolder: boolean;          // activeTokenCount >= 3 && medianActiveHoldHours >= 24
}
```

**(E) velocityScore** - Trading speed intensity (RENAME from flipperScore)

- **Type**: `Float` (0-100)
- **Meaning**: Percentage of trades in ultra-fast buckets (< 1 hour)
- **Professional term**: "Velocity" instead of "Flipper"
- **NOT a category**: Continuous metric for intensity measurement

---

### 4.3 Derivation Rules (Deterministic Algorithm)

**File**: To be added in `src/core/analysis/behavior/analyzer.ts`

```typescript
function deriveStrategyType(
  speedCategory: SpeedCategory | null,
  flowPattern: FlowPattern,
  activeHoldSignal: ActiveHoldSignal,
  totalTradeCount: number,
  tokensWithBothBuyAndSell: number
): StrategyType {
  // 1. Check minimum data gate
  const meetsMinimumData =
    totalTradeCount >= 5 &&
    tokensWithBothBuyAndSell >= 2;

  // 2. NEW: Holder bypass
  const isMeaningfulHolder =
    activeHoldSignal.activeTokenCount >= 3 &&
    activeHoldSignal.medianActiveHoldHours >= 24;

  if (!meetsMinimumData && !isMeaningfulHolder) {
    return 'LOW_ACTIVITY';
  }

  // 3. Pure holders (no exits)
  if (flowPattern === 'BUY_ONLY') {
    return 'PURE_HOLDER';
  }

  // 4. Flow-dominant patterns
  if (flowPattern === 'ACCUMULATOR') return 'ACCUMULATOR';
  if (flowPattern === 'DISTRIBUTOR') return 'DISTRIBUTOR';
  if (flowPattern === 'SELL_ONLY') return 'DISTRIBUTOR';

  // 5. Speed-based (requires completed exits)
  if (speedCategory === null) {
    return flowPattern === 'BALANCED' ? 'BALANCED_TRADER' : 'LOW_ACTIVITY';
  }

  if (['SNIPER', 'SCALPER', 'MOMENTUM'].includes(speedCategory)) {
    return 'FAST_TRADER';
  }
  if (['INTRADAY', 'DAY_TRADER'].includes(speedCategory)) {
    return 'DAY_TRADER';
  }
  if (speedCategory === 'SWING') {
    return 'SWING_TRADER';
  }
  if (['POSITION', 'HOLDER'].includes(speedCategory)) {
    return 'POSITION_TRADER';
  }

  return 'LOW_ACTIVITY';
}
```

---

## 5) Implementation Plan (Phase-by-Phase)

### **PHASE 1: DB Schema & Indexes** (Day 1)

**Files**:
- `prisma/schema.prisma`
- `prisma/migrations/[timestamp]_add_classification_fields/migration.sql`

**Changes**:
1. Add 7 new nullable columns to `WalletBehaviorProfile`:
   - `speedCategory`, `flowPattern`, `strategyType`
   - `tokensWithOnlyBuys`, `tokensWithOnlySells`
   - `medianCurrentHoldingDurationHours`, `percentOfValueInCurrentHoldings`
2. Add `velocityScore Float?` (rename of flipperScore)
3. Add 3 indexes on filter columns
4. Mark `flipperScore` as deprecated (keep for v1 compat)

**Migration**:
```sql
ALTER TABLE "WalletBehaviorProfile"
  ADD COLUMN "speedCategory" TEXT,
  ADD COLUMN "flowPattern" TEXT,
  ADD COLUMN "strategyType" TEXT,
  ADD COLUMN "tokensWithOnlyBuys" INTEGER,
  ADD COLUMN "tokensWithOnlySells" INTEGER,
  ADD COLUMN "medianCurrentHoldingDurationHours" DOUBLE PRECISION,
  ADD COLUMN "percentOfValueInCurrentHoldings" DOUBLE PRECISION,
  ADD COLUMN "velocityScore" DOUBLE PRECISION;

CREATE INDEX idx_wallet_behavior_strategy ON "WalletBehaviorProfile"("strategyType");
CREATE INDEX idx_wallet_behavior_speed ON "WalletBehaviorProfile"("speedCategory");
CREATE INDEX idx_wallet_behavior_flow ON "WalletBehaviorProfile"("flowPattern");
```

**Testing**: Run migration on dev DB, verify schema

**Effort**: 2-3 hours

---

### **PHASE 2: Type Definitions** (Day 1)

**Files**:
- `src/types/behavior.ts`
- `src/core/analysis/behavior/constants.ts`

**Changes**:
1. Add `SpeedCategory` type (use existing `HolderBehaviorType` as base)
2. Add `FlowPattern` type (rename from `BehavioralPattern`)
3. Add `StrategyType` type (NEW)
4. Add `ActiveHoldSignal` interface (NEW)
5. Update `BehavioralMetrics` interface with new fields
6. Rename `BehavioralPattern.HOLDER` → `BUY_ONLY`
7. Rename `BehavioralPattern.DUMPER` → `SELL_ONLY`

**Code**:
```typescript
// src/types/behavior.ts
export type SpeedCategory =
  | 'SNIPER' | 'SCALPER' | 'MOMENTUM' | 'INTRADAY'
  | 'DAY_TRADER' | 'SWING' | 'POSITION' | 'HOLDER';

export type FlowPattern =
  | 'BUY_ONLY' | 'SELL_ONLY' | 'ACCUMULATOR'
  | 'DISTRIBUTOR' | 'BALANCED' | 'MIXED';

export type StrategyType =
  | 'FAST_TRADER' | 'DAY_TRADER' | 'SWING_TRADER' | 'POSITION_TRADER'
  | 'PURE_HOLDER' | 'ACCUMULATOR' | 'DISTRIBUTOR' | 'BALANCED_TRADER'
  | 'LOW_ACTIVITY';

export interface ActiveHoldSignal {
  hasActivePositions: boolean;
  activeTokenCount: number;
  medianActiveHoldHours: number | null;
  totalValueHeld: number | null;
}

export interface BehavioralMetrics {
  // ... existing fields ...

  // NEW: Explicit classification
  speedCategory: SpeedCategory | null;
  flowPattern: FlowPattern;
  strategyType: StrategyType;
  activeHoldSignal: ActiveHoldSignal;

  // NEW: Active holding metrics
  tokensWithOnlyBuys: number;
  tokensWithOnlySells: number;
  medianCurrentHoldingDurationHours: number | null;
  percentOfValueInCurrentHoldings: number | null;

  // NEW: Velocity score (professional term)
  velocityScore: number;

  // DEPRECATED: Keep for backward compat
  flipperScore: number; // Alias for velocityScore
  tradingStyle: string; // Display label only
  tradingStyleLabel: string; // Same as tradingStyle
}
```

**Testing**: TypeScript compilation

**Effort**: 1-2 hours

---

### **PHASE 3: Analyzer Updates** (Days 2-3)

**Files**:
- `src/core/analysis/behavior/analyzer.ts`
- `src/core/analysis/behavior/constants.ts`
- `src/config/constants.ts`

**Changes**:

**3A. Compute active holding metrics** (analyzer.ts ~line 1400)
```typescript
// NEW: Calculate active holding metrics
metrics.tokensWithOnlyBuys = tokenSequences.filter(seq =>
  seq.buyCount > 0 && seq.sellCount === 0
).length;

metrics.tokensWithOnlySells = tokenSequences.filter(seq =>
  seq.buyCount === 0 && seq.sellCount > 0
).length;

const currentHoldingDurations = this.calculateCurrentHoldingDurations(tokenSequences);
metrics.medianCurrentHoldingDurationHours = this.calculateMedian(currentHoldingDurations);

// ... (calculate percentOfValueInCurrentHoldings)
```

**3B. Update classification gate with holder bypass** (analyzer.ts:1552)
```typescript
// BEFORE
if (totalTradeCount < 5 || tokensWithBothBuyAndSell < 2) {
  metrics.tradingStyle = 'Low Activity';
  return;
}

// AFTER
const meetsMinimumData =
  totalTradeCount >= 5 &&
  tokensWithBothBuyAndSell >= 2;

const activeHoldSignal: ActiveHoldSignal = {
  hasActivePositions: metrics.tokensWithOnlyBuys > 0,
  activeTokenCount: metrics.tokensWithOnlyBuys,
  medianActiveHoldHours: metrics.medianCurrentHoldingDurationHours,
  totalValueHeld: null, // TODO
};

const isMeaningfulHolder =
  activeHoldSignal.activeTokenCount >= 3 &&
  activeHoldSignal.medianActiveHoldHours !== null &&
  activeHoldSignal.medianActiveHoldHours >= 24;

if (!meetsMinimumData && !isMeaningfulHolder) {
  metrics.speedCategory = null;
  metrics.flowPattern = 'MIXED';
  metrics.strategyType = 'LOW_ACTIVITY';
  metrics.tradingStyleLabel = 'Low Activity';
  metrics.confidenceScore = 0.3;
  return;
}

metrics.activeHoldSignal = activeHoldSignal;
```

**3C. Derive explicit classification fields** (analyzer.ts:1573)
```typescript
// Use granular 8-category taxonomy for speedCategory
const speedCategory: SpeedCategory | null = metrics.historicalPattern
  ? metrics.historicalPattern.behaviorType // Already SNIPER...HOLDER
  : null;

// Classify flow pattern (rename HOLDER → BUY_ONLY)
let flowPattern: FlowPattern;
if (totalSellCount === 0) {
  flowPattern = 'BUY_ONLY';
} else if (totalBuyCount === 0) {
  flowPattern = 'SELL_ONLY';
} else if (buySellRatio > 2.5 && totalBuyCount > totalSellCount * 2) {
  flowPattern = 'ACCUMULATOR';
} else if (buySellRatio < 0.4 && totalSellCount > totalBuyCount * 2) {
  flowPattern = 'DISTRIBUTOR';
} else if (isBalanced) {
  flowPattern = 'BALANCED';
} else {
  flowPattern = 'MIXED';
}

// Derive strategy type (NEW)
const strategyType = this.deriveStrategyType(
  speedCategory,
  flowPattern,
  activeHoldSignal,
  totalTradeCount,
  tokensWithBothBuyAndSell
);

// Assign to metrics
metrics.speedCategory = speedCategory;
metrics.flowPattern = flowPattern;
metrics.strategyType = strategyType;

// Generate display label
const speedLabel = speedCategory || 'Unknown Speed';
metrics.tradingStyleLabel = `${speedLabel} (${flowPattern})`;
metrics.tradingStyle = metrics.tradingStyleLabel; // Deprecated alias
```

**3D. Add deriveStrategyType method** (NEW)
```typescript
private deriveStrategyType(
  speedCategory: SpeedCategory | null,
  flowPattern: FlowPattern,
  activeHoldSignal: ActiveHoldSignal,
  totalTradeCount: number,
  tokensWithBothBuyAndSell: number
): StrategyType {
  // Implementation from section 4.3
}
```

**3E. Rename flipperScore → velocityScore** (analyzer.ts:1514-1529)
```typescript
// BEFORE
metrics.flipperScore = this.calculateFlipperScore(...);

// AFTER
metrics.velocityScore = this.calculateVelocityScore(...);
metrics.flipperScore = metrics.velocityScore; // Deprecated alias

// Rename constants
// FLIPPER_SCORE → VELOCITY_SCORE
```

**Testing**:
- Unit tests for `deriveStrategyType()`
- Integration test: pure holder should get `PURE_HOLDER` not `LOW_ACTIVITY`
- Integration test: fast accumulator should get `FAST_TRADER`

**Effort**: 1.5-2 days

---

### **PHASE 4: Persistence Layer** (Day 4)

**Files**:
- `src/core/analysis/behavior/behavior-service.ts`
- `src/api/services/database.service.ts`

**Changes**:

**4A. Update persistence to save new fields** (behavior-service.ts)
```typescript
await this.databaseService.upsertWalletBehaviorProfile({
  walletAddress,

  // NEW: Explicit classification
  speedCategory: metrics.speedCategory,
  flowPattern: metrics.flowPattern,
  strategyType: metrics.strategyType,

  // NEW: Active holding metrics
  tokensWithOnlyBuys: metrics.tokensWithOnlyBuys,
  tokensWithOnlySells: metrics.tokensWithOnlySells,
  medianCurrentHoldingDurationHours: metrics.medianCurrentHoldingDurationHours,
  percentOfValueInCurrentHoldings: metrics.percentOfValueInCurrentHoldings,

  // NEW: Velocity score
  velocityScore: metrics.velocityScore,
  flipperScore: metrics.velocityScore, // Deprecated alias

  // DEPRECATED: Keep for backward compat
  tradingStyle: metrics.tradingStyleLabel,

  // ... all other existing fields ...
});
```

**4B. Update database service signature** (database.service.ts)
```typescript
async upsertWalletBehaviorProfile(data: {
  walletAddress: string;
  speedCategory?: string | null;
  flowPattern?: string | null;
  strategyType?: string | null;
  tokensWithOnlyBuys?: number | null;
  tokensWithOnlySells?: number | null;
  medianCurrentHoldingDurationHours?: number | null;
  percentOfValueInCurrentHoldings?: number | null;
  velocityScore?: number | null;
  // ... rest of fields
}) {
  return this.prisma.walletBehaviorProfile.upsert({
    where: { walletAddress: data.walletAddress },
    update: data,
    create: data,
  });
}
```

**Testing**:
- Save a wallet, verify new fields are persisted
- Query DB directly, check values

**Effort**: 0.5 day

---

### **PHASE 5: Fix Cache Reconstruction Bug** (Day 4)

**File**: `src/api/services/behavior.service.ts:86-155`

**Changes**:

**5A. DELETE broken extractBehaviorType method** (lines 143-155)
```typescript
// DELETE THIS ENTIRE METHOD
private extractBehaviorType(tradingStyle: string): any {
  // This never worked - delete it
}
```

**5B. Update convertProfileToMetrics** (line 86)
```typescript
private convertProfileToMetrics(profile: any): BehavioralMetrics {
  // Read explicit fields from DB instead of parsing strings
  const historicalPattern = {
    walletAddress: profile.walletAddress,
    historicalAverageHoldTimeHours: profile.averageFlipDurationHours,
    completedCycleCount: profile.completePairsCount,
    medianCompletedHoldTimeHours: profile.medianHoldTime,
    behaviorType: profile.speedCategory, // NOW CORRECT - read from DB!
    exitPattern: 'GRADUAL' as const,
    dataQuality: profile.confidenceScore,
    observationPeriodDays: this.calculateObservationPeriodDays(profile),
    holdTimeTokenMap: profile.holdTimeTokenMap || undefined,
    enrichedHoldTimeDistribution: profile.enrichedHoldTimeDistribution || undefined,
  };

  return {
    // ... existing fields ...

    // NEW: Explicit classification (read from DB)
    speedCategory: profile.speedCategory || null,
    flowPattern: profile.flowPattern || null,
    strategyType: profile.strategyType || null,

    // NEW: Active holding metrics
    tokensWithOnlyBuys: profile.tokensWithOnlyBuys || null,
    tokensWithOnlySells: profile.tokensWithOnlySells || null,
    medianCurrentHoldingDurationHours: profile.medianCurrentHoldingDurationHours || null,
    percentOfValueInCurrentHoldings: profile.percentOfValueInCurrentHoldings || null,

    // NEW: Velocity score
    velocityScore: profile.velocityScore || profile.flipperScore || null,
    flipperScore: profile.flipperScore || profile.velocityScore || null, // Deprecated

    tradingStyleLabel: profile.tradingStyle,
    tradingStyle: profile.tradingStyle, // Deprecated

    historicalPattern,
  };
}
```

**Testing**:
- Load cached profile, verify `behaviorType` is correct
- Verify `speedCategory` matches `behaviorType`

**Effort**: 0.5 day

---

### **PHASE 6: API Layer Updates** (Day 5)

**Files**:
- `src/api/shared/dto/behavior-analysis-response.dto.ts`
- `src/api/shared/dto/discover-wallet.dto.ts`
- `src/api/services/discover.service.ts`
- `src/api/controllers/wallets.controller.ts`

**Changes**:

**6A. Update Behavior Response DTO**
```typescript
export class BehaviorAnalysisResponseDto {
  @ApiProperty({ example: 2 })
  schemaVersion: number = 2; // v2 = new classification schema

  // v2 fields (NEW)
  speedCategory?: SpeedCategory | null;
  flowPattern?: FlowPattern | null;
  strategyType?: StrategyType | null;
  tradingStyleLabel?: string | null; // Display only
  velocityScore?: number | null;

  // v1 compatibility (DEPRECATED)
  @Deprecated('Use strategyType for filtering')
  tradingStyle?: string | null;

  @Deprecated('Use velocityScore')
  flipperScore?: number | null;

  // ... rest of fields
}
```

**6B. Update Discover Query DTO**
```typescript
export class DiscoverWalletsQueryDto {
  // ... existing fields ...

  // NEW: Explicit filters
  @IsOptional()
  @IsString()
  strategyType?: string;

  @IsOptional()
  @IsString()
  speedCategory?: string;

  @IsOptional()
  @IsString()
  flowPattern?: string;

  // DEPRECATED: Keep for backward compat
  @IsOptional()
  @IsString()
  @Deprecated('Use strategyType instead')
  style?: string;
}
```

**6C. Update Discover Service filtering**
```typescript
// NEW: Exact enum filtering
if (query.strategyType) {
  where.behaviorProfile = {
    is: {
      ...(where.behaviorProfile?.is || {}),
      strategyType: query.strategyType,
    },
  };
}

if (query.speedCategory) {
  where.behaviorProfile = {
    is: {
      ...(where.behaviorProfile?.is || {}),
      speedCategory: query.speedCategory,
    },
  };
}

if (query.flowPattern) {
  where.behaviorProfile = {
    is: {
      ...(where.behaviorProfile?.is || {}),
      flowPattern: query.flowPattern,
    },
  };
}

// DEPRECATED: Keep old style filter (backward compat)
if (query.style && !query.strategyType) {
  where.behaviorProfile = {
    is: {
      ...(where.behaviorProfile?.is || {}),
      tradingStyle: { contains: query.style.toUpperCase(), mode: 'insensitive' },
    },
  };
}
```

**6D. Update Discover response mapping**
```typescript
metrics: {
  // ... existing fields ...

  // NEW: Explicit classification
  speedCategory: behavior?.speedCategory ?? null,
  flowPattern: behavior?.flowPattern ?? null,
  strategyType: behavior?.strategyType ?? null,
  tradingStyleLabel: behavior?.tradingStyle ?? null,
  velocityScore: behavior?.velocityScore ?? null,

  // DEPRECATED
  tradingStyle: behavior?.tradingStyle ?? null,
  flipperScore: behavior?.flipperScore ?? null,
}
```

**6E. Update deriveReason logic** (discover.service.ts:213-336)
```typescript
// BEFORE: Parsing tradingStyle string
if (['FLIPPER', 'SCALPER', 'SNIPER'].includes(normalized) && flipperScore >= 60) {
  return { code: 'FLIPPER', text: `Fast trader · ${flipperScore} flipper score` };
}

// AFTER: Use strategyType
if (strategyType === 'FAST_TRADER' && velocityScore >= 60) {
  return { code: 'FAST_TRADER', text: `Fast trader · velocity ${Math.round(velocityScore)}` };
}
```

**Testing**:
- API response includes new fields
- Filtering works with `strategyType=PURE_HOLDER`
- Old `style` filter still works (backward compat)

**Effort**: 1 day

---

### **PHASE 7: Frontend Updates** (Day 6)

**Files**:
- `dashboard/src/types/api.ts`
- `dashboard/src/types/discover.ts`
- `dashboard/src/app/discover/page.tsx`
- `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx`

**Changes**:

**7A. Update frontend types**
```typescript
// dashboard/src/types/api.ts
export type SpeedCategory =
  | 'SNIPER' | 'SCALPER' | 'MOMENTUM' | 'INTRADAY'
  | 'DAY_TRADER' | 'SWING' | 'POSITION' | 'HOLDER';

export type FlowPattern =
  | 'BUY_ONLY' | 'SELL_ONLY' | 'ACCUMULATOR'
  | 'DISTRIBUTOR' | 'BALANCED' | 'MIXED';

export type StrategyType =
  | 'FAST_TRADER' | 'DAY_TRADER' | 'SWING_TRADER' | 'POSITION_TRADER'
  | 'PURE_HOLDER' | 'ACCUMULATOR' | 'DISTRIBUTOR' | 'BALANCED_TRADER'
  | 'LOW_ACTIVITY';

export interface BehaviorAnalysisResponseDto {
  schemaVersion?: number;
  speedCategory?: SpeedCategory | null;
  flowPattern?: FlowPattern | null;
  strategyType?: StrategyType | null;
  tradingStyleLabel?: string | null;
  velocityScore?: number | null;

  // Deprecated
  tradingStyle?: string | null;
  flipperScore?: number | null;

  // ... rest
}
```

**7B. Update Discover page display** (minimal - just use new field)
```typescript
// BEFORE
<div>{wallet.metrics.tradingStyle || "Unknown"}</div>

// AFTER
<div>{wallet.metrics.tradingStyleLabel || wallet.metrics.strategyType || "Unknown"}</div>
```

**Note**: Discover page is experimental/new - focus on fixing core system first. Filtering UI can be added later.

**7C. Update Baseball Card** (minor change - already has fallback logic!)
```typescript
// BEFORE (line 326)
const behaviorDisplayType = profile.behaviorType ?? (heldTokens > 0 ? 'HOLDER' : null);

// AFTER
const behaviorDisplayType =
  profile.strategyType ??
  profile.speedCategory ??
  profile.behaviorType ??
  (heldTokens > 0 ? 'PURE_HOLDER' : null);
```

**Testing**:
- Discover page displays correct labels
- Baseball card shows correct strategy type
- No TypeScript errors

**Effort**: 0.5-1 day

---

### **PHASE 8: Scripts Migration** (Day 7)

**Files**:
- `src/scripts/validate-behavior-metrics.ts`
- `src/scripts/generate-holder-analysis.ts`
- `src/scripts/validate-holder-risk.ts`
- `src/scripts/test-holder-profiles-cache.ts`

**Changes**: Replace string parsing with enum checks

**Pattern**:
```typescript
// BEFORE
const isFlipper = metrics.tradingStyle.includes('FLIPPER');
const isHolder = metrics.tradingStyle.includes('HOLDER');

// AFTER
const isFastTrader = metrics.strategyType === 'FAST_TRADER';
const isPureHolder = metrics.strategyType === 'PURE_HOLDER';
// or
const isFast = ['SNIPER', 'SCALPER', 'MOMENTUM'].includes(metrics.speedCategory);
```

**Testing**: Run scripts on sample data, verify output

**Effort**: 0.5 day

---

### **PHASE 9: Data Backfill** (Day 7 - runtime, Day 8 - setup)

**Create**: `src/scripts/backfill-classification.ts`

```typescript
/**
 * Backfill classification fields for existing wallets
 * Queues wallets for re-analysis via BullMQ (non-blocking)
 */
async function backfillClassification() {
  const wallets = await prisma.walletBehaviorProfile.findMany({
    where: { strategyType: null },
    select: { walletAddress: true },
  });

  console.log(`Queuing ${wallets.length} wallets for classification backfill`);

  for (const wallet of wallets) {
    await analysisQueue.add('backfill-classification', {
      walletAddress: wallet.walletAddress,
      priority: 'low',
    });
  }

  console.log('Backfill queued. Monitor via admin dashboard.');
}
```

**Estimated runtime**:
- 10,000 wallets × 2 sec/wallet = ~5.5 hours
- Run as background job with low priority

**Testing**: Backfill 10 wallets, verify new fields are populated

**Effort**: 0.5 day setup, 5-6 hours runtime (background)

---

### **PHASE 10: Integration Testing** (Days 8-9)

**Test cases**:

1. **Pure Holder (No Exits)**
   - Input: 50 buys, 0 sells, median hold 72h
   - Expected: `strategyType=PURE_HOLDER`, `flowPattern=BUY_ONLY`, `speedCategory=null`

2. **Fast Accumulator**
   - Input: 100 buys, 20 sells, median hold 45min
   - Expected: `strategyType=FAST_TRADER`, `speedCategory=MOMENTUM`, `flowPattern=ACCUMULATOR`

3. **Low Activity (True)**
   - Input: 3 trades, 1 token, no holdings
   - Expected: `strategyType=LOW_ACTIVITY`

4. **Low Activity with Holder Bypass**
   - Input: 3 buys, 0 sells, 5 active tokens, median hold 48h
   - Expected: `strategyType=PURE_HOLDER` (bypassed gate)

5. **Cache Reconstruction**
   - Load cached profile, verify `behaviorType` matches `speedCategory`

6. **Discover Filtering**
   - Filter by `strategyType=FAST_TRADER`, verify results
   - Filter by `speedCategory=SNIPER`, verify results
   - Old `style` filter still works

7. **API Versioning**
   - Response includes `schemaVersion=2`
   - Deprecated fields still present (v1 compat)

8. **Velocity Score**
   - Verify `velocityScore` = `flipperScore` (alias)
   - Verify score is 0-100

**Effort**: 1.5-2 days

---

### **PHASE 11: Documentation & Cleanup** (Day 10)

**Tasks**:
1. Update API documentation (mark deprecated fields)
2. Add migration guide for external consumers
3. Update internal wiki/docs
4. Clean up old code comments referencing "flipper"
5. Add JSDoc to new types

**Effort**: 0.5 day

---

## 6) Timeline Summary

| Phase | Description | Duration | Dependencies |
|-------|-------------|----------|--------------|
| 1 | DB Schema + Indexes | 0.25 day | None |
| 2 | Type Definitions | 0.25 day | Phase 1 |
| 3 | Analyzer Updates | 2 days | Phase 2 |
| 4 | Persistence Layer | 0.5 day | Phase 3 |
| 5 | Fix Cache Bug | 0.5 day | Phase 4 |
| 6 | API Layer | 1 day | Phase 5 |
| 7 | Frontend | 1 day | Phase 6 |
| 8 | Scripts Migration | 0.5 day | Phase 6 |
| 9 | Data Backfill Setup | 0.5 day | Phase 6 (runtime: 5-6h background) |
| 10 | Integration Testing | 2 days | Phases 1-9 |
| 11 | Documentation | 0.5 day | Phase 10 |

**Total**: **8.5-9 days** (one engineer, sequential execution)

**With parallelization** (frontend + scripts during testing):
- **7-8 days** (more realistic)

---

## 7) Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cache bug corrupted existing data | High | Backfill will recompute correct values |
| Breaking API changes | Medium | v1/v2 dual support, deprecated fields kept |
| DB migration fails | High | Test on dev first, nullable columns (additive) |
| Performance degradation | Low | Indexes on filter columns |
| Users depend on "flipper" terminology | Low | Keep as deprecated alias for 6+ months |

---

## 8) Success Criteria

✅ **Functional**:
- Pure holders classified as `PURE_HOLDER` (not `LOW_ACTIVITY`)
- Cache reconstruction works (no string parsing)
- Discover filtering precise (enum-based)
- Baseball card displays correct strategy

✅ **Technical**:
- All tests pass
- No TypeScript errors
- API response includes `schemaVersion=2`
- DB migration successful

✅ **Performance**:
- Discover queries < 500ms (with indexes)
- Backfill completes in < 8 hours

✅ **Quality**:
- No regression in existing features
- Deprecated fields still work (v1 compat)
- Code follows existing patterns

---

## 9) Post-Launch (6+ Months Later)

**Deprecation phase** (optional):
1. Remove `flipperScore` alias (keep only `velocityScore`)
2. Remove `tradingStyle` from schema (keep only `tradingStyleLabel`)
3. Bump API to v3
4. Update migration guide

**Estimated effort**: 1 day

---

## 10) Related Documents

- **Classification Taxonomy Map**: `.ai/context/classification_taxonomy_map.md`
- **Component Impact Map**: `.ai/context/component_impact_map.md`
- **Usage Analysis Script**: `src/scripts/analyze-classification-usage.ts`
- **Original Plan (Draft)**: `.ai/context/discover_classification_refactor_plan.md` (this file, now updated)

---

**Status**: READY FOR IMPLEMENTATION
**Reviewed**: 2025-12-25
**Approved by**: [TBD]
**Start date**: [TBD]
