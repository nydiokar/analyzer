"use client";

import React, { useCallback, useMemo } from 'react';
import { useGlobalMessages } from '@/hooks/useMessages';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import MessageComposer from './MessageComposer';
import { TokenBadge } from '@/components/shared/TokenBadge';

function MessageItem({ message }: { message: { body: string; createdAt: string; mentions?: Array<{ kind: string; refId?: string | null; rawValue: string }> } }) {
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
      out.push(
        <TokenBadge key={`t-${o.mint}-${o.start}`} mint={o.mint} size="sm" className="inline-flex align-middle mx-1" />
      );
      cursor = o.end;
    }
    if (cursor < body.length) out.push(body.slice(cursor));
    return out;
  }, [message.body, message.mentions]);

  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-sm whitespace-pre-wrap">{nodes}</div>
      <div className="text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</div>
    </div>
  );
}

export default function GlobalChat() {
  const { data, isLoading, error, mutate, loadMore } = useGlobalMessages(50);

  const handlePosted = useCallback(() => {
    mutate();
  }, [mutate]);

  useMessagesSocket({
    onMessageCreated: () => {
      mutate();
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}
        {data?.items?.map((m) => (
          <MessageItem key={m.id} message={m as any} />
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


