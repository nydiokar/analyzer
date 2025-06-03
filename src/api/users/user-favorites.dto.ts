import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AddFavoriteWalletDto {
  @ApiProperty({
    description: 'The wallet address to add to favorites.',
    example: 'So11111111111111111111111111111111111111112',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;
} 