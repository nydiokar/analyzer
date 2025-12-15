import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorBarColor, getBehaviorColor, getQualityColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  onSelect?: (profile: HolderProfile) => void;
}

const behaviorDescriptions: Record<
  string,
  { title: string; description: string; timeframe: string }
> = {
  SNIPER: {
    title: 'Sniper',
    description:
      'Lightning-fast traders who target specific price points with precision timing. Often algorithmic or bot-driven.',
    timeframe: 'Hold time: < 1 second',
  },
  SCALPER: {
    title: 'Scalper',
    description:
      'High-frequency traders capturing small price movements. Execute many trades per day for incremental gains.',
    timeframe: 'Hold time: < 1 minute',
  },
  MOMENTUM: {
    title: 'Momentum Trader',
    description:
      'Traders who ride short-term price trends and momentum. Enter on strength and exit when momentum fades.',
    timeframe: 'Hold time: 5-30 minutes',
  },
  INTRADAY: {
    title: 'Intraday Trader',
    description:
      'Full-session traders who analyze price action throughout the day. Hold positions for several hours but close before day end.',
    timeframe: 'Hold time: 30 minutes - 4 hours',
  },
  DAY_TRADER: {
    title: 'Day Trader',
    description:
      'Traders who complete their positions within 24 hours. May hold overnight but typically close within a day.',
    timeframe: 'Hold time: 4-24 hours',
  },
  SWING: {
    title: 'Swing Trader',
    description:
      'Medium-term traders who capitalize on multi-day price swings. Hold through minor fluctuations to capture larger moves.',
    timeframe: 'Hold time: 1-7 days',
  },
  POSITION: {
    title: 'Position Trader',
    description:
      'Patient traders who take long-term positions based on fundamental analysis. Willing to hold through volatility.',
    timeframe: 'Hold time: 7+ days',
  },
  HOLDER: {
    title: 'Holder',
    description:
      'Long-term investors with strong conviction. Hold assets for extended periods regardless of short-term price action.',
    timeframe: 'Hold time: Extended (weeks to months)',
  },
};

function getBehaviorDescription(type: string | null | undefined) {
  if (!type) return null;
  return behaviorDescriptions[type] ?? null;
}

function getQualityDescription(tier: string | null | undefined): string {
  if (!tier) return 'Quality tier unknown';
  const descriptions: Record<string, string> = {
    GOLD: 'Gold tier: Highest quality data with comprehensive transaction history and strong statistical significance',
    SILVER: 'Silver tier: Good quality data with sufficient transaction history for reliable analysis',
    BRONZE: 'Bronze tier: Basic quality data with limited transaction history, analysis may be less reliable',
    INSUFFICIENT: 'Insufficient data: Not enough transactions for reliable behavioral classification',
  };
  return descriptions[tier] || 'Data quality classification';
}

export function MinimalHoldersTable({ profiles, mode, onSelect }: Props) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {mode === 'token' && <th className="text-left px-4 py-2">Rank</th>}
            <th className="text-left px-4 py-2">Wallet</th>
            <th className="text-left px-4 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">Behavior</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">Trading behavior classification based on typical hold times from completed positions</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
            <th className="text-left px-4 py-2">Exited Hold</th>
            <th className="text-left px-4 py-2">Active + Exited</th>
            <th className="text-left px-4 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">Quality</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">Data quality tier based on transaction history depth and statistical significance</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const typicalHold = getTypicalHoldTimeHours(profile);
            const exitedMedian = profile.realizedMedianHoldTimeHours ?? profile.medianHoldTimeHours;
            const exitedAverage = profile.realizedAverageHoldTimeHours ?? profile.avgHoldTimeHours;
            return (
              <tr
                key={profile.walletAddress}
                className={`border-t border-border/60 ${onSelect ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                onClick={onSelect ? () => onSelect(profile) : undefined}
              >
                {mode === 'token' && <td className="px-4 py-2 text-muted-foreground">#{profile.rank}</td>}
                <td className="px-4 py-2 font-mono text-xs">{formatAddress(profile.walletAddress)}</td>
                <td className="px-4 py-2">
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getBehaviorColor(profile.behaviorType)}`}
                        >
                          {profile.behaviorType ?? '🏷️'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        {(() => {
                          const info = getBehaviorDescription(profile.behaviorType);
                          if (!info) {
                            return <p className="text-muted-foreground">No behavior classification yet.</p>;
                          }
                          return (
                            <div className="space-y-1">
                              <p className="font-semibold">{info.title}</p>
                              <p className="text-muted-foreground">{info.description}</p>
                              <p className="text-primary font-medium">{info.timeframe}</p>
                            </div>
                          );
                        })()}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className="px-4 py-2 text-xs">
                  <div className="font-semibold text-sm">Median: {formatHoldTime(exitedMedian)}</div>
                  <div className="text-muted-foreground text-[11px]">
                    Average: {formatHoldTime(exitedAverage)}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">
                  <div className="font-semibold text-sm">Median: {formatHoldTime(typicalHold)}</div>
                  <div className="text-muted-foreground text-[11px]">
                    Average: {formatHoldTime(profile.currentHoldAverageHours ?? typicalHold)}
                  </div>
                  <div className="text-muted-foreground text-[11px]" title="Active + exited mixes current holdings with exited positions">
                    Source: {formatHoldSource(profile.typicalHoldTimeSource)}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(profile.dataQualityTier)}`}>
                    {profile.dataQualityTier}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
