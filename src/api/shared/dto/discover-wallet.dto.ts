import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class DiscoverWalletsQueryDto {
  @ApiProperty({
    required: false,
    enum: ['interesting', 'most_active', 'best_pnl', 'longest_holders', 'recently_updated'],
    description: 'Sorting mode. Defaults to interesting (activity, pnl, recency).',
  })
  @IsOptional()
  @IsIn(['interesting', 'most_active', 'best_pnl', 'longest_holders', 'recently_updated'])
  sort?: string;

  @ApiProperty({
    required: false,
    enum: ['all', '30d', '7d'],
    description: 'Timeframe filter if precomputed metrics exist. Defaults to all.',
  })
  @IsOptional()
  @IsIn(['all', '30d', '7d'])
  timeframe?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 24, minimum: 10, maximum: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  pageSize?: number = 24;

  @ApiProperty({ required: false, description: 'Minimum total trades to include a wallet.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minTradeCount?: number;

  @ApiProperty({
    required: false,
    description: 'Minimum unique tokens traded (behavior profile).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minUniqueTokens?: number;

  @ApiProperty({
    required: false,
    enum: ['FAST_TRADER', 'DAY_TRADER', 'SWING_TRADER', 'POSITION_TRADER', 'PURE_HOLDER', 'ACCUMULATOR', 'DISTRIBUTOR', 'BALANCED_TRADER', 'LOW_ACTIVITY'],
    description: 'Filter by strategy type (exact enum match on strategyType field).',
  })
  @IsOptional()
  @IsIn(['FAST_TRADER', 'DAY_TRADER', 'SWING_TRADER', 'POSITION_TRADER', 'PURE_HOLDER', 'ACCUMULATOR', 'DISTRIBUTOR', 'BALANCED_TRADER', 'LOW_ACTIVITY'])
  style?: string;

  @ApiProperty({
    required: false,
    enum: ['SNIPER', 'SCALPER', 'MOMENTUM', 'INTRADAY', 'DAY_TRADER', 'SWING', 'POSITION', 'HODLER'],
    description: 'Filter by speed category (exit timing).',
  })
  @IsOptional()
  @IsIn(['SNIPER', 'SCALPER', 'MOMENTUM', 'INTRADAY', 'DAY_TRADER', 'SWING', 'POSITION', 'HODLER'])
  speedCategory?: string;

  @ApiProperty({
    required: false,
    enum: ['BUY_ONLY', 'SELL_ONLY', 'ACCUMULATOR', 'DISTRIBUTOR', 'BALANCED', 'MIXED'],
    description: 'Filter by flow pattern (buy/sell behavior).',
  })
  @IsOptional()
  @IsIn(['BUY_ONLY', 'SELL_ONLY', 'ACCUMULATOR', 'DISTRIBUTOR', 'BALANCED', 'MIXED'])
  flowPattern?: string;

  @ApiProperty({
    required: false,
    enum: ['short', 'medium', 'long'],
    description: 'Hold-bias based on medianHoldTime (short <12h, medium 12-72h, long >72h).',
  })
  @IsOptional()
  @IsIn(['short', 'medium', 'long'])
  holdBias?: string;

  @ApiProperty({
    required: false,
    description: 'Filter out wallets whose summaries are older than this many hours.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minFreshnessHours?: number;

  @ApiProperty({
    required: false,
    description: 'Minimum trading velocity score (0-100).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minVelocity?: number;

  @ApiProperty({
    required: false,
    description: 'Maximum trading velocity score (0-100).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxVelocity?: number;
}

export class DiscoverWalletMetricsDto {
  @ApiProperty({ required: false, nullable: true })
  realizedPnl?: number | null;

  @ApiProperty({ required: false, nullable: true })
  unrealizedPnl?: number | null;

  @ApiProperty({ required: false, nullable: true })
  winRatePercent?: number | null;

  @ApiProperty({ required: false, nullable: true })
  totalTrades?: number | null;

  @ApiProperty({ required: false, nullable: true })
  totalBuys?: number | null;

  @ApiProperty({ required: false, nullable: true })
  totalSells?: number | null;

  @ApiProperty({ required: false, nullable: true })
  totalExecutedSwaps?: number | null;

  @ApiProperty({ required: false, nullable: true })
  averageHoldHours?: number | null;

  @ApiProperty({ required: false, nullable: true })
  medianHoldHours?: number | null;

  @ApiProperty({ required: false, nullable: true })
  uniqueTokensTraded?: number | null;

  @ApiProperty({ required: false, nullable: true })
  tradingStyle?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Speed category (SNIPER, SCALPER, etc. or null if no exits)' })
  speedCategory?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Flow pattern (BUY_ONLY, ACCUMULATOR, etc.)' })
  flowPattern?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Strategy type (canonical filter)' })
  strategyType?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Trading velocity score (0-100, higher = faster rotation)' })
  velocityScore?: number | null;

  // NEW: Behavioral detail metrics for data-driven storytelling (2025-12-26)
  @ApiProperty({ required: false, nullable: true, description: 'Buy/sell ratio (buys/sells count)' })
  buySellRatio?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Percentage of tokens with incomplete buy/sell cycles (spam/dust indicator)' })
  percentageOfUnpairedTokens?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Buy/sell symmetry score (0-1, balance indicator)' })
  buySellSymmetry?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Sequence consistency score (0-1, pattern indicator)' })
  sequenceConsistency?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Exit pattern type (GRADUAL or ALL_AT_ONCE)' })
  exitPattern?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Percentage of value still held in current positions' })
  percentOfValueInCurrentHoldings?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Median current holding duration in hours' })
  medianCurrentHoldingDurationHours?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Current SOL balance in wallet' })
  currentSolBalance?: number | null;

  @ApiProperty({ required: false, nullable: true })
  lastActiveAt?: string | null;

  @ApiProperty({ required: false, nullable: true })
  pnlUpdatedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  behaviorUpdatedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  stalenessMinutes?: number | null;
}

export class DiscoverWalletDto {
  @ApiProperty()
  walletAddress!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  reasonCode!: string;

  @ApiProperty({ required: false, nullable: true })
  lastUpdatedAt?: Date | null;

  @ApiProperty({ type: DiscoverWalletMetricsDto })
  metrics!: DiscoverWalletMetricsDto;
}

export class DiscoverWalletsResponseDto {
  @ApiProperty({ type: [DiscoverWalletDto] })
  items!: DiscoverWalletDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  sort!: string;

  @ApiProperty({ required: false })
  timeframe?: string;
}

export class DiscoverAggregationDistributionDto {
  @ApiProperty()
  category?: string;

  @ApiProperty()
  pattern?: string;

  @ApiProperty()
  count!: number;

  @ApiProperty()
  totalPnl!: number;

  @ApiProperty()
  percentage!: number;
}

export class DiscoverAggregationResponseDto {
  @ApiProperty({ type: [DiscoverAggregationDistributionDto] })
  speedDistribution!: Array<{ category: string; count: number; totalPnl: number; percentage: number }>;

  @ApiProperty({ type: [DiscoverAggregationDistributionDto] })
  flowDistribution!: Array<{ pattern: string; count: number; totalPnl: number; percentage: number }>;

  @ApiProperty()
  total!: number;
}
