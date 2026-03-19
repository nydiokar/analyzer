"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { createCacheKey } from '@/lib/swr-config';
import type { WatchedTokenRow } from '@/hooks/useWatchedTokens';

export function useUserWatchedTokens(enabled: boolean = true) {
  const key = enabled ? createCacheKey.userWatchedTokens() : null;
  const { data, error, isLoading, mutate } = useSWR<WatchedTokenRow[]>(key, fetcher, {
    revalidateOnFocus: false,
  });

  return {
    data: data ?? [],
    error,
    isLoading,
    mutate,
  };
}
