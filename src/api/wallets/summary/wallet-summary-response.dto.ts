import { ApiProperty } from '@nestjs/swagger';

// Forward declare or import necessary types if they are complex
// For now, using basic types or 'object' for simplicity

export class WalletSummaryResponse {
  @ApiProperty({ example: '2HTdFe4CLQtwKcYPdea1qPeU59hxrBpCwKLCFdQz5thQ', description: 'The Solana wallet address.' })
  walletAddress: string;

  @ApiProperty({ example: 1747613680, description: 'Timestamp of the last known activity for the wallet (Unix seconds).', nullable: true })
  lastActiveTimestamp: number | null;

  @ApiProperty({ example: 90, description: 'Number of days the wallet has been active, calculated from first to last known transaction. Can be a placeholder if data is insufficient.' })
  daysActive: number | string;

  @ApiProperty({ example: 0.124672431, description: 'The median PNL per token from the latest advanced statistics.', nullable: true })
  latestPnl?: number;

  @ApiProperty({ example: 51.47, description: 'The win rate percentage based on profitable distinct tokens from the latest advanced statistics.', nullable: true })
  tokenWinRate?: number;

  @ApiProperty({ example: 'True Flipper', description: 'Behavioral classification of the wallet based on trading patterns.' })
  behaviorClassification: string;

  @ApiProperty({ description: 'Raw advanced statistics object for the wallet.', type: () => Object, nullable: true, additionalProperties: true })
  rawAdvancedStats?: any; // Replace 'any' with a more specific DTO if available (e.g., AdvancedStatsDto)

  @ApiProperty({ description: 'Raw behavior metrics object for the wallet.', type: () => Object, nullable: true, additionalProperties: true })
  rawBehaviorMetrics?: any; // Replace 'any' with a more specific DTO if available (e.g., BehaviorMetricsDto)
} 