"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMessagesSocket, type TokenAddedPayload } from '@/hooks/useMessagesSocket';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const STORAGE_KEY = 'tokens-notifications:lastClearedAt';

export type NotificationKind = 'message' | 'token_added';

export interface TokensNotificationItem {
  id: string;
  kind: NotificationKind;
  /** Author display name or email prefix */
  actor: string | null;
  /** Message body snippet (first 120 chars) */
  snippet: string | null;
  /** Token address if the event is associated with one */
  tokenAddress: string | null;
  createdAt: string;
}

function writeLastCleared(ts: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // storage quota or private browsing — non-fatal
  }
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function useTokensNotifications(enabled: boolean) {
  const pathname = usePathname();
  const { userId } = useCurrentUser();

  const [items, setItems] = useState<TokensNotificationItem[]>([]);
  // Start at 0; hydrated from localStorage in the first useEffect to avoid SSR mismatch
  const [lastClearedAt, setLastClearedAt] = useState<number>(0);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage exactly once on the client, after mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v) setLastClearedAt(Number(v));
    } catch {
      // ignore
    }
  }, []);

  const unreadCount = useMemo(
    () => items.filter((n) => new Date(n.createdAt).getTime() > lastClearedAt).length,
    [items, lastClearedAt],
  );

  // Auto-clear when user navigates to /tokens
  useEffect(() => {
    if (pathname === '/tokens') {
      const now = Date.now();
      setLastClearedAt(now);
      writeLastCleared(now);
    }
  }, [pathname]);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setLastClearedAt(now);
    writeLastCleared(now);
  }, []);

  const addItem = useCallback((item: TokensNotificationItem) => {
    setItems((prev) => {
      if (prev.some((n) => n.id === item.id)) return prev;
      return [item, ...prev].slice(0, 50);
    });
  }, []);

  // Stable ref for userId so the socket callbacks don't need it as a dependency
  const userIdRef = useRef<string | undefined>(userId);
  userIdRef.current = userId;

  useMessagesSocket({
    // No tokenAddress — joins global-chat room, receives all global broadcasts
    onMessageCreated: useCallback((payload: { id: string; createdAt: string; body?: string; author?: { id: string; displayName?: string | null; email?: string | null } | null; mentions?: Array<{ kind: string; refId?: string | null }> }) => {
      if (!enabled) return;
      if (!payload?.id) return;
      // Don't notify on own messages
      const authorId = payload.author?.id;
      if (authorId && userIdRef.current && authorId === userIdRef.current) return;

      const author = payload.author;
      const actorName = author?.displayName || (author?.email ? author.email.split('@')[0] : null);
      const body = payload.body ?? '';

      const tokenMention = Array.isArray(payload.mentions)
        ? payload.mentions.find((m) => m.kind === 'TOKEN' && m.refId)
        : null;

      addItem({
        id: payload.id,
        kind: 'message',
        actor: actorName ?? null,
        snippet: body ? truncate(body, 120) : null,
        tokenAddress: tokenMention?.refId ?? null,
        createdAt: payload.createdAt ?? new Date().toISOString(),
      });
    }, [enabled, addItem]),

    onTokenAdded: useCallback((payload: TokenAddedPayload) => {
      if (!enabled) return;
      if (!payload?.tokenAddress) return;
      addItem({
        // Use a random id — addedAt alone is not collision-safe under retries
        id: `token-added:${payload.tokenAddress}:${payload.addedAt}:${Math.random().toString(36).slice(2)}`,
        kind: 'token_added',
        actor: null,
        snippet: null,
        tokenAddress: payload.tokenAddress,
        createdAt: payload.addedAt ?? new Date().toISOString(),
      });
    }, [enabled, addItem]),
  });

  return { items, unreadCount, markAllRead, lastClearedAt };
}
