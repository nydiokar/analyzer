import { ApiProperty } from '@nestjs/swagger';
// Assuming BehavioralMetrics, IdentifiedTradingWindow, TokenMetrics, ActiveTradingPeriods are correctly exported from a path like below
// and that this path is resolvable from the new DTO file's location.
// The exact path might need adjustment based on the project structure.
import { BehavioralMetrics, IdentifiedTradingWindow as IIdentifiedTradingWindow, ActiveTradingPeriods as IActiveTradingPeriods } from '../../../types/behavior';
import { TokenMetrics as ITokenMetrics } from '../../../types/analysis';

// Sub-DTOs for nested structures

export class IdentifiedTradingWindowDto implements IIdentifiedTradingWindow {
  @ApiProperty({ description: 'Start hour of the window (0-23 UTC)' })
  startTimeUTC: number;

  @ApiProperty({ description: 'End hour of the window (0-23 UTC), inclusive' })
  endTimeUTC: number;

  @ApiProperty({ description: 'Duration of the window in hours' })
  durationHours: number;

  @ApiProperty({ description: 'Total trades within this window' })
  tradeCountInWindow: number;

  @ApiProperty({ description: 'Percentage of the user\'s total trades that fall into this window' })
  percentageOfTotalTrades: number;

  @ApiProperty({ description: 'Average trades per hour within this window' })
  avgTradesPerHourInWindow: number;
}

export class ActiveTradingPeriodsDto implements IActiveTradingPeriods {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, description: 'Raw trade counts for each UTC hour (0-23)' })
  hourlyTradeCounts: Record<number, number>;

  @ApiProperty({ type: [IdentifiedTradingWindowDto], description: 'Array of dynamically identified significant trading windows' })
  identifiedWindows: IdentifiedTradingWindowDto[];

  @ApiProperty({ description: 'Metric (0-1) indicating how concentrated trades are' })
  activityFocusScore: number;
}

export class TradingTimeDistributionDto {
  @ApiProperty()
  ultraFast: number;
  @ApiProperty()
  veryFast: number;
  @ApiProperty()
  fast: number;
  @ApiProperty()
  moderate: number;
  @ApiProperty()
  dayTrader: number;
  @ApiProperty()
  swing: number;
  @ApiProperty()
  position: number;
}

export class TradingFrequencyDto {
  @ApiProperty()
  tradesPerDay: number;
  @ApiProperty()
  tradesPerWeek: number;
  @ApiProperty()
  tradesPerMonth: number;
}

export class TokenMetricsDto implements ITokenMetrics {
    @ApiProperty()
    mint: string;
    @ApiProperty()
    count: number;
    @ApiProperty({ required: false })
    totalValue?: number;
    @ApiProperty({ required: false })
    firstSeen?: number;
    @ApiProperty({ required: false })
    lastSeen?: number;
}


export class TokenPreferencesDto {
  @ApiProperty({ type: [TokenMetricsDto] })
  mostTradedTokens: TokenMetricsDto[];
  @ApiProperty({ type: [TokenMetricsDto], description: "Initially 'mostHeld', re-evaluation of this metric is pending as per docs/2. metrics_map.md" })
  mostHeld: TokenMetricsDto[]; // mostHeld might be revised/removed as per metrics_map
}

export class RiskMetricsDto {
  @ApiProperty()
  averageTransactionValueSol: number;
  @ApiProperty()
  largestTransactionValueSol: number;
}

// ✅ NEW: Trading interpretation (2025-11-17)
export class TradingInterpretationDto {
  @ApiProperty({ description: 'Speed classification based on median hold time' })
  speedCategory: 'ULTRA_FLIPPER' | 'FLIPPER' | 'FAST_TRADER' | 'DAY_TRADER' | 'SWING_TRADER' | 'POSITION_TRADER';

  @ApiProperty({ description: 'Typical holding time in hours (median - outlier robust)' })
  typicalHoldTimeHours: number;

  @ApiProperty({ description: 'Economic holding time in hours (weighted average - position size matters)' })
  economicHoldTimeHours: number;

  @ApiProperty({ description: 'Economic risk level based on weighted average hold time' })
  economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  @ApiProperty({ description: 'Behavioral pattern (buy/sell activity)' })
  behavioralPattern: 'BALANCED' | 'ACCUMULATOR' | 'DISTRIBUTOR' | 'HOLDER' | 'DUMPER' | 'MIXED';

  @ApiProperty({ description: 'Human-readable interpretation' })
  interpretation: string;
}

