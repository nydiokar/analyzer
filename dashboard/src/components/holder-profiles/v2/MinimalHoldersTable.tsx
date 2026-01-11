import type { HolderProfile } from '../types';
import { formatHoldTime, formatPercentage, formatSol, formatUsd } from './utils/formatters';
import { getBehaviorColor, getBehaviorDescription, getBehaviorMeta } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { InfoIcon, Link2 } from 'lucide-react';
import { CONNECTION_THRESHOLD } from './SimilaritySidebar';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  tokenMint?: string;
  onSelect?: (profile: HolderProfile) => void;
  /** Set of wallet addresses to highlight (e.g., from similarity pair hover) */
  highlightedWallets?: Set<string>;
  /** Map of wallet address to number of connections above threshold */
  connectionCounts?: Map<string, number>;
}

const SIGNIFICANT_HOLD_THRESHOLD_SOL = 0.3;

// Tokens to exclude from holdings value (stablecoins, wrapped tokens, etc.)
const EXCLUDED_HOLDING_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // usdc1
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // Wrapped BTC (Wormhole)
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // Coinbase Wrapped BTC
  '7vfCXTUXX5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // Wrapped Ether (Wormhole)
  'BQcdHdAQW1hczDbBi9hiegXAR7A98Q9jx3X3iBBBDiq4', // Wrapped USDT (Sollet)
  '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk', // Wrapped Ethereum (Sollet)
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // Wrapped Bitcoin (Sollet)
]);

function getHoldingValueSol(profile: HolderProfile, tokenMint?: string) {
  const holdings = profile.currentHoldings ?? [];
  const filteredHoldings = tokenMint
    ? holdings.filter((holding) => holding.tokenAddress === tokenMint)
    : holdings.filter((holding) => !EXCLUDED_HOLDING_MINTS.has(holding.tokenAddress));
  const total = filteredHoldings.reduce((sum, holding) => {
    if (typeof holding.valueSol === 'number') return sum + holding.valueSol;
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function getRealizedPnlDisplay(profile: HolderProfile) {
  // Show realized PnL in SOL (prefer SOL over USD)
  if (typeof profile.walletRealizedPnlSol === 'number') {
    return { value: formatSol(profile.walletRealizedPnlSol), raw: profile.walletRealizedPnlSol };
  }
  // Fallback to total PnL in SOL if realized not available
  if (typeof profile.walletPnlSol === 'number') {
    return { value: formatSol(profile.walletPnlSol), raw: profile.walletPnlSol };
  }
  return { value: '—', raw: null };
}

function hasSignificantHoldings(profile: HolderProfile) {
  return (profile.currentHoldings ?? []).some((holding) => (holding.valueSol ?? 0) >= SIGNIFICANT_HOLD_THRESHOLD_SOL);
}

export function MinimalHoldersTable({ profiles, mode, tokenMint, onSelect, highlightedWallets, connectionCounts }: Props) {
  return (
    <TooltipProvider delayDuration={150}>
    <div className="rounded-2xl border overflow-x-auto">
      <table className="w-full text-[13px] min-w-[800px]">
        <thead className="bg-muted/40">
          <tr>
            {mode === 'token' && (
              <th className="text-left px-2 py-2 w-[56px]">
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
              </th>
            )}
            <th className="text-left px-4 py-2">Wallet</th>
            <th className="text-left px-4 py-2">Current Holdings</th>
            <th className="text-left px-4 py-2">Realized PnL</th>
            <th className="text-left px-4 py-2">Behavior</th>
            <th className="text-left px-4 py-2 whitespace-nowrap">Exit timings</th>
            <th className="text-left px-4 py-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 cursor-help">
                    Overall Holdings <InfoIcon className="h-3 w-3 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p className="text-muted-foreground">
                    Total SOL value and Hold time for all currently held tokens across all positions with value ≥ 0.3 SOL.
                  </p>
                </TooltipContent>
              </Tooltip>
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
            const pnlDisplay = getRealizedPnlDisplay(profile);
            const currentHoldTime = hasSignificantHoldings(profile)
              ? (profile.currentHoldMedianHours ?? profile.currentHoldAverageHours)
              : null;
            const isHighlighted = highlightedWallets?.has(profile.walletAddress);

            // Only trigger row select if clicking directly on the row, not on interactive elements
            const handleRowClick = (e: React.MouseEvent) => {
              if (!onSelect) return;
              const target = e.target as HTMLElement;
              // Skip if clicking on buttons, links, or elements with data-interactive
              if (
                target.closest('button') ||
                target.closest('a') ||
                target.closest('[data-interactive]')
              ) {
                return;
              }
              onSelect(profile);
            };

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
                onClick={handleRowClick}
              >
                {mode === 'token' && <td className="px-2 py-2 text-muted-foreground whitespace-nowrap w-[56px]">#{profile.rank}</td>}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <WalletBadge address={profile.walletAddress} variant="minimal" />
                    {connectionCounts && connectionCounts.get(profile.walletAddress) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 cursor-help">
                            <Link2 className="h-2.5 w-2.5" />
                            <span className="tabular-nums">{connectionCounts.get(profile.walletAddress)}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs max-w-xs">
                          <p className="font-medium">Connected Wallets</p>
                          <p className="text-muted-foreground mt-1">
                            This wallet has ≥{Math.round(CONNECTION_THRESHOLD * 100)}% similarity with {connectionCounts.get(profile.walletAddress)} other {connectionCounts.get(profile.walletAddress) === 1 ? 'wallet' : 'wallets'} in this set.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2 select-text" data-interactive>
                  <div className="flex flex-col">
                    <span className="font-medium tabular-nums text-foreground whitespace-nowrap">
                      {holdingValueSol !== null ? formatSol(holdingValueSol) : '—'}
                    </span>
                    {supplyPercent !== null && supplyPercent > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {formatPercentage(supplyPercent, 2)} supply
                      </span>
                    )}
                  </div>
                </td>
                <td className={`px-4 py-2 font-medium tabular-nums select-text whitespace-nowrap ${pnlDisplay.raw === null ? 'text-muted-foreground' : pnlDisplay.raw >= 0 ? 'text-emerald-500' : 'text-red-500'}`} data-interactive>
                  {pnlDisplay.value}
                </td>
                <td className="px-4 py-2">
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`px-2 py-1 rounded-full text-[13px] w-fit ${getBehaviorColor(behaviorDisplayType).className}`}
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
                <td className="px-4 py-2 whitespace-nowrap select-text" data-interactive>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] tabular-nums whitespace-nowrap">
                      Median: {formatHoldTime(exitedMedian)}
                    </span>
                    <span className="text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
                      Average: {formatHoldTime(exitedAverage)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 tabular-nums select-text" data-interactive>
                  {(() => {
                    // Emphasize overall holdings if significantly larger than current token holdings (5x+)
                    const isSignificantlyLarger = totalHoldingsValueSol && holdingValueSol &&
                      totalHoldingsValueSol > holdingValueSol * 5;
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span className={`${isSignificantlyLarger ? 'font-medium text-amber-400' : 'text-foreground'} text-[13px] whitespace-nowrap`}>
                          {formatSol(totalHoldingsValueSol)}
                        </span>
                        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                          {formatHoldTime(currentHoldTime)}
                        </span>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-2 text-[13px] tabular-nums select-text text-foreground whitespace-nowrap" data-interactive>
                  {formatSol(profile.solBalance)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </TooltipProvider>
  );
}
