import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { TopHoldersResponse } from '@/types/api';

export function useTopHolders(mint?: string, commitment?: 'finalized' | 'confirmed' | 'processed') {
  const key = mint ? `/token-info/${mint}/top-holders${commitment ? `?commitment=${commitment}` : ''}` : null;
  const { data, error, isLoading, mutate } = useSWR<TopHoldersResponse>(key, fetcher);
  return {
    data,
    error,
    isLoading,
    refresh: mutate,
  };
}


