import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { TopHoldersResponse } from '@/types/api';

export function useTokenMetadata(mint?: string) {
  const key = mint ? `/token-info` : null;
  const { data, error, isLoading, mutate } = useSWR<any>(
    key,
    () => fetcher('/token-info', {
      method: 'POST',
      body: JSON.stringify({ tokenAddresses: [mint] }),
    }),
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const meta = Array.isArray(data) && data[0] ? data[0] : undefined;
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


