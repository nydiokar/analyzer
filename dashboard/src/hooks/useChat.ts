"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGlobalMessages, useTokenMessages } from '@/hooks/useMessages';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { fetcher } from '@/lib/fetcher';
import type { Scope, MessageLite } from '@/chat/types';

export function useChat(scope: Scope, pageSize: number = 50) {
  // Data layer
  const dataHook = scope.kind === 'global'
    ? useGlobalMessages(pageSize)
    : useTokenMessages(scope.tokenAddress, pageSize);

  const { data, isLoading, error, mutate, loadMore, setCursor } = dataHook;

  // State
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const lastPostedAtRef = useRef<number>(0);

  // Computed data
  const messages = (data?.items || []) as MessageLite[];
  const itemsAsc = useMemo(() => messages.slice().reverse(), [messages]);
  const pinnedMessages = useMemo(() => itemsAsc.filter((m) => !!m.isPinned), [itemsAsc]);

  // Last seen functionality
  const lastSeenKey = scope.kind === 'global' ? 'lastSeen:global' : `lastSeen:token:${scope.tokenAddress}`;
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return Date.now();
    const v = window.localStorage.getItem(lastSeenKey);
    return v ? Number(v) : Date.now();
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(lastSeenKey, String(lastSeen));
    }
  }, [lastSeen, lastSeenKey]);

  const newestTs = (messages?.[0]?.createdAt ? new Date(messages[0].createdAt).getTime() : 0);
  const showJumpToLatest = newestTs > lastSeen;

  // Scroll functionality
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);

  const checkIfAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return false;
    const threshold = 100;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = typeof document !== 'undefined' ? document.getElementById(`msg-${messageId}`) : null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  // Real-time updates
  useMessagesSocket({
    tokenAddress: scope.kind === 'token' ? scope.tokenAddress : undefined,
    onMessageCreated: () => {
      setCursor?.(null);
      mutate();
      // Auto-scroll will be handled by the effect below after mutate completes
    },
    onMessageEdited: () => { setCursor?.(null); mutate(); },
    onMessageDeleted: () => { setCursor?.(null); mutate(); },
    onMessagePinned: () => { setCursor?.(null); mutate(); },
    onReactionUpdated: () => { setCursor?.(null); mutate(); },
  });

  // Auto-scroll to bottom when new messages arrive and user is at bottom
  useEffect(() => {
    if (itemsAsc.length > 0 && isAtBottomRef.current) {
      setTimeout(scrollToBottom, 50);
    }
  }, [itemsAsc.length, scrollToBottom]);

  // Infinite scroll
  const sentinelRef = useInfiniteScroll(data?.nextCursor ? loadMore : undefined);

  // Selection functionality
  const selectedId = useMemo(() => (selectedIndex != null ? itemsAsc[selectedIndex]?.id : undefined), [itemsAsc, selectedIndex]);
  const isSelected = useCallback((idx: number) => selectedIndex === idx, [selectedIndex]);

  // Actions used by keyboard navigation
  const handleError = useCallback((error: unknown, action: string) => {
    console.error(`Chat ${action} failed:`, error);
  }, []);

  const openActionsFor = useCallback((messageId: string) => {
    const row = document.getElementById(`msg-${messageId}`);
    const trigger = row?.querySelector('[data-msg-actions-trigger]');
    if (trigger instanceof HTMLElement) trigger.click();
  }, []);

  const pinMessage = useCallback(async (messageId: string, isPinned: boolean) => {
    try {
      await fetcher(`/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ isPinned })
      });
      mutate();
    } catch (error) {
      handleError(error, 'pin message');
    }
  }, [mutate, handleError]);

  // Keyboard navigation
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!itemsAsc.length) return;

    const isTyping = (() => {
      const ae = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (!ae) return false;
      const tag = ae.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || ae.getAttribute('role') === 'textbox';
    })();

    if (isTyping) return;

    // J - next message
    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      setSelectedIndex((idx) => {
        const next = idx == null ? itemsAsc.length - 1 : Math.min(itemsAsc.length - 1, idx + 1);
        scrollToMessage(itemsAsc[next]?.id);
        return next;
      });
      return;
    }

    // K - previous message
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setSelectedIndex((idx) => {
        const curr = idx == null ? itemsAsc.length - 1 : idx;
        const next = Math.max(0, curr - 1);
        scrollToMessage(itemsAsc[next]?.id);
        return next;
      });
      return;
    }

    // Enter - open actions
    if (e.key === 'Enter' && !e.shiftKey) {
      const idx = selectedIndex ?? (itemsAsc.length - 1);
      const id = itemsAsc[idx]?.id;
      if (id) {
        e.preventDefault();
        openActionsFor(id);
      }
      return;
    }

    // Q - reply
    if (e.key.toLowerCase() === 'q') {
      const idx = selectedIndex ?? (itemsAsc.length - 1);
      const message = itemsAsc[idx];
      if (message) {
        e.preventDefault();
        setReplyTo({ id: message.id, body: message.body });
      }
      return;
    }

    // Alt+P - toggle pin
    if (e.altKey && e.key.toLowerCase() === 'p') {
      const idx = selectedIndex ?? (itemsAsc.length - 1);
      const message = itemsAsc[idx];
      if (message) {
        e.preventDefault();
        pinMessage(message.id, !message.isPinned);
      }
      return;
    }
  }, [itemsAsc, selectedIndex, scrollToMessage, openActionsFor, pinMessage]);

  const containerProps = useMemo(() => ({ tabIndex: 0, onKeyDown }), [onKeyDown]);

  const reactToMessage = useCallback(async (messageId: string, type: string, on: boolean) => {
    try {
      await fetcher(`/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ type, on })
      });
      mutate();
    } catch (error) {
      handleError(error, 'react to message');
    }
  }, [mutate, handleError]);

  const watchToken = useCallback(async (tokenAddress: string, on: boolean) => {
    try {
      await fetcher(`/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, {
        method: 'POST',
        body: JSON.stringify({ on })
      });
    } catch (error) {
      handleError(error, 'watch token');
    }
  }, [handleError]);

  const jumpToLatest = useCallback(() => {
    setLastSeen(Date.now());
    scrollToBottom();
  }, [scrollToBottom]);

  const cancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const startReply = useCallback((message: { id?: string; body: string }) => {
    if (message.id) {
      setReplyTo({ id: message.id, body: message.body });
    }
  }, []);

  const onMessageSent = useCallback(() => {
    lastPostedAtRef.current = Date.now();
    setLastSeen(Date.now());
    setReplyTo(null);
    scrollToBottom();
    mutate();
    setCursor?.(null);
  }, [scrollToBottom, mutate, setCursor]);

  // Click pinned message to scroll to original
  const onPinnedMessageClick = useCallback((messageId: string) => {
    scrollToMessage(messageId);
    setSelectedIndex(itemsAsc.findIndex(m => m.id === messageId));
  }, [scrollToMessage, itemsAsc]);

  return {
    // Data
    messages: itemsAsc,
    pinnedMessages,
    isLoading,
    error,
    hasMore: !!data?.nextCursor,

    // State
    replyTo,
    selectedIndex,
    selectedId,
    lastSeen,
    showJumpToLatest,

    // Refs
    scrollRef,
    sentinelRef,
    containerProps,

    // Actions
    openActionsFor,
    pinMessage,
    reactToMessage,
    watchToken,
    jumpToLatest,
    cancelReply,
    startReply,
    onMessageSent,
    onPinnedMessageClick,
    scrollToMessage,
    scrollToBottom,

    // Utils
    isSelected,
    isMessageOwn: (message: MessageLite) =>
      lastPostedAtRef.current && new Date(message.createdAt).getTime() >= lastPostedAtRef.current - 500,

    // Load more
    loadMore,
  } as const;
}