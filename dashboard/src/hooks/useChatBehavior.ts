"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useChatKeyboard } from '@/hooks/useChatKeyboard';
import type { Scope } from '@/chat/types';

type MessageLite = { id: string; createdAt: string; isPinned?: boolean; body?: string };

type ChatBehaviorDeps = {
  openActionsFor: (messageId: string) => void;
  onReplySet: (m: { id: string; body: string }) => void;
  onTogglePin: (messageId: string, nextIsPinned: boolean) => Promise<void> | void;
  getIsPinned: (messageId: string) => boolean;
  onWatchToggle?: () => Promise<void> | void;
};

type ChatBehaviorOptions = { lastSeenKey: string };

export function useChatBehavior(
  params: {
    items: MessageLite[];
    nextCursor?: string | null;
    mutate: () => void;
    loadMore?: () => void;
    scope: Scope;
    setCursor?: (cursor: string | null) => void;
  },
  deps: ChatBehaviorDeps,
  options: ChatBehaviorOptions,
) {
  const { items, nextCursor, mutate, loadMore, scope, setCursor } = params;
  const { openActionsFor, onReplySet, onTogglePin, getIsPinned, onWatchToggle } = deps;
  const { lastSeenKey } = options;

  const itemsAsc = useMemo(() => (items || []).slice().reverse(), [items]);
  const pinnedItems = useMemo(() => itemsAsc.filter((m) => !!m.isPinned), [itemsAsc]);

  useMessagesSocket({
    tokenAddress: scope.kind === 'token' ? scope.tokenAddress : undefined,
    onMessageCreated: () => { 
      setCursor?.(null); 
      mutate(); 
      // Auto-scroll if user is at bottom
      if (isAtBottomRef.current) {
        setTimeout(scrollToBottom, 100); // Small delay to ensure DOM is updated
      }
    },
    onMessageEdited: () => { setCursor?.(null); mutate(); },
    onMessageDeleted: () => { setCursor?.(null); mutate(); },
    onMessagePinned: () => { setCursor?.(null); mutate(); },
    onReactionUpdated: () => { setCursor?.(null); mutate(); },
  });

  const sentinelRef = useInfiniteScroll(nextCursor ? loadMore : undefined);

  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return Date.now();
    const v = window.localStorage.getItem(lastSeenKey);
    return v ? Number(v) : Date.now();
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(lastSeenKey, String(lastSeen));
  }, [lastSeen, lastSeenKey]);
  const newestTs = (items?.[0]?.createdAt ? new Date(items[0].createdAt).getTime() : 0);
  const showJump = newestTs > lastSeen;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Track if user is at bottom to auto-scroll on new messages
  const isAtBottomRef = useRef(true);
  const checkIfAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return false;
    const threshold = 100; // pixels from bottom
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }, []);

  // Update isAtBottomRef when scrolling
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    
    const handleScroll = () => {
      isAtBottomRef.current = checkIfAtBottom();
    };
    
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [checkIfAtBottom]);

  // Auto-scroll to bottom when new messages arrive and user is at bottom
  useEffect(() => {
    if (itemsAsc.length > 0 && isAtBottomRef.current) {
      setTimeout(scrollToBottom, 50); // Small delay to ensure DOM is updated
    }
  }, [itemsAsc.length, scrollToBottom]);

  const { containerProps, isSelected } = useChatKeyboard({
    items: itemsAsc as Array<{ id: string }>,
    openActionsFor,
    onReply: (messageId: string) => {
      const m = itemsAsc.find((x) => x.id === messageId);
      if (m) onReplySet({ id: m.id, body: m.body || '' });
    },
    onTogglePin: (messageId: string, nextIsPinned: boolean) => onTogglePin(messageId, nextIsPinned),
    getIsPinned: (messageId: string) => getIsPinned(messageId),
    onWatchToggle,
    options: {
      isTyping: () => {
        const ae = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
        if (!ae) return false;
        const tag = ae.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || ae.getAttribute('role') === 'textbox';
      },
    },
  });

  return {
    itemsAsc,
    pinnedItems,
    sentinelRef,
    lastSeen,
    setLastSeen,
    showJump,
    scrollRef,
    scrollToBottom,
    containerProps,
    isSelected,
  } as const;
}


