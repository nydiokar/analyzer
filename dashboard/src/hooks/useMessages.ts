"use client";

import useSWR from 'swr';
import { useCallback, useMemo, useRef, useState } from 'react';
import { fetcher } from '@/lib/fetcher';

export interface MessageDto {
  id: string;
  body: string;
  createdAt: string;
  isPinned?: boolean;
  parentId?: string | null;
  reactions?: Array<{ messageId: string; type: string; count: number }>;
  mentions?: Array<{ kind: string; refId?: string | null; rawValue: string; metaJson?: unknown }>;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export const useGlobalMessages = (limit: number = 50) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const key = useMemo(() => [`/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`], [cursor, limit]);
  const { data, error, isLoading, mutate } = useSWR<PagedResult<MessageDto>>(key, ([url]) => fetcher(url), {
    revalidateOnFocus: false,
    refreshInterval: 5000,
  });
  const loadMore = useCallback(() => {
    if (data?.nextCursor) setCursor(data.nextCursor);
  }, [data?.nextCursor]);
  return { data, error, isLoading, mutate, loadMore, cursor, setCursor };
};

export const postMessage = async (body: string, parentId?: string) => {
  return fetcher('/messages', {
    method: 'POST',
    body: JSON.stringify({ body, source: 'dashboard', parentId: parentId ?? undefined }),
  });
};

export const useTokenMessages = (tokenAddress: string, limit: number = 50) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const key = useMemo(
    () => [tokenAddress ? `/messages/tokens/${encodeURIComponent(tokenAddress)}/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` : null],
    [cursor, limit, tokenAddress]
  );
  const { data, error, isLoading, mutate } = useSWR<PagedResult<MessageDto>>(
    tokenAddress ? (key as any) : null,
    ([url]) => fetcher(url),
    { revalidateOnFocus: false, refreshInterval: 5000 }
  );
  const loadMore = useCallback(() => {
    if (data?.nextCursor) setCursor(data.nextCursor);
  }, [data?.nextCursor]);
  return { data, error, isLoading, mutate, loadMore, cursor, setCursor };
};


