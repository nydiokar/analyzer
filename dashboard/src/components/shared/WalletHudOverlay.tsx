'use client';

import { memo } from 'react';
import { useWalletHud } from '@/hooks/useWalletHud';
import { DataQualityTier, BEHAVIOR_CODES } from '@/types/api';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Wallet HUD (Heads-Up Display) Overlay Component
 *
 * Philosophy: Like a poker HUD - show only the most critical signals for instant comprehension.
 * Maximum signal density, no clutter.
 *
 * 6 Core Metrics:
 * - Trimmed Mean PNL
 * - Median P/L per Token
 * - Behavior Code (single letter)
 * - Avg Trades/Day
 * - Win Rate
 * - Data Quality Tier
 *
 * 2 Conditional Badges:
 * - 🤖 Bot (if detected)
 * - 🐋 Whale (if detected)
 */

// ===== COLOR SCHEMES =====

/**
 * Behavior code color mapping
 * Aligned with existing strategy colors but adapted for HUD display
 */
const BEHAVIOR_COLORS: Record<string, string> = {
  // Speed categories (hot to cold)
  S: 'text-red-600 dark:text-red-400',         // Sniper - very hot
  R: 'text-orange-600 dark:text-orange-400',   // Rapid/Scalper - hot
  M: 'text-yellow-600 dark:text-yellow-400',   // Momentum - fast
  I: 'text-amber-600 dark:text-amber-400',     // Intraday - medium-fast
  D: 'text-cyan-600 dark:text-cyan-400',       // Day trader - medium
  W: 'text-blue-600 dark:text-blue-400',       // Week/Swing - patient
  P: 'text-emerald-600 dark:text-emerald-400', // Position - long-term
  H: 'text-green-600 dark:text-green-400',     // Hodler - very long-term

  // Strategy types
  F: 'text-red-600 dark:text-red-400',         // Fast trader
  A: 'text-teal-600 dark:text-teal-400',       // Accumulator
  T: 'text-purple-600 dark:text-purple-400',   // disTributor
  B: 'text-slate-600 dark:text-slate-400',     // Balanced
  L: 'text-gray-500 dark:text-gray-500',       // Low activity

  '?': 'text-gray-500 dark:text-gray-500',     // Unknown
};

/**
 * Data quality tier display configuration
 */
const DATA_QUALITY_DISPLAY: Record<DataQualityTier, { emoji: string; color: string; bg: string }> = {
  [DataQualityTier.GOLD]: {
    emoji: '🥇',
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-500/10',
  },
  [DataQualityTier.SILVER]: {
    emoji: '🥈',
    color: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-400/10',
  },
  [DataQualityTier.BRONZE]: {
    emoji: '🥉',
    color: 'text-orange-600 dark:text-orange-500',
    bg: 'bg-orange-600/10',
  },
  [DataQualityTier.INSUFFICIENT]: {
    emoji: '❓',
    color: 'text-gray-500 dark:text-gray-500',
    bg: 'bg-gray-500/10',
  },
};

// ===== NUMBER FORMATTING UTILITIES =====

/**
 * Format SOL amounts with K/M suffixes for compact display
 * Shows 1 decimal for values < 10 to avoid "-0" display
 */
function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000) {
    return `${sign}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${(value / 1_000).toFixed(1)}K`;
  }
  if (absValue >= 10) {
    return `${sign}${value.toFixed(0)}`;
  }
  // Show 1 decimal for small values to avoid "-0.2" -> "-0"
  return `${sign}${value.toFixed(1)}`;
}

/**
 * Format numbers with commas for readability
 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format percentages from decimal (0.68 -> 68%)
 */
