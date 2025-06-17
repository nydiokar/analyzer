import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min, IsDateString, IsBoolean, IsString, IsNumber, Allow } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

// Add more valid sortable fields as needed from AnalysisResult model
export enum TokenPerformanceSortBy {
  TOKEN_ADDRESS = 'tokenAddress',
  NET_SOL_PROFIT_LOSS = 'netSolProfitLoss',
  ROI = 'roi',
  TOTAL_SOL_SPENT = 'totalSolSpent',
  TOTAL_SOL_RECEIVED = 'totalSolReceived',
  NET_AMOUNT_CHANGE = 'netAmountChange',
  LAST_TRANSFER_TIMESTAMP = 'lastTransferTimestamp',
}

export enum SpamFilterType {
  ALL = 'all',
  SAFE = 'safe',
  WARNING = 'warning',
  HIGH_RISK = 'high-risk',
  UNKNOWN = 'unknown',
}

export class TokenPerformanceQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination.',
    default: 1,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page.',
    default: 20,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // Max items per page
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: 'Field to sort by.',
    enum: TokenPerformanceSortBy,
    default: TokenPerformanceSortBy.NET_SOL_PROFIT_LOSS,
  })
  @IsOptional()
  @IsEnum(TokenPerformanceSortBy)
  sortBy?: TokenPerformanceSortBy = TokenPerformanceSortBy.NET_SOL_PROFIT_LOSS;

  @ApiPropertyOptional({
    description: 'Sort order (ASC or DESC).',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({
    description: 'Start date for the time range (ISO 8601 format).',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for the time range (ISO 8601 format).',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'If true, only shows tokens with a current SPL balance greater than 0.',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showOnlyHoldings?: boolean = false;

  @ApiPropertyOptional({
    description: 'Search term to filter tokens by address or symbol (if available).',
    type: String,
  })
  @IsOptional()
  @IsString()
  searchTerm?: string;

  @ApiPropertyOptional({
    description: 'PNL condition operator (e.g., \">\", \"<\"). Use with pnlConditionValue.',
    type: String,
    example: '>',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['gt', 'lt', 'gte', 'lte', 'eq']) // Allow common operators
  pnlConditionOperator?: string;

  @ApiPropertyOptional({
    description: 'PNL condition value. Use with pnlConditionOperator.',
    type: Number,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pnlConditionValue?: number;

  @ApiPropertyOptional({
    description: 'Minimum number of trades (in+out). Filters for tokens with total trades >= this value.',
    type: Number,
    example: 2,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minTrades?: number;

  @ApiPropertyOptional({
    description: 'Filter tokens by spam risk level.',
    enum: SpamFilterType,
    default: SpamFilterType.ALL,
  })
  @IsOptional()
  @IsEnum(SpamFilterType)
  spamFilter?: SpamFilterType = SpamFilterType.ALL;
} 