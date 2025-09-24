"use client";

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useGlobalMessages } from '@/hooks/useMessages';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import MessageComposer from './MessageComposer';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import MessageRow from './MessageRow';
import { fetcher } from '@/lib/fetcher';
import { useChatKeyboard } from '@/hooks/useChatKeyboard';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

export default function GlobalChat() {
  const { data, isLoading, error, mutate, loadMore } = useGlobalMessages(50);
  const pinnedItems = (data?.items || []).filter((m) => m.isPinned);
  const tokenMentions = (data?.items || [])
    .flatMap((m) => (m.mentions || []).filter((x) => (x.kind === 'TOKEN' || x.kind === 'token') && x.refId).map((x) => x.refId as string));
  const { byMint } = useTokenInfoMany(tokenMentions);
  const { data: watched } = useWatchedTokens('FAVORITES');
  const watchedByMint = useMemo(() => {
    const map: Record<string, { symbol?: string | null; name?: string | null }> = {};
    for (const w of watched || []) map[w.tokenAddress] = { symbol: w.symbol, name: w.name } as any;
    return map;
  }, [watched]);

  const handlePosted = useCallback(() => {
    mutate();
  }, [mutate]);

  useMessagesSocket({
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

  // Track last posted id to style own bubble; minimal heuristic via time
  const lastPostedAtRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useInfiniteScroll(data?.nextCursor ? loadMore : undefined);

  // Unread anchor tracking
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return Date.now();
    const v = window.localStorage.getItem('lastSeen:global');
    return v ? Number(v) : Date.now();
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('lastSeen:global', String(lastSeen));
  }, [lastSeen]);
  const newestTs = (data?.items?.[0]?.createdAt ? new Date(data.items[0].createdAt).getTime() : 0);
  const showJump = newestTs > lastSeen;
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);

  // Show newest at bottom: render ascending and auto-scroll to bottom on new items
  const itemsAsc = useMemo(() => (data?.items || []).slice().reverse(), [data?.items]);
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [itemsAsc.length, scrollToBottom]);

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
    getIsPinned: (messageId: string) => !!(itemsAsc.find((x: any) => x.id === messageId)?.isPinned),
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
    <div className="flex flex-col h-full" {...containerProps} aria-label="Global chat keyboard area">
      {/* Pinned band */}
      {pinnedItems.length > 0 && (
        <div className="p-2 border-b border-border bg-muted/40">
          <div className="text-[10px] text-muted-foreground mb-1">Pinned</div>
          <div className="flex gap-2 overflow-x-auto">
            {pinnedItems.map((m) => (
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
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load older…
          </button>
        )}
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}
        {itemsAsc.map((m, idx) => (
          <MessageRow
            key={m.id}
            message={m as any}
            byMint={byMint}
            watchedByMint={watchedByMint}
            showCopy
            isOwn={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
            canDelete={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
            isPinned={!!m.isPinned}
            selected={isSelected(idx)}
            onTogglePin={async (id) => {
              try {
                const next = !m.isPinned;
                await fetcher(`/messages/${encodeURIComponent(id)}/pin`, { method: 'POST', body: JSON.stringify({ isPinned: next }) });
                mutate();
              } catch {}
            }}
            onReply={(mm) => setReplyTo(mm as any)}
            onReact={async (_m, type) => {
              try {
                const count = ((m as any).reactions || []).find((r: any) => r.type === type)?.count || 0;
                await fetcher(`/messages/${encodeURIComponent(m.id)}/react`, { method: 'POST', body: JSON.stringify({ type, on: count === 0 }) });
                mutate();
              } catch {}
            }}
          />
        ))}
      </div>
      {showJump ? (
        <div className="sticky bottom-0 left-0 right-0 flex justify-center mb-1">
          <button className="px-2 py-1 text-xs rounded border bg-background shadow" onClick={() => setLastSeen(Date.now())}>Jump to latest</button>
        </div>
      ) : null}
      {/* Infinite loader sentinel */}
      {data?.nextCursor ? <div ref={sentinelRef} className="h-1" /> : null}
      <MessageComposer
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onPosted={() => {
          lastPostedAtRef.current = Date.now();
          setLastSeen(Date.now());
          setReplyTo(null);
          scrollToBottom();
          handlePosted();
        }}
      />
    </div>
  );
}


