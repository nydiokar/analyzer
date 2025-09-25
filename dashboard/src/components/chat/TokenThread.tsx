"use client";

import React, { useEffect, useMemo, useRef } from 'react';
import { TokenBadge } from '@/components/shared/TokenBadge';
import Sparkline from '@/components/shared/Sparkline';
import { useMiniPriceSeries } from '@/hooks/useMiniPriceSeries';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { useChat } from '@/hooks/useChat';
import MessageRow from './MessageRow';
import MessageComposer from './MessageComposer';

export default function TokenThread({ tokenAddress, highlightId }: { tokenAddress: string; highlightId?: string }) {
  const chat = useChat({ kind: 'token', tokenAddress });
  const { data: watched, mutate: mutateWatched } = useWatchedTokens('FAVORITES');
  const watchedMeta = useMemo(() => (watched || []).find((w) => w.tokenAddress === tokenAddress) || null, [watched, tokenAddress]);
  const { series, trend } = useMiniPriceSeries(tokenAddress, 24);
  const didScrollRef = useRef(false);
  const { byMint } = useTokenInfoMany([]);

  // Scroll the highlighted message into view once when data arrives
  useEffect(() => {
    if (!highlightId || didScrollRef.current) return;
    const found = chat.messages.find((x) => x.id === highlightId);
    if (found) {
      chat.scrollToMessage(highlightId);
      didScrollRef.current = true;
    }
  }, [highlightId, chat.messages, chat.scrollToMessage]);

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
                const on = !watchedMeta;
                await chat.watchToken(tokenAddress, on);
                mutateWatched();
              } catch (error) {
                console.error('Watch toggle failed:', error);
              }
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
      <div className="flex-1 min-h-0" {...chat.containerProps}>
        {/* Pinned messages */}
        {chat.pinnedMessages.length > 0 && (
          <div className="p-2 border-b border-border bg-muted/40">
            <div className="text-[10px] text-muted-foreground mb-1">Pinned</div>
            <div className="flex gap-2 overflow-x-auto">
              {chat.pinnedMessages.map((m) => (
                <button
                  key={`pin-${m.id}`}
                  onClick={() => chat.onPinnedMessageClick(m.id)}
                  className="text-xs px-2 py-1 rounded border bg-background whitespace-nowrap hover:bg-muted cursor-pointer"
                  title={m.body}
                >
                  {m.body && m.body.length > 40 ? `${m.body.slice(0, 40)}…` : m.body}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={chat.scrollRef} className="flex-1 overflow-auto">
          {chat.hasMore && (
            <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={chat.loadMore}>
              Load older…
            </button>
          )}
          {chat.isLoading && <div className="p-3 text-sm">Loading…</div>}
          {Boolean(chat.error) && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}

          {chat.messages.map((message, idx) => (
            <MessageRow
              key={message.id}
              message={message}
              byMint={byMint}
              threadAddress={tokenAddress}
              isPinned={!!message.isPinned}
              selected={chat.isSelected(idx)}
              isOwn={Boolean(chat.isMessageOwn(message))}
              canDelete={Boolean(chat.isMessageOwn(message))}
              highlighted={message.id === highlightId}
              onTogglePin={(id: string) => chat.pinMessage(id, !message.isPinned)}
              onReply={chat.startReply}
              onReact={(_, type: string) => {
                const count = (message.reactions || []).find(r => r.type === type)?.count || 0;
                const on = count === 0;
                chat.reactToMessage(message.id, type, on);
              }}
            />
          ))}
        </div>

        {chat.showJumpToLatest && (
          <div className="sticky bottom-0 left-0 right-0 flex justify-center mb-1">
            <button
              className="px-2 py-1 text-xs rounded border bg-background shadow"
              onClick={chat.jumpToLatest}
            >
              Jump to latest
            </button>
          </div>
        )}

        {chat.hasMore && <div ref={chat.sentinelRef} className="h-1" />}

        <MessageComposer
          tokenAddress={tokenAddress}
          replyTo={chat.replyTo}
          onCancelReply={chat.cancelReply}
          onPosted={chat.onMessageSent}
        />
      </div>
    </div>
  );
}


