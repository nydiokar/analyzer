import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { WalletHudDto, BatchWalletHudResponse } from '@/types/api';
import { createCacheKey } from '@/lib/swr-config';

/**
 * Hook for fetching Wallet HUD (Heads-Up Display) data for a single wallet.
 *
 * Returns high-signal metrics optimized for at-a-glance evaluation:
 * - 6 core metrics (trimmed PNL, median PNL, behavior, trades/day, win rate, data quality)
 * - 2 conditional badges (bot, whale)
 *
 * **Important**: HUD data is cached for 60s on the backend and only changes when the wallet
 * is re-analyzed. No need for frontend auto-refresh - data is static until next analysis.
 *
 * @param walletAddress - The Solana wallet address to fetch HUD data for
 * @returns SWR response with HUD data, error, loading state, and mutate function
 *
 * @example
 * ```tsx
 * const { data, error, isLoading } = useWalletHud('9xQeWvG816bUx9...');
 * if (data) {
 *   console.log(data.behaviorCode); // "M" for Momentum Trader
 *   console.log(data.winRate); // 0.68 (68%)
 * }
 * ```
 */
export function useWalletHud(walletAddress: string | null) {
  const swrKey = walletAddress ? createCacheKey.walletHud(walletAddress) : null;

  return useSWR<WalletHudDto>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 0, // Don't block refetches - data changes on wallet re-analysis
      refreshInterval: 0, // NO auto-refresh - mutate() is called after analysis completes
      revalidateIfStale: true,
      keepPreviousData: true, // Prevent UI flicker during revalidation
    }
  );
}

/**
 * Hook for fetching Wallet HUD data for multiple wallets in a single batch request.
 *
 * Critical for multi-wallet views:
 * - Trackers page (all favorite wallets)
 * - Discovery results (filtered wallet lists)
 * - Holder analysis (top holders)
 * - Search results (multiple wallet matches)
 *
 * Performs a single optimized database query for all wallets.
 * Returns a map indexed by wallet address for O(1) lookup.
 *
 * @param walletAddresses - Array of Solana wallet addresses to fetch HUD data for
 * @returns SWR response with batch HUD data (map + notFound array), error, and mutate function
 *
 * @example
 * ```tsx
 * const addresses = ['wallet1', 'wallet2', 'wallet3'];
 * const { data, error, isLoading } = useWalletHudBatch(addresses);
 * if (data) {
 *   const wallet1Hud = data.huds['wallet1'];
 *   console.log(wallet1Hud?.behaviorCode); // "M"
 *   console.log(data.notFound); // ['wallet3'] if wallet3 not found
 * }
 * ```
 */
export function useWalletHudBatch(walletAddresses: string[]) {
  // Create a stable cache key that includes all addresses
  // Use a sorted key to ensure consistent caching regardless of array order
  const sortedAddresses = [...walletAddresses].sort();
  const swrKey = walletAddresses.length > 0
    ? createCacheKey.walletHudBatch(sortedAddresses)
    : null;

  return useSWR<BatchWalletHudResponse>(
    swrKey,
    async () => {
      // Custom fetcher for POST request
      // IMPORTANT: Use original order for request, not sorted for cache consistency
      const response = await fetcher('/wallets/hud/batch', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: sortedAddresses }),
      });
      return response as BatchWalletHudResponse;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 0, // Don't block refetches - mutate() is called after analysis completes
      refreshInterval: 0, // No auto-refresh for batch
      revalidateIfStale: true,
      keepPreviousData: true, // Prevent UI flicker during revalidation
    }
  );
}
