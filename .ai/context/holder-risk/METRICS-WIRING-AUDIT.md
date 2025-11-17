# Holder Metrics Wiring Audit (2025-11-17)

## Executive Summary

**CRITICAL FINDING**: The new `historicalPattern` calculation is defined but **NEVER CALLED**. All new metrics are computed using fallbacks to old deprecated metrics, creating a **false appearance of functionality**.

**Status**: 🔴 **BROKEN - None of the new holder metrics are actually working**

---

## Holding Time Metrics - Complete Audit

### OLD METRICS (Deprecated - Still Calculated ⚠️)

#### 1. `averageFlipDurationHours`
- **Purpose**: Unweighted average of completed trades
- **Issues**: Includes active positions, no outlier protection
- **Status in Backend**: ✅ **STILL CALCULATED** (analyzer.ts:1173)
- **Calculation**: `calculateTimeDistributions()` → `avgDuration`
- **Used By**: Frontend fallback only
- **Should Be**: DEPRECATED (use `historicalPattern.historicalAverageHoldTimeHours`)

#### 2. `medianHoldTime`
- **Purpose**: Median of completed trades
- **Issues**: Includes active positions
- **Status in Backend**: ✅ **STILL CALCULATED** (analyzer.ts:1174)
- **Calculation**: `calculateTimeDistributions()` → `medianDuration`
- **Used By**:
  - Classification fallback (analyzer.ts:1346)
  - Frontend fallback (BehavioralPatternsTab.tsx:416)
  - Bot detector fallback (bot-detector.ts:105)
- **Should Be**: DEPRECATED (use `historicalPattern.medianCompletedHoldTimeHours`)

#### 3. `weightedAverageHoldingDurationHours`
- **Purpose**: Weighted average mixing flips + current holdings
- **Issues**: Mixes completed + active (fundamentally flawed)
- **Status in Backend**: ✅ **STILL CALCULATED** (analyzer.ts:1200-1202)
- **Calculation**:
  ```typescript
  (averageFlipDurationHours * flipValueWeight) +
  (averageCurrentHoldingDurationHours * currentValueWeight)
  ```
- **Used By**: Frontend fallback only
- **Should Be**: DEPRECATED (use `historicalPattern.historicalAverageHoldTimeHours`)

---

### NEW METRICS (Intended to Replace Old - NOT CALCULATED ❌)

#### 4. `historicalPattern` (Object)
- **Purpose**: Clean analysis of completed positions ONLY
- **Fields**:
  - `walletAddress: string`
  - `historicalAverageHoldTimeHours: number` (weighted, completed only)
  - `completedCycleCount: number` (sample size)
  - `medianCompletedHoldTimeHours: number` (outlier-robust)
  - `behaviorType: 'ULTRA_FLIPPER' | 'FLIPPER' | 'SWING' | 'HOLDER'`
  - `exitPattern: 'GRADUAL' | 'ALL_AT_ONCE'`
  - `dataQuality: number` (0-1 confidence)
  - `observationPeriodDays: number`

- **Status**: ❌ **NOT CALCULATED AT ALL**
- **Method Exists**: ✅ `calculateHistoricalPattern()` (analyzer.ts:150-298)
- **Called From**: ❌ **NEVER** (not in `analyze()` method)
- **Result**: Always `undefined` in API responses

**Why This Is Critical**: This is the ENTIRE REASON for the refactor - to separate completed positions from active holdings. Without this, we have no improvement over the old system.

#### 5. `tradingInterpretation` (Object)
- **Purpose**: Rich dual-analysis (speed vs economic risk)
- **Fields**:
  - `speedCategory: string` (classification)
  - `typicalHoldTimeHours: number` (median-based)
  - `economicHoldTimeHours: number` (weighted-based)
  - `economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'`
  - `behavioralPattern: string` (buy/sell pattern)
  - `interpretation: string` (human-readable)

- **Status**: ⚠️ **CALCULATED BUT USES FALLBACK DATA**
- **Method Exists**: ✅ `generateTradingInterpretation()` (analyzer.ts:1426-1476)
- **Called From**: ✅ analyzer.ts:1409
- **Problem**: Line 1413 uses fallback:
  ```typescript
  metrics.historicalPattern?.historicalAverageHoldTimeHours || medianHoldHours
  ```
  Since `historicalPattern` is always `undefined`, this ALWAYS uses `medianHoldHours` (the old deprecated metric)

