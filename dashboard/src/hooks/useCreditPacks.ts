import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { createCacheKey } from '@/lib/swr-config';
import { CreditPack } from '@/types/api';
import { useAuthStore } from '@/store/auth-store';

export function useCreditPacks() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const swrKey = isAuthenticated ? createCacheKey.creditPacks() : null;

  const { data, error, isLoading } = useSWR<CreditPack[]>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 60000, // packs don't change often
      errorRetryCount: 1,
    }
  );

  return {
    packs: data ?? [],
    error,
    isLoading,
  };
}
