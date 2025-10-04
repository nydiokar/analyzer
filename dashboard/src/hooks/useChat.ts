"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useGlobalMessages, useTokenMessages } from '@/hooks/useMessages';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { fetcher } from '@/lib/fetcher';
import type { Scope, MessageLite } from '@/chat/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type ReadStateResponse = { scope: string; lastReadAt: string | null };

export function useChat(scope: Scope, pageSize: number = 50) {
  // Data layer
  const dataHook = scope.kind === 'global'
    ? useGlobalMessages(pageSize)
    : useTokenMessages(scope.tokenAddress, pageSize);

  const scopeKey = scope.kind === 'global' ? 'global' : `token:${scope.tokenAddress}`;
  const { userId } = useCurrentUser();

  const { data, isLoading, error, mutate, loadMore, hasMore, mutateMessage } = dataHook;

  const { data: readState, mutate: mutateReadState } = useSWR<ReadStateResponse>(
    `/messages/read-state?scope=${encodeURIComponent(scopeKey)}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // State
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const lastPostedAtRef = useRef<number>(0);
  const lastPersistedRef = useRef<number>(0);

  // Computed data
  const messages = useMemo(() => (data?.items || []) as MessageLite[], [data?.items]);
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
  const loadingOlderRef = useRef(false);

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
    isAtBottomRef.current = true;
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

  // Auto-scroll to bottom when new messages arrive and user is at bottom
  useEffect(() => {
    if (!itemsAsc.length || !isAtBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [itemsAsc.length, scrollToBottom]);

  // Infinite scroll
  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlderRef.current) return;
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;

    loadingOlderRef.current = true;
    try {
      await loadMore();
    } finally {
      requestAnimationFrame(() => {
        const target = scrollRef.current;
        if (target) {
          const newScrollHeight = target.scrollHeight;
          target.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
        loadingOlderRef.current = false;
      });
    }
  }, [hasMore, loadMore]);

  const sentinelRef = useInfiniteScroll(hasMore ? loadOlder : undefined, { rootMargin: '200px 0px 0px 0px' });

  // Selection functionality
  const selectedId = useMemo(() => (selectedIndex != null ? itemsAsc[selectedIndex]?.id : undefined), [itemsAsc, selectedIndex]);
  const isSelected = useCallback((idx: number) => selectedIndex === idx, [selectedIndex]);

  // Actions used by keyboard navigation
  const handleError = useCallback((error: unknown, action: string) => {
    console.error(`Chat ${action} failed:`, error);
  }, []);

  const persistReadState = useCallback(async (timestamp: number) => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const previous = lastPersistedRef.current;
    if (timestamp <= previous) return;
    lastPersistedRef.current = timestamp;
    try {
      await fetcher('/messages/read-state', {
        method: 'POST',
        body: JSON.stringify({ scope: scopeKey, lastReadAt: new Date(timestamp).toISOString() }),
      });
      mutateReadState();
    } catch (error) {
      lastPersistedRef.current = previous;
      handleError(error, 'update read state');
    }
  }, [scopeKey, mutateReadState, handleError]);

  const updateLastSeen = useCallback((timestamp: number, persist = false) => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    setLastSeen((prev) => (timestamp > prev ? timestamp : prev));
    if (persist) {
      persistReadState(timestamp);
    }
  }, [persistReadState]);

  const authoredByUser = useCallback((message: MessageLite) => {
    if (!userId) return false;
    const authorId = (message as any).authorUserId || (message as any).authorId || (message as any).author?.id;
    return Boolean(authorId && authorId === userId);
  }, [userId]);

  useEffect(() => {
    if (!itemsAsc.length || !isAtBottomRef.current) return;
    const latest = new Date(itemsAsc[itemsAsc.length - 1].createdAt).getTime();
    if (!Number.isFinite(latest) || latest <= lastSeen) return;
    updateLastSeen(latest, true);
  }, [itemsAsc, lastSeen, updateLastSeen]);

  // Real-time updates
  useMessagesSocket({
    tokenAddress: scope.kind === 'token' ? scope.tokenAddress : undefined,
    onMessageCreated: async () => {
      await mutate();
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom());
      }
    },
    onMessageEdited: async () => { await mutate(); },
    onMessageDeleted: async () => { await mutate(); },
    onMessagePinned: async () => { await mutate(); },
    onReactionUpdated: async () => { await mutate(); },
    onReadStateUpdated: (payload) => {
      if (!payload || payload.scope !== scopeKey) return;
      if (payload.userId && userId && payload.userId !== userId) return;
      const ts = Date.parse(payload.lastReadAt);
      if (Number.isNaN(ts)) return;
      if (ts > lastPersistedRef.current) {
        lastPersistedRef.current = ts;
      }
      updateLastSeen(ts, false);
      mutateReadState();
    },
  });

  useEffect(() => {
    const iso = readState?.lastReadAt;
    if (!iso) return;
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return;
    if (ts > lastPersistedRef.current) {
      lastPersistedRef.current = ts;
    }
    updateLastSeen(ts, false);
  }, [readState?.lastReadAt, updateLastSeen]);

  const openActionsFor = useCallback((messageId: string) => {
    const row = document.getElementById(`msg-${messageId}`);
    const trigger = row?.querySelector('[data-msg-actions-trigger]');
    if (trigger instanceof HTMLElement) trigger.click();
  }, []);

  const pinMessage = useCallback(async (messageId: string, isPinned: boolean) => {
    try {
      // Optimistic update
      await mutateMessage(
        messageId,
        (m) => ({ ...m, isPinned }),
        { revalidate: false },
      );

      await fetcher(`/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ isPinned })
      });

      // Revalidate after success
      mutate();
    } catch (error) {
      handleError(error, 'pin message');
      // Rollback on error
      mutate();
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
      // Optimistic update
      await mutateMessage(
        messageId,
        (m) => {
          const reactions = (m.reactions || []) as Array<{ type: string; count: number; messageId: string }>;
          const existing = reactions.find((r) => r.type === type);

          let newReactions;
          if (on) {
            if (existing) {
              newReactions = reactions.map((r) =>
                r.type === type ? { ...r, count: r.count + 1 } : r
              );
            } else {
              newReactions = [...reactions, { type, count: 1, messageId }];
            }
          } else {
            if (existing && existing.count > 1) {
              newReactions = reactions.map((r) =>
                r.type === type ? { ...r, count: r.count - 1 } : r
              );
            } else {
              newReactions = reactions.filter((r) => r.type !== type);
            }
          }

          return { ...m, reactions: newReactions };
        },
        { revalidate: false },
      );

      await fetcher(`/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ type, on })
      });

      // Revalidate after success
      mutate();
    } catch (error) {
      handleError(error, 'react to message');
      // Rollback on error
      mutate();
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
    const now = Date.now();
    updateLastSeen(now, true);
    scrollToBottom();
  }, [updateLastSeen, scrollToBottom]);

  const cancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const startReply = useCallback((message: { id?: string; body: string }) => {
    if (message.id) {
      setReplyTo({ id: message.id, body: message.body });
    }
  }, []);

  const onMessageSent = useCallback(() => {
    const now = Date.now();
    lastPostedAtRef.current = now;
    updateLastSeen(now, true);
    setReplyTo(null);
    scrollToBottom();
    requestAnimationFrame(() => scrollToBottom());
    mutate();
  }, [scrollToBottom, mutate, updateLastSeen]);

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
    hasMore: Boolean(hasMore),

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
    isMessageOwn: (message: MessageLite) => {
      if (authoredByUser(message)) return true;
      const createdAtMs = new Date(message.createdAt).getTime();
      if (!Number.isFinite(createdAtMs)) return false;
      const ref = lastPostedAtRef.current;
      return Boolean(ref && createdAtMs >= ref - 2000);
    },

    // Load more
    loadMore: loadOlder,
  } as const;
}
