import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { WalletRepresentationSummary } from '@/types/api';

/**
 * Catalog A2 — per-token cohort-quality badge (SURFACE-1).
 *
 * Aggregates the batched representation read over the visible holder set into a
 * few legible, DB-wide numbers: % coordinated (in a stored cluster), % that have
 * a coordination-token signal among their siblings, and the median neighbor win
 * rate. Components are shown on hover — this is not a black-box score. Only
 * audit-independent signals are aggregated; no per-dimension metric is surfaced.
 *
 * Empty is normal: coordination is rare (~0.65% of wallets DB-wide), so 0%
 * coordinated is the common, correct answer — presented, not hidden.
 */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function CohortQualityBadge({
  representations,
  walletAddresses,
}: {
  representations?: Record<string, WalletRepresentationSummary>;
  walletAddresses: string[];
}) {
  const stats = useMemo(() => {
    if (!representations) return null;
    const summaries = walletAddresses
      .map((addr) => representations[addr])
      .filter((s): s is WalletRepresentationSummary => !!s && s.hasVector);

    if (summaries.length === 0) return null;

    const withRepresentation = summaries.length;
    const coordinatedCount = summaries.filter((s) => s.cluster != null).length;
    const coordSignalCount = summaries.filter(
      (s) => (s.siblings?.coordinatedNeighborCount ?? 0) > 0,
    ).length;
    const neighborWinRates = summaries
      .map((s) => s.siblings?.medianNeighborWinRate)
      .filter((w): w is number => w != null);

    return {
      withRepresentation,
      coordinatedCount,
      coordinatedPct: (coordinatedCount / withRepresentation) * 100,
      coordSignalPct: (coordSignalCount / withRepresentation) * 100,
      medianNeighborWin: median(neighborWinRates),
    };
  }, [representations, walletAddresses]);

  if (!stats) return null;

  const winLabel =
    stats.medianNeighborWin == null ? '—' : `${stats.medianNeighborWin.toFixed(0)}%`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs cursor-help">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-muted-foreground">Cohort quality</span>
            <span className="font-semibold tabular-nums text-foreground">
              {stats.coordinatedPct.toFixed(0)}% coordinated
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <p className="font-medium">Cohort quality (DB-wide)</p>
          <div className="text-muted-foreground mt-1 space-y-0.5">
            <p>
              {stats.coordinatedCount}/{stats.withRepresentation} holders are in a stored
              coordination cluster ({stats.coordinatedPct.toFixed(0)}%).
            </p>
            <p>
              {stats.coordSignalPct.toFixed(0)}% share tokens with their behavioral siblings
              (coordination signal).
            </p>
            <p>Median neighbor win rate: {winLabel}.</p>
            <p className="text-[10px] text-muted-foreground/70 pt-0.5">
              Over the {stats.withRepresentation} holders with a behavioral fingerprint. 0%
              coordinated is common and expected — most wallets are not coordinated.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
