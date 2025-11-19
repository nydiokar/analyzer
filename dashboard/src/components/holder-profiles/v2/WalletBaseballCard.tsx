import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, formatPercentage, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
  const buckets = [
    { label: '<1s', count: distribution.instant ?? 0 },
    { label: '<1m', count: distribution.ultraFast ?? 0 },
    { label: '1-5m', count: distribution.fast ?? 0 },
    { label: '5-30m', count: distribution.momentum ?? 0 },
    { label: '30m-4h', count: distribution.intraday ?? 0 },
    { label: '4-24h', count: distribution.day ?? 0 },
    { label: '1-7d', count: distribution.swing ?? 0 },
    { label: '7+d', count: distribution.position ?? 0 },
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

        return (
          <div key={bucket.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 text-muted-foreground">{bucket.label}</span>
            <div className="flex-1 h-3 bg-muted/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 via-teal-400/70 to-sky-500/80"
                style={{ width: `${widthPercent}%`, opacity: 0.35 + relativeValue * 0.65 }}
              />
            </div>
            <span className="w-9 text-right font-mono text-muted-foreground">{label}</span>
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
  footer?: string;
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
          <p className="text-xl font-semibold tabular-nums">{mixedValue}</p>
        </div>
      </div>
      {footer && <p className="text-[11px] text-muted-foreground">{footer}</p>}
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

      <div className="p-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3">
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
              typeof profile.percentValueInCurrentHoldings === 'number'
                ? `Value still held: ${formatPercentage(profile.percentValueInCurrentHoldings)}`
                : undefined
            }
          />
        </div>

        <div className="bg-muted/10 rounded-md p-3 border w-full lg:w-[160px]">
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
