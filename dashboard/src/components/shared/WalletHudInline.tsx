import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DataQualityTier, type WalletHudDto } from '@/types/api';

const BEHAVIOR_COLORS: Record<string, string> = {
  S: 'text-red-600 dark:text-red-400',
  R: 'text-orange-600 dark:text-orange-400',
  M: 'text-yellow-600 dark:text-yellow-400',
  I: 'text-amber-600 dark:text-amber-400',
  D: 'text-cyan-600 dark:text-cyan-400',
  W: 'text-blue-600 dark:text-blue-400',
  P: 'text-emerald-600 dark:text-emerald-400',
  H: 'text-green-600 dark:text-green-400',
  F: 'text-red-600 dark:text-red-400',
  A: 'text-teal-600 dark:text-teal-400',
  T: 'text-purple-600 dark:text-purple-400',
  B: 'text-slate-600 dark:text-slate-400',
  L: 'text-gray-500 dark:text-gray-500',
  '?': 'text-gray-500 dark:text-gray-500',
};

const DATA_QUALITY_DISPLAY: Record<DataQualityTier, { emoji: string; color: string }> = {
  [DataQualityTier.GOLD]: {
    emoji: '🥇',
    color: 'text-yellow-600 dark:text-yellow-400',
  },
  [DataQualityTier.SILVER]: {
    emoji: '🥈',
    color: 'text-gray-500 dark:text-gray-400',
  },
  [DataQualityTier.BRONZE]: {
    emoji: '🥉',
    color: 'text-orange-600 dark:text-orange-500',
  },
  [DataQualityTier.INSUFFICIENT]: {
    emoji: '❓',
    color: 'text-gray-500 dark:text-gray-500',
  },
};

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
  return `${sign}${value.toFixed(1)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

function formatHoldTime(hours?: number): string | null {
  if (hours === undefined || hours === null) return null;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (hours < 168) return `${(hours / 24).toFixed(1)}d`;
  return `${(hours / 168).toFixed(1)}w`;
}

function getPnlColor(value: number): string {
  if (value > 0) return 'text-green-600 dark:text-green-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}

interface WalletHudInlineProps {
  data: WalletHudDto;
  className?: string;
}

export const WalletHudInline = memo(function WalletHudInline({ data, className }: WalletHudInlineProps) {
  const qualityConfig = DATA_QUALITY_DISPLAY[data.dataQualityTier];
  const behaviorColor = BEHAVIOR_COLORS[data.behaviorCode] || BEHAVIOR_COLORS['?'];
  const pnlColor = getPnlColor(data.trimmedMeanPnl);

  return (
    <TooltipProvider delayDuration={150}>
      <div className={`flex flex-wrap items-center gap-2 text-xs ${className || ''}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={qualityConfig.color}>{qualityConfig.emoji}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <div>{data.dataQualityTier} tier data quality</div>
              {data.provenance?.dataRange && (
                <div className="text-muted-foreground">
                  Data range: {data.provenance.dataRange.from} → {data.provenance.dataRange.to}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
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

        <span className={`font-medium ${pnlColor}`}>{formatPnl(data.trimmedMeanPnl)}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground">{formatNumber(data.medianPnlPerToken)}</span>
        <span className="text-muted-foreground">{formatPercent(data.winRate)} WR</span>
        <span className="text-muted-foreground">{data.uniqueTokensPerDay.toFixed(1)} T/D</span>

        {data.isBot && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>🤖</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">Bot detected ({data.uniqueTokensPerDay.toFixed(1)} tokens/day)</div>
            </TooltipContent>
          </Tooltip>
        )}

        {data.isWhale && (
          <Tooltip>
            <TooltipTrigger asChild>
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
