import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import useSWR from 'swr';
import { FavoriteWallet } from '@/types/api';
import { createCacheKey } from '@/lib/swr-config';

export function useFavorites() {
  const { apiKey, isInitialized } = useApiKeyStore();

  const swrKey = isInitialized && apiKey ? createCacheKey.favorites() : null;

  const { data: favorites, error, mutate } = useSWR<FavoriteWallet[]>(
    swrKey,
    fetcher,
    {
      // Remove loading state completely - just return empty array if no data
      fallbackData: [],
      revalidateOnFocus: false,
      revalidateOnMount: true,
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