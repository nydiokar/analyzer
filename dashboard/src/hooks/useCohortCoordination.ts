import { useMemo } from 'react';
import useSWR from 'swr';
import { createCacheKey } from '@/lib/swr-config';
import { fetcher } from '@/lib/fetcher';
import type { CohortCoordinationResponse } from '@/types/api';

interface CohortCoordinationOptions {
  enabled?: boolean;
}

/**
 * SURFACE-1 engine swap: cohort coordination from the PERSISTED graph.
 *
 * Replaces the client-side `analyzeSimilarityGraph` recompute as the source of
 * truth for "who in this cohort is coordinated". One bounded call to
 * POST /wallets/representation/cohort → materialized DB-wide rings shared by ≥2
 * cohort members + coordination edges internal to the cohort. Empty is normal.
 */
export function useCohortCoordination(
  walletAddresses: string[],
  options: CohortCoordinationOptions = {},
) {
  const { enabled = true } = options;
  const sortedAddresses = useMemo(
    () => [...new Set(walletAddresses.filter(Boolean))].sort(),
    [walletAddresses],
  );
  const swrKey =
    enabled && sortedAddresses.length >= 2
      ? createCacheKey.cohortCoordination(sortedAddresses)
      : null;

  const swr = useSWR<CohortCoordinationResponse>(
    swrKey,
    async () =>
      (await fetcher('/wallets/representation/cohort', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: sortedAddresses }),
      })) as CohortCoordinationResponse,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      refreshInterval: 0,
      revalidateIfStale: false,
      keepPreviousData: true,
    },
  );

  return { data: swr.data, error: swr.error, isLoading: swr.isLoading, mutate: swr.mutate };
}
