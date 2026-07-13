import Link from 'next/link';
import { Users2, Network, Activity } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { WalletRepresentationSummary } from '@/types/api';

/**
 * Surface A inline chips (SURFACE-1): DB-wide behavioral siblings, stored
 * coordination-cluster membership, and a best-effort drift flag — sourced from
 * the batched /wallets/representation/batch read.
 *
 * Honest labels only (validation guardrail): "behavioral fingerprint" (kNN) and
 * "coordinated on-chain" (cluster) — NEVER "same person". Absence is the normal
 * state: a wallet with no vector renders nothing (its metrics are undefined, not
 * missing); a wallet with no cluster (~99% of wallets) shows no cluster chip.
 * Only audit-independent signals are shown — no per-dimension score.
 */

function formatWin(win: number | null): string {
  if (win == null) return '—';
  return `${win.toFixed(0)}%`;
}

function formatDriftDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RepresentationChips({
  representation,
}: {
  representation?: WalletRepresentationSummary;
}) {
  // No representation yet (no vector = zero-swap shell). Render nothing so the
  // absence looks intentional, not broken.
  if (!representation || !representation.hasVector) return null;

  const { siblings, cluster, drift } = representation;

  return (
    <div className="flex flex-wrap items-center gap-1" data-interactive>
      {/* DB-wide behavioral siblings — pivots into the Similarity Lab pre-seeded. */}
      {siblings && siblings.count > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/similarity-lab?seed=${representation.walletAddress}`}
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-500 hover:bg-sky-500/20 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <Users2 className="h-2.5 w-2.5" />
              <span className="tabular-nums">{siblings.count}</span>
              {siblings.topStrategy && (
                <span className="text-sky-400/80">{siblings.topStrategy}</span>
              )}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            <p className="font-medium">DB-wide behavioral siblings</p>
            <p className="text-muted-foreground mt-1">
              {siblings.count} nearest wallets across the whole DB share this wallet&apos;s
              behavioral fingerprint
              {siblings.topStrategy ? ` (mostly ${siblings.topStrategy})` : ''}.
              {siblings.medianNeighborWinRate != null && (
                <> Median neighbor win rate {formatWin(siblings.medianNeighborWinRate)}.</>
              )}
              {siblings.coordinatedNeighborCount > 0 && (
                <> {siblings.coordinatedNeighborCount} also share tokens (coordination signal).</>
              )}
            </p>
            <p className="text-[10px] text-sky-400 mt-1">Click to open in the Similarity Lab →</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Stored coordination cluster — empty for ~99% of wallets, which is normal. */}
      {cluster && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 cursor-help">
              <Network className="h-2.5 w-2.5" />
              <span className="tabular-nums">{cluster.clusterSize}</span>
              {cluster.role && <span className="text-amber-400/80">{cluster.role}</span>}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            <p className="font-medium">Coordinated on-chain</p>
            <p className="text-muted-foreground mt-1">
              In a stored coordination cluster of {cluster.clusterSize}{' '}
              {cluster.clusterSize === 1 ? 'wallet' : 'wallets'}
              {cluster.role ? ` (${cluster.role})` : ''}. These wallets trade the same tokens
              in a way that suggests coordination — not proof of a single owner.
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Best-effort behavioral drift — only when history exists. */}
      {drift && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 cursor-help">
              <Activity className="h-2.5 w-2.5" />
              <span className="tabular-nums">{drift.magnitude.toFixed(2)}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            <p className="font-medium">Behavioral drift</p>
            <p className="text-muted-foreground mt-1">
              This wallet&apos;s behavior last shifted around {formatDriftDate(drift.at)} (drift{' '}
              {drift.magnitude.toFixed(2)}). Best-effort — updates only on re-analysis, not live.
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
