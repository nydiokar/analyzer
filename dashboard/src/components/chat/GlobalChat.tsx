"use client";

import React, { useCallback, useMemo } from 'react';
import { useGlobalMessages } from '@/hooks/useMessages';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import MessageComposer from './MessageComposer';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import MessageRow from './MessageRow';
import { useRef } from 'react';

export default function GlobalChat() {
  const { data, isLoading, error, mutate, loadMore } = useGlobalMessages(50);
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
  });

  // Track last posted id to style own bubble; minimal heuristic via time
  const lastPostedAtRef = useRef<number>(0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}
        {data?.items?.map((m) => (
          <MessageRow
            key={m.id}
            message={m as any}
            byMint={byMint}
            watchedByMint={watchedByMint}
            showCopy
            isOwn={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
            canDelete={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
          />
        ))}
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load more…
          </button>
        )}
      </div>
      <MessageComposer onPosted={() => { lastPostedAtRef.current = Date.now(); handlePosted(); }} />
    </div>
  );
}


