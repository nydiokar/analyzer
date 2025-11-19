import type { HolderProfile } from '../types';
import { formatAddress } from './utils/formatters';
import { getBehaviorColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle } from 'lucide-react';

interface Props {
  profile: HolderProfile;
  walletAddress: string;
}

interface ExitTimingBreakdownProps {
  distribution: {
    instant: number;
    ultraFast: number;
    fast: number;
    momentum: number;
    intraday: number;
    day: number;
    swing: number;
    position: number;
  };
}

function ExitTimingBreakdown({ distribution }: ExitTimingBreakdownProps) {
  const items = [
    { label: '<1s', count: distribution.instant },
    { label: '<1m', count: distribution.ultraFast },
    { label: '1-5m', count: distribution.fast },
    { label: '5-30m', count: distribution.momentum },
    { label: '30m-4h', count: distribution.intraday },
    { label: '4-24h', count: distribution.day },
    { label: '1-7d', count: distribution.swing },
    { label: '7+d', count: distribution.position },
  ];

  // Find top 2 counts
  const sortedCounts = [...items].sort((a, b) => b.count - a.count);
  const topCount = sortedCounts[0]?.count || 0;
  const secondCount = sortedCounts[1]?.count || 0;

  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        const isTop = item.count === topCount && item.count > 0;
        const isSecond = item.count === secondCount && item.count > 0 && item.count !== topCount;

        return (
          <div key={idx} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{item.label}</span>
            <span
              className={`font-semibold tabular-nums ${
                isTop
                  ? 'text-emerald-500 font-bold drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : isSecond
                  ? 'text-blue-400 font-bold drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]'
                  : ''
              }`}
            >
              {item.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatHoldTime(hours: number | null): string {
  if (hours === null) return 'N/A';
  if (hours < 1/60) return `${Math.round(hours * 3600)}s`;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (hours < 168) return `${(hours/24).toFixed(1)}d`;
  return `${(hours/168).toFixed(1)}w`;
}

function getHoldInsight(hours: number | null): string {
  if (hours === null) return 'No data';
  if (hours < 1/60) return 'Ultra-fast bot';
  if (hours < 1/12) return 'Instant exits';
  if (hours < 1) return 'Sub-hour flips';
  if (hours < 4) return 'Quick trades';
  if (hours < 24) return 'Intraday holds';
  if (hours < 168) return 'Multi-day holds';
  return 'Long-term holder';
}

function getQualityIndicator(tier: string): { color: string; label: string; bgColor: string } {
  switch (tier) {
    case 'HIGH':
      return { color: 'bg-emerald-500', label: 'High quality', bgColor: 'bg-emerald-500/10' };
    case 'MEDIUM':
      return { color: 'bg-blue-500', label: 'Medium quality', bgColor: 'bg-blue-500/10' };
    case 'LOW':
      return { color: 'bg-yellow-500', label: 'Low quality', bgColor: 'bg-yellow-500/10' };
    case 'INSUFFICIENT':
      return { color: 'bg-red-500', label: 'Insufficient data', bgColor: 'bg-red-500/10' };
    default:
      return { color: 'bg-gray-500', label: 'Unknown', bgColor: 'bg-gray-500/10' };
  }
}

export function WalletBaseballCard({ profile, walletAddress }: Props) {
  const qualityIndicator = getQualityIndicator(profile.dataQualityTier);
  const hasFallbackData = profile.completedCycleCount === 0 && profile.medianHoldTimeHours !== null;
  const isInsufficientData = profile.dataQualityTier === 'INSUFFICIENT';

  return (
    <div className="rounded-lg border bg-card hover:shadow-md transition-shadow overflow-hidden">
      {/* Header Section - Distinct Background */}
      <div className={`p-3 border-b ${qualityIndicator.bgColor}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-mono font-semibold">
            {formatAddress(walletAddress)}
          </p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`w-2.5 h-2.5 rounded-full ${qualityIndicator.color} ring-2 ring-background`} />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-semibold">{qualityIndicator.label}</p>
                <p className="text-xs text-muted-foreground">{profile.completedCycleCount} completed tokens</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Behavior Badge Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${getBehaviorColor(profile.behaviorType)}`}>
            {profile.behaviorType ?? 'UNCLASSIFIED'}
          </span>
          <span className="text-xs text-muted-foreground font-medium">
            {Math.round(profile.confidence * 100)}%
          </span>
          <span className="text-[10px] text-muted-foreground">
            {profile.completedCycleCount} tokens
          </span>
        </div>
      </div>

      {/* Fallback Warning Banner */}
      {hasFallbackData && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Including tokens currently held (no exits yet)
          </p>
        </div>
      )}

      {/* Metrics Grid - Two Column Layout */}
      <div className="p-3 grid grid-cols-[1fr_auto] gap-3">
        {/* Left Column: Hold Metrics */}
        <div className="space-y-2">
          {/* Median Hold - Compact */}
          <div className="bg-muted/30 rounded-md p-2 border">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
              Median Hold
            </p>
            <p className="text-2xl font-bold tabular-nums leading-none">
              {formatHoldTime(profile.medianHoldTimeHours)}
            </p>
            <p className="text-[10px] text-muted-foreground italic mt-0.5">
              {getHoldInsight(profile.medianHoldTimeHours)}
            </p>
          </div>

          {/* Average Hold */}
          <div className="bg-muted/20 rounded-md p-2 border">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
              Avg Hold
            </p>
            <p className="text-lg font-bold tabular-nums">
              {formatHoldTime(profile.avgHoldTimeHours)}
            </p>
          </div>

          {/* Flip Ratio */}
          <div className="bg-muted/20 rounded-md p-2 border">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
              Flip Ratio
            </p>
            <p className="text-lg font-bold tabular-nums">
              {profile.dailyFlipRatio !== null ? `${profile.dailyFlipRatio.toFixed(0)}%` : 'N/A'}
            </p>
          </div>
        </div>

        {/* Right Column: Exit Timing Breakdown */}
        <div className="bg-muted/10 rounded-md p-2.5 border w-[140px]">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Exit Timing
          </p>
          {profile.holdTimeDistribution ? (
            <ExitTimingBreakdown distribution={profile.holdTimeDistribution} />
          ) : (
            <p className="text-xs text-muted-foreground">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
