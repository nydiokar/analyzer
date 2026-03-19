"use client";

import React, { useMemo, useCallback } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { fetcher } from '@/lib/fetcher';
import type { TokenInfoByMint } from '@/hooks/useTokenInfoMany';
import useSWR from 'swr';

export interface MessageRowProps {
  message: {
    id?: string;
    body: string;
    createdAt: string;
    authorUserId?: string | null;
    mentions?: Array<{ kind: string; refId?: string | null; rawValue: string }>;
    author?: { id: string; displayName?: string | null; email?: string | null } | null;
  };
  byMint: TokenInfoByMint;
  watchedByMint?: Record<string, { symbol?: string | null; name?: string | null }>;
  threadAddress?: string;
  showCopy?: boolean;
  isOwn?: boolean;
  canDelete?: boolean;
  isPinned?: boolean;
  onTogglePin?: (messageId: string) => void;
  highlighted?: boolean;
  selected?: boolean;
  onReply?: (m: { id?: string; body: string }) => void;
  onReact?: (m: { id?: string }, type: 'like'|'dislike'|'warn'|'test') => void;
  authorLabel?: string | null;
  groupPosition?: 'single' | 'start' | 'middle' | 'end';
}

export default function MessageRow({ message, byMint, watchedByMint = {}, threadAddress, showCopy = false, isOwn = false, canDelete = false, isPinned = false, onTogglePin, highlighted = false, selected = false, onReply, onReact, authorLabel, groupPosition = 'single' }: MessageRowProps) {
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

  // Load parent preview if needed
  const { data: parent } = useSWR(message && (message as any).parentId ? `/messages/${encodeURIComponent((message as any).parentId)}` : null, (url) => fetcher(url));

  const bubbleShape = useMemo(() => {
    if (groupPosition === 'single') return 'rounded-2xl';
    if (isOwn) {
      if (groupPosition === 'start') return 'rounded-2xl rounded-br-md';
      if (groupPosition === 'middle') return 'rounded-2xl rounded-tr-md rounded-br-md';
      return 'rounded-2xl rounded-tr-md';
    }
    if (groupPosition === 'start') return 'rounded-2xl rounded-bl-md';
    if (groupPosition === 'middle') return 'rounded-2xl rounded-tl-md rounded-bl-md';
    return 'rounded-2xl rounded-tl-md';
  }, [groupPosition, isOwn]);

  const rowPaddingClass = groupPosition === 'start' || groupPosition === 'single' ? 'pt-3 pb-1.5' : 'pt-1 pb-1.5';
  const showAuthor = Boolean(authorLabel) && (groupPosition === 'single' || groupPosition === 'start');
  const displayAuthor = isOwn ? 'You' : authorLabel;

  return (
    <div
      id={message.id ? `msg-${message.id}` : undefined}
      className={`px-3 ${rowPaddingClass}`}
      style={{ contentVisibility: 'auto' as any, containIntrinsicSize: '72px' as any }}
    >
      {showAuthor ? (
        <div className={`mb-1 px-1 text-[11px] text-muted-foreground ${isOwn ? 'text-right' : 'text-left'}`}>
          {displayAuthor}
        </div>
      ) : null}
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className={`group max-w-[80%] px-3 py-1.5 ${bubbleShape} ${highlighted || selected ? 'ring-2 ring-primary/60' : ''} focus-within:ring-2 focus-within:ring-primary outline-none ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`} tabIndex={0}>
          {(message as any).parentId && parent ? (
            <div className="mb-1 pl-2 border-l-2 border-border text-xs text-muted-foreground">
              {(parent.body || '').slice(0, 120)}{(parent.body || '').length > 120 ? '…' : ''}
            </div>
          ) : null}
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{nodes}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</div>
              {isPinned ? <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">Pinned</span> : null}
            </div>
            {(showCopy || canDelete || onTogglePin || onReply) ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="text-[10px] text-muted-foreground hover:text-foreground" data-msg-actions-trigger>
                  •••
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showCopy ? <DropdownMenuItem onClick={copyBody}>Copy</DropdownMenuItem> : null}
                  {canDelete ? <DropdownMenuItem onClick={handleDelete}>Delete</DropdownMenuItem> : null}
                  {isOwn && canDelete ? (
                    <DropdownMenuItem onClick={async () => {
                      try {
                        const next = typeof window !== 'undefined' ? window.prompt('Edit message', message.body) : null;
                        if (next === null || next === undefined) return;
                        await fetcher(`/messages/${encodeURIComponent(message.id || '')}`, { method: 'PATCH', body: JSON.stringify({ body: next }) });
                      } catch {}
                    }}>Edit</DropdownMenuItem>
                  ) : null}
                  {onTogglePin && message.id ? (
                    <DropdownMenuItem onClick={() => onTogglePin(message.id!)}>{isPinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
                  ) : null}
                  {onReply ? <DropdownMenuItem onClick={() => onReply({ id: message.id, body: message.body })}>Reply</DropdownMenuItem> : null}
                  {onReact ? (
                    <>
                      <DropdownMenuItem onClick={() => onReact({ id: message.id }, 'like')}>React 👍</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onReact({ id: message.id }, 'dislike')}>React 👎</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onReact({ id: message.id }, 'warn')}>React ⚠️</DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {/* Reactions: only show when used; add via menu */}
          {(() => {
            const reactions = ((message as any).reactions || []) as Array<{ type: string; count: number }>;
            const like = reactions.find((r) => r.type === 'like')?.count || 0;
            const dislike = reactions.find((r) => r.type === 'dislike')?.count || 0;
            const warn = reactions.find((r) => r.type === 'warn')?.count || 0;
            const any = like + dislike + warn > 0;
            if (!any) return null;
            return (
              <div className="mt-1 flex items-center gap-3 text-xs">
                {like > 0 ? <span>👍 {like}</span> : null}
                {dislike > 0 ? <span>👎 {dislike}</span> : null}
                {warn > 0 ? <span>⚠️ {warn}</span> : null}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}


