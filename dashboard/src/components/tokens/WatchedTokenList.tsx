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
      mutate();
    },
  });

  if (isLoading) return <div className="p-3 text-sm">Loading…</div>;
  if (error) return <div className="p-3 text-sm text-red-500">Failed to load tokens</div>;

  return (
    <div className="divide-y divide-border">
      {data.map((t) => {
        const row = (
          <div key={t.tokenAddress} className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 cursor-pointer" onClick={() => onSelect?.(t.tokenAddress)}>
            <div className="flex items-center gap-3">
              <TokenBadge mint={t.tokenAddress} metadata={{ name: t.name ?? undefined, symbol: t.symbol ?? undefined, imageUrl: t.imageUrl ?? undefined }} size="sm" />
              <div className="flex items-center gap-1 flex-wrap">
                {t.tags.slice(0, 4).map((tag, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {tag.name}
                  </span>
                ))}
                {t.tags.length > 4 && <span className="text-[10px] text-muted-foreground">+{t.tags.length - 4}</span>}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t.latestMessageAt ? new Date(t.latestMessageAt).toLocaleString() : '—'}
            </div>
          </div>
        );
        return row;
      })}
    </div>
  );
}


