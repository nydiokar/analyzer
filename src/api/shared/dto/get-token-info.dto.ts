import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class GetTokenInfoRequestDto {
  @ApiProperty({
    description: 'An array of token mint addresses to fetch information for.',
    type: [String],
    example: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uHod', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'],
  })
  @IsArray()
  @IsString({ each: true })
  tokenAddresses: string[];
} 