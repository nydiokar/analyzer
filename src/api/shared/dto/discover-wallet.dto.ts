import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

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
    enum: ['flipper', 'swing', 'position', 'holder', 'scalper', 'sniper'],
    description: 'Filter by cached tradingStyle classification.',
  })
  @IsOptional()
  @IsIn(['flipper', 'swing', 'position', 'holder', 'scalper', 'sniper'])
  style?: string;

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
}

export class DiscoverWalletMetricsDto {
  @ApiProperty({ required: false, nullable: true })
  realizedPnl?: number | null;

  @ApiProperty({ required: false, nullable: true })
  winRatePercent?: number | null;

  @ApiProperty({ required: false, nullable: true })
  totalTrades?: number | null;

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
