import useSWR from 'swr';
import { CACHE_DURATIONS, createCacheKey } from '@/lib/swr-config';
import type { BatchWalletHudResponse, WalletHudDto } from '@/types/api';

interface BatchHudOptions {
  enabled?: boolean;
}

export function useBatchWalletHud(walletAddresses: string[], options: BatchHudOptions = {}) {
  const { enabled = true } = options;
  const normalizedAddresses = Array.from(new Set(walletAddresses.filter(Boolean)));
  const sortedAddresses = [...normalizedAddresses].sort();
  const swrKey =
    enabled && sortedAddresses.length > 0
      ? createCacheKey.walletHudBatch(sortedAddresses)
      : null;

  const swr = useSWR<BatchWalletHudResponse>(
    swrKey,
    async () => {
      const response = await fetch('/api/wallets/hud/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddresses: sortedAddresses }),
      });

      if (!response.ok) {
        const error: any = new Error('Failed to fetch batch HUD data');
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: CACHE_DURATIONS.WALLET_HUD,
      refreshInterval: 0,
      revalidateIfStale: true,
      keepPreviousData: true,
    }
  );

  return {
    ...swr,
    data: swr.data?.huds as Record<string, WalletHudDto> | undefined,
    notFound: swr.data?.notFound ?? [],
  };
}
