'use client';

import { memo } from 'react';
import { useWalletHud } from '@/hooks/useWalletHud';
import { DataQualityTier, BEHAVIOR_CODES } from '@/types/api';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  classifyMcapBucket,
  compareMcapBuckets,
  formatMcapCompact,
  getMcapBucketDisplayLabel,
} from '@/lib/mcap';

/**
 * Wallet HUD (Heads-Up Display) Overlay Component
 *
 * Philosophy: Like a poker HUD - show only the most critical signals for instant comprehension.
 * Maximum signal density, no clutter.
 *
 * 6 Core Metrics:
 * - Trimmed Mean PNL
 * - Avg Tx Value (SOL)
 * - Behavior Code (single letter)
 * - Unique Tokens/Day
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
 * Format SOL amounts for compact display (avg tx values are typically small)
 * Examples: 0.05, 0.5, 2.4, 12.3, 150, 1.2K
 */
function formatSol(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  if (absValue >= 100) {
    return `${value.toFixed(0)}`;
  }
  if (absValue >= 1) {
    return `${value.toFixed(1)}`;
  }
  return `${value.toFixed(2)}`;
}

/**
 * Format percentages from decimal (0.68 -> 68%)
 */
function formatPercent(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

function getMarketCapSignal(data: ReturnType<typeof useWalletHud>['data']) {
  if (!data) return null;

  const hasTypicalSignal = data.typicalEntryMcapUsd !== undefined;

  if (!hasTypicalSignal && data.dominantEntryMcapBucket === undefined) {
    return null;
  }

  const typicalBucket = classifyMcapBucket(data.typicalEntryMcapUsd);
  const dominantBucket = data.dominantEntryMcapBucket;
  const bucketDelta = compareMcapBuckets(dominantBucket, typicalBucket);
  const deviationBucket =
    dominantBucket && typicalBucket && dominantBucket !== typicalBucket
      ? dominantBucket
      : null;

  return {
    typicalEntryMcapUsd: data.typicalEntryMcapUsd,
    dominantBucket,
    deviationBucket,
    deviationDirection:
      bucketDelta == null || bucketDelta === 0
        ? null
        : bucketDelta > 0
          ? 'higher'
          : 'lower',
    hasTypicalSignal,
  };
}

/**
 * Format ISO date to compact display (e.g., "Oct 01, 2025")
 */
function formatDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(isoDate));
}

/**
 * Format data range for HUD display
 */
function formatDateRange(from: string, to: string): string {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return `${formatDateShort(from)} - ${formatDateShort(to)}`;
  }

  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const sameMonth = sameYear && fromDate.getMonth() === toDate.getMonth();
  const year = toDate.getFullYear();

  if (sameMonth) {
    const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(fromDate);
    return `${monthLabel} ${fromDate.getDate()}-${toDate.getDate()}, ${year}`;
  }

  if (sameYear) {
    const fromLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(fromDate);
    const toLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(toDate);
    return `${fromLabel} - ${toLabel}, ${year}`;
  }

  return `${formatDateShort(from)} - ${formatDateShort(to)}`;
}

/**
 * Format hold time in hours to compact human-readable format
 * Examples: 0.5h, 4.2h, 1.3d, 15d, 2.1w
 */
function formatHoldTime(hours: number | undefined): string | null {
  if (hours === undefined || hours === null) return null;

  if (hours < 1) {
    // Less than 1 hour: show in minutes
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  } else if (hours < 24) {
    // Less than 24 hours: show in hours
    return `${hours.toFixed(1)}h`;
  } else if (hours < 168) {
    // Less than 7 days: show in days
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  } else {
    // 7+ days: show in weeks
    const weeks = hours / 168;
    return `${weeks.toFixed(1)}w`;
  }
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
  data?: ReturnType<typeof useWalletHud>['data'] | null;
}

