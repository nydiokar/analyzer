# Architecture: Holder Risk Analysis & Predictive Holding Time

**Status**: ✅ Phase 1-4 Complete | 🚀 Production Ready
**Priority**: High
**Owner**: Core Analytics Team
**Last Updated**: 2025-12-01

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

## Implementation Status (2025-12-01)

### ✅ Phase 1: Core Calculation (COMPLETE - 2025-11-08)

**Location**: `src/core/analysis/behavior/analyzer.ts`

✅ **Historical Pattern Calculation** (Lines 150-298)
- **Enhancement**: Uses per-token median aggregation (not all-lifecycles median)
- Prevents re-entry bias - each token weighted equally regardless of cycle count
- Weighted average from COMPLETED positions only
- Median hold time (outlier-robust)
- Behavior classification (ULTRA_FLIPPER/FLIPPER/SWING/HOLDER)
- Data quality scoring
- Hold time distribution for flip ratio calculation
- **Validated**: 19 wallets, 4,007+ exited positions, 100% accuracy

✅ **Token Lifecycle Tracking** (Lines 573-710)
- `buildTokenLifecycles()`: Per-token position states (ACTIVE/EXITED)
- Re-entry support (multiple cycles per token)
- Exit detection (20% threshold)
- Weighted entry time calculation

✅ **Dual Holding Time Methodology** - Two complementary systems serve different purposes:

1. **Exited Positions (Historical Pattern)** - For prediction & risk analysis:
   - `historicalPattern.medianCompletedHoldTimeHours` - Median from exited-only
   - `historicalPattern.historicalAverageHoldTimeHours` - Weighted avg from exited-only

2. **Current Holdings** - For portfolio state analysis:
   - `medianCurrentHoldingDurationHours` - Median of active positions
   - `averageCurrentHoldingDurationHours` - Average of active positions

3. **Smart Fallback (Holder Profiles API)**:
   - `medianHoldTimeHours` - Smart fallback (typical → realized → current)
   - `avgHoldTimeHours` - Smart fallback (typical → realized → current)

✅ **Truly Deprecated Metrics** (NOT used in holder-profiles, safe to remove in future):
- `averageFlipDurationHours` (BehaviorAnalysisResponseDto) - Legacy mixed metric
- `medianHoldTime` (BehaviorAnalysisResponseDto) - Legacy mixed metric
- `weightedAverageHoldingDurationHours` (BehaviorAnalysisResponseDto) - Conceptually flawed (mixes completed + active)

### ✅ Phase 2: Prediction Layer (FUNCTIONALLY COMPLETE - 2025-11-12)

**Location**: `src/core/analysis/behavior/analyzer.ts:312-397`

✅ **Prediction Method**
- `predictTokenExit()`: Estimates time until exit
- Current position age calculation (weighted entry time)
- Risk level classification (CRITICAL <5min, HIGH <30min, MEDIUM <2h, LOW ≥2h)
- Confidence scoring

⏳ **Validation Infrastructure** (DEFERRED)
- Database storage for predictions
- Accuracy tracking over time
- Background validation jobs

### ✅ Phase 3: Token Holder Profiles Dashboard (COMPLETE - 2025-11-13)

**API**: `POST /api/v1/analyses/holder-profiles`

✅ **Backend**
- Async job-based architecture (BullMQ)
- Processor: `src/queues/processors/analysis-operations.processor.ts:632-1500`
- Batch database queries (no N+1)
- Parallel holder analysis (`Promise.all`)
- **TWO-TIER CACHING** (Enhanced beyond original plan):
  - **Tier 1 (Redis)**: 1-hour TTL, <50ms response
  - **Tier 2 (PostgreSQL)**: `HolderProfileSnapshot` table, smart freshness checks via `wallet.lastSuccessfulFetchTimestamp`
  - Progressive streaming: Serve 7 cached instantly, compute 3 missing
- **Performance**: <15s for 10 holders (cold), <50ms (cached)

✅ **Dashboard**
- Page: `dashboard/src/app/tools/holder-profiles/page.tsx`
- Shows: median hold time, flip ratio, behavior type, data quality
- Job status polling
- Loading states

✅ **Critical Fixes Applied** (2025-11-13)
- Supply percentage (fetches actual token supply via RPC)
- Cache race condition (atomic Lua script)
- Timeout enforcement (5 checkpoints)
- Job deduplication
- Token supply caching (permanent)

### ✅ Metrics Refactor (COMPLETE - 2025-11-17)

**Constants Consolidation**: `src/core/analysis/behavior/constants.ts` ✅ (2025-11-18)

All behavior classification thresholds now centralized in a single source of truth.

✅ **System 1: Trading Speed Categories** (6 types)
- **Used By**: `TradingInterpretation.speedCategory`
- **Data Source**: **COMPLETED/EXITED positions only** (same as System 2)
- **Purpose**: General wallet speed classification ("How fast do they exit?")
- **Helper Function**: `classifyTradingSpeed(medianHoldTimeHours)` where `medianHoldTimeHours` comes from `historicalPattern.medianCompletedHoldTimeHours`
- **Categories**:
  - ULTRA_FLIPPER: <3 minutes (bot-like, MEV, arbitrage)
  - FLIPPER: 3-10 minutes (snipe-and-dump)
  - FAST_TRADER: 10-60 minutes (intra-hour momentum)
  - DAY_TRADER: 1-24 hours (standard day trading)
  - SWING_TRADER: 1-7 days (multi-day holds)
  - POSITION_TRADER: 7+ days (long-term holds)
- **UI Display**: BehavioralPatternsTab summary section

✅ **System 2: Holder Behavior Types** (8 types - MORE GRANULAR)
- **Used By**: `WalletHistoricalPattern.behaviorType`
- **Data Source**: COMPLETED positions only (exited trades)
- **Purpose**: Holder risk analysis and exit prediction ("How fast do they exit?")
- **Helper Function**: `classifyHolderBehavior(medianCompletedHoldTimeHours)`
- **Categories**:
  - SNIPER: <1 minute (Bot/MEV behavior)
  - SCALPER: 1-5 minutes (Ultra-fast scalping)
  - MOMENTUM: 5-30 minutes (Momentum trading)
  - INTRADAY: 30 minutes - 4 hours (Short-term intraday)
  - DAY_TRADER: 4-24 hours (Day trading)
  - SWING: 1-7 days (Swing trading)
  - POSITION: 7-30 days (Position trading)
  - HOLDER: 30+ days (Long-term holding)
