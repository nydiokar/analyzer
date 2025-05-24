import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min, IsDateString } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

// Add more valid sortable fields as needed from AnalysisResult model
export enum TokenPerformanceSortBy {
  TOKEN_ADDRESS = 'tokenAddress',
  NET_SOL_PROFIT_LOSS = 'netSolProfitLoss',
  TOTAL_SOL_SPENT = 'totalSolSpent',
  TOTAL_SOL_RECEIVED = 'totalSolReceived',
  NET_AMOUNT_CHANGE = 'netAmountChange',
  LAST_TRANSFER_TIMESTAMP = 'lastTransferTimestamp',
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
} 