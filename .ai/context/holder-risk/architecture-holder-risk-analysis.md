# Architecture: Holder Risk Analysis & Predictive Holding Time

**Status**: Active Development
**Priority**: High
**Owner**: Core Analytics Team
**Last Updated**: 2025-11-03

---

## Goal

Build a predictive holder risk analysis system that enables traders to evaluate token holder behavior and estimate "dump risk" before buying. The system should answer: **"If I buy this token now, when will the major holders likely exit?"**

### User Scenario

1. Trader finds $MEMECOIN they want to buy
2. Opens token analysis dashboard
3. Views top 10-50 holders and their historical patterns
4. Sees aggregated risk: "27% of supply exits in <48h, 18% in 3-7d, 55% in 7+ days"
5. Makes informed decision based on holder stability

---

## Current State

### What We Have

✅ **FIFO-based holding time calculation** (`src/core/analysis/behavior/analyzer.ts:301-348`)
- `calculateFlipDurations()`: Matches buys to sells using FIFO queue
- `calculateCurrentHoldingsMetrics()`: Tracks positions still held
- Dust filtering via configurable thresholds

✅ **Behavioral metrics** (`src/core/analysis/behavior/analyzer.ts:539-719`)
- `averageFlipDurationHours`: Mean of completed buy→sell cycles
- `medianHoldTime`: Median flip duration
- `weightedAverageHoldingDurationHours`: Blends flips + current holdings
- `percentOfValueInCurrentHoldings`: Portfolio composition

✅ **Top holders data** (implied from usage context)
- Ability to analyze multiple wallets
- Token-specific position tracking

### What's Missing

❌ **Historical-only pattern calculation**
- Current metrics include active positions, which skews predictions
- No separation between "what they've done" vs "what they're doing now"

❌ **Predictive time-to-exit estimation**
- No forward-looking "when will they dump" metric
- No risk level classification

❌ **Per-token position analysis**
- No tracking of "peak position" per token
- No exit detection (when position dropped below threshold)
- No behavior type classification (FULL_HOLDER vs PROFIT_TAKER)

❌ **Aggregated holder risk metrics**
- No API to analyze top N holders of a token
- No supply-weighted risk calculation
- No token-level "lifespan" estimate

---

## Solution Architecture

### Two-Layer Approach

**Layer 1: Historical Pattern Calculation (Weighted Average)**
- Calculate holding time ONLY from completed positions
- Exclude current holdings to enable clean prediction
- Use FIFO-based weighted average: `Σ(amount_i × duration_i) / total_amount`

**Layer 2: Predictive Risk Model**
- Compare historical average to current position age
- Calculate `estimatedTimeUntilExit = max(0, historicalAvg - currentAge)`
- Assign risk levels: CRITICAL | HIGH | MEDIUM | LOW

### Key Innovation

**Separation of concerns:**
```
Historical Pattern (past completed tokens)
  ↓
Predict future based on past
  ↓
Compare to current position (THIS token)
  ↓
Estimate time remaining
```

This enables statements like:
> "This holder typically exits after 5 days. They're on day 3 of their current position. **Estimated exit: ~2 days**"

---

## Metric Deprecation Strategy

### Metrics to Replace (Obsolete)

| Metric | Status | Reason | Replacement |
|--------|--------|--------|-------------|
| `weightedAverageHoldingDurationHours` | ❌ REMOVE | Mixes completed + active positions (conceptually flawed) | `historicalPattern.averageCompletedHoldTimeHours` |
| `averageFlipDurationHours` | ❌ REPLACE | Unweighted average (less accurate) | `historicalPattern.averageCompletedHoldTimeHours` (weighted) |

### Metrics to Keep (Different Purpose)

| Metric | Status | Reason |
|--------|--------|--------|
| `averageCurrentHoldingDurationHours` | ✅ KEEP | Current state metric (not predictive) |
| `medianCurrentHoldingDurationHours` | ✅ KEEP | Current state metric |
| `medianHoldTime` | ⚠️ MAYBE | Consider deprecating in favor of `historicalPattern.medianCompletedHoldTimeHours` |

### Migration Plan

**Phase 1**: Add `historicalPattern` field (optional, additive)
**Phase 2**: Update dashboard to use new metrics
**Phase 3**: Mark old metrics as `@deprecated` in types
**Phase 4**: Remove deprecated metrics in breaking change release