- **UI Display**: BehavioralPatternsTab historical pattern section, HolderProfilesTable

✅ **Why Two Systems?**
- **Same Data Source**: Both use COMPLETED/EXITED positions only (via `historicalPattern`)
- **Different Granularity**: System 1 has 6 categories, System 2 has 8 categories (more granular for memecoin behavior)
- **Different Purposes**: System 1 = general speed classification, System 2 = granular holder risk prediction
- **Real Example**: Wallet with median exit time of 2.5 min → FLIPPER (system 1, 6-category) but SCALPER (system 2, 8-category more granular)

✅ **Migration Impact** (`analyzer.ts`)
- Line 265: Replaced 23 hardcoded lines with `classifyHolderBehavior()`
- Line 1360: Replaced 15 hardcoded lines with `classifyTradingSpeed()`
- Zero breaking changes (thresholds identical, just moved to constants)
- Single source of truth: Changing thresholds requires updating only `constants.ts`

✅ **Critical Bug Fixes** (2025-11-18)
- **Invalid Hold Time Filtering** (`analyzer.ts:226-243`):
  - **Before**: `weightedHoldingTimeHours > 0` (too strict, filtered out sub-second holds)
  - **After**: `weightedHoldingTimeHours >= 0.0001h` (~0.36 seconds minimum)
  - **Impact**: Now properly captures ultra-fast bot exits (MEV, same-block trades)
  - **Example**: Wallet rotation (same-tx transfers) now correctly identified as instant holds

- **Hold Time Distribution** (`analyzer.ts:268-287`, `types/behavior.ts:63-73`):
  - **Added**: `holdTimeDistribution` field to `WalletHistoricalPattern`
  - **Contains**: 8 time ranges (instant, ultraFast, fast, momentum, intraday, day, swing, position)
  - **Purpose**: Show breakdown of hold times across all completed positions
  - **Usage**: Available in API for UI display, used for flip ratio calculation

- **Flip Ratio Calculation** (`analysis-operations.processor.ts:1555-1590`):
  - Uses `holdTimeDistribution` from `historicalPattern`
  - **Formula**: `(instant + ultraFast + fast) / total * 100`
  - **Enhancement**: Confidence tiers (HIGH ≥10 cycles, MEDIUM 5-9, LOW 3-4, NONE <3)
  - **Impact**: Shows % of positions held <5min with quality indicator (e.g., "91% (HIGH)")

- **Log Spam Reduction** (`analyzer.ts:238-243`):
  - **Before**: 100+ individual lines "Filtering out token X with invalid hold time: 0.000000h"
  - **After**: Single aggregated line "Filtered out 90 tokens with invalid hold times"
  - **Impact**: Cleaner logs, easier debugging

✅ **Bot Detection Update** (`bot-detector.ts:105-116`)
- Uses median hold time (was average)
- 3-minute threshold (was 6 minutes)

✅ **New Type**: `TradingInterpretation` (`types/behavior.ts:94-112`)
- `speedCategory`: Classification based on median
- `typicalHoldTimeHours`: What they usually do
- `economicHoldTimeHours`: Where the money goes
- `economicRisk`: CRITICAL/HIGH/MEDIUM/LOW
- `behavioralPattern`: ACCUMULATOR/BALANCED/etc

### ✅ Phase 4: Frontend Migration (COMPLETE - 2025-11-17)

**File**: `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`

✅ **Completed**:
1. Updated to use `historicalPattern` metrics with fallbacks
2. Added `tradingInterpretation` display (speed category, economic risk, behavioral pattern)
3. Both tabs now show consistent metrics
4. Clear tooltips explaining dual interpretation (typical vs economic)
5. Removed deprecated metric displays from current holdings section

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

## Implementation Steps (COMPLETED PHASES)

### ✅ Step 1: Core Calculation (BehaviorAnalyzer) - COMPLETE (2025-11-08)

**Priority**: CRITICAL
**Files**: `src/core/analysis/behavior/analyzer.ts`

1. [x] Add `calculatePeakPosition()` method (lines 405-448)
2. [x] Add `detectPositionExit()` method (lines 455-491)
3. [x] Add `buildTokenLifecycles()` method (lines 573-710) - with re-entry bug fix (2025-11-10)
4. [x] Add `calculateHistoricalPattern()` method (lines 150-298) - completed tokens only
5. [x] Add `predictTokenExit()` method (lines 312-397) - current position + prediction
6. [x] Update config types with new thresholds (`src/types/behavior.ts:23-92`)
7. [x] Write unit tests (`test-holder-risk-sampled.ts` - validated with 19 wallets, 4,007+ exited positions)

**Success Criteria:** ✅ ALL MET
- ✅ Can calculate historical average from completed positions
- ✅ Can classify position status (ACTIVE/EXITED/DUST)
- ✅ Can predict time-to-exit
- ✅ Tests pass with various trading patterns (100% success rate)

### ✅ Step 2: Job-Based Processor (NOT Service Layer) - COMPLETE (2025-11-12)

**Note**: We used **async job-based architecture** instead of creating a synchronous service

**Priority**: HIGH
**Files**: `src/queues/processors/analysis-operations.processor.ts`

1. [x] ~~Create `HolderRiskService` class~~ → Used job-based processor pattern instead
2. [x] Reuse existing `TokenHoldersService.getTopHolders()` (lines 643-658)
3. [x] Implement `processAnalyzeHolderProfiles()` job handler (lines 632-809)
4. [x] Implement `analyzeWalletProfile()` per-wallet analysis (lines 811-922)
5. [x] Implement `calculateDailyFlipRatio()` helper (lines 947-974)
6. [x] Add Redis caching layer (`HolderProfilesCacheService` with 2min TTL and smart invalidation)
7. [x] Write integration tests (validated with real tokens)

**Success Criteria:** ✅ ALL MET
- ✅ Can fetch top holders for a token (reused existing service)
- ✅ Can analyze each holder's risk (parallel processing with Promise.all)
- ✅ Can aggregate to token-level results
- ✅ Response time <15s for top 10 holders (12.8s avg)

### ✅ Step 3: API Endpoints - COMPLETE (2025-11-12)

**Priority**: HIGH
**Files**: `src/api/controllers/analyses.controller.ts` (extended existing)

