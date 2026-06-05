import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { createCacheKey } from '@/lib/swr-config';
import { CreditsBalance } from '@/types/api';
import { useAuthStore } from '@/store/auth-store';

export function useCredits() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const swrKey = isAuthenticated ? createCacheKey.credits() : null;

  const { data, error, mutate, isLoading } = useSWR<CreditsBalance>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnMount: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      refreshInterval: 0,
      errorRetryCount: 0,
    }
  );

  return {
    balance: data?.balance ?? null,
    transactions: data?.transactions ?? [],
    usage: data?.usage ?? null,
    error,
    isLoading,
    mutate,
  };
}
