import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { createCacheKey } from '@/lib/swr-config';
import { HuntListItem, HuntDetail } from '@/types/api';

export function useHuntList() {
  const { data, error, mutate, isLoading } = useSWR<HuntListItem[]>(
    createCacheKey.walletHuntList(),
    fetcher,
    {
      fallbackData: [],
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      errorRetryCount: 0,
    }
  );

  return { hunts: data ?? [], error, mutate, isLoading };
}

export function useHuntDetail(huntId: string | null) {
  const { data, error, mutate, isLoading } = useSWR<HuntDetail>(
    huntId ? createCacheKey.walletHuntDetail(huntId) : null,
    fetcher,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 5000,
      errorRetryCount: 0,
    }
  );

  return { detail: data ?? null, error, mutate, isLoading };
}
