import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SigBuyersQueryDto {
  @ApiProperty({ description: 'Token mint address' })
  @IsString()
  mint: string;

  @ApiProperty({ description: 'Start time as Unix timestamp (seconds)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  startTime: number;

  @ApiProperty({ description: 'End time as Unix timestamp (seconds)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  endTime: number;

  @ApiPropertyOptional({ description: 'Minimum SOL spent to qualify', default: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minSolSpent?: number;

  @ApiPropertyOptional({ description: 'Max transactions to process', default: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50000)
  maxTransactions?: number;
}

export interface SigBuyerResult {
  walletAddress: string;
  solSpent: number;
  solReceived: number;
  netPnl: number;
  transactionCount: number;
  firstTransactionAt: string;
  lastTransactionAt: string;
}

export interface SigBuyersResponseDto {
  mint: string;
  startTime: number;
  endTime: number;
  minSolSpent: number;
  totalTransactionsFetched: number;
  totalWalletsFound: number;
  qualifyingWallets: number;
  buyers: SigBuyerResult[];
  durationMs: number;
}
