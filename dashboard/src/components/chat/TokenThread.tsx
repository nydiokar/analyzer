"use client";

import React, { useEffect, useMemo, useRef } from 'react';
import { TokenBadge } from '@/components/shared/TokenBadge';
import Sparkline from '@/components/shared/Sparkline';
import { useMiniPriceSeries } from '@/hooks/useMiniPriceSeries';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { fetcher } from '@/lib/fetcher';
import ChatFeed from './ChatFeed';

export default function TokenThread({ tokenAddress, highlightId }: { tokenAddress: string; highlightId?: string }) {
  const { data: watched, mutate: mutateWatched } = useWatchedTokens('FAVORITES');
  const watchedMeta = useMemo(() => (watched || []).find((w) => w.tokenAddress === tokenAddress) || null, [watched, tokenAddress]);
  const { series, trend } = useMiniPriceSeries(tokenAddress, 24);
  const didScrollRef = useRef(false);
  const { byMint } = useTokenInfoMany([]);

  // Scroll the highlighted message into view once when data arrives
  useEffect(() => {
    if (!highlightId || didScrollRef.current) return;
    const el = typeof document !== 'undefined' ? document.getElementById(`msg-${highlightId}`) : null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      didScrollRef.current = true;
    }
  }, [highlightId]);

  return (
    <div className="flex flex-col h-full" aria-label="Token thread keyboard area">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <TokenBadge mint={tokenAddress} metadata={{ name: watchedMeta?.name ?? undefined, symbol: watchedMeta?.symbol ?? undefined, imageUrl: (watchedMeta?.imageUrl as any) ?? undefined }} />
        <div className="flex items-center gap-4">
          {/* Mini sparkline for quick trend glance */}
          <div className={`hidden md:flex items-center gap-2 ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-rose-500' : 'text-muted-foreground'}`} title={series.length ? `Trend ${trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'}` : 'No data yet'}>
            <Sparkline values={series} width={96} height={24} />
          </div>
          <button
            className="h-7 px-2 text-xs border rounded hover:bg-muted"
            onClick={async () => {
              try {
                const on = watchedMeta ? false : true;
                await fetcher(`/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, { method: 'POST', body: JSON.stringify({ on }) });
                mutateWatched();
              } catch {}
            }}
            aria-label={watchedMeta ? 'Unwatch token' : 'Watch token'}
          >
            {watchedMeta ? 'Unwatch' : 'Watch'}
          </button>
        </div>
      </div>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">Tags:</span>
        {/* Simple inline add form - minimal UX */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement;
            const input = form.querySelector('input[name="tag-input"]') as HTMLInputElement;
            const value = (input.value || '').trim().toLowerCase();
            if (!value) return;
            try {
              await fetch((process.env.NEXT_PUBLIC_API_BASE_URL || '') + `/watched-tokens/${encodeURIComponent(tokenAddress)}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: [{ type: 'meta', name: value }] }),
              });
              input.value = '';
            } catch {}
          }}
          className="flex items-center gap-2"
        >
          <input name="tag-input" placeholder="add tag e.g. meta:elon" className="h-7 px-2 text-xs bg-background border rounded" />
          <button className="h-7 px-2 text-xs border rounded">Add</button>
        </form>
      </div>
      <div className="flex-1 min-h-0">
        <ChatFeed
          scope={{ kind: 'token', tokenAddress }}
          rowPropsMapper={() => ({ byMint, threadAddress: tokenAddress })}
          actions={{
          openActionsFor: (messageId) => {
            const row = document.getElementById(`msg-${messageId}`);
            const trigger = row?.querySelector('[data-msg-actions-trigger]') as HTMLElement | null;
            trigger?.click();
          },
          onTogglePin: async (messageId, next) => {
            try {
              await fetcher(`/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST', body: JSON.stringify({ isPinned: next }) });
            } catch {}
          },
          onReact: async (messageId, type, on) => {
            try {
              await fetcher(`/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ type, on }) });
            } catch {}
          },
          onWatchToggle: async () => {
            try {
              const on = watchedMeta ? false : true;
              await fetcher(`/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, { method: 'POST', body: JSON.stringify({ on }) });
              mutateWatched();
            } catch {}
          },
          }}
          onItemsChange={(items) => {
          if (!highlightId || didScrollRef.current) return;
          const found = items.find((x) => x.id === highlightId);
          if (found) {
            const el = typeof document !== 'undefined' ? document.getElementById(`msg-${highlightId}`) : null;
            if (el) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              didScrollRef.current = true;
            }
          }
          }}
        />
      </div>
    </div>
  );
}


