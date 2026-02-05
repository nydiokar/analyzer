import { useMemo } from 'react';
import useSWR from 'swr';
import { createCacheKey } from '@/lib/swr-config';
import { fetcher } from '@/lib/fetcher';
import type { BatchWalletHudResponse, WalletHudDto } from '@/types/api';

interface BatchHudOptions {
  enabled?: boolean;
}

export function useBatchWalletHud(walletAddresses: string[], options: BatchHudOptions = {}) {
  const { enabled = true } = options;
  const sortedAddresses = useMemo(
    () => [...new Set(walletAddresses.filter(Boolean))].sort(),
    [walletAddresses]
  );
  const swrKey =
    enabled && sortedAddresses.length > 0
      ? createCacheKey.walletHudBatch(sortedAddresses)
      : null;

  const swr = useSWR<BatchWalletHudResponse>(
    swrKey,
    async () => {
      const response = await fetcher('/wallets/hud/batch', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: sortedAddresses }),
      });
      return response as BatchWalletHudResponse;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 0,
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
