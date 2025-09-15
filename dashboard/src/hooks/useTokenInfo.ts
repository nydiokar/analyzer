"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

export interface TokenInfoRow {
  tokenAddress: string;
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  priceUsd?: string | null;
}

export const useTokenInfo = (tokenAddress: string | null) => {
  const key = tokenAddress ? ['/token-info', tokenAddress] : null as any;
  const { data, error, isLoading, mutate } = useSWR<TokenInfoRow[] | null>(
    key,
    async () => {
      if (!tokenAddress) return null;
      // POST /token-info with list
      const res = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: [tokenAddress] }),
      });
      return res as TokenInfoRow[];
    },
    { revalidateOnFocus: false }
  );
  return { data: data ?? null, error, isLoading, mutate };
};


