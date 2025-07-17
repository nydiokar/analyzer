import { IsArray, IsIn, IsOptional, IsString, ArrayNotEmpty, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimilarityAnalysisRequestDto {
  @ApiProperty({
    description: 'An array of wallet addresses to be compared.',
    type: [String],
    example: ['5LEhdhS7aP8vW2gD12c2a3ZjK3Y6f7gH9jM8b6N2k3d4', 'GyqKuTj3bF5c6dE7f8gH9jM8b6N2k3d4c2a3ZjK3Y6f7'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(2)
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
}