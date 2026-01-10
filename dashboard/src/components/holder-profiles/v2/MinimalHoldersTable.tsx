import type { HolderProfile } from '../types';
import { formatHoldTime, formatSol, formatUsd, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor, getBehaviorDescription, getBehaviorMeta } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { InfoIcon } from 'lucide-react';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  onSelect?: (profile: HolderProfile) => void;
}

const SIGNIFICANT_HOLD_THRESHOLD_SOL = 0.3;

function getHoldingValueUsd(profile: HolderProfile) {
  const holdings = profile.currentHoldings ?? [];
  const total = holdings.reduce((sum, holding) => {
    if (typeof holding.valueUsd === 'number') return sum + holding.valueUsd;
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function getPnlDisplay(profile: HolderProfile) {
  if (typeof profile.tokenPnlUsd === 'number') {
    return { value: formatUsd(profile.tokenPnlUsd), raw: profile.tokenPnlUsd };
  }
  if (typeof profile.tokenPnlSol === 'number') {
    return { value: formatSol(profile.tokenPnlSol), raw: profile.tokenPnlSol };
  }
  return { value: '—', raw: null };
}

function hasSignificantHoldings(profile: HolderProfile) {
  return (profile.currentHoldings ?? []).some((holding) => (holding.valueSol ?? 0) >= SIGNIFICANT_HOLD_THRESHOLD_SOL);
}

export function MinimalHoldersTable({ profiles, mode, onSelect }: Props) {
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
            <th className="text-left px-4 py-2">Category + Time</th>
            <th className="text-left px-4 py-2">Hold Time (&gt;0.3 SOL)</th>
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
            const typicalHold = getTypicalHoldTimeHours(profile);
            const holdingValueUsd = getHoldingValueUsd(profile);
            const pnlDisplay = getPnlDisplay(profile);
            const currentHoldTime = hasSignificantHoldings(profile)
              ? (profile.currentHoldMedianHours ?? profile.currentHoldAverageHours)
              : null;
            return (
              <tr
                key={profile.walletAddress}
                className={`border-t border-border/60 ${onSelect ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                onClick={onSelect ? () => onSelect(profile) : undefined}
              >
                {mode === 'token' && <td className="px-4 py-2 text-muted-foreground">#{profile.rank}</td>}
                <td className="px-4 py-2">
                  <WalletBadge address={profile.walletAddress} size="sm" variant="inline" />
                </td>
                <td className="px-4 py-2">
                  <span className="font-medium tabular-nums">
                    {holdingValueUsd !== null ? formatUsd(holdingValueUsd) : '—'}
                  </span>
                </td>
                <td className={`px-4 py-2 font-medium tabular-nums ${pnlDisplay.raw === null ? 'text-muted-foreground' : pnlDisplay.raw >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {pnlDisplay.value}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1">
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium w-fit ${getBehaviorColor(behaviorDisplayType)}`}
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
                    <span className="text-xs text-muted-foreground">
                      held {formatHoldTime(typicalHold)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                  {formatHoldTime(currentHoldTime)}
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
