"use client";

import React, { useCallback, useMemo } from 'react';
import { useTokenMessages } from '@/hooks/useMessages';
import { useTokenInfo } from '@/hooks/useTokenInfo';
import { TokenBadge } from '@/components/shared/TokenBadge';
import MessageComposer from './MessageComposer';

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}

function MessageItem({ body, createdAt }: { body: string; createdAt: string }) {
  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-sm whitespace-pre-wrap">{body}</div>
      <div className="text-[10px] text-muted-foreground">{new Date(createdAt).toLocaleString()}</div>
    </div>
  );
}

export default function TokenThread({ tokenAddress }: { tokenAddress: string }) {
  const { data: tokenInfoRows } = useTokenInfo(tokenAddress);
  const meta = useMemo(() => tokenInfoRows?.[0] ?? null, [tokenInfoRows]);
  const { data, isLoading, error, mutate, loadMore } = useTokenMessages(tokenAddress, 50);

  const handlePosted = useCallback(() => {
    mutate();
  }, [mutate]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <TokenBadge mint={tokenAddress} metadata={{ name: meta?.name ?? undefined, symbol: meta?.symbol ?? undefined, imageUrl: meta?.imageUrl ?? undefined }} />
        <div className="flex items-center gap-4">
          <Metric label="Price" value={meta?.priceUsd ?? null} />
          <Metric label="MCap" value={meta?.marketCapUsd ? `$${Math.round(meta.marketCapUsd).toLocaleString()}` : null} />
          <Metric label="Liq" value={meta?.liquidityUsd ? `$${Math.round(meta.liquidityUsd).toLocaleString()}` : null} />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {error && <div className="p-3 text-sm text-red-500">Failed to load thread</div>}
        {data?.items?.map((m) => (
          <MessageItem key={m.id} body={m.body} createdAt={m.createdAt} />
        ))}
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load more…
          </button>
        )}
      </div>
      <MessageComposer onPosted={handlePosted} tokenAddress={tokenAddress} />
    </div>
  );
}


