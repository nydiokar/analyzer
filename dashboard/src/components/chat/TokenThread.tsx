"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTokenMessages } from '@/hooks/useMessages';
import { TokenBadge } from '@/components/shared/TokenBadge';
import MessageComposer from './MessageComposer';
import Sparkline from '@/components/shared/Sparkline';
import { useMiniPriceSeries } from '@/hooks/useMiniPriceSeries';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import type { TokenInfoByMint } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import MessageRow from './MessageRow';
import { fetcher } from '@/lib/fetcher';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useChatKeyboard } from '@/hooks/useChatKeyboard';

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}

function MessageItem({ message, byMint, threadAddress }: { message: { body: string; createdAt: string; mentions?: Array<{ kind: string; refId?: string | null; rawValue: string }> }; byMint: TokenInfoByMint; threadAddress: string }) {
  const nodes = useMemo(() => {
    const body = message.body || '';
    const mentions = (message.mentions || []).filter((m) => (m.kind === 'TOKEN' || m.kind === 'token') && m.refId);
    if (mentions.length === 0) return [body];

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    type Occ = { start: number; end: number; raw: string; mint: string };
    const occs: Occ[] = [];
    for (const m of mentions) {
      const raw = m.rawValue;
      const re = new RegExp(escapeRegExp(raw), 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(body)) !== null) {
        occs.push({ start: match.index, end: match.index + raw.length, raw, mint: m.refId as string });
      }
    }
    if (occs.length === 0) return [body];
    occs.sort((a, b) => a.start - b.start);

    const out: React.ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < occs.length; i++) {
      const o = occs[i];
      if (o.start < cursor) continue; // skip overlaps
      if (o.start > cursor) out.push(body.slice(cursor, o.start));
      // If this mention is the scoped thread token, omit it entirely (no label, no address)
      if (o.mint === threadAddress) {
        cursor = o.end;
        continue;
      }
      const label = byMint[o.mint]?.symbol || byMint[o.mint]?.name || `${o.mint.slice(0, 4)}...${o.mint.slice(-4)}`;
      out.push(
        <span key={`twrap-${o.mint}-${o.start}`} className="inline-flex items-center mx-1 text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">
          {label}
        </span>
      );
      cursor = o.end;
    }
    if (cursor < body.length) out.push(body.slice(cursor));
    return out;
  }, [message.body, message.mentions, byMint, threadAddress]);

  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-sm whitespace-pre-wrap">{nodes}</div>
      <div className="text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</div>
    </div>
  );
}

