"use client";

import React, { useMemo, useState } from 'react';
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
              title={m.body}
            >
              {m.body && m.body.length > 40 ? `${m.body.slice(0, 40)}…` : m.body}
            </button>
          ))}
        </div>
      </div>
    );
  }, [chat.pinnedMessages, chat.onPinnedMessageClick]);

  return (
    <div className="flex flex-col h-full min-h-0" {...chat.containerProps} aria-label="Global chat keyboard area">
      {PinnedBand}

      <div ref={chat.scrollRef} className="flex-1 overflow-auto">
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
        <div className="sticky bottom-0 left-0 right-0 flex justify-center mb-1">
          <button
            className="px-2 py-1 text-xs rounded border bg-background shadow"
            onClick={chat.jumpToLatest}
          >
            Jump to latest
          </button>
        </div>
      )}

      <MessageComposer
        replyTo={chat.replyTo}
        onCancelReply={chat.cancelReply}
        onPosted={chat.onMessageSent}
      />
    </div>
  );
}


