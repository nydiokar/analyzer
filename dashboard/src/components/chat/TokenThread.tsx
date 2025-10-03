"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TokenBadge } from '@/components/shared/TokenBadge';
import Sparkline from '@/components/shared/Sparkline';
import { useMiniPriceSeries } from '@/hooks/useMiniPriceSeries';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { useChat } from '@/hooks/useChat';
import MessageRow from './MessageRow';
import MessageComposer from './MessageComposer';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type MessageMeta = {
  message: any;
  isOwn: boolean;
  authorName?: string | null;
  groupPosition: 'single' | 'start' | 'middle' | 'end';
};

function getAuthorKey(message: any): string | null {
  return message?.authorId || message?.userId || message?.author?.id || null;
}

function getAuthorName(message: any): string | null {
  return message?.author?.name || message?.authorName || null;
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompactNumber(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return `$${compactFormatter.format(value)}`;
}

function formatPrice(value?: string | number | null) {
  if (value == null) return null;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return null;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(6)}`;
}

export default function TokenThread({ tokenAddress, highlightId }: { tokenAddress: string; highlightId?: string }) {
  const chat = useChat({ kind: 'token', tokenAddress });
  const { data: watched, mutate: mutateWatched } = useWatchedTokens('FAVORITES');
  const watchedMeta = useMemo(() => (watched || []).find((w) => w.tokenAddress === tokenAddress) || null, [watched, tokenAddress]);
  const { series, trend } = useMiniPriceSeries(tokenAddress, 24);
  const didScrollRef = useRef(false);
  const { byMint } = useTokenInfoMany([]);
  const [tagValue, setTagValue] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);

  const watchedByMint = useMemo(() => {
    const map: Record<string, { symbol?: string | null; name?: string | null }> = {};
    for (const w of watched || []) map[w.tokenAddress] = { symbol: w.symbol, name: w.name };
    return map;
  }, [watched]);

  const messageMeta = useMemo<MessageMeta[]>(() => {
    return chat.messages.map((message, idx) => {
      const isOwn = Boolean(chat.isMessageOwn(message));
      const authorKey = getAuthorKey(message);
      const authorName = getAuthorName(message);

      const prev = idx > 0 ? chat.messages[idx - 1] : null;
      const next = idx < chat.messages.length - 1 ? chat.messages[idx + 1] : null;

      const prevKey = prev ? getAuthorKey(prev) : null;
      const nextKey = next ? getAuthorKey(next) : null;
      const prevOwn = prev ? Boolean(chat.isMessageOwn(prev)) : null;
      const nextOwn = next ? Boolean(chat.isMessageOwn(next)) : null;

      const samePrev = prev ? (authorKey ? prevKey === authorKey : prevOwn === isOwn) : false;
      const sameNext = next ? (authorKey ? nextKey === authorKey : nextOwn === isOwn) : false;

      const groupPosition: MessageMeta['groupPosition'] =
        samePrev && sameNext
          ? 'middle'
          : samePrev
            ? 'end'
            : sameNext
              ? 'start'
              : 'single';

      return { message, isOwn, authorName, groupPosition };
    });
  }, [chat.messages, chat.isMessageOwn]);

  const firstUnreadIndex = useMemo(() => {
    return messageMeta.findIndex((meta) => {
      const createdAt = new Date(meta.message.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt > chat.lastSeen;
    });
  }, [messageMeta, chat.lastSeen]);

  useEffect(() => {
    if (!highlightId || didScrollRef.current) return;
    const target = chat.messages.find((x) => x.id === highlightId);
    if (target) {
      chat.scrollToMessage(highlightId);
      didScrollRef.current = true;
    }
  }, [highlightId, chat.messages, chat.scrollToMessage]);

  const priceLabel = formatPrice(watchedMeta?.priceUsd);
  const marketCapLabel = formatCompactNumber(watchedMeta?.marketCapUsd ?? null);
  const liquidityLabel = formatCompactNumber(watchedMeta?.liquidityUsd ?? null);
  const tags = watchedMeta?.tags ?? [];

  const handleAddTag = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = tagValue.trim().toLowerCase();
    if (!value) return;
    if (!tokenAddress) return;

    // Validation: tags must be alphanumeric with hyphens/underscores, no @ prefix
    const validTagRe = /^[a-z0-9_-]+$/;
    if (!validTagRe.test(value)) {
      alert('Tag must contain only lowercase letters, numbers, hyphens, and underscores');
      return;
    }

    setIsSavingTag(true);
    try {
      await fetch((process.env.NEXT_PUBLIC_API_BASE_URL || '') + `/watched-tokens/${encodeURIComponent(tokenAddress)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ type: 'meta', name: value }] }),
      });
      setTagValue('');
      mutateWatched();
    } catch (error) {
      console.error('Failed to add tag', error);
    } finally {
      setIsSavingTag(false);
    }
  };

  const threadPalette = {
    pinnedBand: 'border-b border-border bg-muted/30',
    pinnedLabel: 'text-[11px] uppercase tracking-wide text-muted-foreground',
    pinnedButton: 'text-xs px-2 py-1 rounded-full border bg-background text-muted-foreground hover:bg-muted',
    dividerLine: 'bg-border',
    dividerBadge: 'bg-muted',
    dividerText: 'text-muted-foreground',
    loadMore: 'text-muted-foreground hover:text-foreground',
    loading: 'text-muted-foreground',
    error: 'text-destructive',
    jumpButton: 'rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted',
  };

  const pinnedBand = useMemo(() => {
    if (!chat.pinnedMessages.length) return null;
    return (
      <div className={cn('flex flex-col gap-2 px-4 py-2', threadPalette.pinnedBand)}>
        <div className={threadPalette.pinnedLabel}>Pinned</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {chat.pinnedMessages.map((m) => (
            <button
              key={`pin-${m.id}`}
              onClick={() => chat.onPinnedMessageClick(m.id)}
              className={threadPalette.pinnedButton}
              title={m.body}
            >
              {m.body && m.body.length > 40 ? `${m.body.slice(0, 40)}...` : m.body}
            </button>
          ))}
        </div>
      </div>
    );
  }, [chat.pinnedMessages, chat.onPinnedMessageClick, threadPalette]);

  return (
    <div className="flex h-full min-h-0 flex-col" {...chat.containerProps} aria-label="Token thread keyboard area">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TokenBadge
              mint={tokenAddress}
              metadata={{
                name: watchedMeta?.name ?? undefined,
                symbol: watchedMeta?.symbol ?? undefined,
                imageUrl: (watchedMeta?.imageUrl as any) ?? undefined,
              }}
              size="md"
            />
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                <span>{watchedMeta?.symbol || watchedMeta?.name || tokenAddress.slice(0, 6)}</span>
                <span className="text-xs text-muted-foreground">{tokenAddress.slice(0, 4)}...{tokenAddress.slice(-4)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {priceLabel ? <span>{priceLabel}</span> : null}
                {marketCapLabel ? <span>MC {marketCapLabel}</span> : null}
                {liquidityLabel ? <span>Liq {liquidityLabel}</span> : null}
                <span>Trend {trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkline values={series} width={128} height={28} stroke={trend > 0 ? '#34d399' : trend < 0 ? '#f87171' : '#a1a1aa'} />
            </div>
            <Button
              variant={watchedMeta ? 'outline' : 'default'}
              size="sm"
              onClick={async () => {
                try {
                  const on = !watchedMeta;
                  await chat.watchToken(tokenAddress, on);
                  mutateWatched();
                } catch (error) {
                  console.error('Watch toggle failed', error);
                }
              }}
            >
              {watchedMeta ? 'Unwatch' : 'Watch'}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tags.map((tag, idx) => (
            <span key={`${tag.name}-${idx}`} className="rounded-full bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {tag.name}
            </span>
          ))}
          <form onSubmit={handleAddTag} className="flex items-center gap-2">
            <Input
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              placeholder="Add tag (meta:elon)"
              className="h-8 w-40 text-xs"
            />
            <Button type="submit" size="sm" disabled={isSavingTag || !tagValue.trim()}>
              Add
            </Button>
          </form>
        </div>
      </header>

      {pinnedBand}

      <div ref={chat.scrollRef} className="flex-1 min-h-0 overflow-auto px-5 py-4">
        {chat.hasMore && (
          <button className={cn('w-full py-2 text-xs', threadPalette.loadMore)} onClick={chat.loadMore}>
            Load older...
          </button>
        )}
        {chat.isLoading && <div className={cn('p-3 text-sm', threadPalette.loading)}>Loading...</div>}
        {Boolean(chat.error) && <div className={cn('p-3 text-sm', threadPalette.error)}>Failed to load messages</div>}

        {messageMeta.map((meta, idx) => (
          <React.Fragment key={meta.message.id}>
            {firstUnreadIndex !== -1 && idx === firstUnreadIndex ? (
              <div className="my-3 flex items-center gap-3">
                <span className={cn('flex-1 h-px', threadPalette.dividerLine)} />
                <span className={cn('rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide', threadPalette.dividerBadge, threadPalette.dividerText)}>
                  New
                </span>
                <span className={cn('flex-1 h-px', threadPalette.dividerLine)} />
              </div>
            ) : null}
            <MessageRow
              message={meta.message}
              byMint={byMint}
              watchedByMint={watchedByMint}
              threadAddress={tokenAddress}
              showCopy
              isPinned={Boolean(meta.message.isPinned)}
              selected={chat.isSelected(idx)}
              isOwn={meta.isOwn}
              canDelete={meta.isOwn}
              highlighted={meta.message.id === highlightId}
              onTogglePin={(id: string) => chat.pinMessage(id, !meta.message.isPinned)}
              onReply={chat.startReply}
              onReact={(_, type: string) => {
                const reactions = (meta.message.reactions || []) as Array<{ type: string; count: number }>;
                const count = reactions.find((r) => r.type === type)?.count || 0;
                const nextState = count === 0;
                chat.reactToMessage(meta.message.id, type, nextState);
              }}
            />
          </React.Fragment>
        ))}
      </div>

      {chat.showJumpToLatest && (
        <div className="sticky bottom-0 left-0 right-0 flex justify-center pb-2">
          <button className={threadPalette.jumpButton} onClick={chat.jumpToLatest}>
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
  );
}
