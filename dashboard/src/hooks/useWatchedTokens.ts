"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

export interface WatchedTokenRow {
  tokenAddress: string;
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  latestMessageAt?: string | null;
  tags: Array<{ name: string; type: string }>;
}

export const useWatchedTokens = (list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES') => {
  const key = [`/watched-tokens?list=${list}`];
  const { data, error, isLoading, mutate } = useSWR<WatchedTokenRow[]>(key, ([url]) => fetcher(url), {
    revalidateOnFocus: false,
    refreshInterval: 8000,
  });
  return { data: data ?? [], error, isLoading, mutate };
};


