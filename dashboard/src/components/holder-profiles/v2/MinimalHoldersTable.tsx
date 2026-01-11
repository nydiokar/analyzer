import type { HolderProfile } from '../types';
import { formatHoldTime, formatPercentage, formatSol, formatUsd } from './utils/formatters';
import { getBehaviorColor, getBehaviorDescription, getBehaviorMeta } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { InfoIcon } from 'lucide-react';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  tokenMint?: string;
  onSelect?: (profile: HolderProfile) => void;
  /** Set of wallet addresses to highlight (e.g., from similarity pair hover) */
  highlightedWallets?: Set<string>;
}

const SIGNIFICANT_HOLD_THRESHOLD_SOL = 0.3;

function getHoldingValueSol(profile: HolderProfile, tokenMint?: string) {
  const holdings = profile.currentHoldings ?? [];
  const filteredHoldings = tokenMint
    ? holdings.filter((holding) => holding.tokenAddress === tokenMint)
    : holdings;
  const total = filteredHoldings.reduce((sum, holding) => {
    if (typeof holding.valueSol === 'number') return sum + holding.valueSol;
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function getPnlDisplay(profile: HolderProfile) {
  if (typeof profile.walletPnlUsd === 'number') {
    return { value: formatUsd(profile.walletPnlUsd), raw: profile.walletPnlUsd };
  }
  if (typeof profile.walletPnlSol === 'number') {
    return { value: formatSol(profile.walletPnlSol), raw: profile.walletPnlSol };
  }
  return { value: '—', raw: null };
}

function hasSignificantHoldings(profile: HolderProfile) {
  return (profile.currentHoldings ?? []).some((holding) => (holding.valueSol ?? 0) >= SIGNIFICANT_HOLD_THRESHOLD_SOL);
}

export function MinimalHoldersTable({ profiles, mode, tokenMint, onSelect, highlightedWallets }: Props) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {mode === 'token' && (
              <th className="text-left px-4 py-2">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Rank <InfoIcon className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      <p className="text-muted-foreground">
                        Position based on holding value and behavioral similarity.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </th>
            )}
            <th className="text-left px-4 py-2">Wallet</th>
            <th className="text-left px-4 py-2">Holding Value</th>
            <th className="text-left px-4 py-2">PnL</th>
            <th className="text-left px-4 py-2">Behavior</th>
            <th className="text-left px-4 py-2 whitespace-nowrap">Exit timings</th>
            <th className="text-left px-4 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 cursor-help">
                      Current holdings <InfoIcon className="h-3 w-3 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">
                      Hold time for all currently held tokens across all positions with value ≥ 0.3 SOL.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
            <th className="text-left px-4 py-2">SOL Balance</th>
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
            const behaviorDisplayType = profile.behaviorType ?? (isHolderOnly ? 'HODLER' : null);
            const exitedMedian = profile.realizedMedianHoldTimeHours ?? null;
            const exitedAverage = profile.realizedAverageHoldTimeHours ?? null;
            const holdingValueSol = mode === 'token'
              ? (typeof profile.tokenHoldingValueSol === 'number'
                ? profile.tokenHoldingValueSol
                : getHoldingValueSol(profile, tokenMint))
              : getHoldingValueSol(profile, tokenMint);
            const totalHoldingsValueSol = getHoldingValueSol(profile);
            const supplyPercent = typeof profile.supplyPercent === 'number' ? profile.supplyPercent : null;
            const pnlDisplay = getPnlDisplay(profile);
            const currentHoldTime = hasSignificantHoldings(profile)
              ? (profile.currentHoldMedianHours ?? profile.currentHoldAverageHours)
              : null;
            const isHighlighted = highlightedWallets?.has(profile.walletAddress);
            return (
              <tr
                key={profile.walletAddress}
                className={`border-t border-border/60 transition-colors duration-200 ${
                  isHighlighted
                    ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                    : onSelect
                      ? 'cursor-pointer hover:bg-muted/40'
                      : ''
                }`}
                onClick={onSelect ? () => onSelect(profile) : undefined}
              >
                {mode === 'token' && <td className="px-4 py-2 text-muted-foreground">#{profile.rank}</td>}
                <td className="px-4 py-2">
                  <WalletBadge address={profile.walletAddress} size="sm" variant="inline" />
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium tabular-nums">
                      {holdingValueSol !== null ? formatSol(holdingValueSol) : '—'}
                    </span>
                    {supplyPercent !== null && supplyPercent > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {formatPercentage(supplyPercent, 2)} supply
                      </span>
                    )}
                  </div>
                </td>
                <td className={`px-4 py-2 font-medium tabular-nums ${pnlDisplay.raw === null ? 'text-muted-foreground' : pnlDisplay.raw >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {pnlDisplay.value}
                </td>
                <td className="px-4 py-2">
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`px-2 py-1 rounded-full text-sm w-fit ${getBehaviorColor(behaviorDisplayType).className}`}
                          style={getBehaviorColor(behaviorDisplayType).style}
                        >
                          {behaviorMeta?.label ?? profile.behaviorType ?? 'Unclassified'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm text-xs">
                        {(() => {
                          const info = getBehaviorDescription(profile.behaviorType) || behaviorMeta;
                          if (!info) {
                            return <p className="text-muted-foreground">No behavior classification yet.</p>;
                          }
                          return (
                            <div className="space-y-2">
                              <p className="font-semibold">{'title' in info ? info.title : info.label}</p>
                              <p className="text-muted-foreground">{info.description}</p>
                              <p className="text-primary font-medium">{info.timeframe}</p>
                            </div>
                          );
                        })()}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm tabular-nums">
                      Median: {formatHoldTime(exitedMedian)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Average: {formatHoldTime(exitedAverage)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                  <div className="flex flex-col gap-0.5">
                    <span>{formatHoldTime(currentHoldTime)}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatSol(totalHoldingsValueSol)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                  {formatSol(profile.solBalance)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
