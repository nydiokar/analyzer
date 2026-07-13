import { useMemo } from 'react';
import useSWR from 'swr';
import { createCacheKey } from '@/lib/swr-config';
import { fetcher } from '@/lib/fetcher';
import type {
  WalletRepresentationBatchResponse,
  WalletRepresentationSummary,
} from '@/types/api';

interface RepresentationBatchOptions {
  enabled?: boolean;
}

// The backend caps a single call at 200 and runs sibling probes serially, so
// keep the client batch modest — a holder page is ≤100 rows in practice.
const REPRESENTATION_BATCH_LIMIT = 100;

function chunkAddresses(addresses: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += size) {
    chunks.push(addresses.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batched SPEC-001/002 representation signals for a holder page (SURFACE-1).
 *
 * One request per ≤100-address chunk to POST /wallets/representation/batch —
 * the N+1 guard for the holder-profiles inline chips. Returns a map keyed by
 * address; a missing key OR a summary with `hasVector: false` is the normal
 * "no representation yet" state, not an error.
 */
export function useWalletRepresentationBatch(
  walletAddresses: string[],
  options: RepresentationBatchOptions = {},
) {
  const { enabled = true } = options;
  const sortedAddresses = useMemo(
    () => [...new Set(walletAddresses.filter(Boolean))].sort(),
    [walletAddresses],
  );
  const swrKey =
    enabled && sortedAddresses.length > 0
      ? createCacheKey.walletRepresentationBatch(sortedAddresses)
      : null;

  const swr = useSWR<Record<string, WalletRepresentationSummary>>(
    swrKey,
    async () => {
      const batches = chunkAddresses(sortedAddresses, REPRESENTATION_BATCH_LIMIT);
      const merged: Record<string, WalletRepresentationSummary> = {};
      for (const batch of batches) {
        const response = (await fetcher('/wallets/representation/batch', {
          method: 'POST',
          body: JSON.stringify({ walletAddresses: batch }),
        })) as WalletRepresentationBatchResponse;
        Object.assign(merged, response.representations || {});
      }
      return merged;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      refreshInterval: 0,
      revalidateIfStale: false,
      keepPreviousData: true,
    },
  );

  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