1. [x] ~~Create new controller~~ → Extended existing `AnalysesController`
2. [x] Implement `POST /api/v1/analyses/holder-profiles` endpoint (async job-based)
3. [x] ~~Implement per-wallet endpoint~~ → Not needed, use existing `/wallets/:address/behavior-analysis`
4. [x] Add rate limiting (Throttle decorator: 10 requests/minute)
5. [x] Add API documentation (Swagger annotations)
6. [x] Test with real tokens (validated during implementation)

**Success Criteria:** ✅ ALL MET
- ✅ Endpoint returns job ID for monitoring
- ✅ Proper error handling (job failures, timeouts)
- ✅ API docs generated (Swagger)
- ✅ Rate limiting works (via @Throttle decorator)

### ✅ Step 4: Dashboard Integration - COMPLETE (2025-11-12)

**Priority**: MEDIUM
**Files**: `dashboard/src/app/tools/holder-profiles/page.tsx`, `dashboard/src/components/holder-profiles/*`

1. [x] Create TypeScript types matching backend DTOs (`dashboard/src/types/api.ts` - HolderProfile interface)
2. [x] ~~Create `TokenHolderRiskCard`~~ → Created `HolderProfilesStats` component instead
3. [x] Create `HolderProfilesTable` component (shows wallet, rank, supply %, metrics, quality)
4. [x] ~~Create `RiskBadge`~~ → Used inline badges with `getBehaviorColor()` and `getDataQualityColor()` helpers
5. [x] Create standalone page at `/tools/holder-profiles` (not integrated into token view yet)
6. [x] Add loading states and error handling (job status polling)
7. [x] Add tooltips and explanations (data quality, flip ratio, hold times)

**Success Criteria:** ✅ ALL MET
- ✅ Users can view holder profiles for any token
- ✅ Clear quality indicators (GOLD/SILVER/BRONZE/INSUFFICIENT badges)
- ✅ Detailed breakdown in table (median, avg, flip ratio, behavior type)
- ✅ Mobile responsive (Tailwind responsive classes)

### ✅ Step 5: Metrics Refactor & Frontend Migration - COMPLETE (2025-11-17)

**Priority**: HIGH (elevated from LOW due to user confusion with deprecated metrics)
**Files**: Multiple (see MIGRATION-COMPLETE.md)

1. [x] Create `src/core/analysis/behavior/constants.ts` (trading speed thresholds)
2. [x] Refactor `classifyTradingStyle()` to use median and separate speed from pattern
3. [x] Update bot detection to use median with 3-minute threshold
4. [x] Add `TradingInterpretation` interface to types
5. [x] Update frontend types (`dashboard/src/types/api.ts`)
6. [x] Update `BehavioralPatternsTab.tsx` to use new metrics with fallbacks
7. [x] Verify consistency between holder risk tab and wallet profile

**Success Criteria:** ✅ ALL MET
- ✅ User-facing documentation (inline tooltips explain dual interpretation)
- ✅ Clear metric labels ("Typical Hold Time (Median)" vs "Economic Hold Time (Weighted)")
- ✅ Zero breaking changes (fallback strategy with `??` operator)
- ✅ Consistent display across all tabs
- ✅ Rich interpretation available (speed category, economic risk, behavioral pattern)

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

## 🎯 IMPLEMENTATION STATUS (Updated 2025-11-12)

### Phase 1: Core Calculation - ✅ **100% COMPLETE** (Completed 2025-11-08)

**Implementation Files**:
- `src/core/analysis/behavior/analyzer.ts:150-298` - `calculateHistoricalPattern()`
- `src/core/analysis/behavior/analyzer.ts:405-448` - `calculatePeakPosition()`
- `src/core/analysis/behavior/analyzer.ts:455-491` - `detectPositionExit()`
- `src/core/analysis/behavior/analyzer.ts:573-710` - `buildTokenLifecycles()` with re-entry fix
- `src/types/behavior.ts:23-62` - Type definitions for all lifecycle and pattern types
- `src/core/analysis/behavior/test-holder-risk-analysis.ts` - Comprehensive unit tests (7 scenarios)

**What's Working**:
- ✅ Historical patterns (medianCompletedHoldTimeHours) - validated on 19+ wallets, 4,007+ exited positions
- ✅ Token lifecycles with entry/exit timestamps for every token (handles re-entries correctly)
- ✅ Position status classification (ACTIVE/EXITED)
- ✅ Behavioral classification (ULTRA_FLIPPER <1min / FLIPPER 1-24h / SWING 1-7d / HOLDER >7d)
- ✅ Exit pattern detection (GRADUAL >2 sells/token / ALL_AT_ONCE ≤2 sells/token)
- ✅ Weighted average holding time calculation (matches FIFO sell logic)
- ✅ Data quality scoring based on sample size
- ✅ Deprecated old metrics (`weightedAverageHoldingDurationHours`, `averageFlipDurationHours`)

**Critical Bug Fixed (2025-11-10)**:
- ✅ Re-entry lifecycle bug fixed - now creates separate lifecycles when balance hits 0 and trader re-enters
- Previously: 1 lifecycle per token (undercounted hold times on re-entries)
- Now: Multiple lifecycles per token when position fully exits then re-enters

### Phase 2: Prediction Layer - 🟡 **PARTIALLY COMPLETE** (70% done)

**What's Implemented**:
- ✅ `predictTokenExit()` method (src/core/analysis/behavior/analyzer.ts:312-397)
- ✅ Current position age calculation (weighted entry time)
- ✅ `estimatedExitHours` calculation (`max(0, historicalMedian - currentAge)`)
- ✅ Risk level classification (CRITICAL <5min, HIGH <30min, MEDIUM <2h, LOW ≥2h)
- ✅ `WalletTokenPrediction` TypeScript interface (src/types/behavior.ts:67-92)
- ✅ Prediction confidence scoring (based on data quality)
- ✅ CLI scripts for generating predictions:
  - `src/scripts/generate-prediction-report.ts` - Multi-wallet prediction report
  - `src/scripts/generate-holder-analysis.ts` - Consolidated holder + prediction analysis

**What's MISSING** (30% remaining):
- ❌ **Prisma schema** for `WalletTokenPrediction` table (persistence layer)
- ❌ **Database storage** for predictions (currently only in-memory via scripts)
- ❌ **Validation service** to track prediction accuracy over time
- ❌ **Background job** to check predictions vs actual exits
- ❌ **Historical backtest** system (predict 7 days ago, validate today)
- ❌ **Accuracy metrics dashboard** ("Based on 142 predictions, avg error: ±18h")

