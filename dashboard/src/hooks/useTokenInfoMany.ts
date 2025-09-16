"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { TokenInfoRow } from './useTokenInfo';

export type TokenInfoByMint = Record<string, TokenInfoRow | undefined>;

export const useTokenInfoMany = (tokenAddresses: string[]) => {
  const addrs = Array.from(new Set((tokenAddresses || []).filter(Boolean)));
  const key = addrs.length > 0 ? ['/token-info/batch', ...addrs] : null as any;
  const { data, error, isLoading, mutate } = useSWR<TokenInfoRow[] | null>(
    key,
    async () => {
      if (addrs.length === 0) return null;
      const rows = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: addrs }),
      });
      return rows as TokenInfoRow[];
    },
    { revalidateOnFocus: false }
  );

  const byMint: TokenInfoByMint = {};
  (data || []).forEach((r) => { byMint[r.tokenAddress] = r; });

  return { data: data ?? null, byMint, error, isLoading, mutate };
};