---

## Data Model Extensions

### New Types

```typescript
// Per-token position lifecycle
interface TokenPositionLifecycle {
  mint: string;
  entryTimestamp: number;           // First buy
  exitTimestamp: number | null;     // When crossed exit threshold (or null if active)
  peakPosition: number;             // Max tokens ever held
  currentPosition: number;          // Current balance (via FIFO)
  percentOfPeakRemaining: number;   // current / peak

  positionStatus: 'ACTIVE' | 'EXITED' | 'DUST';
  behaviorType: 'FULL_HOLDER' | 'PROFIT_TAKER' | 'MOSTLY_EXITED' | null;

  // Weighted average for THIS token only
  weightedHoldingTimeHours: number; // For completed: actual, for active: partial

  // Trade metadata
  totalBought: number;
  totalSold: number;
  buyCount: number;
  sellCount: number;
}

// Wallet's historical pattern (aggregated across completed tokens)
interface WalletHistoricalPattern {
  walletAddress: string;

  // Aggregate metrics from COMPLETED positions only
  historicalAverageHoldTimeHours: number;  // Weighted avg across completed tokens
  completedCycleCount: number;             // Number of fully exited tokens
  medianCompletedHoldTimeHours: number;    // Median of completed cycles

  // Behavioral classification
  behaviorType: 'ULTRA_FLIPPER' | 'FLIPPER' | 'SWING' | 'HOLDER';
  exitPattern: 'GRADUAL' | 'ALL_AT_ONCE';  // Based on sell distribution

  // Confidence metrics
  dataQuality: number;                     // 0-1, based on sample size
  observationPeriodDays: number;           // Time span of historical data
}

// Current position analysis for a specific token
interface WalletTokenRiskAnalysis {
  walletAddress: string;
  tokenMint: string;

  // Historical pattern (from OTHER tokens)
  historicalPattern: WalletHistoricalPattern;

  // Current position (for THIS token)
  currentPositionAge: number;              // Hours since first buy
  percentAlreadySold: number;              // % of peak sold
  positionStatus: 'ACTIVE' | 'EXITED' | 'DUST';
  behaviorType: 'FULL_HOLDER' | 'PROFIT_TAKER' | 'MOSTLY_EXITED' | null;

  // Predictive metrics
  estimatedHoursUntilExit: number;         // max(0, historical - current)
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number;                 // Based on data quality + pattern match

  // Context
  supplyPercentage?: number;               // % of token supply held (if known)
  lastTradeTimestamp: number;              // Most recent activity
}

// Aggregated token holder risk
interface TokenHolderRiskAggregate {
  tokenMint: string;
  analyzedAt: number;

  // Holder breakdown
  totalHoldersAnalyzed: number;
  topHoldersAnalyzed: number;              // e.g., top 50

  // Supply-weighted risk distribution
  supplyByRiskLevel: {
    critical: number;   // % of supply at CRITICAL risk
    high: number;       // % of supply at HIGH risk
    medium: number;     // % of supply at MEDIUM risk
    low: number;        // % of supply at LOW risk
    unknown: number;    // % where we couldn't analyze
  };

  // Aggregate predictions
  averageEstimatedExitHours: number;       // Supply-weighted average
  medianEstimatedExitHours: number;        // Supply-weighted median

  // Risk summary
  overallRiskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  riskScore: number;                       // 0-100 composite score

  // Individual holder details
  holders: WalletTokenRiskAnalysis[];
}
```

### Configuration Extensions

```typescript
interface BehaviorAnalysisConfig {
  // ... existing fields ...

  holdingThresholds?: {
    exitThreshold: number;                 // Default: 0.20 (20% of peak)
    dustThreshold: number;                 // Default: 0.05 (5% of peak)
    minimumSolValue: number;               // Default: 0.001 SOL
    minimumHoldingTimeSeconds: number;     // Default: 60 (1 minute)
  };

  riskThresholds?: {
    criticalHours: number;                 // Default: 24 (<1 day)
    highHours: number;                     // Default: 48 (<2 days)
    mediumHours: number;                   // Default: 120 (<5 days)
    // 5+ days = LOW
  };

  historicalPatternConfig?: {
    minimumCompletedCycles: number;        // Default: 3 (need 3 completed tokens minimum)
    maximumDataAgeDays: number;            // Default: 90 (only use last 90 days)
  };
}
```

