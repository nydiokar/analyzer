import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor, getQualityColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  onSelect?: (profile: HolderProfile) => void;
}

function getBehaviorDescription(type: string | null | undefined): string {
  if (!type) return 'No behavior classification yet';
  const descriptions: Record<string, string> = {
    SNIPER: 'Lightning-fast trader (< 1 second holds)',
    SCALPER: 'High-frequency scalper (< 1 minute holds)',
    MOMENTUM: 'Momentum trader (5-30 minutes holds)',
    INTRADAY: 'Intraday trader (30m - 4 hours holds)',
    DAY_TRADER: 'Day trader (4-24 hours holds)',
    SWING: 'Swing trader (1-7 days holds)',
    POSITION: 'Position trader (7+ days holds)',
    HOLDER: 'Long-term holder (extended holds)',
  };
  return descriptions[type] || 'Trading behavior classification';
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
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getBehaviorColor(profile.behaviorType)}`}>
                    {profile.behaviorType ?? '🏷️'}
                  </span>
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
