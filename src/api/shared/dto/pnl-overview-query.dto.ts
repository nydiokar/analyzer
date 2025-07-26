import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsISO8601 } from 'class-validator';

export class PnlOverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Optional start date for the PNL overview period (ISO 8601 format).',
    example: '2023-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Optional end date for the PNL overview period (ISO 8601 format).',
    example: '2023-01-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
} 