---

## Implementation Plan

### Phase 1: Extend BehaviorAnalyzer (Core Calculation Logic)

**Location**: `src/core/analysis/behavior/analyzer.ts`

**New Methods:**

```typescript
class BehaviorAnalyzer {
  // ... existing methods ...

  /**
   * Calculate peak position for a token across all trades
   */
  private calculatePeakPosition(trades: TokenTrade[]): number;

  /**
   * Calculate current position using FIFO (already exists, may need extraction)
   */
  private calculateCurrentPosition(trades: TokenTrade[]): number;

  /**
   * Determine if/when a position was exited based on threshold
   */
  private detectPositionExit(
    trades: TokenTrade[],
    peakPosition: number
  ): { exited: boolean; exitTimestamp: number | null; };

  /**
   * Calculate weighted holding time for a SINGLE token
   * Returns different values for completed vs active positions
   */
  private calculateTokenWeightedHoldTime(
    trades: TokenTrade[],
    isCompleted: boolean,
    currentTimestamp?: number
  ): number;

  /**
   * NEW: Calculate historical pattern from completed tokens only
   */
  public calculateHistoricalPattern(
    swapRecords: SwapAnalysisInput[]
  ): WalletHistoricalPattern;

  /**
   * NEW: Analyze wallet's position in a specific token
   */
  public analyzeTokenPosition(
    walletAddress: string,
    tokenMint: string,
    swapRecords: SwapAnalysisInput[],
    historicalPattern: WalletHistoricalPattern
  ): WalletTokenRiskAnalysis;

  /**
   * NEW: Build full position lifecycle for each token
   */
  private buildTokenLifecycles(
    sequences: TokenTradeSequence[],
    currentTimestamp: number
  ): TokenPositionLifecycle[];
}
```

**Modified Methods:**

```typescript
// Update to separate completed vs active positions
private calculateTimeDistributions(
  sequences: TokenTradeSequence[],
  onlyCompleted: boolean = false  // NEW parameter
): { /* ... */ };

// Update to track position lifecycle
private buildTokenSequences(
  swapRecords: SwapAnalysisInput[]
): TokenTradeSequence[];  // Already exists, may need lifecycle tracking
```

### Phase 2: Create HolderRiskService

**New File**: `src/api/services/holder-risk.service.ts`

**Purpose**: Orchestrate holder risk analysis across multiple wallets for a token

```typescript
@Injectable()
export class HolderRiskService {
  constructor(
    private behaviorAnalyzer: BehaviorAnalyzer,
    private databaseService: DatabaseService,
    private dexScreenerService: DexScreenerService,
  ) {}

  /**
   * Analyze top holders of a token and calculate aggregate risk
   */
  async analyzeTokenHolderRisk(
    tokenMint: string,
    topN: number = 50
  ): Promise<TokenHolderRiskAggregate>;

  /**
   * Get holder wallets for a token (via DexScreener or on-chain)
   */
  private async getTopHolders(
    tokenMint: string,
    limit: number
  ): Promise<Array<{ address: string; percentage: number }>>;

  /**
   * Analyze a single holder's risk for this token
   */
  private async analyzeHolderRisk(
    walletAddress: string,
    tokenMint: string
  ): Promise<WalletTokenRiskAnalysis>;

  /**
   * Calculate supply-weighted risk distribution
   */
  private calculateSupplyWeightedRisk(
    holders: WalletTokenRiskAnalysis[]
  ): TokenHolderRiskAggregate['supplyByRiskLevel'];
}
```

### Phase 3: API Endpoint

**New Controller**: `src/api/controllers/token-holder-risk.controller.ts`

```typescript
@Controller('api/v1/tokens')
export class TokenHolderRiskController {

  /**
   * GET /api/v1/tokens/:mint/holder-risk
   *
   * Analyze holder risk for a token
   */
  @Get(':mint/holder-risk')
  async getTokenHolderRisk(
    @Param('mint') tokenMint: string,
    @Query('topN') topN: number = 50,
  ): Promise<TokenHolderRiskAggregate>;

  /**
   * GET /api/v1/tokens/:mint/holders/:wallet/risk
   *
   * Analyze specific holder's risk for this token
   */
  @Get(':mint/holders/:wallet/risk')
  async getHolderRisk(
    @Param('mint') tokenMint: string,
    @Param('wallet') walletAddress: string,
  ): Promise<WalletTokenRiskAnalysis>;
}
```

