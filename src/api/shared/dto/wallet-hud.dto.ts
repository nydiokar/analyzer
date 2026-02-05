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
 * Maps speedCategory/strategyType enums to compact display codes
 */
export const BEHAVIOR_CODES: Record<string, string> = {
  // Speed categories (from speedCategory field)
  SNIPER: 'S',      // <1min exits
  SCALPER: 'R',     // 1-5min exits (R = Rapid)
  MOMENTUM: 'M',    // 5-30min exits
  INTRADAY: 'I',    // 30min-4h exits
  DAY_TRADER: 'D',  // 4-24h exits
  SWING: 'W',       // 1-7d exits (W = Week)
  POSITION: 'P',    // 7-30d exits
  HODLER: 'H',      // 30d+ exits

  // Strategy types (from strategyType field)
  FAST_TRADER: 'F',
  SWING_TRADER: 'W',
  POSITION_TRADER: 'P',
  PURE_HOLDER: 'H',
  ACCUMULATOR: 'A',
  DISTRIBUTOR: 'T',  // T = disTributor
  BALANCED_TRADER: 'B',
  LOW_ACTIVITY: 'L',

  // Fallback
  UNKNOWN: '?',
  UNCLASSIFIED: '?',
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

  @ApiProperty({
    description: 'Signal type identifier for this payload',
    example: 'wallet_behavior_v1',
  })
  signalType: string;

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

  @ApiPropertyOptional({
    description: 'Median hold time for completed trades in hours (more precise than category)',
    example: 4.2,
  })
  medianHoldTimeHours?: number;

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
    description: 'Whale detection flag (true if portfolio value > 200 SOL OR > $20k USD)',
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
    description: 'Total portfolio value in SOL (sum of all current token holdings value)',
    example: 245.67,
  })
  currentHoldingsSol: number;

  @ApiPropertyOptional({
    description: 'Total portfolio value in USD (sum of all current token holdings value)',
    example: 28200.50,
  })
  currentHoldingsUsd?: number;

  // ===== METADATA =====

  @ApiProperty({
    description: 'Timestamp when HUD data was calculated',
    example: '2026-02-02T10:30:00.000Z',
  })
  calculatedAt: Date;

  @ApiPropertyOptional({
    description: 'Provenance metadata for the signal',
    example: {
      provider: 'alpha-node',
      nodeId: 'alpha-node-07',
      schemaVersion: '1.0.0',
      generatedAt: '2026-02-02T10:30:00.000Z',
      dataRange: {
        from: '2025-10-01T00:00:00.000Z',
        to: '2026-02-02T10:30:00.000Z',
      },
      source: 'indexed_db',
    },
  })
  provenance?: {
    provider: string;
    nodeId?: string;
    schemaVersion: string;
    generatedAt: string;
    dataRange?: {
      from: string;
      to: string;
    };
    source?: 'onchain' | 'indexed_db' | 'hybrid';
  };
}

/**
 * Batch request for multiple wallet HUDs
 */
export class BatchWalletHudRequestDto {
  @ApiProperty({
    description: 'Array of wallet addresses to fetch HUD data for (max 200)',
    example: [
      '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7',
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
