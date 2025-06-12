import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { FavoriteWallet } from '@/types/api';

export function useFavorites() {
  const { apiKey, isInitialized } = useApiKeyStore();
  
  const swrKey = isInitialized && apiKey ? '/users/me/favorites' : null;

  const { data, error, mutate, isLoading } = useSWR<FavoriteWallet[]>(
    swrKey,
    fetcher,
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