### Phase 4: Dashboard Integration

**Location**: `dashboard/src/components/token/`

**New Components:**

1. `TokenHolderRiskCard.tsx` - Main card showing aggregate risk
2. `HolderRiskTable.tsx` - Table of top holders with risk indicators
3. `HolderRiskChart.tsx` - Visualization of supply distribution by risk
4. `RiskBadge.tsx` - Reusable risk level indicator

**Integration Point:**

Existing top holders display should be enhanced with risk indicators:

```tsx
// Before:
<HolderRow wallet="..." percentage={15} />

// After:
<HolderRow
  wallet="..."
  percentage={15}
  riskLevel="HIGH"
  estimatedExitHours={48}
  historicalAvgHours={120}
  currentPositionAge={72}
/>
```

---

## Implementation Steps

### Step 1: Core Calculation (BehaviorAnalyzer)

**Priority**: CRITICAL
**Files**: `src/core/analysis/behavior/analyzer.ts`

1. [ ] Add `calculatePeakPosition()` method
2. [ ] Add `detectPositionExit()` method
3. [ ] Add `buildTokenLifecycles()` method
4. [ ] Add `calculateHistoricalPattern()` method (completed tokens only)
5. [ ] Add `analyzeTokenPosition()` method (current position + prediction)
6. [ ] Update config types with new thresholds
7. [ ] Write unit tests (use existing `test-fifo-holding-time.ts` as template)

**Success Criteria:**
- Can calculate historical average from completed positions
- Can classify position status (ACTIVE/EXITED/DUST)
- Can predict time-to-exit
- Tests pass with various trading patterns

### Step 2: Service Layer (HolderRiskService)

**Priority**: HIGH
**Files**: `src/api/services/holder-risk.service.ts`

1. [ ] Create `HolderRiskService` class
2. [ ] Implement `getTopHolders()` (integrate with DexScreener or RPC)
3. [ ] Implement `analyzeHolderRisk()` (orchestrate BehaviorAnalyzer)
4. [ ] Implement `analyzeTokenHolderRisk()` (aggregate multiple holders)
5. [ ] Implement `calculateSupplyWeightedRisk()`
6. [ ] Add caching layer (Redis) for expensive calculations
7. [ ] Write integration tests

**Success Criteria:**
- Can fetch top holders for a token
- Can analyze each holder's risk
- Can aggregate to token-level risk
- Response time <5s for top 50 holders

### Step 3: API Endpoints

**Priority**: HIGH
**Files**: `src/api/controllers/token-holder-risk.controller.ts`, DTOs

1. [ ] Create controller and DTOs
2. [ ] Implement `/api/v1/tokens/:mint/holder-risk` endpoint
3. [ ] Implement `/api/v1/tokens/:mint/holders/:wallet/risk` endpoint
4. [ ] Add rate limiting
5. [ ] Add API documentation (Swagger)
6. [ ] Test with real tokens

**Success Criteria:**
- Endpoints return correct data
- Proper error handling
- API docs generated
- Rate limiting works

### Step 4: Dashboard Integration

**Priority**: MEDIUM
**Files**: `dashboard/src/components/token/*`, `dashboard/src/types/api.ts`

1. [ ] Create TypeScript types matching backend DTOs
2. [ ] Create `TokenHolderRiskCard` component
3. [ ] Create `HolderRiskTable` component
4. [ ] Create `RiskBadge` component
5. [ ] Integrate into existing token view
6. [ ] Add loading states and error handling
7. [ ] Add tooltips and explanations

**Success Criteria:**
- Users can view holder risk at a glance
- Clear risk indicators (colors, badges)
- Detailed breakdown available on click
- Mobile responsive

### Step 5: Polish & Documentation

**Priority**: LOW
**Files**: Documentation, examples

1. [ ] Write user-facing documentation
2. [ ] Create example queries
3. [ ] Add "How it works" explainer
4. [ ] Create demo video/screenshots
5. [ ] Update API docs with use cases
6. [ ] Performance optimization if needed

---

## Technical Considerations

### Performance

**Challenge**: Analyzing 50 wallets × potentially thousands of trades each

