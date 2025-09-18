"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import { useTokenMessages } from '@/hooks/useMessages';
import { TokenBadge } from '@/components/shared/TokenBadge';
import MessageComposer from './MessageComposer';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { useTokenInfoMany } from '@/hooks/useTokenInfoMany';
import type { TokenInfoByMint } from '@/hooks/useTokenInfoMany';
import { useWatchedTokens } from '@/hooks/useWatchedTokens';
import MessageRow from './MessageRow';

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

export default function TokenThread({ tokenAddress }: { tokenAddress: string }) {
  const { data, isLoading, error, mutate, loadMore } = useTokenMessages(tokenAddress, 50);
  const tokenMentions = (data?.items || [])
    .flatMap((m) => (m.mentions || []).filter((x) => (x.kind === 'TOKEN' || x.kind === 'token') && x.refId).map((x) => x.refId as string));
  const { byMint } = useTokenInfoMany(tokenMentions);
  const { data: watched } = useWatchedTokens('FAVORITES');
  const watchedMeta = useMemo(() => (watched || []).find((w) => w.tokenAddress === tokenAddress) || null, [watched, tokenAddress]);

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
  });

  const lastPostedAtRef = useRef<number>(0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <TokenBadge mint={tokenAddress} metadata={{ name: watchedMeta?.name ?? undefined, symbol: watchedMeta?.symbol ?? undefined, imageUrl: (watchedMeta?.imageUrl as any) ?? undefined }} />
        <div className="flex items-center gap-4">
          <Metric label="Price" value={watchedMeta?.priceUsd ?? null} />
          <Metric label="MCap" value={watchedMeta?.marketCapUsd ? `$${Math.round(watchedMeta.marketCapUsd).toLocaleString()}` : null} />
          <Metric label="Liq" value={watchedMeta?.liquidityUsd ? `$${Math.round(watchedMeta.liquidityUsd).toLocaleString()}` : null} />
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
        {data?.items?.map((m) => (
          <MessageRow
            key={m.id}
            message={m as any}
            byMint={byMint}
            threadAddress={tokenAddress}
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
      <MessageComposer onPosted={() => { lastPostedAtRef.current = Date.now(); handlePosted(); }} tokenAddress={tokenAddress} />
    </div>
  );
}


