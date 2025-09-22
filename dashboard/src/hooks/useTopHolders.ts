import useSWR from 'swr';
import { useEffect, useRef } from 'react';
import { fetcher } from '@/lib/fetcher';
import type { TopHoldersResponse } from '@/types/api';

export function useTokenMetadata(mint?: string) {
  // Include the mint in the SWR key so we re-fetch when it changes
  const key = mint ? `/token-info?mint=${mint}` : null;
  const { data, error, isLoading, mutate } = useSWR<any>(
    key,
    () => fetcher('/token-info', {
      method: 'POST',
      body: JSON.stringify({ tokenAddresses: [mint] }),
    }),
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateOnMount: true, dedupingInterval: 300 }
  );
  // Normalize: API may return an array or a single object
  let meta: any | undefined;
  if (Array.isArray(data)) {
    // Prefer exact match by token address; if not found, prefer first with a non-empty name/symbol
    const byExact = mint ? data.find((t: any) => t?.tokenAddress === mint) : undefined;
    if (byExact) {
      meta = byExact;
    } else {
      const withName = data.find((t: any) => (t?.name && String(t.name).trim()) || (t?.symbol && String(t.symbol).trim()));
      meta = withName ?? (data[0] ?? undefined);
    }
  } else if (data && typeof data === 'object') {
    meta = data;
  }
  if (mint && data) {
    // eslint-disable-next-line no-console
    console.log('useTokenMetadata resolved', {
      mint,
      items: Array.isArray(data) ? data.length : 1,
      chosen: meta?.name,
      symbol: meta?.symbol,
    });
  }

  // If DB returned no record initially (enrichment pending), retry a few times with backoff
  const attemptsRef = useRef<number>(0);
  useEffect(() => {
    if (!mint) return;
    if (meta) { attemptsRef.current = 0; return; }
    if (attemptsRef.current >= 5) return; // cap ~5 retries
    const delayMs = Math.min(1000 * Math.pow(1.6, attemptsRef.current), 6000);
    const t = setTimeout(() => { attemptsRef.current += 1; mutate(); }, delayMs);
    return () => clearTimeout(t);
  }, [mint, meta, mutate]);
  return { meta, error, isLoading, refresh: mutate };
}

export function useTopHolders(mint?: string, commitment?: 'finalized' | 'confirmed' | 'processed') {
  const key = mint ? `/token-info/${mint}/top-holders${commitment ? `?commitment=${commitment}` : ''}` : null;
  const { data, error, isLoading, mutate } = useSWR<TopHoldersResponse>(
    key,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  return {
    data,
    error,
    isLoading,
    refresh: mutate,
  };
}


