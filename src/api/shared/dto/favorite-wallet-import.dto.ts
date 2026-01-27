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
  @ApiProperty({ description: 'Wallets to import', type: [BulkImportWalletItemDto] })
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
    description: 'Queue dashboard analysis after import',
    required: false,
    example: true,
  })
  analyze?: boolean;

  @ApiProperty({
    description: 'Dashboard analysis scope to queue',
    required: false,
    enum: ['flash', 'working', 'deep'],
    example: 'deep',
  })
  analysisScope?: DashboardAnalysisScope;

  @ApiProperty({
    description: 'Limit number of wallets queued for analysis (useful for test runs)',
    required: false,
    example: 5,
  })
  analysisLimit?: number;

  @ApiProperty({
    description: 'Target signature count for dashboard analysis (capped by DASHBOARD_MAX_SIGNATURES)',
    required: false,
    example: 10000,
  })
  targetSignatureCount?: number;

  @ApiProperty({ description: 'Force refresh for queued analysis jobs', required: false, example: false })
  forceRefresh?: boolean;

  @ApiProperty({ description: 'Queue follow-up working scope after flash', required: false, example: false })
  queueWorkingAfter?: boolean;

  @ApiProperty({ description: 'Queue follow-up deep scope after flash/working', required: false, example: false })
  queueDeepAfter?: boolean;

  @ApiProperty({ description: 'Include job IDs in response (can be large)', required: false, example: false })
  includeJobIds?: boolean;
}

