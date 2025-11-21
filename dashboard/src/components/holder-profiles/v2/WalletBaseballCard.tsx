import React, { useState } from 'react';
import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, formatPercentage, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ExitTimingDrilldownPanel } from './ExitTimingDrilldownPanel';
import { TokenBadge } from '@/components/shared/TokenBadge';

const formatBalanceCompact = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
};

interface Props {
  profile: HolderProfile;
  walletAddress: string;
}

type TimeBucket = 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';

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
  enrichedDistribution?: {
    instant: { count: number; winRate: number; roiPercent: number };
    ultraFast: { count: number; winRate: number; roiPercent: number };
    fast: { count: number; winRate: number; roiPercent: number };
    momentum: { count: number; winRate: number; roiPercent: number };
    intraday: { count: number; winRate: number; roiPercent: number };
    day: { count: number; winRate: number; roiPercent: number };
    swing: { count: number; winRate: number; roiPercent: number };
    position: { count: number; winRate: number; roiPercent: number };
  };
  walletAddress: string;
  onBucketClick: (bucket: TimeBucket, label: string, anchor: { x: number; y: number }) => void;
}

function ExitTimingBreakdown({ distribution, enrichedDistribution, walletAddress, onBucketClick }: ExitTimingBreakdownProps) {
  const buckets: Array<{ label: string; count: number; bucket: TimeBucket; winRate?: number; roiPercent?: number }> = [
    {
      label: '<1s',
      count: distribution.instant ?? 0,
      bucket: 'instant',
      winRate: enrichedDistribution?.instant.winRate,
      roiPercent: enrichedDistribution?.instant.roiPercent
    },
    {
      label: '<1m',
      count: distribution.ultraFast ?? 0,
      bucket: 'ultraFast',
      winRate: enrichedDistribution?.ultraFast.winRate,
      roiPercent: enrichedDistribution?.ultraFast.roiPercent
    },
    {
      label: '1-5m',
      count: distribution.fast ?? 0,
      bucket: 'fast',
      winRate: enrichedDistribution?.fast.winRate,
      roiPercent: enrichedDistribution?.fast.roiPercent
    },
    {
      label: '5-30m',
      count: distribution.momentum ?? 0,
      bucket: 'momentum',
      winRate: enrichedDistribution?.momentum.winRate,
      roiPercent: enrichedDistribution?.momentum.roiPercent
    },
    {
      label: '30m-4h',
      count: distribution.intraday ?? 0,
      bucket: 'intraday',
      winRate: enrichedDistribution?.intraday.winRate,
      roiPercent: enrichedDistribution?.intraday.roiPercent
    },
    {
      label: '4-24h',
      count: distribution.day ?? 0,
      bucket: 'day',
      winRate: enrichedDistribution?.day.winRate,
      roiPercent: enrichedDistribution?.day.roiPercent
    },
    {
      label: '1-7d',
      count: distribution.swing ?? 0,
      bucket: 'swing',
      winRate: enrichedDistribution?.swing.winRate,
      roiPercent: enrichedDistribution?.swing.roiPercent
    },
    {
      label: '7+d',
      count: distribution.position ?? 0,
      bucket: 'position',
      winRate: enrichedDistribution?.position.winRate,
      roiPercent: enrichedDistribution?.position.roiPercent
    },
  ];

  const values = buckets.map((bucket) => bucket.count ?? 0);
  const isNormalized = values.every((value) => value >= 0 && value <= 1);
  const maxCount = Math.max(...values, 0);

  return (
    <div className="space-y-1.5">
      {buckets.map((bucket) => {
        const rawValue = bucket.count ?? 0;
        const relativeValue = isNormalized
          ? rawValue
          : maxCount > 0
            ? rawValue / maxCount
            : 0;
        const easedValue = relativeValue > 0 ? Math.pow(relativeValue, 0.35) : 0;
        const widthPercent = rawValue > 0 ? Math.min(100, 18 + easedValue * 82) : 0;
        const label = isNormalized
          ? `${Math.round(rawValue * 100)}%`
          : rawValue.toLocaleString();

        // ROI color logic
        const hasMetrics = bucket.winRate !== undefined && bucket.roiPercent !== undefined && rawValue > 0;
        const roiColor = hasMetrics
          ? bucket.roiPercent! > 0
            ? 'text-emerald-500'
            : bucket.roiPercent! < 0
              ? 'text-red-400'
              : 'text-muted-foreground'
          : '';

        return (
          <div key={bucket.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 text-muted-foreground">{bucket.label}</span>
            <div
              className="flex-1 h-3 bg-muted/20 rounded-full overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              onClick={(e) => rawValue > 0 && onBucketClick(bucket.bucket, bucket.label, { x: e.clientX, y: e.clientY })}
              title={rawValue > 0 ? `Click to see ${label} tokens in ${bucket.label} range` : undefined}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 via-teal-400/70 to-sky-500/80"
                style={{ width: `${widthPercent}%`, opacity: 0.35 + relativeValue * 0.65 }}
              />
            </div>
            <span className="w-9 text-right font-mono text-muted-foreground">{label}</span>
            {hasMetrics && (
              <span className={`w-32 text-right text-xs font-mono ${roiColor}`}>
                {bucket.winRate!.toFixed(0)}% WR, {bucket.roiPercent! > 0 ? '+' : ''}{bucket.roiPercent!.toFixed(0)}% ROI
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HoldMetricCard(props: {
  label: string;
  exitedLabel?: string;
  exitedValue: string;
  mixedLabel?: string;
  mixedValue: string;
  highlightMixed?: boolean;
  footer?: React.ReactNode;
}) {
  const { label, exitedLabel = 'Exited', exitedValue, mixedLabel = 'Active + exited', mixedValue, highlightMixed, footer } =
    props;

  return (
    <div className="bg-muted/30 rounded-md p-3 border space-y-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">{exitedLabel}</p>
          <p className="text-xl font-semibold tabular-nums">{exitedValue}</p>
        </div>
        <div className={highlightMixed ? 'rounded-md bg-primary/5 p-2 -m-1 space-y-1' : ''}>
          <p className="text-[11px] text-muted-foreground">{mixedLabel}</p>
          <p className="text-lg font-semibold tabular-nums whitespace-nowrap leading-tight">{mixedValue}</p>
        </div>
      </div>
      {footer && <div className="text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

function getQualityIndicator(tier?: string) {
  switch (tier) {
    case 'HIGH':
      return { dot: 'bg-emerald-500', panel: 'bg-emerald-500/10', label: 'High quality' };
    case 'MEDIUM':
      return { dot: 'bg-blue-500', panel: 'bg-blue-500/10', label: 'Medium quality' };
    case 'LOW':
      return { dot: 'bg-yellow-500', panel: 'bg-yellow-500/10', label: 'Low quality' };
    case 'INSUFFICIENT':
      return { dot: 'bg-red-500', panel: 'bg-red-500/10', label: 'Insufficient data' };
    default:
      return { dot: 'bg-gray-400', panel: 'bg-muted', label: 'Unknown' };
  }
}

export function WalletBaseballCard({ profile, walletAddress }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<{ bucket: TimeBucket; label: string; anchor: { x: number; y: number } } | null>(null);
  const [showHoldings, setShowHoldings] = useState(false);

  const handleBucketClick = (bucket: TimeBucket, label: string, anchor: { x: number; y: number }) => {
    // Toggle: if clicking the same bucket, close the panel
    if (selectedBucket?.bucket === bucket && panelOpen) {
      setPanelOpen(false);
      setSelectedBucket(null);
    } else {
      setSelectedBucket({ bucket, label, anchor });
      setPanelOpen(true);
    }
  };

  const qualityIndicator = getQualityIndicator(profile.dataQualityTier);
  const typicalHold = getTypicalHoldTimeHours(profile);
  const realizedMedian = profile.realizedMedianHoldTimeHours ?? profile.medianHoldTimeHours ?? null;
  const realizedAverage = profile.realizedAverageHoldTimeHours ?? profile.avgHoldTimeHours ?? null;
  const inclusiveMedian = typicalHold ?? profile.currentHoldMedianHours ?? realizedMedian;
  const inclusiveAverage = profile.avgHoldTimeHours ?? profile.currentHoldAverageHours ?? realizedAverage;
  const includesCurrentData =
    profile.typicalHoldTimeSource === 'CURRENT' || profile.typicalHoldTimeSource === 'MIXED';
  const totalTokens = profile.totalTokensTraded ?? profile.completedCycleCount ?? 0;
  const heldTokens = profile.currentHoldingsCount ?? 0;
  const exitedTokens = profile.completedCycleCount ?? 0;
  const percentHeldValue = profile.percentValueInCurrentHoldings ?? 0;
  const currentHoldingsList = (profile.currentHoldings || []).filter(h => (h.uiBalance ?? 0) > 0);
  const hasHoldingsList = currentHoldingsList.length > 0;
  const estimatedHeld =
    heldTokens > 0
      ? heldTokens
      : percentHeldValue > 0
        ? Math.max(1, Math.round((percentHeldValue / 100) * Math.max(totalTokens, 1)))
        : 0;
  const heldDisplay =
    heldTokens > 0
      ? heldTokens.toLocaleString()
      : percentHeldValue > 0
        ? `~${estimatedHeld.toLocaleString()}`
        : '0';
  const tokensSummary = `${totalTokens.toLocaleString()} tokens`;
  const exitHoldSummary = `${exitedTokens.toLocaleString()} exited / ${heldDisplay} held`;

  return (
    <div className="rounded-lg border bg-card hover:shadow-md transition-shadow overflow-hidden">
      <div className={`p-3 border-b ${qualityIndicator.panel}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-mono font-semibold">{formatAddress(walletAddress)}</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`w-2.5 h-2.5 rounded-full ${qualityIndicator.dot} ring-2 ring-background`} />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-semibold">{qualityIndicator.label}</p>
                <p className="text-xs text-muted-foreground">
                  {profile.completedCycleCount} completed tokens
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-help ${getBehaviorColor(profile.behaviorType)}`}>
                    {profile.behaviorType ?? 'UNCLASSIFIED'}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Classification derived from typical exited hold time. Still-held positions do not affect this tag.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-xs text-muted-foreground">
              {Math.round(profile.confidence * 100)}% confidence
            </span>
          </div>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-[10px] font-semibold text-muted-foreground cursor-help">
                  {tokensSummary} / {exitHoldSummary}
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Total tokens analysed / fully exited tokens / estimated currently held tokens (estimated via % of value still held when counts are missing).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="p-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-3">
        <div className="space-y-3">
          <HoldMetricCard
            label="Median Hold"
            exitedValue={formatHoldTime(realizedMedian)}
            mixedValue={formatHoldTime(inclusiveMedian)}
            highlightMixed={includesCurrentData}
            mixedLabel={formatHoldSource(profile.typicalHoldTimeSource)}
          />
          <HoldMetricCard
            label="Average Hold"
            exitedValue={formatHoldTime(realizedAverage)}
            mixedValue={formatHoldTime(inclusiveAverage)}
            highlightMixed={includesCurrentData}
            mixedLabel={formatHoldSource(profile.typicalHoldTimeSource)}
            footer={
              typeof profile.percentValueInCurrentHoldings === 'number' ? (
                <button
                  onClick={() => hasHoldingsList && setShowHoldings(!showHoldings)}
                  disabled={!hasHoldingsList}
                  className={`underline-offset-2 ${hasHoldingsList ? 'underline hover:text-primary transition-colors' : 'text-muted-foreground cursor-not-allowed'}`}
                >
                  Value still held: {formatPercentage(profile.percentValueInCurrentHoldings)}{' '}
                  {hasHoldingsList ? '(click to view tokens)' : '(no current tokens detected)'}
                </button>
              ) : undefined
            }
          />
        </div>

        <div className="bg-muted/10 rounded-md p-3 border w-full lg:min-w-[280px]">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Exit Timing
          </p>
          {profile.holdTimeDistribution ? (
            <ExitTimingBreakdown
              distribution={profile.holdTimeDistribution}
              enrichedDistribution={profile.enrichedHoldTimeDistribution}
              walletAddress={walletAddress}
              onBucketClick={handleBucketClick}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No data</p>
          )}
        </div>
      </div>

      {showHoldings && hasHoldingsList && (
        <div className="px-3 pb-3 space-y-2 border-t bg-muted/10">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Current holdings ({currentHoldingsList.length})
            </p>
            <button
              onClick={() => setShowHoldings(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {currentHoldingsList.map((holding) => (
              <div key={holding.tokenAddress} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TokenBadge mint={holding.tokenAddress} size="sm" />
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  Bal: {formatBalanceCompact(holding.uiBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exit Timing Drilldown Panel */}
      {selectedBucket && (
        <ExitTimingDrilldownPanel
          walletAddress={walletAddress}
          timeBucket={selectedBucket.bucket}
          bucketLabel={selectedBucket.label}
          anchor={selectedBucket.anchor}
          isOpen={panelOpen}
          onClose={() => {
            setPanelOpen(false);
            setSelectedBucket(null);
          }}
        />
      )}
    </div>
  );
}
