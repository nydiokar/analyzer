import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class TriggerAnalysisDto {
  @ApiProperty({
    description: 'A list of Solana wallet addresses to analyze.',
    type: [String],
    example: ['ADDRESS_1', 'ADDRESS_2'],
  })
  @IsArray()
  @IsString({ each: true })
  walletAddresses: string[];
} 