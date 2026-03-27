'use client';

import { Loader2, TrendingUp, TrendingDown, ArrowRightLeft, Minus } from 'lucide-react';
import type { HolderProfileDiff } from '@/hooks/useHolderProfileDiff';

interface Props {
  diff: HolderProfileDiff | null;
  isLoading: boolean;
  error: string | null;
  compareLabel: string;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-muted-foreground font-mono text-xs">—</span>;
  const pos = value > 0;
  return (
    <span className={`font-mono text-xs font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      {pos ? '+' : ''}{value}{suffix}
    </span>
  );
}

export function SnapshotDiffPanel({ diff, isLoading, error, compareLabel }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-1 text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        Comparing with {compareLabel}…
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-2 px-1">{error}</p>;
  }

  if (!diff) return null;

  const noChanges =
    diff.newHolders.length === 0 &&
    diff.departedHolders.length === 0 &&
    diff.tierMigrations.length === 0 &&
    diff.supplyConcentrationDelta === 0;

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 divide-y divide-border/40 text-xs">
      {/* Compact summary strip */}
      <div className="flex items-center gap-4 px-3 py-2 flex-wrap">
        <span className="text-muted-foreground shrink-0">vs <span className="text-foreground/70 font-mono">{compareLabel}</span></span>
        <span className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-emerald-400 shrink-0" />
          <span className="text-muted-foreground">New</span>
          <Delta value={diff.newHolders.length} />
        </span>
        <span className="flex items-center gap-1">
          <TrendingDown className="h-3 w-3 text-red-400 shrink-0" />
          <span className="text-muted-foreground">Left</span>
          <Delta value={-diff.departedHolders.length} />
        </span>
        <span className="flex items-center gap-1">
          <ArrowRightLeft className="h-3 w-3 text-amber-400 shrink-0" />
          <span className="text-muted-foreground">Behavior shifts</span>
          <span className="font-mono font-semibold">{diff.tierMigrations.length}</span>
        </span>
        <span className="flex items-center gap-1">
          <Minus className="h-3 w-3 text-blue-400 shrink-0" />
          <span className="text-muted-foreground">Supply held</span>
          <Delta value={diff.supplyConcentrationDelta} suffix="%" />
        </span>
        {noChanges && <span className="text-muted-foreground italic">No changes</span>}
      </div>

      {/* Detail rows — only rendered when there's something to show */}
      {(diff.newHolders.length > 0 || diff.departedHolders.length > 0 || diff.tierMigrations.length > 0) && (
        <div className="px-3 py-2 space-y-2">

          {diff.newHolders.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-emerald-400 font-semibold shrink-0 w-14">+entered</span>
              {diff.newHolders.slice(0, 6).map((h) => (
                <span key={h.walletAddress} className="flex items-center gap-1 text-muted-foreground">
                  <span className="text-foreground/40">#{h.rank}</span>
                  <span className="font-mono">{shortAddr(h.walletAddress)}</span>
                  {h.behaviorType && (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1 rounded">{h.behaviorType}</span>
                  )}
                  <span className="text-foreground/50">{h.supplyPercent.toFixed(1)}%</span>
                </span>
              ))}
              {diff.newHolders.length > 6 && (
                <span className="text-muted-foreground">+{diff.newHolders.length - 6} more</span>
              )}
            </div>
          )}

          {diff.departedHolders.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-red-400 font-semibold shrink-0 w-14">−exited</span>
              {diff.departedHolders.slice(0, 6).map((h) => (
                <span key={h.walletAddress} className="flex items-center gap-1 text-muted-foreground">
                  <span className="text-foreground/40">#{h.rank}</span>
                  <span className="font-mono">{shortAddr(h.walletAddress)}</span>
                  {h.behaviorType && (
                    <span className="text-[10px] bg-red-500/10 text-red-400 px-1 rounded">{h.behaviorType}</span>
                  )}
                  <span className="text-foreground/50">{h.supplyPercent.toFixed(1)}%</span>
                </span>
              ))}
              {diff.departedHolders.length > 6 && (
                <span className="text-muted-foreground">+{diff.departedHolders.length - 6} more</span>
              )}
            </div>
          )}

          {diff.tierMigrations.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-amber-400 font-semibold shrink-0 w-14">shifted</span>
              {diff.tierMigrations.slice(0, 6).map((m) => (
                <span key={m.walletAddress} className="flex items-center gap-1 text-muted-foreground">
                  <span className="text-foreground/40">#{m.rank}</span>
                  <span className="font-mono">{shortAddr(m.walletAddress)}</span>
                  <span className="text-foreground/50">{m.from ?? '—'}</span>
                  <ArrowRightLeft className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                  <span className="text-foreground/80">{m.to ?? '—'}</span>
                </span>
              ))}
              {diff.tierMigrations.length > 6 && (
                <span className="text-muted-foreground">+{diff.tierMigrations.length - 6} more</span>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