/**
 * Inline Display - Compact single-line format
 * Example: 🥇 M  +1.2K | 2.4 SOL/tx  68% WR  12.5 T/D  🤖
 * Note: T/D = Unique Tokens per Day (not Trades per Day)
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
    <TooltipProvider>
      <div className={`flex items-center gap-2 text-xs ${className || ''}`}>
        {/* Data Quality Emoji */}
        <Tooltip>
          <TooltipTrigger>
            <span className={qualityConfig.color}>{qualityConfig.emoji}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <div>{data.dataQualityTier} tier data quality</div>
              {data.provenance?.dataRange && (
                <div className="text-muted-foreground">
                  Data range: {formatDateRange(data.provenance.dataRange.from, data.provenance.dataRange.to)}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Behavior Code + Median Hold Time */}
        <Tooltip>
          <TooltipTrigger>
            <span className={`font-semibold ${behaviorColor}`}>
              {data.behaviorCode}
              {formatHoldTime(data.medianHoldTimeHours) && (
                <span className="text-muted-foreground font-normal ml-0.5">
                  {formatHoldTime(data.medianHoldTimeHours)}
                </span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              {data.behaviorCategory || 'Unknown behavior'}
              {data.medianHoldTimeHours !== undefined && (
                <div className="text-muted-foreground mt-0.5">
                  Median hold: {formatHoldTime(data.medianHoldTimeHours)}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Trimmed Mean PNL */}
        <span className={`font-medium ${pnlColor}`}>
          {formatPnl(data.trimmedMeanPnl)}
        </span>

        <span className="text-muted-foreground">|</span>

        {/* Avg Tx Value */}
        <span className="text-foreground">{formatSol(data.avgTxValueSol)} SOL/tx</span>

        {/* Win Rate */}
        <span className="text-muted-foreground">{formatPercent(data.winRate)} WR</span>

        {/* Unique Tokens/Day */}
        <span className="text-muted-foreground">{data.uniqueTokensPerDay.toFixed(1)} T/D</span>

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
    </TooltipProvider>
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
  const marketCapSignal = getMarketCapSignal(data);

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
        {data.provenance?.dataRange && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Data range:</span>
            <span className="font-medium">
              {formatDateRange(data.provenance.dataRange.from, data.provenance.dataRange.to)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Trimmed PNL:</span>
          <span className={`font-medium ${pnlColor}`}>
            {formatPnl(data.trimmedMeanPnl)} SOL
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Tx Value:</span>
          <span className="font-medium">{formatSol(data.avgTxValueSol)} SOL</span>
        </div>
        {data.medianHoldTimeHours !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Median Hold:</span>
            <span className={`font-medium ${behaviorColor}`}>
              {formatHoldTime(data.medianHoldTimeHours)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Win Rate:</span>
          <span className="font-medium">{formatPercent(data.winRate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tokens/Day:</span>
          <span className="font-medium">{data.uniqueTokensPerDay.toFixed(1)}</span>
        </div>
        {marketCapSignal && marketCapSignal.hasTypicalSignal && marketCapSignal.typicalEntryMcapUsd !== undefined && (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Typical Entry Mcap:</span>
              <span className="font-medium">{formatMcapCompact(marketCapSignal.typicalEntryMcapUsd)}</span>
            </div>
            {marketCapSignal.deviationBucket && marketCapSignal.deviationDirection && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Capital Skews {marketCapSignal.deviationDirection}:</span>
                <span className="font-medium">
                  {getMcapBucketDisplayLabel(marketCapSignal.deviationBucket)}
                </span>
              </div>
            )}
          </>
        )}
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
              🐋 (Holding: {data.currentHoldingsSol.toFixed(1)} SOL)
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
    <div className={`grid grid-cols-3 gap-x-6 gap-y-4 p-4 border rounded-xl bg-card w-fit ${className || ''}`}>
      {/* Data Quality */}
      <div className="text-center">
        <div className={`text-3xl ${qualityConfig.color}`}>{qualityConfig.emoji}</div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Data Quality</div>
      </div>

      {/* Behavior Category + Median Hold Time */}
      <div className="text-center">
        <div className={`text-3xl font-bold ${behaviorColor}`}>
          {data.behaviorCode}
          {data.medianHoldTimeHours !== undefined && (
            <span className="text-lg text-muted-foreground font-normal ml-1.5">
              {formatHoldTime(data.medianHoldTimeHours)}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">
          {data.behaviorCategory || 'Unknown'}
        </div>
      </div>

      {/* Trimmed Mean PNL */}
      <div className="text-center">
        <div className={`text-2xl font-bold ${pnlColor}`}>
          {formatPnl(data.trimmedMeanPnl)}
        </div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Trimmed Mean PNL</div>
      </div>

      {/* Avg Tx Value */}
      <div className="text-center">
        <div className="text-2xl font-bold">{formatSol(data.avgTxValueSol)}</div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Avg Tx (SOL)</div>
      </div>

      {/* Win Rate */}
      <div className="text-center">
        <div className="text-2xl font-bold">{formatPercent(data.winRate)}</div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Win Rate</div>
      </div>

      {/* Unique Tokens/Day */}
      <div className="text-center">
        <div className="text-2xl font-bold">{data.uniqueTokensPerDay.toFixed(1)}</div>
        <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Tokens/Day</div>
      </div>

      {/* Typical Entry Mcap */}
      {data.typicalEntryMcapUsd !== undefined && (
        <div className="text-center">
          <div className="text-2xl font-bold">{formatMcapCompact(data.typicalEntryMcapUsd)}</div>
          <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wide font-medium">Typical MC Entry</div>
        </div>
      )}

      {/* Conditional Badges */}
      {data.isBot && (
        <div className="text-center">
          <div className="text-2xl">🤖</div>
          <div className="text-xs text-orange-600 dark:text-orange-400 mt-1.5 font-medium">
            Bot Detected
          </div>
        </div>
      )}

      {data.isWhale && (
        <div className="text-center">
          <div className="text-2xl">🐋</div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1.5 font-medium">
            HOLDING &gt; 200 SOL   
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
  data: externalData = null,
}: WalletHudOverlayProps) {
  const shouldFetch = !externalData && !!walletAddress;
  const { data: fetchedData, error, isLoading } = useWalletHud(shouldFetch ? walletAddress : null);
  const data = externalData ?? fetchedData;

  // Loading state - show minimal skeleton
  if (isLoading && !externalData) {
    return (
      <div className={`animate-pulse ${className || ''}`}>
        {display === 'inline' && (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-muted rounded"></div>
            <div className="h-4 w-20 bg-muted rounded"></div>
          </div>
        )}
        {display === 'tooltip' && (
          <div className="space-y-2">
            <div className="h-3 w-24 bg-muted rounded"></div>
            <div className="h-3 w-32 bg-muted rounded"></div>
            <div className="h-3 w-28 bg-muted rounded"></div>
            <div className="h-3 w-20 bg-muted rounded"></div>
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
