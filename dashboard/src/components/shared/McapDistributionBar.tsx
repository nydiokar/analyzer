'use client';

import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MCAP_BUCKET_ORDER, getMcapBucketDisplayLabel } from '@/lib/mcap';

interface McapBucketPnl {
  realizedPnlSol: number;
  tradeCount: number;
  winRate: number;
}

interface McapDistributionBarProps {
  mcapDistribution: Record<string, number>;
  mcapBucketPnl?: Record<string, McapBucketPnl>;
  dominantEntryMcapBucket?: string;
  className?: string;
}

function formatSol(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  const abs = Math.abs(value);
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

function formatPct(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

const SHORT_LABELS: Record<string, string> = {
  '0-10k':    '<$10K',
  '10-20k':   '$10K',
  '20-30k':   '$20K',
  '30-50k':   '$30K',
  '50-100k':  '$50K',
  '100-200k': '$100K',
  '200-500k': '$200K',
  '500k-1m':  '$500K',
  '1m+':      '$1M+',
};

export const McapDistributionBar = memo(function McapDistributionBar({
  mcapDistribution,
  mcapBucketPnl,
  dominantEntryMcapBucket,
  className,
}: McapDistributionBarProps) {
  const bucketsWithData = MCAP_BUCKET_ORDER.filter((b) => (mcapDistribution[b] ?? 0) > 0);
  if (bucketsWithData.length === 0) return null;

  const maxShare = Math.max(...bucketsWithData.map((b) => mcapDistribution[b]));

  return (
    <TooltipProvider>
      <div className={`flex flex-col h-full ${className ?? ''}`}>

        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 shrink-0">
          Entry Mcap
        </p>

        {/* Rows */}
        <div className="flex flex-col flex-1 justify-between">
          {MCAP_BUCKET_ORDER.map((bucket) => {
            const share = mcapDistribution[bucket] ?? 0;
            if (share === 0) return null;

            const pnlData = mcapBucketPnl?.[bucket];
            const isDominant = bucket === dominantEntryMcapBucket;
            const widthPct = (share / maxShare) * 100;

            let barBg = 'bg-muted/30';
            let barFill = 'bg-muted/60';
            if (pnlData && pnlData.realizedPnlSol !== 0) {
              barBg = pnlData.realizedPnlSol > 0 ? 'bg-emerald-950/40' : 'bg-red-950/40';
              if (pnlData.realizedPnlSol > 0) {
                barFill = pnlData.winRate >= 0.6 ? 'bg-emerald-500' : 'bg-emerald-500/60';
              } else {
                barFill = pnlData.winRate <= 0.35 ? 'bg-red-500' : 'bg-red-500/60';
              }
            }

            return (
              <Tooltip key={bucket}>
                <TooltipTrigger asChild>
                  {/* Row: label | bar track | pct */}
                  <div className="flex items-center gap-2 cursor-default group">
                    <span className={`text-[10px] tabular-nums w-[42px] text-right shrink-0 leading-none ${isDominant ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                      {SHORT_LABELS[bucket]}
                    </span>
                    <div className={`flex-1 h-4 rounded-[3px] overflow-hidden ${barBg}`}>
                      <div
                        className={`h-full rounded-[3px] transition-opacity group-hover:opacity-75 ${barFill} ${isDominant ? 'ring-1 ring-white/20 ring-inset' : ''}`}
                        style={{ width: `${Math.max(widthPct, 3)}%` }}
                      />
                    </div>
                    <span className={`text-[10px] tabular-nums w-7 shrink-0 leading-none ${isDominant ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                      {formatPct(share)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs space-y-1.5 min-w-[152px]">
                  <p className="font-semibold text-foreground">{getMcapBucketDisplayLabel(bucket)}</p>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Capital share</span>
                    <span className="font-medium">{formatPct(share)}</span>
                  </div>
                  {pnlData ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Realized PnL</span>
                        <span className={`font-medium ${pnlData.realizedPnlSol >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatSol(pnlData.realizedPnlSol)} SOL
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Win rate</span>
                        <span className="font-medium">{formatPct(pnlData.winRate)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Tokens</span>
                        <span className="font-medium">{pnlData.tradeCount}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-[11px]">No completed trades</p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

      </div>
    </TooltipProvider>
  );
});
