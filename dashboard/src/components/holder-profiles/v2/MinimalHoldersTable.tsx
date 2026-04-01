import type { HolderProfile } from '../types';
import { memo } from 'react';
import { formatHoldTime, formatPercentage, formatSol } from './utils/formatters';
import { getBehaviorColor, getBehaviorDescription, getBehaviorMeta } from './utils/behavior';

const MCAP_BUCKET_LABELS: Record<string, string> = {
  '0-10k':    'Seed',
  '10-20k':   'Early Seed',
  '20-30k':   'Late Seed',
  '30-50k':   'Pre-Growth',
  '50-100k':  'Early Growth',
  '100-200k': 'Growth',
  '200-500k': 'Late Growth',
  '500k-1m':  'Expansion',
  '1m+':      'Established',
};

function formatMcapCompact(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '–';
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { InfoIcon, Link2 } from 'lucide-react';
import { useFavoriteActions } from '@/providers/FavoriteModalProvider';
import type { WalletHudDto } from '@/types/api';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  tokenMint?: string;
  onSelect?: (profile: HolderProfile) => void;
  hudData?: Record<string, WalletHudDto>;
  highlightedWallets?: Set<string>;
  connectionCounts?: Map<string, number>;
}

interface HolderTableRowProps {
  profile: HolderProfile;
  mode: 'token' | 'wallet';
  tokenMint?: string;
  hud?: WalletHudDto;
  isHighlighted: boolean;
  connectionCount?: number;
  onSelect?: (profile: HolderProfile) => void;
}

const SIGNIFICANT_HOLD_THRESHOLD_SOL = 0.3;

const EXCLUDED_HOLDING_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj',
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  '7vfCXTUXX5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'BQcdHdAQW1hczDbBi9hiegXAR7A98Q9jx3X3iBBBDiq4',
  '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk',
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
]);

