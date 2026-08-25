import { IsArray, IsIn, IsOptional, IsString, ArrayNotEmpty, ArrayMinSize, ArrayMaxSize, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimilarityAnalysisRequestDto {
  @ApiProperty({
    description: 'An array of wallet addresses to be compared. Regular users: max 50. Owner: max 200.',
    type: [String],
    example: ['5LEhdhS7aP8vW2gD12c2a3ZjK3Y6f7gH9jM8b6N2k3d4', 'GyqKuTj3bF5c6dE7f8gH9jM8b6N2k3d4c2a3ZjK3Y6f7'],
    minItems: 2,
    maxItems: 200,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(2)
  @ArrayMaxSize(200) // Hard cap at DTO layer; controller enforces 30 for non-owner users
  @IsString({ each: true })
  walletAddresses: string[];

  @ApiProperty({
    description: 'The type of vector to use for the similarity analysis.',
    enum: ['capital', 'binary'],
    required: false,
    example: 'capital',
  })
  @IsOptional()
  @IsIn(['capital', 'binary'])
  vectorType?: 'capital' | 'binary';

  @ApiProperty({
    description: 'Include full wallet balances in the response payload (heavy).',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeBalances?: boolean;

  @ApiProperty({
    description: 'Include raw wallet vectors in the response payload (very heavy).',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeVectors?: boolean;

  @ApiProperty({
    description: 'Queue background token enrichment for similarity results.',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enrichMetadata?: boolean;
}
