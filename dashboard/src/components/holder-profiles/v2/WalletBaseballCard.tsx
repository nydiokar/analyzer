import React, { useEffect, useMemo, useState } from 'react';
import type { HolderProfile } from '../types';
import { formatHoldTime, formatHoldSource, formatPercentage, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor, getBehaviorMeta } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ExitTimingDrilldownPanel } from './ExitTimingDrilldownPanel';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { TransactionDateRange } from './TransactionDateRange';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { InfoIcon } from 'lucide-react';

const formatBalanceCompact = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
};

interface Props {
  profile: HolderProfile;
  walletAddress: string;
}

type TimeBucket = 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';

function getTimeBucketDescription(bucket: TimeBucket): { title: string; description: string; tradingStyle: string } {
  const descriptions: Record<TimeBucket, { title: string; description: string; tradingStyle: string }> = {
    instant: {
      title: 'Instant Exits (< 1 second)',
      description: 'Lightning-fast exits executed within a second. These are typically algorithmic trades, MEV bot activity, or automated arbitrage strategies.',
      tradingStyle: 'Style: Algorithmic / Bot-driven'
    },
    ultraFast: {
      title: 'Ultra-Fast Exits (< 1 minute)',
      description: 'Very rapid scalping trades that capture immediate price movements. Common in high-frequency trading strategies.',
      tradingStyle: 'Style: High-frequency scalping'
    },
    fast: {
      title: 'Fast Exits (1-5 minutes)',
      description: 'Quick momentum captures targeting short-lived price spikes. Traders look for rapid entry and exit opportunities.',
      tradingStyle: 'Style: Scalping / Quick momentum'
    },
    momentum: {
      title: 'Momentum Exits (5-30 minutes)',
      description: 'Short-term trend following where traders ride momentum for 5-30 minutes. Enter on strength, exit when momentum fades.',
      tradingStyle: 'Style: Momentum trading'
    },
    intraday: {
      title: 'Intraday Exits (30m - 4 hours)',
      description: 'Intraday positions held for several hours but typically closed within the same trading session. Focuses on intraday price action.',
      tradingStyle: 'Style: Intraday trading'
    },
    day: {
      title: 'Day Exits (4-24 hours)',
      description: 'Day trading positions that complete within 24 hours. May hold overnight but typically close within a day.',
      tradingStyle: 'Style: Day trading'
    },
    swing: {
      title: 'Swing Exits (1-7 days)',
      description: 'Medium-term swing trades capitalizing on multi-day price movements. Traders hold through minor fluctuations to capture larger swings.',
      tradingStyle: 'Style: Swing trading'
    },
    position: {
      title: 'Position Exits (7+ days)',
      description: 'Long-term positions held for weeks or months. Reflects patient trading with conviction in fundamental value.',
      tradingStyle: 'Style: Position trading / Holding'
    },
  };
  return descriptions[bucket];
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
      label: '<1 sec',
      count: distribution.instant ?? 0,
      bucket: 'instant',
      winRate: enrichedDistribution?.instant.winRate,
      roiPercent: enrichedDistribution?.instant.roiPercent
    },
    {
      label: '<1 min',
      count: distribution.ultraFast ?? 0,
      bucket: 'ultraFast',
      winRate: enrichedDistribution?.ultraFast.winRate,
      roiPercent: enrichedDistribution?.ultraFast.roiPercent
    },
    {
      label: '1-5 min',
      count: distribution.fast ?? 0,
      bucket: 'fast',
      winRate: enrichedDistribution?.fast.winRate,
      roiPercent: enrichedDistribution?.fast.roiPercent
    },
    {
      label: '5-30 min',
      count: distribution.momentum ?? 0,
      bucket: 'momentum',
      winRate: enrichedDistribution?.momentum.winRate,
      roiPercent: enrichedDistribution?.momentum.roiPercent
    },
    {
      label: '30 min-4h',
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

        const bucketInfo = getTimeBucketDescription(bucket.bucket);

        return (
          <TooltipProvider key={bucket.label} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-10 text-muted-foreground cursor-help">{bucket.label}</span>
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
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs" side="left">
                <p className="font-semibold mb-1">{bucketInfo.title}</p>
                <p className="text-muted-foreground mb-2">{bucketInfo.description}</p>
                <p className="text-xs text-primary font-medium">{bucketInfo.tradingStyle}</p>
                {rawValue > 0 && (
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                    💡 Click the bar to see specific tokens in this timeframe
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
  tooltip?: string;
}) {
  const {
    label,
    exitedLabel = 'Exited',
    exitedValue,
    mixedLabel = 'Active + exited',
    mixedValue,
    highlightMixed,
    footer,
    tooltip,
  } = props;

  return (
    <div className="bg-muted/30 rounded-md p-3 border space-y-3">
      <div className="flex items-center gap-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
        {tooltip && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
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
    case 'GOLD':
      return { dot: 'bg-yellow-500', panel: 'bg-yellow-500/10', label: 'Gold quality' };
    case 'SILVER':
      return { dot: 'bg-gray-400', panel: 'bg-gray-400/10', label: 'Silver quality' };
    case 'BRONZE':
      return { dot: 'bg-orange-700', panel: 'bg-orange-700/10', label: 'Bronze quality' };
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
  const HOLDINGS_BATCH_SIZE = 30;
  const [holdingsDisplayLimit, setHoldingsDisplayLimit] = useState(HOLDINGS_BATCH_SIZE);

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
  const behaviorDisplayType = profile.behaviorType ?? (heldTokens > 0 ? 'HOLDER' : null);
  const currentHoldingsList = useMemo(
    () => (profile.currentHoldings || [])
      .filter((holding) => (holding.uiBalance ?? 0) > 0)
      .sort((a, b) => (b.uiBalance ?? 0) - (a.uiBalance ?? 0)),
    [profile.currentHoldings]
  );
  const hasHoldingsList = currentHoldingsList.length > 0;
  const displayedHoldings = currentHoldingsList.slice(0, holdingsDisplayLimit);
  const canLoadMoreHoldings = holdingsDisplayLimit < currentHoldingsList.length;
  const estimatedHeld =
    heldTokens > 0
      ? heldTokens
      : percentHeldValue > 0
        ? Math.max(1, Math.round((percentHeldValue / 100) * Math.max(totalTokens, 1)))
        : 0;
  const activeTokens = heldTokens > 0 ? heldTokens : estimatedHeld;
  const heldDisplay = activeTokens > 0 ? activeTokens.toLocaleString() : '0';
  const unresolvedTokens = Math.max(totalTokens - exitedTokens - activeTokens, 0);
  const tokensSummary = `${totalTokens.toLocaleString()} tokens`;
  const exitHoldSummary = `Exited: ${exitedTokens.toLocaleString()} · Active: ${heldDisplay}${unresolvedTokens ? ` · Other: ${unresolvedTokens.toLocaleString()}` : ''}`;

  const toggleHoldingsVisibility = () => {
    if (!hasHoldingsList) return;
    setShowHoldings((prev) => {
      const next = !prev;
      if (next) {
        setHoldingsDisplayLimit(HOLDINGS_BATCH_SIZE);
      }
      return next;
    });
  };

  const closeHoldingsList = () => {
    setShowHoldings(false);
    setHoldingsDisplayLimit(HOLDINGS_BATCH_SIZE);
  };

  const loadMoreHoldings = () => {
    setHoldingsDisplayLimit((prev) => Math.min(prev + HOLDINGS_BATCH_SIZE, currentHoldingsList.length));
  };

  useEffect(() => {
    setShowHoldings(false);
    setHoldingsDisplayLimit(HOLDINGS_BATCH_SIZE);
  }, [profile.walletAddress]);

  return (
    <div className="rounded-lg border bg-card hover:shadow-md transition-shadow overflow-hidden">
      <div className={`p-3 border-b ${qualityIndicator.panel}`}>
        <div className="flex items-center justify-between mb-2">
          <WalletBadge address={walletAddress} className="text-sm font-semibold" />
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
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-help ${getBehaviorColor(behaviorDisplayType)}`}>
                    {getBehaviorMeta(profile.behaviorType)?.label
                      ?? (heldTokens > 0 ? 'Holder (no exits yet)' : profile.behaviorType)
                      ?? 'Unclassified'}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm text-xs">
                  <p className="font-semibold mb-2">
                    {getBehaviorMeta(profile.behaviorType)?.label
                      ?? (heldTokens > 0 ? 'Holder (no exits yet)' : profile.behaviorType)
                      ?? 'Unclassified'}
                  </p>
                  <p className="text-muted-foreground mb-2">
                    {getBehaviorMeta(profile.behaviorType)?.timeframe
                      ? `Typical hold time: ${getBehaviorMeta(profile.behaviorType)?.timeframe}`
                      : heldTokens > 0
                        ? 'Not enough completed exits to classify speed'
                        : 'No exit data available'}
                  </p>
                  <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
                    <p className="font-medium mb-1">Speed Categories:</p>
                    <ul className="space-y-0.5 text-[10px]">
                      <li>• SNIPER: &lt;1 min exits</li>
                      <li>• SCALPER: 1-5 min exits</li>
                      <li>• MOMENTUM: 5-30 min exits</li>
                      <li>• INTRADAY: 30min-4h exits</li>
                      <li>• DAY_TRADER: 4-24h exits</li>
                      <li>• SWING: 1-7 day holds</li>
                      <li>• POSITION: 7-30 day holds</li>
                      <li>• HOLDER: 30+ day holds</li>
                    </ul>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground cursor-help">
                    {Math.round(profile.confidence * 100)}% confidence
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p className="font-semibold mb-1">Classification Confidence</p>
                  <p className="text-muted-foreground">
                    Statistical confidence in the behavior classification. Higher confidence means more consistent trading patterns with sufficient data points.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-[10px] font-semibold text-muted-foreground cursor-help">
                  {tokensSummary} / {exitHoldSummary}
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p className="font-semibold mb-1">Token accounting</p>
                <p className="text-muted-foreground">
                Total analyzed / fully exited / active holdings. "Other" covers dust/spam/partial data, not classify as active or exited.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <TransactionDateRange
          oldestTimestamp={profile.oldestTransactionTimestamp}
          newestTimestamp={profile.newestTransactionTimestamp}
        />
      </div>

      <div className="p-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] gap-4">
        <div className="space-y-3">
          <HoldMetricCard
            label="Median Hold"
            exitedValue={formatHoldTime(realizedMedian)}
            mixedValue={formatHoldTime(inclusiveMedian)}
            highlightMixed={includesCurrentData}
            mixedLabel={formatHoldSource(profile.typicalHoldTimeSource)}
            tooltip="Median hold time across exits: half of the exits were faster and half slower. The mixed value blends current positions with exits to reflect present behavior."
          />
          <HoldMetricCard
            label="Average Hold"
            exitedValue={formatHoldTime(realizedAverage)}
            mixedValue={formatHoldTime(inclusiveAverage)}
            highlightMixed={includesCurrentData}
            mixedLabel={formatHoldSource(profile.typicalHoldTimeSource)}
            footer={
              typeof profile.percentValueInCurrentHoldings === 'number' ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={toggleHoldingsVisibility}
                        disabled={!hasHoldingsList}
                        className={`underline-offset-2 ${hasHoldingsList ? 'underline hover:text-primary transition-colors' : 'text-muted-foreground cursor-not-allowed'}`}
                      >
                        Value still held: {formatPercentage(profile.percentValueInCurrentHoldings)}{' '}
                        {hasHoldingsList ? '(click to view tokens)' : '(no current tokens detected)'}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      <p className="font-semibold mb-1">Value still held</p>
                      <p className="text-muted-foreground">
                        Percentage of portfolio value still in current holdings. May differ from token counts because dust/low-balance tokens are filtered by backend thresholds.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : undefined
            }
            tooltip="Average (mean) hold duration. Sensitive to outliers; compare against the median to spot skew from very long or very short trades. Mixed value includes active positions to show current behavior."
          />
        </div>

        <div className="bg-muted/10 rounded-md p-3 border w-full lg:min-w-[280px]">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 cursor-help w-fit">
                  Exit Timing
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                <p className="font-semibold mb-1">Exit Timing Distribution</p>
                <p className="text-muted-foreground mb-2">
                  Shows how long this holder typically keeps positions before exiting.
                  Each bar represents the proportion of exits within that timeframe.
                </p>
                <p className="text-xs text-primary font-medium">
                  Hover over time ranges for detailed descriptions
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
              Current holdings ({Math.min(displayedHoldings.length, currentHoldingsList.length)}
              {canLoadMoreHoldings ? ` of ${currentHoldingsList.length}` : ''})
            </p>
            <button
              onClick={closeHoldingsList}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <div className="grid gap-1 md:grid-cols-2">
              {displayedHoldings.map((holding) => (
                <div key={holding.tokenAddress} className="flex items-center justify-between rounded-md border bg-background px-2 py-1">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <TokenBadge mint={holding.tokenAddress} variant="inline" size="sm" className="min-w-0" />
                  </div>
                  <div className="text-xs text-muted-foreground text-right leading-tight flex-shrink-0 ml-2">
                    Bal: {formatBalanceCompact(holding.uiBalance)}
                  </div>
                </div>
              ))}
            </div>
            {canLoadMoreHoldings && (
              <div className="sticky bottom-0 pt-2 pb-1 bg-muted/10">
                <button
                  onClick={loadMoreHoldings}
                  className="w-full text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Load more tokens
                </button>
              </div>
            )}
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