**Risk Thresholds** (optimized for memecoin flippers):
- CRITICAL: <5 minutes (dump imminent)
- HIGH: 5-30 minutes (dump very soon)
- MEDIUM: 30min-2h (short-term risk)
- LOW: 2+ hours (you have time)

### Phase 3: Holder Aggregation - ❌ **NOT STARTED** (Token Death Meter 💀)

**Ultimate Goal**: "When will this token die?" (based on top holder behavior)

**Missing Components**:
- ❌ `HolderRiskService` service layer (src/api/services/holder-risk.service.ts)
- ❌ Token-level holder risk aggregation logic
- ❌ API endpoints:
  - `GET /api/v1/tokens/:mint/holder-risk` - Aggregate risk for top N holders
  - `GET /api/v1/tokens/:mint/holders/:wallet/risk` - Single holder risk
- ❌ Supply-weighted risk distribution calculation
- ❌ Parallel holder analysis orchestration (Promise.all for 10-50 wallets)
- ❌ Dashboard components (risk cards, holder tables, charts)
- ❌ Integration with existing `GET /tokens/:mint/top-holders` endpoint

### Phase 4: Time Filters & Polish - ❌ **NOT STARTED**

**Planned Features**:
- ❌ Time window filters (7d, 30d, all-time) for pattern calculation
- ❌ Behavioral drift detection (compare 7d vs 30d patterns)
- ❌ Prediction accuracy dashboard
- ❌ Performance optimization (Redis caching for historical patterns)
- ❌ Complete removal of deprecated metrics

---

## 📋 NEXT IMMEDIATE STEPS

### To Complete Phase 2 (Prediction Storage & Validation):

1. **Add Prisma Schema** (1 hour)
   ```prisma
   model WalletTokenPrediction {
     id                    String   @id @default(cuid())
     walletAddress         String
     tokenMint             String
     predictedAt           Int      // Unix timestamp
     estimatedExitHours    Float
     estimatedExitTimestamp Int
     riskLevel             String   // CRITICAL | HIGH | MEDIUM | LOW

     // For validation
     actualExitTimestamp   Int?     // Populated when position exits
     predictionAccuracyHours Float? // |predicted - actual|
     validated             Boolean  @default(false)

     // Context
     historicalMedianHoldHours Float
     historicalSampleSize      Int
     behaviorType              String
     currentPositionAgeHours   Float
     percentAlreadySold        Float
     predictionConfidence      Float

     createdAt             DateTime @default(now())

     @@unique([walletAddress, tokenMint, predictedAt])
     @@index([tokenMint, validated])
     @@index([walletAddress])
   }
   ```

2. **Create PredictionService** (2-3 days)
   - Store predictions when generated
   - Query predictions for validation
   - Calculate accuracy metrics

3. **Build Validation Job** (2-3 days)
   - Background worker (runs daily or hourly)
   - Check predictions where `predictedAt + estimatedExitHours < now`
   - Query wallet positions to see if actually exited
   - Update `actualExitTimestamp` and `predictionAccuracyHours`

4. **Historical Backtest Script** (1-2 days)
   - Use existing transaction data
   - Generate predictions "as of" 7 days ago
   - Compare to actual behavior
   - Report accuracy by behavior type

### To Start Phase 3 (Token Death Meter):

**Prerequisites**: Phase 2 validation shows ≥70% accuracy

1. Create `HolderRiskService`
2. Build token-level aggregation endpoint
3. Integrate with top holders API
4. Build dashboard UI components

---

## 📊 VALIDATION RESULTS (Phase 1)

**Test Date**: 2025-11-08
**Test Dataset**: 19 real wallets, 4,007+ exited positions
**Performance**: 12.8s avg sync time, <0.05s analysis time per wallet

**Behavior Distribution**:
- 6 ULTRA_FLIPPER wallets (avg 35min hold)
- 13 FLIPPER wallets (avg 5.5h hold)
- 100% success rate (all wallets classified correctly)

**Smart Sampling**: 2000 signatures yields 50-357 exited positions per wallet (sufficient for reliable patterns)

**Critical Findings**:
- Bug discovered in exit detection (now fixed)
- DUST threshold needs redefinition (should be value-based, not supply-based)
- Re-entry lifecycle bug fixed (no longer undercounts hold times)

---

## 🎯 NEXT: Phase 3 - Token Holder Profiles Dashboard (3-4 days)

### Goal
Show holding behavior profile for each top holder. **Incremental, optimized, transparent about data quality.**

---

## ⚠️ **ARCHITECTURE PATTERN - READ THIS FIRST**

**DO NOT create a synchronous "god service" that does everything. Follow the existing job-based pattern:**

### Current System Architecture:
```
1. Controller (HTTP) → Enqueues job, returns job ID
2. BullMQ Queue → Stores job
3. Processor (Worker) → Executes job asynchronously
4. Core Services → Business logic (BehaviorAnalyzer, etc.)
5. Database → Data access
```

### For Holder Profiles:
```
POST /analyses/holder-profiles
  ↓ (enqueues job)
AnalysisOperationsProcessor.processAnalyzeHolderProfiles()
  ↓ (calls existing core services)
BehaviorAnalyzer.calculateHistoricalPattern()  ← ALREADY EXISTS
  ↓
Return job ID to frontend → Frontend polls job status
```

**Key Points:**
- ✅ **Use existing `BehaviorAnalyzer`** - Don't duplicate logic
- ✅ **Async job-based** - Not synchronous HTTP
- ✅ **Extend existing processor** - Don't create new service
- ✅ **Controller enqueues job** - Returns job ID for monitoring
- ❌ **No `HolderProfileService`** - That would be a god service

---

## What We Already Have (Reuse)

✅ **Top Holders Fetching** - `TokenHoldersService.getTopHolders(mint)`
- Returns: wallet addresses, supply %, rank
- Already filters AMM pools, system wallets
- **Use with topN=10** for performance

✅ **Token Metadata** - Token enrichment job + token badge component
- Token symbol, name, supply already available
- Dashboard already consumes via token badge
- **No additional work needed**

✅ **Wallet Historical Analysis** - `BehaviorAnalyzer`
- `calculateHistoricalPattern()` - median, avg hold time, behavior type
- Already handles lifecycle tracking, re-entries
- **Just wire it up**

---

## What We Need to Build

### 1. Job Types (Data Structures)

**File**: `src/queues/jobs/types.ts`

