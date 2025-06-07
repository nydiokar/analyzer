import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WalletSummaryResponse {
  @ApiProperty({
    description: "The status of the wallet summary, indicating the type of data returned.",
    example: 'ok',
    enum: ['ok', 'unanalyzed', 'restricted'],
  })
  status: 'ok' | 'unanalyzed' | 'restricted';

  @ApiProperty({ 
    description: 'The Solana wallet address.',
    example: 'Dez...yc1' 
  })
  walletAddress: string;

  @ApiPropertyOptional({ 
    description: 'ISO 8601 timestamp of when the wallet was last analyzed.',
    example: '2023-05-21T10:00:00.000Z' 
  })
  lastAnalyzedAt?: string | null;

  @ApiPropertyOptional({ 
    description: "Timestamp of the wallet's last known transaction (Unix seconds).",
    example: 1684663200 
  })
  lastActiveTimestamp?: number | null;

  @ApiPropertyOptional({ 
    description: 'Number of days the wallet has been active.',
    example: 42 
  })
  daysActive?: number | string;

  @ApiPropertyOptional({ 
    description: 'The latest realized PNL for the wallet.',
    example: 1250.75 
  })
  latestPnl?: number | null;

  @ApiPropertyOptional({ 
    description: 'The win rate of profitable tokens as a percentage.',
    example: 66.67 
  })
  tokenWinRate?: number | null;

  @ApiPropertyOptional({ 
    description: 'The classified trading behavior of the wallet.',
    example: 'True Flipper' 
  })
  behaviorClassification?: string | null;

  @ApiPropertyOptional({ 
    description: 'The current SOL balance of the wallet.',
    example: 10.5 
  })
  currentSolBalance?: number | null;

  @ApiPropertyOptional({
    description: 'The current USDC balance of the wallet.',
    example: 5000.25
  })
  currentUsdcBalance?: number | null;

  @ApiPropertyOptional({ 
    description: 'ISO 8601 timestamp of when the SOL balance was last fetched.',
    example: '2023-05-21T09:55:00.000Z' 
  })
  balancesFetchedAt?: string | null;
} 