import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class WalletSearchQueryDto {
  @ApiProperty({
    description: 'The search term to find wallet addresses (e.g., partial address).',
    example: '28825K3y',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100) // Wallet addresses are typically 32-44 chars, 100 is a safe upper bound for a fragment
  query: string;
} 