```typescript
export interface AnalyzeHolderProfilesJobData {
  tokenMint: string;
  topN: number;
  requestId: string;
}

export interface HolderProfilesResult {
  apiVersion: string;
  tokenMint: string;
  analyzedAt: number;
  totalHolders: number;
  holdersWithData: number;
  holders: HolderProfile[];
  performance: {
    totalProcessingTimeMs: number;
    avgTimePerHolderMs: number;
  };
}

export interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;

  // Metrics (null if insufficient data)
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;
  behaviorType: string | null;
  exitPattern: string | null;

  // Data quality (always present)
  dataQualityTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
}
```

### 2. Processor - Extend Existing

**File**: `src/queues/processors/analysis-operations.processor.ts`

**Add to processJob() switch:**
```typescript
private async processJob(job: Job): Promise<any> {
  const jobName = job.name;

  switch (jobName) {
    case 'analyze-pnl':
      return this.processAnalyzePnl(job);
    case 'analyze-behavior':
      return this.processAnalyzeBehavior(job);
    case 'analyze-holder-profiles':  // NEW
      return this.processAnalyzeHolderProfiles(job);
    // ...
  }
}
```

**Add job handler:**
```typescript
private async processAnalyzeHolderProfiles(
  job: Job<AnalyzeHolderProfilesJobData>
): Promise<HolderProfilesResult> {
  const { tokenMint, topN, requestId } = job.data;
  const startTime = Date.now();

  // 1. Fetch top holders (reuse existing TokenHoldersService)
  const topHoldersResponse = await this.tokenHoldersService.getTopHolders(tokenMint);

  const wallets = topHoldersResponse.holders
    .filter(h => h.ownerAccount)
    .slice(0, topN)
    .map((h, idx) => ({
      address: h.ownerAccount,
      rank: idx + 1,
      supplyPercent: (h.uiAmount / totalSupply) * 100  // Calculate from response
    }));

  if (wallets.length === 0) {
    throw new Error(`No analyzable holders found for token ${tokenMint}`);
  }

  // 2. BATCH fetch swap records for ALL wallets (avoid N+1)
  const walletAddresses = wallets.map(w => w.address);
  const allSwapRecords = await this.databaseService.prisma.swapAnalysisInput.findMany({
    where: { walletAddress: { in: walletAddresses } }
  });

  // Group by wallet
  const swapRecordsByWallet = walletAddresses.reduce((acc, address) => {
    acc[address] = allSwapRecords.filter(r => r.walletAddress === address);
    return acc;
  }, {} as Record<string, any[]>);

  // 3. Analyze wallets IN PARALLEL
  const profiles = await Promise.all(
    wallets.map(wallet =>
      this.analyzeWalletProfile(wallet, swapRecordsByWallet[wallet.address])
    )
  );

  // 4. Calculate aggregate stats
  const holdersWithData = profiles.filter(p => p.dataQualityTier !== 'INSUFFICIENT').length;
  const totalProcessingTime = Date.now() - startTime;

  return {
    apiVersion: '1.0',
    tokenMint,
    analyzedAt: Math.floor(Date.now() / 1000),
    totalHolders: profiles.length,
    holdersWithData,
    holders: profiles,
    performance: {
      totalProcessingTimeMs: totalProcessingTime,
      avgTimePerHolderMs: Math.round(totalProcessingTime / profiles.length)
    }
  };
}

private async analyzeWalletProfile(
  wallet: { address: string; rank: number; supplyPercent: number },
  swapRecords: any[]
): Promise<HolderProfile> {
  const startTime = Date.now();

  // Use EXISTING BehaviorAnalyzer (core service)
  const config: BehaviorAnalysisConfig = {
    holdingThresholds: {
      exitThreshold: 0.20,
      dustThreshold: 0.05,
      minimumSolValue: 0.001,
      minimumPercentageRemaining: 0.05,
      minimumHoldingTimeSeconds: 60,
    },
    historicalPatternConfig: {
      minimumCompletedCycles: 3,
      maximumDataAgeDays: 90,
    },
  };

  const analyzer = new BehaviorAnalyzer(config);

  // Calculate historical pattern using EXISTING method
  const pattern = analyzer.calculateHistoricalPattern(swapRecords, wallet.address);

  if (!pattern) {
    return {
      walletAddress: wallet.address,
      rank: wallet.rank,
      supplyPercent: wallet.supplyPercent,
      medianHoldTimeHours: null,
      avgHoldTimeHours: null,
      dailyFlipRatio: null,
      behaviorType: null,
      exitPattern: null,
      dataQualityTier: 'INSUFFICIENT',
      completedCycleCount: 0,
      confidence: 0,
      insufficientDataReason: 'Less than 3 completed token cycles',
      processingTimeMs: Date.now() - startTime
    };
  }

  // Calculate daily flip ratio (new helper)
  const flipRatio = this.calculateDailyFlipRatio(analyzer, swapRecords);

  // Determine data quality tier
  const qualityTier = this.determineDataQualityTier(
    pattern.completedCycleCount,
    pattern.dataQuality
  );

  return {
    walletAddress: wallet.address,
    rank: wallet.rank,
    supplyPercent: wallet.supplyPercent,
    medianHoldTimeHours: pattern.medianCompletedHoldTimeHours,
    avgHoldTimeHours: pattern.historicalAverageHoldTimeHours,
    behaviorType: pattern.behaviorType,
    exitPattern: pattern.exitPattern,
    dailyFlipRatio: flipRatio.ratio,
    completedCycleCount: pattern.completedCycleCount,
    dataQualityTier: qualityTier,
    confidence: pattern.dataQuality,
    processingTimeMs: Date.now() - startTime
  };
}
```

**Add helper methods:**
```typescript
private calculateDailyFlipRatio(
  analyzer: BehaviorAnalyzer,
  swapRecords: any[]
): { ratio: number; shortHolds: number; longHolds: number } {
  // Build lifecycles using existing analyzer method
  const sequences = analyzer['buildTokenSequences'](swapRecords);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const lifecycles = analyzer['buildTokenLifecycles'](sequences, currentTimestamp);

  const completed = lifecycles.filter(lc => lc.positionStatus === 'EXITED');

  let shortHolds = 0;  // <5 minutes
  let longHolds = 0;   // ≥1 hour

  for (const lc of completed) {
    const minutes = lc.weightedHoldingTimeHours * 60;
    if (minutes < 5) {
      shortHolds++;
    } else if (lc.weightedHoldingTimeHours >= 1) {
      longHolds++;
    }
  }

  const total = shortHolds + longHolds;
  return {
    ratio: total > 0 ? (shortHolds / total) * 100 : 0,
    shortHolds,
    longHolds
  };
}

private determineDataQualityTier(
  cycles: number,
  confidence: number
): 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' {
  if (cycles >= 10 && confidence >= 0.8) return 'HIGH';
  if (cycles >= 5 && confidence >= 0.6) return 'MEDIUM';
  if (cycles >= 3) return 'LOW';
  return 'INSUFFICIENT';
}
```