**Solutions**:
- Cache historical patterns (they don't change for past data)
- Parallel processing for independent wallet analyses
- Pagination for large holder lists
- Pre-compute for popular tokens

### Data Quality

**Challenge**: Not all wallets have sufficient history

**Solutions**:
- Minimum completed cycles threshold (default: 3)
- Confidence scoring based on data quality
- Clear indicators when data is insufficient
- Graceful degradation (show what we can)

### Edge Cases

**Scenarios to handle:**
1. Wallet with only current position (no history) → Show "Insufficient data"
2. Wallet that never fully exits positions → Use percentiles instead of averages
3. Token with very few holders → Adjust topN dynamically
4. Stale holder data → Cache invalidation strategy

---

## Success Metrics

### Technical KPIs

- [ ] API response time <5s for top 50 holders
- [ ] 95% calculation accuracy (vs manual verification)
- [ ] Cache hit rate >70% for repeated queries
- [ ] Zero calculation errors in production

### Product KPIs

- [ ] User engagement: % of token views that check holder risk
- [ ] Decision support: Correlation between risk level and user actions
- [ ] Data coverage: % of analyzed tokens with sufficient holder data
- [ ] User feedback: NPS or satisfaction score for this feature

---

## Future Enhancements

### V2 Features (Post-MVP)

1. **Historical risk tracking**: Show how holder risk has changed over time
2. **Alert system**: Notify when major holders approach exit
3. **Whale watching**: Track specific large holders across tokens
4. **Pattern clustering**: Group holders by behavior similarity
5. **ML predictions**: Improve exit timing with machine learning
6. **Social signals**: Integrate holder wallet reputation/history

### Integration Opportunities

1. **Token screener**: Filter tokens by holder stability
2. **Portfolio tracker**: Monitor your holdings' holder risk
3. **Trading bots**: Automated exit based on holder risk changes
4. **Research tools**: Export holder analysis for deep dives

---

## Questions & Decisions

### Open Questions

1. **Holder data source**: DexScreener vs direct RPC queries?
   - DexScreener: Faster, cached, but may be stale
   - RPC: Real-time, accurate, but slower and more expensive
   - **Decision**: Start with DexScreener, fallback to RPC

2. **Historical window**: How far back to look for patterns?
   - Too short: Not enough data
   - Too long: Stale patterns (wallet behavior changes)
   - **Decision**: 90 days default, configurable

3. **Minimum holders to analyze**: topN parameter bounds?
   - Too few: Miss important holders
   - Too many: Slow, expensive
   - **Decision**: Default 50, max 100, min 10

4. **Cache strategy**: How long to cache results?
   - Holder positions change constantly
   - Historical patterns are stable
   - **Decision**: Cache historical patterns 24h, current positions 5min

### Decided

- ✅ Use weighted average for historical calculation
- ✅ Exclude current holdings from historical pattern
- ✅ Exit threshold: 20% of peak (configurable)
- ✅ Risk levels: 4 tiers (CRITICAL/HIGH/MEDIUM/LOW)
- ✅ Minimum completed cycles: 3 tokens

---

## Implementation Considerations

### ✅ Resolved: Data Sources

**Top Holders Data**: Already available via existing endpoint
- `GET /api/v1/tokens/:mint/top-holders` returns top holders with wallet addresses
- **Decision**: Start with top 10 holders, scale to more after validating performance
- No blocker here ✅

### 🎯 Performance Strategy

**Initial Scope**: 10 wallets per token
- Each wallet requires full historical analysis
- Parallel processing for independent wallet analyses
- Estimate: ~1-2 seconds per wallet with caching

**Scaling Practices (Implement Upfront)**:
- Redis caching for historical patterns (24h TTL)
- Parallel analysis using Promise.all()
- Database indexing on wallet + token mint
- Progressive loading (show results as they complete)

**Performance Targets**:
- Historical pattern calculation: <500ms per wallet (cached)
- Total analysis for 10 holders: <5s (parallel + cached)
- Cache hit rate target: >70% after 24h

### 📊 Data Coverage Handling

**Insufficient Data Cases**:
- Wallets with <3 completed cycles
- New wallets with only current positions
- Low-activity wallets

**UI Approach**:
- Show all holders with data quality indicators
- Icon or badge: "⚠️ Limited data (2 cycles)"
- Tooltip: "Sample size too small for reliable prediction"
- Still show available metrics (current position, total trades)

**Minimum Requirements**:
- 3 completed token cycles for historical pattern
- Otherwise: Show current position data only

### 🔧 Technical Decisions

#### 1. **Entry Time Calculation** (Multiple Buys)
**Scenario**: Buy 100k day 1, buy 50k day 3, buy 30k day 5

**Decision**: Option B - Weighted Average Entry Time
- Calculate weighted average: `Σ(amount_i × timestamp_i) / Σ(amount_i)`
- Example: `(100k×day1 + 50k×day3 + 30k×day5) / 180k = day 2.11`
- **Reason**: Matches weighted selling logic, mathematically consistent

**Implementation**: Track each buy with timestamp, calculate weighted average on demand

#### 2. **Behavioral Drift** (Changing Patterns Over Time)
**Problem**: Wallet behavior changes (2023 holder → 2024 flipper)

**Solution**: Time-filtered views
- Show historical pattern for multiple windows:
  - Last 7 days
  - Last 30 days
  - All time (or last 90 days)
- User can see trend: "30d avg: 2 days, 7d avg: 0.5 days → becoming flipper"

**UI**: Dropdown or tabs to switch time windows

#### 3. **Token-Specific Behavior** (Documentation Only)
**Limitation**: Wallets may treat different tokens differently
- Hold SOL/ETH long-term
- Flip memecoins fast
- Historical pattern from random tokens may not predict behavior on THIS specific token

**Approach for MVP**:
- Document this limitation clearly
- Accept as known constraint
- **Future enhancement**: Filter historical pattern by token type/market cap similarity

#### 4. **Exit Threshold**
**Decision**: 80% sold (20% remaining) = exited position
- Previous: 5% remaining (dust threshold)
- New: 20% remaining (exit threshold)
- Dust threshold stays at 5% (filter completely)

**Ranges**:
- `<5%` remaining: DUST (ignore)
- `5-20%` remaining: EXITED (position closed)
- `20-75%` remaining: PROFIT_TAKER (active)
- `>75%` remaining: FULL_HOLDER (active)

**Configuration**: Make thresholds configurable but use 20% as default

### 🎯 Validation & Accuracy Tracking (Critical)

**Prediction Storage**:
```typescript
interface StoredPrediction {
  walletAddress: string;
  tokenMint: string;
  predictedAt: number;
  estimatedExitHours: number;
  actualExitTimestamp?: number; // Populated when position exits
  predictionAccuracyHours?: number; // |predicted - actual|
}
```

**Background Job** (Weekly):
- Query predictions where `predictedAt + estimatedExitHours < now`
- Check if position actually exited
- Calculate accuracy: `|predicted - actual|`
- Aggregate: "Predictions within 24h of actual: 68%"

**Dashboard Display**:
- Show accuracy metrics prominently
- "Based on 142 completed predictions, avg error: ±18 hours"
- Builds user confidence in predictions

**Implementation**: Phase 2 (when predictions are added)

---

## Final Implementation Plan

### ✅ Ready to Start

**Phase 1 (Core Calculation)**: 5-7 days
- [ ] Add `calculatePeakPosition()` and `detectPositionExit()` (exit at 20% threshold)
- [ ] Add `buildTokenLifecycles()` to track position states
- [ ] Add `calculateHistoricalPattern()` with weighted average from completed positions
- [ ] Implement weighted average entry time calculation (Option B)
- [ ] Add `historicalPattern` field to `BehavioralMetrics` (optional, non-breaking)
- [ ] Mark `weightedAverageHoldingDurationHours` and `averageFlipDurationHours` as `@deprecated`
- [ ] Implement Redis caching for historical patterns (24h TTL)
- [ ] Write comprehensive unit tests
- [ ] Validate accuracy on 10+ test wallets

**Phase 2 (Prediction Layer)**: 3-5 days
- [ ] Add current position analysis (weighted entry time, percent sold, status)
- [ ] Calculate `estimatedTimeUntilExit = max(0, historical - weightedCurrentAge)`
- [ ] Add risk level classification (CRITICAL <24h, HIGH <48h, MEDIUM <120h, LOW ≥120h)
- [ ] Store predictions in DB with `StoredPrediction` schema
- [ ] Display predictions with confidence scores
- [ ] Background job: Track prediction accuracy weekly

**Phase 3 (Holder Aggregation)**: 5-7 days
- [ ] Create `HolderRiskService` to orchestrate multi-wallet analysis
- [ ] Integrate with existing `GET /tokens/:mint/top-holders` endpoint
- [ ] Implement parallel holder analysis (start with 10 holders)
- [ ] Calculate supply-weighted risk distribution
- [ ] Create API endpoints (async pattern if needed for scaling)
- [ ] Build dashboard components with data quality indicators

**Phase 4 (Time Filters & Polish)**: 3-4 days
- [ ] Add time window filters (7d, 30d, all-time) to historical pattern calculation
- [ ] Display behavioral drift (compare 7d vs 30d patterns)
- [ ] Remove deprecated metrics from codebase
- [ ] Add prediction accuracy dashboard
- [ ] Performance optimization
- [ ] Documentation

**Total Estimate**: 16-23 days

---

## 🎯 UPDATED PLAN (2025-11-10)

### Phase 1 Status: ✅ **100% COMPLETE**

**Key Discovery**: Entry timestamps already exist in `TokenPositionLifecycle.entryTimestamp` (line 542 in analyzer.ts)

**What We Have**:
- ✅ Historical patterns (medianCompletedHoldTimeHours) - tested on 37 wallets, 6,292 cycles
- ✅ Token lifecycles with entry/exit timestamps for every token
- ✅ Position status (ACTIVE/EXITED), current balance, percent sold
- ✅ Behavioral classification (ULTRA_FLIPPER/FLIPPER/SWING/HOLDER)
- ✅ Exit pattern detection (GRADUAL/ALL_AT_ONCE)
- ✅ All timestamps stored in SwapAnalysisInput + HeliusTransactionCache

### Ultimate Goal: Token Death Meter 💀

**User Need**: "When will this token die?" (based on top holder behavior)

**Approach**:
1. Per-wallet prediction: "Wallet exits after 20m median, held THIS token 18m → exits in 2m"
2. Aggregate to token: "Top 10 holders average 2.3h hold → token dies in 1.8h"

### Phase 2 Revised: Build & Validate Foundation FIRST

**Phase 2A: Per-Wallet Prediction + Validation** (2 weeks) ← START HERE
1. Build `predictTokenExit()` method (1 day)
   - Input: wallet + tokenMint + swapRecords
   - Output: estimated exit time, risk level, confidence
   - Math: `timeRemaining = max(0, historicalMedian - currentAge)`

2. Add prediction storage (1 day)
   - New table: `WalletTokenPrediction` with actual exit tracking
   - Store predictions to validate later

3. Build validation system (2 days)
   - Daily job: check predictions vs actual exits
   - Measure accuracy: % within ±20% of predicted time
   - Break down by behavior type

4. Historical backtest (2 days)
   - Test on past data: predict 7 days ago, validate against today
   - Measure accuracy on 37 test wallets

5. Accuracy measurement (1 week)
   - Run predictions, wait, validate
   - **Target**: 70%+ accuracy for ULTRA_FLIPPER/FLIPPER
   - If <70%, iterate on prediction logic

**Success Criteria**:
- ✅ 70%+ overall accuracy
- ✅ 80%+ for ULTRA_FLIPPER (most predictable)
- ✅ Can measure accuracy by behavior type
- ✅ Validation system running

**Phase 2B: Token Aggregation** (1 week) ← ONLY AFTER 2A
1. Supply integration (DexScreener API for top holders)
2. Token death meter service (aggregate wallet predictions)
3. API endpoints + simple UI

### Why This Order?

**Critical Insight**: Need to validate atomic predictions before composing them.
- If wallet predictions are 40% accurate → token aggregation is garbage
- If wallet predictions are 85% accurate → token aggregation is reliable
- Must measure and trust foundation before building on it

### Next Immediate Steps

1. Implement `BehaviorAnalyzer.predictTokenExit()` (uses existing data)
2. Add `WalletTokenPrediction` Prisma schema
3. Build validation service
4. Test and measure accuracy
5. **Decision Point**: If accuracy ≥70%, proceed to Phase 2B (token aggregation)

---

## References

- Main documentation: `docs/3.metrics_compact_map.md` (Holding Time Methodology section)
- Current implementation: `src/core/analysis/behavior/analyzer.ts`
- Test examples: `src/core/analysis/behavior/test-fifo-holding-time.ts`
- Config types: `src/types/analysis.ts`
