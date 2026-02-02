import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayMaxSize, ArrayMinSize } from 'class-validator';

/**
 * Data quality tier classification based on data completeness and activity
 */
export enum DataQualityTier {
  GOLD = 'GOLD',           // Complete data, significant activity (50+ trades, 7+ days)
  SILVER = 'SILVER',       // Good data, moderate activity (20+ trades, 3+ days)
  BRONZE = 'BRONZE',       // Basic data, some activity (5+ trades)
  INSUFFICIENT = 'INSUFFICIENT', // Too little data for reliable metrics
}

/**
 * Behavior category mapping to single-letter codes
 */
export const BEHAVIOR_CODES: Record<string, string> = {
  // Primary categories
  MOMENTUM_TRADER: 'M',
  TRUE_FLIPPER: 'F',
  POSITION_HOLDER: 'H',
  ACCUMULATOR: 'A',

  // Speed variants
  INSTANT_FLIPPER: 'I',
  SWING_TRADER: 'S',

  // Fallback
  UNKNOWN: '?',
};

/**
 * Wallet HUD (Heads-Up Display) - High-signal metrics for at-a-glance evaluation
 *
 * Philosophy: Like a poker HUD, show only the most critical signals for instant comprehension.
 * 6 core metrics + 2 conditional badges.
 */
export class WalletHudDto {
  @ApiProperty({
    description: 'The wallet address',
    example: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  })
  walletAddress: string;

  // ===== CORE METRICS (Always visible) =====

  @ApiProperty({
    description: 'Trimmed mean PNL per token (outliers removed) in SOL',
    example: 1234.56,
  })
  trimmedMeanPnl: number;

  @ApiProperty({
    description: 'Median P/L per token (true center of distribution) in SOL',
    example: 890.12,
  })
  medianPnlPerToken: number;

  @ApiPropertyOptional({
    description: 'Full behavior category name',
    example: 'MOMENTUM_TRADER',
  })
  behaviorCategory?: string;

  @ApiProperty({
    description: 'Single-letter behavior code (M/F/H/A/I/S/?)',
    example: 'M',
  })
  behaviorCode: string;

  @ApiProperty({
    description: 'Average number of trades per day',
    example: 12.5,
  })
  avgTradesPerDay: number;

  @ApiProperty({
    description: 'Win rate as decimal (0-1, where 0.68 = 68%)',
    example: 0.68,
  })
  winRate: number;

  @ApiProperty({
    description: 'Data quality tier classification',
    enum: DataQualityTier,
    example: DataQualityTier.GOLD,
  })
  dataQualityTier: DataQualityTier;

  // ===== CONDITIONAL BADGES (Only when applicable) =====

  @ApiProperty({
    description: 'Bot detection flag (true if uniqueTokensPerDay > 60)',
    example: true,
  })
  isBot: boolean;

  @ApiProperty({
    description: 'Whale detection flag (true if holdings > 200 SOL OR > $20k USD)',
    example: false,
  })
  isWhale: boolean;

  // ===== SUPPORTING DATA =====

  @ApiProperty({
    description: 'Average unique tokens traded per day (for bot detection)',
    example: 65.2,
  })
  uniqueTokensPerDay: number;

  @ApiProperty({
    description: 'Unrealized PNL in SOL (total current portfolio value from token holdings)',
    example: 245.67,
  })
  currentHoldingsSol: number;

  @ApiPropertyOptional({
    description: 'Unrealized PNL in USD (total current portfolio value from token holdings)',
    example: 28200.50,
  })
  currentHoldingsUsd?: number;

  // ===== METADATA =====

  @ApiProperty({
    description: 'Timestamp when HUD data was calculated',
    example: '2026-02-02T10:30:00.000Z',
  })
  calculatedAt: Date;
}

/**
 * Batch request for multiple wallet HUDs
 */
export class BatchWalletHudRequestDto {
  @ApiProperty({
    description: 'Array of wallet addresses to fetch HUD data for (max 200)',
    example: [
      '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      '8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
    ],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  walletAddresses: string[];
}

/**
 * Batch response for multiple wallet HUDs
 * Returns a map indexed by wallet address for O(1) lookup
 */
export class BatchWalletHudResponseDto {
  @ApiProperty({
    description: 'Map of wallet addresses to their HUD data',
    type: 'object',
    additionalProperties: {
      $ref: '#/components/schemas/WalletHudDto',
    },
  })
  huds: Record<string, WalletHudDto>;

  @ApiProperty({
    description: 'Array of wallet addresses that were not found or have insufficient data',
    example: [],
    type: [String],
  })
  notFound: string[];

  @ApiProperty({
    description: 'Timestamp when batch was calculated',
    example: '2026-02-02T10:30:00.000Z',
  })
  calculatedAt: Date;
}
