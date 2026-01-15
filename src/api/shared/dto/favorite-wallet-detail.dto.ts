import { ApiProperty } from '@nestjs/swagger';

// Simple favorite wallet details with JSON-based tags and collections
export class FavoriteWalletDetailDto {
  @ApiProperty({ description: 'Wallet address', example: 'So11111111111111111111111111111111111111112' })
  walletAddress: string;

  @ApiProperty({ description: 'Known wallet type from registry (if applicable).', required: false })
  knownType?: string;

  @ApiProperty({ description: 'Known wallet display label from registry (if applicable).', required: false })
  knownLabel?: string;

  @ApiProperty({ description: 'User-defined nickname for the wallet', example: 'DeFi Whale #1', required: false })
  nickname?: string;

  @ApiProperty({ description: 'Array of collections containing this wallet', example: ['Main Portfolio', 'Watchlist'], required: false })
  collections?: string[];

  @ApiProperty({ description: 'Custom metadata for the wallet', required: false })
  metadata?: any;

  @ApiProperty({ description: 'Brief summary stat 1 (e.g., PNL)', example: 1250.75, required: false })
  pnl?: number;

  @ApiProperty({ description: 'Brief summary stat 2 (e.g., Win Rate)', example: 0.65, required: false })
  winRate?: number;

  @ApiProperty({ description: 'Current SOL balance', example: 42.5, required: false })
  currentSolBalance?: number;

  @ApiProperty({ description: 'Unix timestamp (seconds) of last wallet activity', example: 1735497600, required: false })
  lastActiveTimestamp?: number;

  @ApiProperty({ description: 'Timestamp when the wallet was favorited' })
  favoritedAt: Date;

  @ApiProperty({ description: 'Timestamp when the wallet was last viewed', required: false })
  lastViewedAt?: Date;
}

// DTO for updating favorite wallets
export class UpdateFavoriteWalletDto {
  @ApiProperty({ description: 'User-defined nickname for the wallet', example: 'DeFi Whale #1', required: false })
  nickname?: string;

  @ApiProperty({ description: 'Array of collections for this wallet', example: ['Main Portfolio'], required: false })
  collections?: string[];

  @ApiProperty({ description: 'Custom metadata for the wallet', required: false })
  metadata?: any;
}

// DTO for enhanced favorite wallet creation
export class AddFavoriteWalletDto {
  @ApiProperty({ description: 'The wallet address to add to favorites', example: 'So11111111111111111111111111111111111111112' })
  walletAddress: string;

  @ApiProperty({ description: 'Optional nickname for the wallet', example: 'DeFi Whale #1', required: false })
  nickname?: string;

  @ApiProperty({ description: 'Optional collections to add to', example: ['Main Portfolio'], required: false })
  collections?: string[];
}

 
