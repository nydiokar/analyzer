import { useMemo } from 'react';
import useSWR from 'swr';
import { createCacheKey } from '@/lib/swr-config';
import { fetcher } from '@/lib/fetcher';
import type { BatchWalletHudResponse, WalletHudDto } from '@/types/api';

interface BatchHudOptions {
  enabled?: boolean;
}

const HUD_BATCH_LIMIT = 180;

function chunkAddresses(addresses: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += size) {
    chunks.push(addresses.slice(i, i + size));
  }
  return chunks;
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
      const batches = chunkAddresses(sortedAddresses, HUD_BATCH_LIMIT);
      const mergedHuds: Record<string, WalletHudDto> = {};
      const mergedNotFound = new Set<string>();
      let calculatedAt = new Date().toISOString();

      for (const walletBatch of batches) {
        const response = await fetcher('/wallets/hud/batch', {
          method: 'POST',
          body: JSON.stringify({ walletAddresses: walletBatch }),
        }) as BatchWalletHudResponse;

        Object.assign(mergedHuds, response.huds || {});
        (response.notFound || []).forEach((address) => mergedNotFound.add(address));
        if (response.calculatedAt) {
          calculatedAt = response.calculatedAt;
        }
      }

      return {
        huds: mergedHuds,
        notFound: Array.from(mergedNotFound),
        calculatedAt,
      };
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000, // 5 seconds - merge concurrent requests for same wallets
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