### 3. Controller - Enqueue Job

**File**: `src/api/controllers/analyses.controller.ts` (add to existing controller)

```typescript
@Post('/holder-profiles')
@Throttle({ default: { limit: 10, ttl: 60000 } })
@ApiOperation({
  summary: 'Analyze holder profiles for a token',
  description: 'Queues analysis of top holders. Returns job ID for monitoring.'
})
@HttpCode(202)
async analyzeHolderProfiles(
  @Body() body: { tokenMint: string; topN?: number }
): Promise<{
  jobId: string;
  requestId: string;
  status: string;
  monitoringUrl: string;
}> {
  if (!body.tokenMint || !isValidSolanaAddress(body.tokenMint)) {
    throw new BadRequestException('Valid tokenMint is required');
  }

  const requestId = `holder-profiles-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const topN = body.topN && body.topN >= 5 && body.topN <= 20 ? body.topN : 10;

  // Enqueue job
  const job = await this.analysisOperationsQueue.add(
    'analyze-holder-profiles',
    {
      tokenMint: body.tokenMint,
      topN,
      requestId
    },
    {
      priority: JobPriority.NORMAL,
      jobId: `holder-profiles-${body.tokenMint}-${requestId}`
    }
  );

  return {
    jobId: job.id,
    requestId,
    status: 'queued',
    monitoringUrl: `/api/v1/jobs/${job.id}`
  };
}
```

**Response Format:**
```typescript
{
  apiVersion: "1.0",
  tokenMint: "So11111...",
  analyzedAt: 1699999999,

  // Summary
  totalHolders: 10,
  holdersWithData: 7,
  holdersWithInsufficientData: 3,

  // Holders (sorted by rank)
  holders: [
    {
      walletAddress: "abc...",
      rank: 1,
      supplyPercent: 12.3,

      // Holding metrics (null if insufficient data)
      medianHoldTimeHours: 2.5,
      avgHoldTimeHours: 3.1,
      dailyFlipRatio: 85,
      behaviorType: "ULTRA_FLIPPER",
      exitPattern: "ALL_AT_ONCE",

      // Data quality (always present)
      dataQualityTier: "HIGH",
      completedCycleCount: 47,
      confidence: 0.85,

      // Transparency
      insufficientDataReason: null,
      processingTimeMs: 234
    },
    {
      walletAddress: "def...",
      rank: 2,
      supplyPercent: 8.1,

      // No metrics available
      medianHoldTimeHours: null,
      dataQualityTier: "INSUFFICIENT",
      completedCycleCount: 1,
      insufficientDataReason: "Less than 3 completed token cycles",
      processingTimeMs: 89
    }
  ],

  // Performance tracking
  performance: {
    totalProcessingTimeMs: 4231,
    avgTimePerHolderMs: 423,
    slowestHolderMs: 1234,
    fastestHolderMs: 89
  }
}
```

---

### 3. Dashboard - Progressive Loading

**File**: `dashboard/src/app/tools/holder-profiles/page.tsx`

**Approach: Show data as soon as available**

```tsx
const [holders, setHolders] = useState([]);
const [isLoading, setIsLoading] = useState(false);

const analyzeToken = async (mint) => {
  setIsLoading(true);
  setHolders([]); // Clear previous

  try {
    const response = await fetch(`/api/v1/tokens/${mint}/holder-profiles`);
    const data = await response.json();

    // Show all holders at once (backend already optimized)
    setHolders(data.holders);
  } finally {
    setIsLoading(false);
  }
};
```

**Table Component:**
```tsx
<HolderProfilesTable holders={holders}>
  {holders.map(holder => (
    <TableRow key={holder.walletAddress}>
      <TableCell>{holder.rank}</TableCell>
      <TableCell>
        <WalletAddress address={holder.walletAddress} />
      </TableCell>
      <TableCell>{holder.supplyPercent.toFixed(2)}%</TableCell>

      {/* Metrics - show if available */}
      <TableCell>
        {holder.dataQualityTier !== 'INSUFFICIENT' ? (
          formatHoldTime(holder.medianHoldTimeHours)
        ) : (
          <Tooltip content={holder.insufficientDataReason}>
            <Badge variant="outline">No Data</Badge>
          </Tooltip>
        )}
      </TableCell>

      {/* Data quality badge */}
      <TableCell>
        <DataQualityBadge
          tier={holder.dataQualityTier}
          cycles={holder.completedCycleCount}
        />
      </TableCell>
    </TableRow>
  ))}
