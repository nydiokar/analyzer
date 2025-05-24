import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Forward declare or import necessary types if they are complex
// For now, using basic types or 'object' for simplicity

export class WalletSummaryResponse {
  @ApiProperty({ example: '2HTdFe4CLQtwKcYPdea1qPeU59hxrBpCwKLCFdQz5thQ', description: 'The Solana wallet address.' })
  walletAddress: string;

  @ApiProperty({ example: 1747613680, description: 'Timestamp of the last known activity for the wallet (Unix seconds).', nullable: true })
  lastActiveTimestamp: number | null;

  @ApiProperty({ example: 90, description: 'Number of days the wallet has been active, calculated from first to last known transaction. Can be a placeholder if data is insufficient.' })
  daysActive: number | string;

  @ApiPropertyOptional({ example: 0.12, description: 'The latest PNL from the advanced statistics. Specific to the queried time range if provided, otherwise overall.', nullable: true })
  latestPnl?: number;

  @ApiPropertyOptional({ example: 51.47, description: 'The token win rate percentage from the advanced statistics. Specific to the queried time range if provided, otherwise overall.', nullable: true })
  tokenWinRate?: number;

  @ApiProperty({ example: 'True Flipper', description: 'Behavioral classification of the wallet based on trading patterns. May be influenced by time range if applicable to behavior service.', nullable: true })
  behaviorClassification: string | null;

  @ApiPropertyOptional({
    description: 'The start date that was used for filtering the summary, if provided in the request (ISO 8601 format).',
    example: '2024-01-01T00:00:00.000Z',
  })
  receivedStartDate?: string | null;

  @ApiPropertyOptional({
    description: 'The end date that was used for filtering the summary, if provided in the request (ISO 8601 format).',
    example: '2024-01-31T23:59:59.999Z',
  })
  receivedEndDate?: string | null;
} 