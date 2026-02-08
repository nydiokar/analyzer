import { ApiProperty } from '@nestjs/swagger';
import type { DashboardAnalysisScope } from '../../../shared/dashboard-analysis.types';

export class BulkImportWalletItemDto {
  @ApiProperty({
    description: 'Wallet address to track (supports legacy "trackedWalletAddress" or "walletAddress" keys)',
    example: 'So11111111111111111111111111111111111111112',
  })
  trackedWalletAddress?: string;

  @ApiProperty({
    description: 'Wallet address to track (preferred key)',
    example: 'So11111111111111111111111111111111111111112',
    required: false,
  })
  walletAddress?: string;

  @ApiProperty({ description: 'Optional display name for the wallet', required: false, example: 'DINNER' })
  name?: string;

  @ApiProperty({ description: 'Optional nickname for the wallet', required: false, example: 'DINNER' })
  nickname?: string;

  @ApiProperty({ description: 'Optional emoji label', required: false, example: '🔥' })
  emoji?: string;

  @ApiProperty({ description: 'Optional alerts flag', required: false, example: true })
  alertsOn?: boolean;

  @ApiProperty({ description: 'Optional collection name for this wallet', required: false, example: 'Whale Watch' })
  collection?: string;

  @ApiProperty({ description: 'Optional collections list for this wallet', required: false, example: ['Whale Watch'] })
  collections?: string[];

  @ApiProperty({ description: 'Optional custom metadata payload', required: false })
  metadata?: any;
}

export class BulkImportFavoriteWalletsDto {
  @ApiProperty({
    description: 'Wallets to import',
    type: [BulkImportWalletItemDto],
    example: [
      { walletAddress: 'So11111111111111111111111111111111111111112', nickname: 'Whale 1', emoji: '🐋' }
    ]
  })
  wallets: BulkImportWalletItemDto[];

  @ApiProperty({
    description: 'Default collections applied to every imported wallet (string or array)',
    required: false,
    example: ['Whale Watch'],
  })
  defaultCollections?: string[] | string;

  @ApiProperty({
    description: 'Merge collections into existing favorites (default true)',
    required: false,
    example: true,
  })
  mergeCollections?: boolean;

  @ApiProperty({
    description: 'Overwrite existing nickname when provided (default false)',
    required: false,
    example: false,
  })
  overwriteNickname?: boolean;

  @ApiProperty({
    description: 'Include job IDs in response (can be large, useful for debugging)',
    required: false,
    example: false
  })
  includeJobIds?: boolean;
}

