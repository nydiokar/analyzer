import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class WalletStatusRequestDto {
  @ApiProperty({
    description: 'An array of wallet addresses to check.',
    type: [String],
    example: ['ADDRESS_1', 'ADDRESS_2'],
  })
  @IsArray()
  @IsString({ each: true })
  walletAddresses: string[];
} 