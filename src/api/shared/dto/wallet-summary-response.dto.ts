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
    description: 'The latest realized PNL for the wallet in USD.',
    example: 125075.00 
  })
  latestPnlUsd?: number | null;

  @ApiPropertyOptional({ 
    description: 'The trade-level win rate representing the percentage of individual trades that were profitable (realized PnL > 0) out of all trades executed.',
    example: 66.67 
  })
  tokenWinRate?: number | null;

  @ApiPropertyOptional({ 
    description: 'The classified trading behavior of the wallet.',
    example: 'True Flipper' 
  })
  behaviorClassification?: string | null;

  @ApiPropertyOptional({ 
    description: 'The wallet classification for performance optimization.',
    example: 'high_frequency',
    enum: ['normal', 'high_frequency', 'unknown'],
  })
  classification?: string | null;

  @ApiPropertyOptional({ 
    description: 'The current SOL balance of the wallet.',
    example: 10.5 
  })
  currentSolBalance?: number | null;

  @ApiPropertyOptional({ 
    description: 'The current SOL balance of the wallet in USD.',
    example: 1050.00 
  })
  currentSolBalanceUsd?: number | null;



  @ApiPropertyOptional({
    description: 'The number of profitable trades (individual transactions) that were profitable.',
    example: 150
  })
  profitableTradesCount?: number | null;

  @ApiPropertyOptional({
    description: 'The total number of individual trades (transactions) executed.',
    example: 350
  })
  totalTradesCount?: number | null;

  @ApiPropertyOptional({ 
    description: 'ISO 8601 timestamp of when the balance was last fetched.',
    example: '2023-05-21T10:00:00.000Z' 
  })
  balancesFetchedAt?: string | null;
} 