**Result**: `tradingInterpretation.economicHoldTimeHours` === `tradingInterpretation.typicalHoldTimeHours` (they're both the same old `medianHoldTime` value!)

---

## Current Holdings Metrics (Still Valid ✅)

These metrics are for **active positions** (not completed) and are still correctly calculated:

#### 6. `averageCurrentHoldingDurationHours`
- **Status**: ✅ CALCULATED (analyzer.ts:1191)
- **Purpose**: How long current holdings have been held
- **Valid**: Yes, this is for active positions

#### 7. `medianCurrentHoldingDurationHours`
- **Status**: ✅ CALCULATED (analyzer.ts:1192)
- **Purpose**: Median of current holding durations
- **Valid**: Yes, this is for active positions

#### 8. `percentOfValueInCurrentHoldings`
- **Status**: ✅ CALCULATED (analyzer.ts:1193)
- **Purpose**: % of value still in active positions
- **Valid**: Yes, useful metric

---

## The Core Problem - Call Chain Analysis

### Expected Flow (INTENDED):
```
1. API request → WalletsController.getBehaviorAnalysis()
2. → BehaviorService.analyzeWalletBehavior()
3. → BehaviorAnalyzer.analyze(swapRecords)
4.   → calculateBehavioralMetrics()
5.   → calculateHistoricalPattern() ← ❌ NEVER CALLED
6.   → classifyTradingStyle() (uses historicalPattern)
7.   → generateTradingInterpretation() (uses historicalPattern)
8. ← Return metrics with historicalPattern + tradingInterpretation
```

### Actual Flow (BROKEN):
```
1. API request → WalletsController.getBehaviorAnalysis()
2. → BehaviorService.analyzeWalletBehavior()
3. → BehaviorAnalyzer.analyze(swapRecords)
4.   → calculateBehavioralMetrics()
5.   → (historicalPattern NEVER CALCULATED) ← ❌ MISSING STEP
6.   → classifyTradingStyle() (uses fallback: medianHoldTime)
7.   → generateTradingInterpretation() (uses fallback: medianHoldHours)
8. ← Return metrics WITHOUT historicalPattern, tradingInterpretation uses wrong data
```

---

## Fallback Analysis (Frontend)

### File: `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`

#### Line 416: Typical Hold Time
```typescript
value={formatNumber(behaviorData.historicalPattern?.medianCompletedHoldTimeHours ?? behaviorData.medianHoldTime)}
```
- **Fallback**: `behaviorData.medianHoldTime` (old metric)
- **Result**: Always shows old metric (historicalPattern is undefined)
- **User Impact**: NO ERROR VISIBLE - silently wrong data ⚠️

#### Line 422: Economic Hold Time
```typescript
value={formatNumber(behaviorData.historicalPattern?.historicalAverageHoldTimeHours ?? behaviorData.averageFlipDurationHours)}
```
- **Fallback**: `behaviorData.averageFlipDurationHours` (old metric)
- **Result**: Always shows old metric (historicalPattern is undefined)
- **User Impact**: NO ERROR VISIBLE - silently wrong data ⚠️

### Why Fallbacks Are Dangerous Here

**The Problem**: These fallbacks make it APPEAR like everything is working when it's completely broken.

**User sees**:
- ✅ "Typical Hold Time: 0.37 hours"
- ✅ "Economic Hold Time: 1.01 hours"
- ✅ No errors, no warnings

**Reality**:
- ❌ Using OLD deprecated metrics (includes active positions)
- ❌ NOT using new calculation (completed only)
- ❌ No separation of typical vs economic
- ❌ No data quality scoring
- ❌ No behavior type classification

---

## What Needs to Be Fixed

### 1. Wire Up historicalPattern Calculation ❌ CRITICAL

**File**: `src/core/analysis/behavior/analyzer.ts`
**Method**: `analyze()` (lines 53-140)
**Fix**: Add these lines before `classifyTradingStyle()` (after line 129):

```typescript
// Calculate historical pattern from completed positions only
// This must happen BEFORE classifyTradingStyle() which depends on it
if (swapRecords.length > 0 && firstTransactionTimestamp) {
  // Need wallet address - must be passed to analyze() method
  metrics.historicalPattern = this.calculateHistoricalPattern(
    swapRecords,
    walletAddress  // ← PROBLEM: Not available in current signature!
  );
}
```

**BLOCKER**: The `analyze()` method doesn't receive `walletAddress`!
- Current signature: `analyze(rawSwapRecords: SwapAnalysisInput[])`
- Needed signature: `analyze(rawSwapRecords: SwapAnalysisInput[], walletAddress: string)`

### 2. Update analyze() Method Signature ❌ CRITICAL

**Files to Update**:
- `src/core/analysis/behavior/analyzer.ts:53` - Method definition
- `src/core/analysis/behavior/behavior-service.ts:48` - Method call
- Any tests that call `analyze()`

**Change**:
```typescript
// Before
public analyze(rawSwapRecords: SwapAnalysisInput[]): BehavioralMetrics

// After
public analyze(rawSwapRecords: SwapAnalysisInput[], walletAddress: string): BehavioralMetrics
```

### 3. Remove Frontend Fallbacks ❌ CRITICAL

**File**: `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`

**Line 416** - Remove fallback:
```typescript
// Before
value={formatNumber(behaviorData.historicalPattern?.medianCompletedHoldTimeHours ?? behaviorData.medianHoldTime)}

// After (will show "N/A" if not present - GOOD!)
value={formatNumber(behaviorData.historicalPattern?.medianCompletedHoldTimeHours)}
```

**Line 422** - Remove fallback:
```typescript
// Before
value={formatNumber(behaviorData.historicalPattern?.historicalAverageHoldTimeHours ?? behaviorData.averageFlipDurationHours)}

// After
value={formatNumber(behaviorData.historicalPattern?.historicalAverageHoldTimeHours)}
```

**Why**: If the field is missing, we WANT to see "N/A" or an error - this tells us the calculation isn't working!

### 4. Update Bot Detector (Conditional) ⚠️

**File**: `src/core/analysis/behavior/bot-detector.ts:105-116`

The bot detector currently has a fallback:
```typescript
const medianHoldTime = behavioralMetrics?.historicalPattern?.medianCompletedHoldTimeHours
                    || behavioralMetrics?.medianHoldTime;
```

**Options**:
1. **Keep fallback**: Bot detection still works with old metric if new one fails
2. **Remove fallback**: Bot detection fails if historicalPattern missing (more correct)

**Recommendation**: Remove fallback AFTER fixing analyzer, or add explicit error handling:
```typescript
const medianHoldTime = behavioralMetrics?.historicalPattern?.medianCompletedHoldTimeHours;
if (!medianHoldTime) {
  this.logger.warn('Missing historicalPattern for bot detection, skipping hold time check');
  // Skip this bot check, rely on other signals
}
```

---

## Impact Assessment

### Current State (With Fallbacks)
- ✅ Frontend appears to work
- ✅ No errors thrown
- ❌ Showing OLD metrics (deprecated, includes active positions)
- ❌ No improvement over pre-refactor state
- ❌ Users trust data that's fundamentally flawed
- ❌ "Data quality" section never appears (always undefined)

### After Removing Fallbacks (Before Fix)
- ❌ Frontend shows "N/A" for hold times
- ✅ Immediately obvious something is broken
- ✅ Forces us to fix the root cause
- ✅ No false sense of working system

### After Full Fix (Wire + No Fallbacks)
- ✅ Frontend shows NEW metrics (completed only)
- ✅ Separation of typical vs economic hold time
- ✅ Data quality section appears
- ✅ Behavior type classification visible
- ✅ Users get accurate risk assessment

---

## Testing Checklist

After fixes are applied:

### Backend Tests
- [ ] Call `analyze()` with wallet address parameter
- [ ] Verify `historicalPattern` is NOT undefined
- [ ] Verify `historicalPattern.medianCompletedHoldTimeHours` > 0
- [ ] Verify `historicalPattern.completedCycleCount` ≥ 3 (or is null for insufficient data)
- [ ] Verify `tradingInterpretation.typicalHoldTimeHours` !== `tradingInterpretation.economicHoldTimeHours` (for wallets with varied position sizes)

### API Tests
- [ ] Hit `/api/v1/wallets/{address}/behavior-analysis`
- [ ] Response includes `historicalPattern` field
- [ ] Response includes `tradingInterpretation` field
- [ ] `tradingInterpretation.economicHoldTimeHours` matches `historicalPattern.historicalAverageHoldTimeHours`
- [ ] `tradingInterpretation.typicalHoldTimeHours` matches `historicalPattern.medianCompletedHoldTimeHours`

### Frontend Tests
- [ ] Load wallet profile → Behavioral Patterns tab
- [ ] "Typical Hold Time" shows value (not N/A)
- [ ] "Economic Hold Time" shows value (not N/A)
- [ ] "Historical Pattern" section appears below holding durations
- [ ] Section shows: Completed Cycles, Behavior Type, Exit Pattern, Data Quality
- [ ] For wallets with <3 completed cycles, gracefully shows "Insufficient data"

---

## Deprecated Metrics - Migration Plan

Once historicalPattern is working:

### Phase 1: Mark as Deprecated (✅ DONE)
- DTO has `@ApiProperty({ description: '⚠️ DEPRECATED: ...' })`
- Frontend has comments marking old fields

### Phase 2: Remove from DTO (FUTURE)
- Remove `averageFlipDurationHours`
- Remove `medianHoldTime`
- Remove `weightedAverageHoldingDurationHours`
- **Timing**: After confirming historicalPattern works in production

### Phase 3: Remove Calculation (FUTURE)
- Remove from `calculateBehavioralMetrics()`
- Remove from `getEmptyMetrics()`
- **Timing**: After Phase 2 deployed and stable

---

## Conclusion

**We built a comprehensive new system but forgot to plug it in.**

The code quality is excellent - the `calculateHistoricalPattern()` method is well-designed with proper filtering, data quality checks, and edge case handling. But it's completely disconnected from the analysis flow.

**Action Required**:
1. Fix method signature to pass wallet address
2. Wire up historicalPattern calculation
3. Remove frontend fallbacks to expose real state
4. Test thoroughly
5. Deploy and invalidate cache