function getHoldingValueSol(profile: HolderProfile, tokenMint?: string): number | null {
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

function getOverallHoldingsValueSol(profile: HolderProfile, tokenMint?: string): number | null {
  const holdings = profile.currentHoldings ?? [];
  const baseHoldings = holdings.filter((holding) => !EXCLUDED_HOLDING_MINTS.has(holding.tokenAddress));
  const baseTotal = baseHoldings.reduce((sum, holding) => {
    if (typeof holding.valueSol === 'number') return sum + holding.valueSol;
    return sum;
  }, 0);

  if (tokenMint && typeof profile.tokenHoldingValueSol === 'number') {
    const tokenHolding = holdings.find((holding) => holding.tokenAddress === tokenMint);
    const hasTokenValue = typeof tokenHolding?.valueSol === 'number';
    const tokenExcluded = EXCLUDED_HOLDING_MINTS.has(tokenMint);
    if (!hasTokenValue || tokenExcluded) {
      return baseTotal + profile.tokenHoldingValueSol;
    }
  }

  return baseTotal > 0 ? baseTotal : null;
}

function getRealizedPnlDisplay(profile: HolderProfile): { value: string; raw: number | null } {
  if (typeof profile.walletRealizedPnlSol === 'number') {
    return { value: formatSol(profile.walletRealizedPnlSol), raw: profile.walletRealizedPnlSol };
  }
  if (typeof profile.walletPnlSol === 'number') {
    return { value: formatSol(profile.walletPnlSol), raw: profile.walletPnlSol };
  }
  return { value: '-', raw: null };
}

function hasSignificantHoldings(profile: HolderProfile): boolean {
  return (profile.currentHoldings ?? []).some((holding) => (holding.valueSol ?? 0) >= SIGNIFICANT_HOLD_THRESHOLD_SOL);
}

const HolderTableRow = memo(function HolderTableRow({
  profile,
  mode,
  tokenMint,
  hud,
  isHighlighted,
  connectionCount,
  onSelect,
}: HolderTableRowProps) {
  const { isFavorite, openFavoriteDialog } = useFavoriteActions();

  const isHolderOnly = !profile.behaviorType && !profile.analysisSkipped && (profile.currentHoldingsCount ?? 0) > 0;
  const behaviorMeta = getBehaviorMeta(profile.behaviorType) ?? (isHolderOnly
    ? {
        label: 'Fresh',
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
  const totalHoldingsValueSol = getOverallHoldingsValueSol(profile, tokenMint);
  const supplyPercent = typeof profile.supplyPercent === 'number' ? profile.supplyPercent : null;
  const pnlDisplay = getRealizedPnlDisplay(profile);
  const currentHoldTime = hasSignificantHoldings(profile)
    ? (profile.currentHoldMedianHours ?? profile.currentHoldAverageHours)
    : null;
  const exitCount = profile.completedCycleCount ?? 0;
  const lowExitSample = exitCount > 0 && exitCount < 3;

  const handleRowClick = (e: React.MouseEvent) => {
    if (!onSelect) return;
    const target = e.target as HTMLElement;
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
      <td className="px-4 py-2 min-w-[180px]">
        <div className="flex items-center gap-2">
          <WalletBadge
            address={profile.walletAddress}
            variant="minimal"
            knownType={profile.knownType}
            knownLabel={profile.knownLabel}
            isFavorite={isFavorite(profile.walletAddress)}
            onFavoriteToggle={() => openFavoriteDialog(profile.walletAddress)}
            showHud={true}
            hudData={hud}
          />
          {connectionCount ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 cursor-help">
                  <Link2 className="h-2.5 w-2.5" />
                  <span className="tabular-nums">{connectionCount}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-xs">
                <p className="font-medium">Connected Wallets</p>
                <p className="text-muted-foreground mt-1">
                  Meaningful cluster-qualified connections with {connectionCount} other {connectionCount === 1 ? 'wallet' : 'wallets'} in this set.
                </p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2 select-text" data-interactive>
        <div className="flex flex-col">
          <span className="font-medium tabular-nums text-foreground whitespace-nowrap">
            {holdingValueSol !== null ? formatSol(holdingValueSol) : '-'}
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
                const timeframe = (info as { timeframe?: string }).timeframe;
                return (
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">
                      {timeframe ? `Typical hold: ${timeframe}` : 'No exit data'}
                    </p>
                    {exitCount > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Sample: {exitCount} exits{lowExitSample ? ' - low sample' : ''}
                      </p>
                    )}
                  </div>
                );
              })()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
      {mode === 'token' && (
        <td className="px-4 py-2 whitespace-nowrap select-text" data-interactive>
          {profile.entryMcapUsd != null ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex flex-col gap-0.5 cursor-help">
                    <span className="text-[13px] tabular-nums font-medium">
                      {formatMcapCompact(profile.entryMcapUsd)}
                    </span>
                    {profile.entryMcapBucket && (
                      <span className="text-[11px] text-muted-foreground">
                        {MCAP_BUCKET_LABELS[profile.entryMcapBucket] ?? profile.entryMcapBucket}
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <p className="font-medium">Position Entry Mcap</p>
                  <p className="text-muted-foreground mt-0.5">
                    Capital-weighted average market cap across the buys that built this wallet's position in this token.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="text-[13px] text-muted-foreground">–</span>
          )}
        </td>
      )}
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
          const isSignificantlyLarger = totalHoldingsValueSol && holdingValueSol &&
            totalHoldingsValueSol > holdingValueSol * 5;
          return (
            <div className="flex flex-col gap-0.5">
              <span className={`${isSignificantlyLarger ? 'font-medium text-amber-400' : 'text-foreground'} text-[13px] whitespace-nowrap`}>
                {totalHoldingsValueSol !== null ? formatSol(totalHoldingsValueSol) : '-'}
              </span>
              {totalHoldingsValueSol === null && (profile.currentHoldingsCount ?? 0) > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap cursor-help">
                      N/A ({profile.currentHoldingsCount})
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    <p className="text-muted-foreground">
                      Value unavailable for {profile.currentHoldingsCount} {profile.currentHoldingsCount === 1 ? 'holding' : 'holdings'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                  {formatHoldTime(currentHoldTime)}
                </span>
              )}
            </div>
          );
        })()}
      </td>
      <td className="px-4 py-2 text-[13px] tabular-nums select-text text-foreground whitespace-nowrap" data-interactive>
        {formatSol(profile.solBalance)}
      </td>
    </tr>
  );
}, (prev, next) => {
  return (
    prev.profile === next.profile &&
    prev.mode === next.mode &&
    prev.tokenMint === next.tokenMint &&
    prev.hud === next.hud &&
    prev.isHighlighted === next.isHighlighted &&
    prev.connectionCount === next.connectionCount &&
    prev.onSelect === next.onSelect
  );
});

export function MinimalHoldersTable({
  profiles,
  mode,
  tokenMint,
  onSelect,
  hudData,
  highlightedWallets,
  connectionCounts,
}: Props) {
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
                        Rank by holdings value + behavior similarity.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </th>
              )}
              <th className="text-left px-4 py-2 min-w-[180px]">Wallet</th>
              <th className="text-left px-4 py-2 w-[140px]">Current Holdings</th>
              <th className="text-left px-4 py-2 w-[120px]">Realized PnL</th>
              <th className="text-left px-4 py-2 w-[140px]">Behavior</th>
              {mode === 'token' && (
                <th className="text-left px-4 py-2 whitespace-nowrap w-[120px]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Entry Mcap <InfoIcon className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      <p className="text-muted-foreground">
                        Volume-weighted avg market cap when this wallet entered this token.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </th>
              )}
              <th className="text-left px-4 py-2 whitespace-nowrap w-[140px]">Exit timings</th>
              <th className="text-left px-4 py-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 cursor-help">
                      Overall Holdings <InfoIcon className="h-3 w-3 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="text-muted-foreground">
                      Total value and median hold time for current positions &gt;= 0.3 SOL.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </th>
              <th className="text-left px-4 py-2">SOL Balance</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <HolderTableRow
                key={profile.walletAddress}
                profile={profile}
                mode={mode}
                tokenMint={tokenMint}
                hud={hudData?.[profile.walletAddress]}
                isHighlighted={highlightedWallets?.has(profile.walletAddress) ?? false}
                connectionCount={connectionCounts?.get(profile.walletAddress)}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
