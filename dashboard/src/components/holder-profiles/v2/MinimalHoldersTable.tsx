import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor, getBehaviorDescription, getBehaviorMeta, getQualityColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  onSelect?: (profile: HolderProfile) => void;
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
                    <p className="text-muted-foreground">
                      Trading behavior classification based on typical exited hold times; current holdings do not affect this tag.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
            <th className="text-left px-4 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">Exited Hold</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">
                      Hold times calculated only from completed exits. Median = typical exit; Average = mean across all exits.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
            <th className="text-left px-4 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">Active + Exited</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">
                      Mixes current holdings with exits to show present behavior. Use alongside exit-only stats to spot recent shifts.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
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
            const isHolderOnly = !profile.behaviorType && (profile.currentHoldingsCount ?? 0) > 0;
            const behaviorMeta = getBehaviorMeta(profile.behaviorType) ?? (isHolderOnly
              ? {
                  label: 'Holder (no exits yet)',
                  description: 'No completed exits yet; classification will update once exits occur.',
                  timeframe: 'Not enough exits',
                }
              : null);
            const behaviorDisplayType = profile.behaviorType ?? (isHolderOnly ? 'HOLDER' : null);
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
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getBehaviorColor(behaviorDisplayType)}`}
                        >
                          {behaviorMeta?.label ?? profile.behaviorType ?? 'Unclassified'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        {(() => {
                          const info = getBehaviorDescription(profile.behaviorType) || behaviorMeta;
                          if (!info) {
                            return <p className="text-muted-foreground">No behavior classification yet.</p>;
                          }
                          return (
                            <div className="space-y-1">
                              <p className="font-semibold">{info.title ?? info.label}</p>
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
                </td>
                <td className="px-4 py-2">
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(profile.dataQualityTier)}`}>
                          {profile.dataQualityTier}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        <p className="font-semibold mb-1">{profile.dataQualityTier || 'Unknown quality'}</p>
                        <p className="text-muted-foreground">{getQualityDescription(profile.dataQualityTier)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
