import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, ArrayMaxSize, ArrayMinSize, IsString } from 'class-validator';
import type { DashboardAnalysisScope } from '../../../shared/dashboard-analysis.types';

export class BatchAnalyzeFavoritesDto {
  @ApiProperty({
    description: 'Wallet addresses to analyze (max 20)',
    type: [String],
    example: ['So11111111111111111111111111111111111111112'],
    minItems: 1,
    maxItems: 20,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  walletAddresses: string[];

  @ApiProperty({
    description: 'Analysis scope (flash for quick refresh, working for 30d, deep for full history)',
    enum: ['flash', 'working', 'deep'],
    example: 'deep',
  })
  @IsEnum(['flash', 'working', 'deep'])
  scope: DashboardAnalysisScope;
}