</HolderProfilesTable>
```

**Data Quality Badge:**
```tsx
function DataQualityBadge({ tier, cycles }) {
  const config = {
    HIGH: { color: 'green', label: 'High', icon: '✓' },
    MEDIUM: { color: 'yellow', label: 'Medium', icon: '~' },
    LOW: { color: 'orange', label: 'Low', icon: '!' },
    INSUFFICIENT: { color: 'red', label: 'Insufficient', icon: '✗' }
  };

  const { color, label, icon } = config[tier];

  return (
    <Tooltip content={`${cycles} completed cycles`}>
      <Badge variant={color}>
        {icon} {label}
      </Badge>
    </Tooltip>
  );
}
```

---

## Implementation Checklist

### Day 1: Backend Service (6-8h) - ✅ COMPLETED (2025-11-12)

- [x] ~~Create `HolderProfileService`~~ Used job-based processor pattern instead
- [x] Implement `batchFetchSwapRecords()` - single query for all wallets (analysis-operations.processor.ts:680-687)
- [x] ~~Implement `getTokenHolderProfiles()` - orchestrator~~ Implemented as `processAnalyzeHolderProfiles()` job handler
- [x] Implement `analyzeWalletProfile()` - per-wallet analysis (analysis-operations.processor.ts:824-922)
- [x] Implement `calculateDailyFlipRatio()` - NEW metric (analysis-operations.processor.ts:947-974)
- [x] Implement `determineDataQualityTier()` - GOLD/SILVER/BRONZE/INSUFFICIENT (analysis-operations.processor.ts:983-990)
- [x] Add performance tracking (processing time per wallet) - included in response
- [x] Use `Promise.all()` for parallel wallet analysis (analysis-operations.processor.ts:719)
- [x] Unit test for quality tiers and flip ratio - validated with real tokens

### Day 2: API Endpoint (4h) - ✅ COMPLETED (2025-11-12)

- [x] ~~Create `HolderProfileController`~~ Extended existing `AnalysesController`
- [x] Endpoint: `POST /api/v1/analyses/holder-profiles` (async job-based pattern)
- [x] Add to `ApiModule` (providers + controllers) - used existing queue infrastructure
- [x] Create response DTOs - `HolderProfilesResult`, `HolderProfile` types
- [x] Test with curl on 3 tokens (fast, slow, no data) - validated during implementation
- [x] Verify batch query optimization (check SQL logs) - single query for all wallets
- [x] Verify parallel processing (should be ~10x faster than sequential) - confirmed with Promise.all()

### Day 3: Dashboard UI (6h) - ✅ COMPLETED (2025-11-12)

- [x] Create page: `dashboard/src/app/tools/holder-profiles/page.tsx`
- [x] Create `HolderProfilesTable` component
  - [x] Show wallet, rank, supply %
  - [x] Show median, avg, flip ratio (or "No Data")
  - [x] Show data quality badge with tooltip
  - [x] Show processing time per wallet
- [x] Create `DataQualityBadge` component
- [x] Create `useHolderProfiles` hook
- [x] Add TypeScript types
- [x] Handle loading states
- [x] Handle errors gracefully

### Day 4: Caching & Optimization (2-4h) - ✅ COMPLETED (2025-11-12)

- [x] **Implement Redis caching for holder profiles** (2025-11-12)
  - [x] Create `HolderProfilesCacheService` (src/api/services/holder-profiles-cache.service.ts)
  - [x] Add cache checks in processor (before analysis)
  - [x] Add cache storage (after successful analysis)
  - [x] Add cache invalidation in `WalletOperationsProcessor` (after wallet sync)
  - [x] Add cache invalidation in `AnalysisOperationsProcessor` (after behavior analysis)
  - [x] Create `HolderProfilesCacheModule`
  - [x] Add module imports to `QueueModule`
- [x] Test with 5 real tokens
- [x] Test edge cases:
  - [x] All holders have insufficient data
  - [x] Mix of GOLD/SILVER/BRONZE/INSUFFICIENT
  - [x] Very slow wallets (500k+ transactions)
- [x] Verify performance:
  - [x] Total time <15s for 10 holders
  - [x] No N+1 queries (check DB logs)
  - [x] Parallel processing working
- [x] Add performance monitoring to logs
- [x] Document API in Swagger

---

## Key Optimizations

1. ✅ **Batch DB fetch** - Single query for all wallets (not N queries)
2. ✅ **Parallel processing** - `Promise.all()` for wallet analysis
3. ✅ **Top 10 only** - Not 20-50 (faster, more relevant)
4. ✅ **Performance tracking** - Know which wallets are slow
5. ✅ **Transparent data quality** - Users know when data is insufficient
6. ✅ **Reuse existing services** - TokenHoldersService, BehaviorAnalyzer
7. ✅ **Redis caching** (2025-11-12) - 2 min TTL with smart invalidation (prevents stale data)

---

## After Phase 3
- **Phase 2B**: Add validation infrastructure (store predictions, track accuracy)
- **Phase 4**: Add Token Death Meter (aggregate predictions)

---

## Caching Implementation (2025-11-12, Enhanced 2025-12-01)

### Overview

**Challenge**: Holder profile analysis is expensive (10 wallets × behavior analysis = 5-15 seconds). Without caching, every page load would trigger full re-analysis.

**Solution**: Two-tier caching with smart freshness checks (evolved from original 2-min Redis plan).

### Architecture

**Tier 1: Redis (Hot Cache)**
- **TTL**: 1 hour (auto-eviction)
- **Response Time**: <50ms
- **Cache Key**: `holder-profiles:{tokenMint}:{topN}` or `holder-profiles:wallet:{address}`
- **Storage**: Complete `HolderProfilesResult` objects

**Tier 2: PostgreSQL (Persistent Cache)**
- **Table**: `HolderProfileSnapshot` (JSONB column for profile data)
- **TTL**: Until wallet re-syncs (smart freshness check)
- **Response Time**: 100-200ms
- **Storage**: Individual `HolderProfile` records
- **Freshness Logic**: `snapshot.computedAt >= wallet.lastSuccessfulFetchTimestamp`

**Cache Flow** (10 holders requested):
1. Check Tier 1 → Full result? → Return immediately (<50ms)
2. Check Tier 2 → Fetch 10 snapshots → 7 fresh, 3 stale
3. Stream 7 cached profiles to frontend immediately
4. Compute 3 missing → Save to Tier 2 → Stream to frontend
5. Cache complete result in Tier 1 for next request

**Performance**:
- Cold: 5-15s (full analysis)
- Tier 1 hit: <50ms (100-300x faster)
- Tier 2 partial: 2-5s (7 instant + 3 computed)

### Implementation

**File**: `src/api/services/holder-profiles-cache.service.ts`

**Key Methods**:
- `getTokenResult()` / `cacheTokenResult()` - Tier 1 token-level caching
- `getWalletResult()` / `cacheWalletResult()` - Tier 1 wallet-level caching
- `getTokenSnapshots()` / `getWalletSnapshot()` - Tier 2 snapshot retrieval
- `saveSnapshot()` - Tier 2 snapshot persistence
- `hydrateSnapshot()` - Convert DB snapshot to `HolderProfile` object

## Time Window Filters (Phase 5 - NOT YET IMPLEMENTED)

### Design Proposal for 7d / 30d / All-Time Filters

**Goal**: Show behavioral drift (e.g., "was holder 30d ago, now flipper 7d ago")

---

### Architecture Design

#### API Extension
```typescript
POST /api/v1/analyses/holder-profiles
{
  tokenMint: "So11...",
  topN: 10,
  timeWindow?: "7d" | "30d" | "all-time"  // Optional, defaults to "all-time"
}
```

#### Type Extension
```typescript
export interface HolderProfile {
  // Existing fields (all-time by default)
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  behaviorType: string | null;

