import { ApiProperty } from '@nestjs/swagger';

export class FavoriteWalletDetailDto {
  @ApiProperty({ description: 'Wallet address', example: 'So11111111111111111111111111111111111111112' })
  walletAddress: string;

  @ApiProperty({ description: 'Brief summary stat 1 (e.g., PNL)', example: 1250.75, required: false })
  pnl?: number; // Example stat

  @ApiProperty({ description: 'Brief summary stat 2 (e.g., Win Rate)', example: 0.65, required: false })
  winRate?: number; // Example stat

  // Add more key summary stats as needed

  @ApiProperty({ description: 'Timestamp when the wallet was favorited' })
  favoritedAt: Date;
} 