export default function TokenThread({ tokenAddress, highlightId }: { tokenAddress: string; highlightId?: string }) {
  const { data, isLoading, error, mutate, loadMore } = useTokenMessages(tokenAddress, 50);
  const pinnedItems = (data?.items || []).filter((m: any) => (m as any).isPinned);
  const tokenMentions = (data?.items || [])
    .flatMap((m) => (m.mentions || []).filter((x) => (x.kind === 'TOKEN' || x.kind === 'token') && x.refId).map((x) => x.refId as string));
  const { byMint } = useTokenInfoMany(tokenMentions);
  const { data: watched, mutate: mutateWatched } = useWatchedTokens('FAVORITES');
  const watchedMeta = useMemo(() => (watched || []).find((w) => w.tokenAddress === tokenAddress) || null, [watched, tokenAddress]);
  const { series, trend } = useMiniPriceSeries(tokenAddress, 24);

  const handlePosted = useCallback(() => {
    mutate();
  }, [mutate]);

  useMessagesSocket({
    tokenAddress,
    onMessageCreated: () => {
      mutate();
    },
    onMessageEdited: () => {
      mutate();
    },
    onMessageDeleted: () => {
      mutate();
    },
    onMessagePinned: () => {
      mutate();
    },
    onReactionUpdated: () => {
      mutate();
    },
  });

  const lastPostedAtRef = useRef<number>(0);
  const didScrollRef = useRef(false);
  const sentinelRef = useInfiniteScroll(data?.nextCursor ? loadMore : undefined);
  
  // Scroll the highlighted message into view once when data arrives
  useEffect(() => {
    if (!highlightId || didScrollRef.current) return;
    const el = typeof document !== 'undefined' ? document.getElementById(`msg-${highlightId}`) : null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      didScrollRef.current = true;
    }
  }, [highlightId, data]);

  // Reply state
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  // Unread anchor for this token
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return Date.now();
    const v = window.localStorage.getItem(`lastSeen:token:${tokenAddress}`);
    return v ? Number(v) : Date.now();
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(`lastSeen:token:${tokenAddress}`, String(lastSeen));
  }, [lastSeen, tokenAddress]);
  const newestTs = (data?.items?.[0]?.createdAt ? new Date(data.items[0].createdAt).getTime() : 0);
  const showJump = newestTs > lastSeen;

  const itemsAsc = useMemo(() => (data?.items || []).slice().reverse(), [data?.items]);
  const { containerProps, isSelected } = useChatKeyboard({
    items: itemsAsc as Array<{ id: string }>,
    openActionsFor: (messageId: string) => {
      const row = document.getElementById(`msg-${messageId}`);
      const trigger = row?.querySelector('[data-msg-actions-trigger]') as HTMLElement | null;
      trigger?.click();
    },
    onReply: (messageId: string) => {
      const m = itemsAsc.find((x) => x.id === messageId) as any;
      if (m) setReplyTo({ id: m.id, body: m.body });
    },
    onTogglePin: async (messageId: string, nextIsPinned: boolean) => {
      try {
        await fetcher(`/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST', body: JSON.stringify({ isPinned: nextIsPinned }) });
        mutate();
      } catch {}
    },
    getIsPinned: (messageId: string) => !!((itemsAsc.find((x: any) => x.id === messageId) as any)?.isPinned),
    onWatchToggle: async () => {
      try {
        const on = watchedMeta ? false : true;
        await fetcher(`/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, { method: 'POST', body: JSON.stringify({ on }) });
        mutateWatched();
      } catch {}
    },
    options: {
      isTyping: () => {
        const ae = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
        if (!ae) return false;
        const tag = ae.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || ae.getAttribute('role') === 'textbox';
      },
    },
  });

  return (
    <div className="flex flex-col h-full" {...containerProps} aria-label="Token thread keyboard area">
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
      {pinnedItems.length > 0 && (
        <div className="p-2 border-b border-border bg-muted/40">
          <div className="text-[10px] text-muted-foreground mb-1">Pinned</div>
          <div className="flex gap-2 overflow-x-auto">
            {pinnedItems.map((m: any) => (
              <span
                key={`pin-${m.id}`}
                className="text-xs px-2 py-1 rounded border bg-background whitespace-nowrap"
                title={m.body}
              >
                {m.body.length > 40 ? `${m.body.slice(0, 40)}…` : m.body}
              </span>
            ))}
          </div>
        </div>
      )}
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
              // Refresh thread header metrics/tags by reloading watched list implicitly (next page visit) or keep simple for now
            } catch {}
          }}
          className="flex items-center gap-2"
        >
          <input name="tag-input" placeholder="add tag e.g. meta:elon" className="h-7 px-2 text-xs bg-background border rounded" />
          <button className="h-7 px-2 text-xs border rounded">Add</button>
        </form>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load thread</div>}
        {itemsAsc.map((m, idx) => (
          <MessageRow
            key={m.id}
            message={m as any}
            byMint={byMint}
            threadAddress={tokenAddress}
            isOwn={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
            canDelete={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
            isPinned={!!(m as any).isPinned}
            highlighted={highlightId === m.id}
            selected={isSelected(idx)}
            onReply={(mm) => setReplyTo({ id: mm.id as string, body: mm.body })}
            onReact={async (_m, type) => {
              try {
                const count = ((m as any).reactions || []).find((r: any) => r.type === type)?.count || 0;
                await fetcher(`/messages/${encodeURIComponent(m.id)}/react`, { method: 'POST', body: JSON.stringify({ type, on: count === 0 }) });
                mutate();
              } catch {}
            }}
            onTogglePin={async (id) => {
              try {
                const next = !(m as any).isPinned;
                await fetcher(`/messages/${encodeURIComponent(id)}/pin`, { method: 'POST', body: JSON.stringify({ isPinned: next }) });
                mutate();
              } catch {}
            }}
          />
        ))}
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load older…
          </button>
        )}
      </div>
      {/* Infinite loader sentinel */}
      {data?.nextCursor ? <div ref={sentinelRef} className="h-1" /> : null}
      {showJump ? (
        <div className="sticky bottom-0 left-0 right-0 flex justify-center mb-1">
          <button className="px-2 py-1 text-xs rounded border bg-background shadow" onClick={() => setLastSeen(Date.now())}>Jump to latest</button>
        </div>
      ) : null}
      <MessageComposer onPosted={() => { lastPostedAtRef.current = Date.now(); setLastSeen(Date.now()); handlePosted(); setReplyTo(null); const scroller = document.querySelector('[aria-label="Token thread keyboard area"]'); (scroller as HTMLElement | null)?.scrollTo?.({ top: (scroller as HTMLElement).scrollHeight }); }} tokenAddress={tokenAddress} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
    </div>
  );
}


