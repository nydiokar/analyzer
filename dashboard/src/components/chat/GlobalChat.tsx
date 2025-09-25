"use client";

import React, { useMemo, useState } from 'react';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import { fetcher } from '@/lib/fetcher';
import ChatFeed from './ChatFeed';

export default function GlobalChat() {
  const { data: watched } = useWatchedTokens('FAVORITES');
  const watchedByMint = useMemo(() => {
    const map: Record<string, { symbol?: string | null; name?: string | null }> = {};
    for (const w of watched || []) map[w.tokenAddress] = { symbol: w.symbol, name: w.name } as any;
    return map;
  }, [watched]);

  const [tokenMentions, setTokenMentions] = useState<string[]>([]);
  const { byMint } = useTokenInfoMany(tokenMentions);

  return (
    <ChatFeed
      scope={{ kind: 'global' }}
      rowPropsMapper={() => ({ byMint, watchedByMint, showCopy: true })}
      onMentionsChange={(tokens) => setTokenMentions(tokens)}
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
      }}
    />
  );
}