function formatPercent(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

/**
 * Get PNL color classes
 */
function getPnlColor(value: number): string {
  if (value > 0) return 'text-green-600 dark:text-green-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}

// ===== COMPONENT INTERFACES =====

export interface WalletHudOverlayProps {
  walletAddress: string;
  display?: 'inline' | 'tooltip' | 'expanded';
  className?: string;
}

/**
 * Inline Display - Compact single-line format
 * Example: 🥇 M  +1.2K / 890  68% WR  12.5 T/D  🤖
 */
const InlineDisplay = memo(function InlineDisplay({
  data,
  className,
}: {
  data: ReturnType<typeof useWalletHud>['data'];
  className?: string;
}) {
  if (!data) return null;

  const qualityConfig = DATA_QUALITY_DISPLAY[data.dataQualityTier];
  const behaviorColor = BEHAVIOR_COLORS[data.behaviorCode] || BEHAVIOR_COLORS['?'];
  const pnlColor = getPnlColor(data.trimmedMeanPnl);

  return (
    <div className={`flex items-center gap-2 text-xs ${className || ''}`}>
      {/* Data Quality Emoji */}
      <Tooltip>
        <TooltipTrigger>
          <span className={qualityConfig.color}>{qualityConfig.emoji}</span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">{data.dataQualityTier} tier data quality</div>
        </TooltipContent>
      </Tooltip>

      {/* Behavior Code */}
      <Tooltip>
        <TooltipTrigger>
          <span className={`font-semibold ${behaviorColor}`}>{data.behaviorCode}</span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">{data.behaviorCategory || 'Unknown behavior'}</div>
        </TooltipContent>
      </Tooltip>

      {/* Trimmed Mean PNL */}
      <span className={`font-medium ${pnlColor}`}>
        {formatPnl(data.trimmedMeanPnl)}
      </span>

      <span className="text-muted-foreground">/</span>

      {/* Median PNL */}
      <span className="text-foreground">{formatNumber(data.medianPnlPerToken)}</span>

      {/* Win Rate */}
      <span className="text-muted-foreground">{formatPercent(data.winRate)} WR</span>

      {/* Avg Trades/Day */}
      <span className="text-muted-foreground">{data.avgTradesPerDay.toFixed(1)} T/D</span>

      {/* Conditional Badges */}
      {data.isBot && (
        <Tooltip>
          <TooltipTrigger>
            <span>🤖</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">Bot detected ({data.uniqueTokensPerDay.toFixed(1)} tokens/day)</div>
          </TooltipContent>
        </Tooltip>
      )}

      {data.isWhale && (
        <Tooltip>
          <TooltipTrigger>
            <span>🐋</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              Whale wallet (Portfolio: {data.currentHoldingsSol.toFixed(1)} SOL
              {data.currentHoldingsUsd && ` / $${formatNumber(Math.abs(data.currentHoldingsUsd))}`})
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});

/**
 * Tooltip Display - Detailed multi-line format for hover
 */
const TooltipDisplay = memo(function TooltipDisplay({
  data,
}: {
  data: ReturnType<typeof useWalletHud>['data'];
}) {
  if (!data) return null;

  const qualityConfig = DATA_QUALITY_DISPLAY[data.dataQualityTier];
  const behaviorColor = BEHAVIOR_COLORS[data.behaviorCode] || BEHAVIOR_COLORS['?'];
  const pnlColor = getPnlColor(data.trimmedMeanPnl);

  return (
    <div className="text-xs space-y-1.5 min-w-[200px]">
      {/* Header: Data Quality + Behavior */}
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <span className={qualityConfig.color}>{qualityConfig.emoji} {data.dataQualityTier}</span>
        <span className="text-muted-foreground">•</span>
        <span className={behaviorColor}>{data.behaviorCategory || 'Unknown'}</span>
      </div>

      {/* Metrics Grid */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Trimmed PNL:</span>
          <span className={`font-medium ${pnlColor}`}>
            {formatPnl(data.trimmedMeanPnl)} SOL
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Median P/L:</span>
          <span className="font-medium">{formatNumber(data.medianPnlPerToken)} SOL</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Win Rate:</span>
          <span className="font-medium">{formatPercent(data.winRate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Trades/Day:</span>
          <span className="font-medium">{data.avgTradesPerDay.toFixed(1)}</span>
        </div>
      </div>

      {/* Conditional Alerts */}
      {(data.isBot || data.isWhale) && (
        <div className="pt-1 border-t border-border space-y-1">
          {data.isBot && (
            <div className="text-orange-600 dark:text-orange-400">
              ⚠️ Bot detected ({data.uniqueTokensPerDay.toFixed(1)} tokens/day)
            </div>
          )}
          {data.isWhale && (
            <div className="text-blue-600 dark:text-blue-400">
              🐋 Whale wallet (Portfolio: {data.currentHoldingsSol.toFixed(1)} SOL)
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Expanded Display - Full grid layout for profile pages
 */
const ExpandedDisplay = memo(function ExpandedDisplay({
  data,
  className,
}: {
  data: ReturnType<typeof useWalletHud>['data'];
  className?: string;
}) {
  if (!data) return null;

  const qualityConfig = DATA_QUALITY_DISPLAY[data.dataQualityTier];
  const behaviorColor = BEHAVIOR_COLORS[data.behaviorCode] || BEHAVIOR_COLORS['?'];
  const pnlColor = getPnlColor(data.trimmedMeanPnl);

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 gap-4 p-4 border rounded-lg ${className || ''}`}>
      {/* Data Quality */}
      <div className="text-center">
        <div className={`text-3xl ${qualityConfig.color}`}>{qualityConfig.emoji}</div>
        <div className="text-xs text-muted-foreground mt-1">{data.dataQualityTier}</div>
      </div>

      {/* Behavior Category */}
      <div className="text-center">
        <div className={`text-2xl font-bold ${behaviorColor}`}>{data.behaviorCode}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {data.behaviorCategory || 'Unknown'}
        </div>
      </div>

      {/* Trimmed Mean PNL */}
      <div className="text-center">
        <div className={`text-lg font-bold ${pnlColor}`}>
          {formatPnl(data.trimmedMeanPnl)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">Trimmed Mean PNL</div>
      </div>

      {/* Median PNL */}
      <div className="text-center">
        <div className="text-lg font-bold">{formatNumber(data.medianPnlPerToken)}</div>
        <div className="text-xs text-muted-foreground mt-1">Median P/L</div>
      </div>

      {/* Win Rate */}
      <div className="text-center">
        <div className="text-lg font-bold">{formatPercent(data.winRate)}</div>
        <div className="text-xs text-muted-foreground mt-1">Win Rate</div>
      </div>

      {/* Avg Trades/Day */}
      <div className="text-center">
        <div className="text-lg font-bold">{data.avgTradesPerDay.toFixed(1)}</div>
        <div className="text-xs text-muted-foreground mt-1">Trades/Day</div>
      </div>

      {/* Conditional Badges */}
      {data.isBot && (
        <div className="text-center">
          <div className="text-2xl">🤖</div>
          <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
            Bot Detected
          </div>
        </div>
      )}

      {data.isWhale && (
        <div className="text-center">
          <div className="text-2xl">🐋</div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Whale Wallet
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Main WalletHudOverlay Component
 */
export const WalletHudOverlay = memo(function WalletHudOverlay({
  walletAddress,
  display = 'inline',
  className,
}: WalletHudOverlayProps) {
  const { data, error, isLoading } = useWalletHud(walletAddress);

  // Loading state - show minimal skeleton
  if (isLoading) {
    return (
      <div className={`animate-pulse ${className || ''}`}>
        {display === 'inline' && (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-muted rounded"></div>
            <div className="h-4 w-20 bg-muted rounded"></div>
          </div>
        )}
        {display === 'expanded' && (
          <div className="grid grid-cols-3 gap-4 p-4 border rounded-lg">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Error or no data - show nothing (graceful degradation)
  if (error || !data) {
    return null;
  }

  // Render appropriate display variant
  switch (display) {
    case 'tooltip':
      return <TooltipDisplay data={data} />;
    case 'expanded':
      return <ExpandedDisplay data={data} className={className} />;
    case 'inline':
    default:
      return <InlineDisplay data={data} className={className} />;
  }
});