  // NEW: Time window breakdown (optional)
  timeWindowMetrics?: {
    '7d': {
      medianHoldTimeHours: number | null;
      avgHoldTimeHours: number | null;
      behaviorType: string | null;
      completedCycleCount: number;
      dataQuality: number;
    };
    '30d': { /* same structure */ };
    'all-time': { /* same structure */ };
  };
}
```

#### Cache Strategy

**Tier 1 (Redis)**: Window-specific cache keys
```
holder-profiles:token:So11...:10:7d       → TTL 1h
holder-profiles:token:So11...:10:30d      → TTL 1h
holder-profiles:token:So11...:10:all-time → TTL 1h
```

**Tier 2 (PostgreSQL)**: Single snapshot with all windows
```sql
-- HolderProfileSnapshot.data (JSONB column)
{
  "walletAddress": "abc...",
  "medianHoldTimeHours": 2.5,  -- Default all-time
  "timeWindowMetrics": {
    "7d": { "median": 0.5, "avg": 1.2, "behaviorType": "FLIPPER", "cycles": 5 },
    "30d": { "median": 1.8, "avg": 3.5, "behaviorType": "SWING", "cycles": 15 },
    "all-time": { "median": 2.5, "avg": 5.0, "behaviorType": "SWING", "cycles": 50 }
  }
}
```

**Benefit**: Single DB row stores all 3 windows, no storage bloat

---

### Compute Strategy

**Option 1: Compute on-the-fly** ❌ NOT RECOMMENDED
```typescript
// Filter swap records by date range on every request
calculateHistoricalPattern(
  swapRecords.filter(r => r.timestamp > now - 7days),
  wallet
)
```
- **Pros**: No DB changes, flexible
- **Cons**: 3x compute on every read (terrible UX + server load)

**Option 2: Pre-compute during analysis** ✅ RECOMMENDED
```typescript
// During holder profile analysis, compute all 3 windows
const metrics7d = calculateHistoricalPattern(
  swapRecords.filter(r => r.timestamp > now - 7days), wallet
);  // ~30ms

const metrics30d = calculateHistoricalPattern(
  swapRecords.filter(r => r.timestamp > now - 30days), wallet
);  // ~60ms

const metricsAllTime = calculateHistoricalPattern(
  swapRecords, wallet
);  // ~100ms

// Store all 3 in HolderProfile.timeWindowMetrics
// Total: ~190ms vs 100ms = +90ms per wallet
```

**Compute Impact**:
- **Per wallet**: +90ms (+90% compute during analysis)
- **10 wallets**: +900ms = 12s → 13s total (+8% job time)
- **Read time**: 0ms (pre-computed, instant window switching)

**Trade-off**: 8% slower analysis for instant UI responsiveness ✅ **Worth it**

---

### Frontend Display Options

#### Option A: Tabs (Simple)
```tsx
<Tabs defaultValue="all-time">
  <Tab value="7d">Last 7 Days</Tab>
  <Tab value="30d">Last 30 Days</Tab>
  <Tab value="all-time">All Time</Tab>
</Tabs>

<TabContent value="7d">
  <HolderProfilesTable data={profiles} window="7d" />
</TabContent>
```

#### Option B: Inline Comparison (Better UX)
```tsx
<HolderProfileRow>
  <WalletCell>abc...123</WalletCell>
  <BehaviorCell>
    <div className="text-xs space-y-1">
      <div>7d: <Badge color="red">FLIPPER</Badge> 0.5h</div>
      <div>30d: <Badge color="yellow">SWING</Badge> 1.8h</div>
      <div>All: <Badge color="green">SWING</Badge> 2.5h</div>
    </div>
    {/* Visual indicator: 🔴 Becoming faster */}
  </BehaviorCell>
</HolderProfileRow>
```

#### Option C: Trend Graph (Best UX)
```tsx
<MiniSparkline
  data={[
    { label: '7d', value: 0.5 },
    { label: '30d', value: 1.8 },
    { label: 'All', value: 2.5 }
  ]}
  trend="down"  // Becoming faster = red indicator
/>
```

---

### Implementation Steps (When Needed)

1. **Backend** (2-3 hours):
   - Extend `HolderProfile` type with `timeWindowMetrics` field
   - Update `analyzeWalletProfile()` to compute 3 windows
   - Modify cache keys to include window parameter
   - Update Tier 2 snapshot storage to save all 3 windows

2. **Frontend** (2-3 hours):
   - Add time window selector (tabs or dropdown)
   - Update table to show time-specific metrics
   - Add drift indicators (color coding for behavioral changes)
   - Optional: Add mini trend graphs

3. **Testing** (1 hour):
   - Verify 3 windows compute correctly
   - Test cache invalidation per window
   - Validate UI displays all windows
   - Check performance impact (<15s for 10 wallets)

**Total Estimate**: 5-7 hours

---

### Business Value

**Enables**:
- Behavioral drift detection ("was holder, now flipper")
- Early dump warning ("50% of holders flipping faster in last 7d")
- Wallet filtering ("show only wallets trending toward dumping")
- Risk alerts ("3 major holders changed to FLIPPER pattern")

**Priority**: Low (nice-to-have, not blocking current features)

**Decision**: Deferred until user feedback indicates need

---



## Current Data Flow (Complete Pipeline)

```
1. POST /api/v1/analyses/holder-profiles/wallet
   → AnalysisOperationsQueue.add('analyze-holder-profiles', {walletAddress})

2. AnalysisOperationsProcessor.processAnalyzeHolderProfiles()
   ├─ Sync wallet (HeliusSyncService)
   │  └─ Helius TX cache → SwapAnalysisInput table
   │
   ├─ Aggregate PnL (PnlAnalysisService) ← NEW STEP
   │  └─ SwapAnalysisInput → AnalysisResult table
   │
   └─ Analyze behavior (BehaviorService)
      ├─ Query AnalysisResult for PnL map
      ├─ BehaviorAnalyzer.calculateHistoricalPattern(swapRecords, wallet, pnlMap)
      │  ├─ Build token lifecycles
      │  ├─ Calculate hold time distribution (8 buckets)
      │  ├─ Map tokens to buckets
      │  └─ Calculate enriched distribution with WR/ROI per bucket
      └─ Save to WalletBehaviorProfile (includes enrichedHoldTimeDistribution)

3. Frontend fetches cached result
   → HolderProfile includes enrichedHoldTimeDistribution
   → WalletBaseballCard displays WR/ROI per bucket
```


## References

- Main documentation: `docs/3.metrics_compact_map.md` (Holding Time Methodology section)
- Current implementation: `src/core/analysis/behavior/analyzer.ts`
- Test examples: `src/core/analysis/behavior/test-fifo-holding-time.ts`
- Config types: `src/types/analysis.ts`
