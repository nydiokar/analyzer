import { fetcher } from '@/lib/fetcher';
import useSWR from 'swr';
import { FavoriteWallet } from '@/types/api';
import { createCacheKey } from '@/lib/swr-config';

interface UseFavoritesOptions {
  enabled?: boolean;
}

export function useFavorites(options: UseFavoritesOptions = {}) {
  const { enabled = true } = options;
  const swrKey = enabled ? createCacheKey.favorites() : null;

  const { data: favorites, error, mutate } = useSWR<FavoriteWallet[]>(
    swrKey,
    fetcher,
    {
      // Remove loading state completely - just return empty array if no data
      fallbackData: [],
      revalidateOnFocus: true, // Auto-refresh when window gains focus
      revalidateOnMount: true,
      revalidateOnReconnect: true, // Auto-refresh when reconnecting
      revalidateIfStale: true, // Only revalidate if data is stale
      refreshInterval: 0, // No polling (rely on mutations)
      dedupingInterval: 10000, // Prevent duplicate requests within 10s
      focusThrottleInterval: 10000, // Throttle focus revalidation to max once per 10s
      errorRetryCount: 0, // Don't retry on error
    }
  );

  return {
    favorites: favorites || [],
    error,
    isLoading: false, // Never show loading
    mutate,
  };
}
