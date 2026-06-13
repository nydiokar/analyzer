import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class SolPriceDto {
  @ApiProperty({ description: 'UTC calendar date for the SOL/USD price.', example: '2026-06-13' })
  date!: string;

  @ApiProperty({ description: 'SOL/USD price for the date.', example: 67.84 })
  priceUsd!: number;

  @ApiProperty({ description: 'Timestamp when this row was fetched or refreshed.' })
  fetchedAt!: Date;
}

export class SolPriceRangeQueryDto {
  @ApiProperty({
    description: 'Inclusive UTC start date in YYYY-MM-DD format.',
    example: '2026-06-01',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({
    description: 'Inclusive UTC end date in YYYY-MM-DD format.',
    example: '2026-06-13',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class SolPriceRangeResponseDto {
  @ApiProperty({ description: 'Inclusive UTC start date.', example: '2026-06-01' })
  from!: string;

  @ApiProperty({ description: 'Inclusive UTC end date.', example: '2026-06-13' })
  to!: string;

  @ApiProperty({ description: 'Number of returned price rows.', example: 13 })
  count!: number;

  @ApiProperty({ type: [SolPriceDto] })
  prices!: SolPriceDto[];
}

export class LatestSolPriceQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum age of the latest stored row in hours.',
    default: 48,
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  @Matches(/^\d+$/)
  maxAgeHours?: string;
}
