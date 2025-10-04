"use client";

import useSWRInfinite from 'swr/infinite';
import { useCallback, useMemo } from 'react';
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
  const {
    data,
    error,
    isValidating,
    mutate,
    setSize,
    size,
  } = useSWRInfinite<PagedResult<MessageDto>>(
    (pageIndex, previousPageData) => {
      if (previousPageData && !previousPageData.nextCursor) return null;
      if (pageIndex === 0) return `/messages?limit=${limit}`;
      const cursor = previousPageData?.nextCursor;
      if (!cursor) return null;
      return `/messages?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
    },
    (url) => fetcher(url),
    {
      revalidateOnFocus: false,
    }
  );

  const combinedItems = useMemo(() => data?.flatMap((page) => page.items) ?? [], [data]);
  const lastPage = data?.[data.length - 1];
  const nextCursor = lastPage?.nextCursor ?? null;
  const isLoading = !data && isValidating;

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    await setSize((s) => s + 1);
  }, [nextCursor, setSize]);

  const reset = useCallback(async () => {
    await setSize(1);
  }, [setSize]);

  return {
    data: data ? ({ items: combinedItems, nextCursor } as PagedResult<MessageDto>) : undefined,
    error,
    isLoading,
    isValidating,
    mutate,
    loadMore,
    hasMore: Boolean(nextCursor),
    size,
    setSize,
    reset,
  } as const;
};

export const postMessage = async (body: string, parentId?: string) => {
  return fetcher('/messages', {
    method: 'POST',
    body: JSON.stringify({ body, source: 'dashboard', parentId: parentId ?? undefined }),
  });
};

export const useTokenMessages = (tokenAddress: string, limit: number = 50) => {
  const {
    data,
    error,
    isValidating,
    mutate,
    setSize,
    size,
  } = useSWRInfinite<PagedResult<MessageDto>>(
    (pageIndex, previousPageData) => {
      if (!tokenAddress) return null;
      if (previousPageData && !previousPageData.nextCursor) return null;
      if (pageIndex === 0) {
        return `/messages/tokens/${encodeURIComponent(tokenAddress)}/messages?limit=${limit}`;
      }
      const cursor = previousPageData?.nextCursor;
      if (!cursor) return null;
      return `/messages/tokens/${encodeURIComponent(tokenAddress)}/messages?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
    },
    (url) => fetcher(url),
    {
      revalidateOnFocus: false,
    }
  );

  const combinedItems = useMemo(() => data?.flatMap((page) => page.items) ?? [], [data]);
  const lastPage = data?.[data.length - 1];
  const nextCursor = lastPage?.nextCursor ?? null;
  const isLoading = !data && isValidating;

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    await setSize((s) => s + 1);
  }, [nextCursor, setSize]);

  const reset = useCallback(async () => {
    await setSize(1);
  }, [setSize]);

  return {
    data: data ? ({ items: combinedItems, nextCursor } as PagedResult<MessageDto>) : undefined,
    error,
    isLoading,
    isValidating,
    mutate,
    loadMore,
    hasMore: Boolean(nextCursor),
    size,
    setSize,
    reset,
  } as const;
};


