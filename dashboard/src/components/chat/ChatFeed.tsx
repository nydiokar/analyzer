"use client";

import React, { useMemo, useRef, useState } from 'react';
import type { Scope } from '@/chat/types';
import { useChatData } from '@/hooks/useChatData';
import { useChatBehavior } from '@/hooks/useChatBehavior';
import MessageRow from './MessageRow';
import { extractTokenMentions } from '@/chat/utils';
import MessageComposer from './MessageComposer';

type DefaultRowProps = React.ComponentProps<typeof MessageRow>;

export type ChatFeedProps<RowProps extends { message: any } = DefaultRowProps> = {
  scope: Scope;
  pageSize?: number;
  RowComponent?: React.ComponentType<RowProps>;
  rowPropsMapper?: (message: any, index: number) => Omit<RowProps, 'message' | 'isPinned' | 'selected'>;
  onItemsChange?: (items: any[]) => void;
  onMentionsChange?: (tokenAddresses: string[]) => void;
  Header?: React.ComponentType | null;
  PinnedBand?: React.ComponentType<{ items: any[] }> | null;
  Footer?: React.ComponentType | null;
  Composer?: React.ComponentType<{ scope: Scope; replyTo: { id: string; body: string } | null; onCancelReply: () => void; onPosted: () => void }> | null;
  actions: {
    onTogglePin: (messageId: string, next: boolean) => Promise<void> | void;
    onReact?: (messageId: string, type: string, on: boolean) => Promise<void> | void;
    onReply?: (messageId: string, body: string) => void; // optional if wrapper wants to intercept
    openActionsFor: (messageId: string) => void;
    onWatchToggle?: () => Promise<void> | void;
  };
};

export default function ChatFeed<RowProps extends { message: any } = DefaultRowProps>({
  scope,
  pageSize = 50,
  RowComponent = MessageRow as unknown as React.ComponentType<RowProps>,
  rowPropsMapper,
  onItemsChange,
  onMentionsChange,
  Header = null,
  PinnedBand = null,
  Footer = null,
  Composer,
  actions,
}: ChatFeedProps<RowProps>) {
  const { data, isLoading, error, mutate, loadMore, setCursor } = useChatData(scope, pageSize);

  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  const lastPostedAtRef = useRef<number>(0);

  const lastSeenKey = scope.kind === 'global' ? 'lastSeen:global' : `lastSeen:token:${scope.tokenAddress}`;

  const {
    itemsAsc,
    pinnedItems,
    sentinelRef,
    setLastSeen,
    showJump,
    scrollRef,
    scrollToBottom,
    containerProps,
    isSelected,
  } = useChatBehavior(
    {
      items: (data?.items || []) as any[],
      nextCursor: (data as any)?.nextCursor,
      mutate,
      loadMore,
      scope,
      setCursor,
    },
    {
      openActionsFor: actions.openActionsFor,
      onReplySet: (m) => {
        actions.onReply?.(m.id, m.body);
        setReplyTo(m);
      },
      onTogglePin: actions.onTogglePin,
      getIsPinned: (messageId) => !!((data?.items || []).find((x: { id: string; isPinned?: boolean }) => x.id === messageId)?.isPinned),
      onWatchToggle: actions.onWatchToggle,
    },
    { lastSeenKey }
  );

  React.useEffect(() => {
    if (onItemsChange) onItemsChange(itemsAsc as any[]);
    if (onMentionsChange) onMentionsChange(extractTokenMentions(itemsAsc as any[]));
  }, [onItemsChange, onMentionsChange, itemsAsc]);

  const PinnedDefault = useMemo(() => {
    return function PinnedDefaultImpl({ items }: { items: any[] }) {
      if (!items.length) return null;
      return (
        <div className="p-2 border-b border-border bg-muted/40">
          <div className="text-[10px] text-muted-foreground mb-1">Pinned</div>
          <div className="flex gap-2 overflow-x-auto">
            {items.map((m: any) => (
              <span key={`pin-${m.id}`} className="text-xs px-2 py-1 rounded border bg-background whitespace-nowrap" title={m.body}>
                {m.body && m.body.length > 40 ? `${m.body.slice(0, 40)}…` : m.body}
              </span>
            ))}
          </div>
        </div>
      );
    };
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0" {...containerProps} aria-label="Chat feed keyboard area">
      {Header ? <Header /> : null}
      {pinnedItems.length > 0 ? (
        React.createElement((PinnedBand || PinnedDefault) as React.ComponentType<any>, { items: pinnedItems })
      ) : null}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {data?.nextCursor && (
          <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground" onClick={loadMore}>
            Load older…
          </button>
        )}
        {isLoading && <div className="p-3 text-sm">Loading…</div>}
        {Boolean(error) && <div className="p-3 text-sm text-red-500">Failed to load messages</div>}
        {itemsAsc.map((m: any, idx: number) => {
          const extra = (rowPropsMapper ? rowPropsMapper(m, idx) : ({} as Omit<RowProps, 'message' | 'isPinned' | 'selected'>));
          const RowAny = RowComponent as unknown as React.ComponentType<any>;
          return (
            <RowAny
              key={m.id}
              {...(extra as any)}
              message={m}
              isPinned={!!m.isPinned}
              selected={isSelected(idx)}
              isOwn={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
              canDelete={lastPostedAtRef.current && new Date(m.createdAt).getTime() >= lastPostedAtRef.current - 500 ? true : false}
              onTogglePin={(id: string) => {
                const next = !m.isPinned;
                Promise.resolve(actions.onTogglePin(id, next)).then(() => mutate());
              }}
              onReply={(mm: { id: string; body: string }) => setReplyTo({ id: mm.id, body: mm.body })}
              onReact={actions.onReact ? (_mm: unknown, type: string) => {
                const count = ((m.reactions || []) as Array<{ type: string; count: number }>).find((r) => r.type === type)?.count || 0;
                const on = count === 0;
                Promise.resolve(actions.onReact!(m.id, type, on)).then(() => mutate());
              } : undefined}
            />
          );
        })}
      </div>
      {showJump ? (
        <div className="sticky bottom-0 left-0 right-0 flex justify-center mb-1">
          <button className="px-2 py-1 text-xs rounded border bg-background shadow" onClick={() => setLastSeen(Date.now())}>Jump to latest</button>
        </div>
      ) : null}
      {data?.nextCursor ? <div ref={sentinelRef} className="h-1" /> : null}
      {Composer ? (
        React.createElement(Composer as React.ComponentType<{ scope: Scope; replyTo: { id: string; body: string } | null; onCancelReply: () => void; onPosted: () => void }>, {
          scope,
          replyTo,
          onCancelReply: () => setReplyTo(null),
          onPosted: () => {
            lastPostedAtRef.current = Date.now();
            setLastSeen(Date.now());
            setReplyTo(null);
            scrollToBottom();
            mutate();
          },
        })
      ) : (
        <MessageComposer
          tokenAddress={scope.kind === 'token' ? scope.tokenAddress : undefined}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onPosted={() => {
            lastPostedAtRef.current = Date.now();
            setLastSeen(Date.now());
            setReplyTo(null);
            scrollToBottom();
            mutate();
            // Reset pagination so newest page is shown after post
            setCursor?.(null);
          }}
        />
      )}
      {Footer ? <Footer /> : null}
    </div>
  );
}