// ✅ NEW: Historical pattern from completed positions (2025-11-17)
export class HistoricalPatternDto {
  @ApiProperty({ description: 'Wallet address (redundant in context, included for interface compliance)' })
  walletAddress: string;

  @ApiProperty({ description: 'Weighted average holding time from completed positions (hours)' })
  historicalAverageHoldTimeHours: number;

  @ApiProperty({ description: 'Number of completed token cycles (sample size)' })
  completedCycleCount: number;

  @ApiProperty({ description: 'Median holding time from completed positions only (hours)' })
  medianCompletedHoldTimeHours: number;

  @ApiProperty({ description: 'Behavior classification' })
  behaviorType: 'ULTRA_FLIPPER' | 'FLIPPER' | 'SWING' | 'HOLDER';

  @ApiProperty({ description: 'Exit pattern' })
  exitPattern: 'GRADUAL' | 'ALL_AT_ONCE';

  @ApiProperty({ description: 'Data quality score (0-1)' })
  dataQuality: number;

  @ApiProperty({ description: 'Observation period in days' })
  observationPeriodDays: number;
}

// Main DTO
export class BehaviorAnalysisResponseDto implements BehavioralMetrics {
  @ApiProperty()
  buySellRatio: number;
  @ApiProperty()
  buySellSymmetry: number;
  @ApiProperty({ description: '⚠️ DEPRECATED: Use historicalPattern.historicalAverageHoldTimeHours instead' })
  averageFlipDurationHours: number;
  @ApiProperty({ description: '⚠️ DEPRECATED: Use historicalPattern.medianCompletedHoldTimeHours instead' })
  medianHoldTime: number;
  @ApiProperty()
  sequenceConsistency: number;
  @ApiProperty()
  flipperScore: number;
  @ApiProperty()
  uniqueTokensTraded: number;
  @ApiProperty()
  tokensWithBothBuyAndSell: number;
   @ApiProperty()
  tokensWithOnlyBuys: number;
   @ApiProperty()
  tokensWithOnlySells: number;
  @ApiProperty()
  totalTradeCount: number;
  @ApiProperty()
  totalBuyCount: number;
  @ApiProperty()
  totalSellCount: number;
  @ApiProperty()
  completePairsCount: number;
  @ApiProperty()
  averageTradesPerToken: number;
  @ApiProperty({ type: TradingTimeDistributionDto })
  tradingTimeDistribution: TradingTimeDistributionDto;
  @ApiProperty()
  percentTradesUnder1Hour: number;
  @ApiProperty()
  percentTradesUnder4Hours: number;
  @ApiProperty()
  tradingStyle: string;
  @ApiProperty()
  confidenceScore: number;
  @ApiProperty({ type: TradingFrequencyDto })
  tradingFrequency: TradingFrequencyDto;
  @ApiProperty({ type: TokenPreferencesDto })
  tokenPreferences: TokenPreferencesDto;
  @ApiProperty({ type: RiskMetricsDto })
  riskMetrics: RiskMetricsDto;
  @ApiProperty()
  reentryRate: number;
  @ApiProperty()
  percentageOfUnpairedTokens: number;
  @ApiProperty()
  sessionCount: number;
  @ApiProperty()
  avgTradesPerSession: number;
  @ApiProperty({ type: ActiveTradingPeriodsDto })
  activeTradingPeriods: ActiveTradingPeriodsDto;
  @ApiProperty()
  averageSessionStartHour: number;
  @ApiProperty()
  averageSessionDurationMinutes: number;
  @ApiProperty({ required: false })
  firstTransactionTimestamp?: number;
  @ApiProperty({ required: false })
  lastTransactionTimestamp?: number;
  @ApiProperty()
  averageCurrentHoldingDurationHours: number;
  @ApiProperty()
  medianCurrentHoldingDurationHours: number;
  @ApiProperty({ description: '⚠️ DEPRECATED: Use historicalPattern.historicalAverageHoldTimeHours instead' })
  weightedAverageHoldingDurationHours: number;
  @ApiProperty()
  percentOfValueInCurrentHoldings: number;

  // ✅ NEW: Rich interpretation fields (2025-11-17)
  @ApiProperty({ type: TradingInterpretationDto, required: false, description: 'Rich trading interpretation with dual analysis (speed vs economic)' })
  tradingInterpretation?: TradingInterpretationDto;

  @ApiProperty({ type: HistoricalPatternDto, required: false, description: 'Historical pattern from completed positions only' })
  historicalPattern?: HistoricalPatternDto;
} 