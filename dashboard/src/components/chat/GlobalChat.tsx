"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { useChat } from '@/hooks/useChat';
import { extractTokenMentions } from '@/chat/utils';
import MessageRow from './MessageRow';
import MessageComposer from './MessageComposer';

export default function GlobalChat() {
  const chat = useChat({ kind: 'global' });
  const { data: watched } = useWatchedTokens('FAVORITES');

  const watchedByMint = useMemo(() => {
    const map: Record<string, { symbol?: string | null; name?: string | null }> = {};
    for (const w of watched || []) map[w.tokenAddress] = { symbol: w.symbol, name: w.name } as any;
    return map;
  }, [watched]);

  const [tokenMentions, setTokenMentions] = useState<string[]>([]);
  const { byMint } = useTokenInfoMany(tokenMentions);

  // Update token mentions when messages change
  React.useEffect(() => {
    setTokenMentions(extractTokenMentions(chat.messages));
  }, [chat.messages.length, chat.messages]);

  const formatPinnedPreview = useCallback(
    (message: { body?: string; mentions?: Array<{ kind: string; refId?: string | null }> }) => {
      let text = message.body ?? '';
      if (!text) return '';
      (message.mentions || []).forEach((mention) => {
        if (!mention || (mention.kind !== 'TOKEN' && mention.kind !== 'token') || !mention.refId) return;
        const symbol = watchedByMint[mention.refId]?.symbol || byMint[mention.refId]?.symbol || watchedByMint[mention.refId]?.name || byMint[mention.refId]?.name;
        const replacement = symbol ? `@${symbol}` : `@${mention.refId.slice(0, 4)}...${mention.refId.slice(-4)}`;
        const regex = new RegExp(`@ca:${mention.refId}`, 'gi');
        text = text.replace(regex, replacement);
      });
      return text;
    },
    [byMint, watchedByMint]
  );

  const PinnedBand = useMemo(() => {
    if (!chat.pinnedMessages.length) return null;
    return (
      <div className="p-2 border-b border-border bg-muted/40">
        <div className="text-[10px] text-muted-foreground mb-1">Pinned</div>
        <div className="flex gap-2 overflow-x-auto">
          {chat.pinnedMessages.map((m) => (
            <button
              key={`pin-${m.id}`}
              onClick={() => chat.onPinnedMessageClick(m.id)}
              className="text-xs px-2 py-1 rounded border bg-background whitespace-nowrap hover:bg-muted cursor-pointer"
              title={formatPinnedPreview(m) || m.body}
            >
              {(() => {
                const preview = formatPinnedPreview(m);
                if (!preview) return '';
                return preview.length > 40 ? `${preview.slice(0, 40)}…` : preview;
              })()}
            </button>
          ))}
        </div>
      </div>
    );
  }, [chat.pinnedMessages, chat.onPinnedMessageClick, formatPinnedPreview]);

  return (
    <div className="flex flex-col h-full min-h-0" {...chat.containerProps} aria-label="Global chat keyboard area">
      {PinnedBand}

      <div className="relative flex-1 min-h-0">
        <div ref={chat.scrollRef} className="h-full overflow-auto">
          {chat.hasMore && <div ref={chat.sentinelRef} className="h-1" />}
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
              watchedByMint={watchedByMint}
              showCopy={true}
              isPinned={!!message.isPinned}
              selected={chat.isSelected(idx)}
              isOwn={Boolean(chat.isMessageOwn(message))}
              canDelete={Boolean(chat.isMessageOwn(message))}
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
          <button
            className="absolute bottom-5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background px-5 py-2 text-sm font-semibold shadow-lg hover:bg-background/95"
            onClick={chat.jumpToLatest}
            aria-label="Jump to latest messages"
          >
            <span>Jump to latest</span>
            {chat.unreadCount > 0 ? (
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
                {chat.unreadCount}
              </span>
            ) : null}
          </button>
        )}
      </div>

      <MessageComposer
        replyTo={chat.replyTo}
        onCancelReply={chat.cancelReply}
        onPosted={chat.onMessageSent}
      />
    </div>
  );
}


