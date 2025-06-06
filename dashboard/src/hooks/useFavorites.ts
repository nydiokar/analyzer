import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { FavoriteWallet } from '@/types/api';

const API_BASE_URL = '/api/v1';

export function useFavorites() {
  const { apiKey, isInitialized } = useApiKeyStore();
  
  const swrKey = isInitialized && apiKey ? `${API_BASE_URL}/users/me/favorites` : null;

  const { data, error, mutate, isLoading } = useSWR<FavoriteWallet[]>(
    swrKey,
    (url: string) => fetcher(url, { cache: 'no-store' }),
    {
      revalidateOnFocus: false,
    }
  );

  return {
    favorites: data,
    isLoading,
    error,
    mutate,
  };
} 