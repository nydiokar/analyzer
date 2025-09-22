"use client";

import React, { useMemo, useCallback } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { fetcher } from '@/lib/fetcher';
import type { TokenInfoByMint } from '@/hooks/useTokenInfoMany';

export interface MessageRowProps {
  message: { id?: string; body: string; createdAt: string; mentions?: Array<{ kind: string; refId?: string | null; rawValue: string }> };
  byMint: TokenInfoByMint;
  watchedByMint?: Record<string, { symbol?: string | null; name?: string | null }>;
  threadAddress?: string;
  showCopy?: boolean;
  isOwn?: boolean;
  canDelete?: boolean;
  isPinned?: boolean;
  onTogglePin?: (messageId: string) => void;
  highlighted?: boolean;
}

export default function MessageRow({ message, byMint, watchedByMint = {}, threadAddress, showCopy = false, isOwn = false, canDelete = false, isPinned = false, onTogglePin, highlighted = false }: MessageRowProps) {
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
      if (o.start < cursor) continue;
      if (o.start > cursor) out.push(body.slice(cursor, o.start));
      // In a scoped thread, omit the scoped token mention entirely
      if (threadAddress && o.mint === threadAddress) {
        cursor = o.end;
        continue;
      }
      const label = watchedByMint[o.mint]?.symbol
        || watchedByMint[o.mint]?.name
        || byMint[o.mint]?.symbol
        || byMint[o.mint]?.name
        || `${o.mint.slice(0, 4)}...${o.mint.slice(-4)}`;
      out.push(
        <span key={`twrap-${o.mint}-${o.start}`} className="inline-flex items-center mx-1 text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">
          {label}
        </span>
      );
      cursor = o.end;
    }
    if (cursor < body.length) out.push(body.slice(cursor));
    return out;
  }, [message.body, message.mentions, byMint, watchedByMint, threadAddress]);

  const copyBody = useCallback(() => {
    try {
      void navigator.clipboard?.writeText(message.body);
    } catch {}
  }, [message.body]);

  const handleDelete = useCallback(async () => {
    const id = message.id;
    if (!id) return;
    try {
      await fetcher(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}
  }, [message.id]);

  return (
    <div
      id={message.id ? `msg-${message.id}` : undefined}
      className="px-3 py-1.5"
      style={{ contentVisibility: 'auto' as any, containIntrinsicSize: '72px' as any }}
    >
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className={`group max-w-[80%] px-3 py-1.5 rounded-2xl ${highlighted ? 'ring-2 ring-primary/60' : ''} focus-within:ring-2 focus-within:ring-primary outline-none ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`} tabIndex={0}>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{nodes}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</div>
              {isPinned ? <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">Pinned</span> : null}
            </div>
            {(showCopy || canDelete || onTogglePin) ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="text-[10px] text-muted-foreground hover:text-foreground">•••</DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showCopy ? <DropdownMenuItem onClick={copyBody}>Copy</DropdownMenuItem> : null}
                  {canDelete ? <DropdownMenuItem onClick={handleDelete}>Delete</DropdownMenuItem> : null}
                  {onTogglePin && message.id ? (
                    <DropdownMenuItem onClick={() => onTogglePin(message.id!)}>{isPinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}


