"use client";

import React, { useCallback } from 'react';
import { useGlobalMessages } from '@/hooks/useMessages';
import MessageComposer from './MessageComposer';

function MessageItem({ body, createdAt }: { body: string; createdAt: string }) {
  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-sm whitespace-pre-wrap">{body}</div>
      <div className="text-[10px] text-muted-foreground">{new Date(createdAt).toLocaleString()}</div>
    </div>
  );
}

export default function GlobalChat() {
  const { data, isLoading, error, mutate, loadMore } = useGlobalMessages(50);

  const handlePosted = useCallback(() => {
    mutate();
  }, [mutate]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}
        {data?.items?.map((m) => (
          <MessageItem key={m.id} body={m.body} createdAt={m.createdAt} />
        ))}
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load more…
          </button>
        )}
      </div>
      <MessageComposer onPosted={handlePosted} />
    </div>
  );
}


