"use client";

import React from 'react';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { TokenBadge } from '@/components/shared/TokenBadge';
import Link from 'next/link';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';

interface WatchedTokenListProps {
  onSelect?: (tokenAddress: string) => void;
}
export default function WatchedTokenList({ onSelect }: WatchedTokenListProps) {
  const { data, isLoading, error, mutate } = useWatchedTokens('FAVORITES');

  // Revalidate list on any new message so newly mentioned tokens appear quickly
  useMessagesSocket({
    onMessageCreated: () => {
      // Immediate revalidate so first mentions appear quickly
      mutate();
      // Schedule a delayed revalidate to pick up enriched metadata (price/symbol) once backend updates
      setTimeout(() => mutate(), 1200);
    },
  });

  if (isLoading) return <div className="p-3 text-sm">Loading…</div>;
  if (error) return <div className="p-3 text-sm text-red-500">Failed to load tokens</div>;

  return (
    <div className="divide-y divide-border">
      {data.map((t) => {
        const fmtPrice = (p?: string | null) => {
          if (!p) return null;
          const n = Number(p);
          if (!isFinite(n)) return null;
          if (n >= 1) return `$${n.toFixed(2)}`;
          if (n >= 0.01) return `$${n.toFixed(4)}`;
          return `$${n.toFixed(6)}`;
        };
        const row = (
          <div
            key={t.tokenAddress}
            className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(t.tokenAddress)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(t.tokenAddress); } }}
            aria-label={`Open thread for ${t.symbol || t.name || t.tokenAddress}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <TokenBadge mint={t.tokenAddress} metadata={{ name: t.name ?? undefined, symbol: t.symbol ?? undefined, imageUrl: t.imageUrl ?? undefined }} size="sm" />
              <div className="flex items-center gap-1 flex-wrap">
                {t.tags.slice(0, 3).map((tag, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {tag.name}
                  </span>
                ))}
                {t.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{t.tags.length - 3}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground whitespace-nowrap">
              {fmtPrice(t.priceUsd) ? <span className="text-foreground">{fmtPrice(t.priceUsd)}</span> : null}
              {t.marketCapUsd ? <span className="hidden 2xl:inline">MCap ${Math.round(t.marketCapUsd).toLocaleString()}</span> : null}
              {t.liquidityUsd ? <span className="hidden 2xl:inline">Liq ${Math.round(t.liquidityUsd).toLocaleString()}</span> : null}
            </div>
          </div>
        );
        return row;
      })}
    </div>
  );
}


