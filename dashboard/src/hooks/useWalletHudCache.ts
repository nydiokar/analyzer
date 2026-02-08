import { useEffect, useState } from 'react';
import { useBatchWalletHud } from './useBatchWalletHud';

interface WalletHudCacheOptions {
  /**
   * Enable fetching (default: true)
   */
  enabled?: boolean;

  /**
   * Fetch immediately on mount instead of waiting for user interaction (default: true)
   */
  proactiveFetch?: boolean;
}

/**
 * Enhanced caching hook for wallet HUD data
 *
 * Features:
 * - Proactive fetching on mount (no toggle needed)
 * - Optimized for poker-style always-visible HUD badges
 *
 * @param walletAddresses - Array of wallet addresses to fetch HUD data for
 * @param options - Caching options
 */
export function useWalletHudCache(
  walletAddresses: string[],
  options: WalletHudCacheOptions = {}
) {
  const {
    enabled = true,
    proactiveFetch = true,
  } = options;

  const [fetchGateOpen, setFetchGateOpen] = useState(!proactiveFetch);

  useEffect(() => {
    if (!enabled) {
      setFetchGateOpen(false);
      return;
    }

    if (!proactiveFetch) {
      setFetchGateOpen(true);
      return;
    }

    // Let the main page content paint first, then start HUD hydration.
    const timer = window.setTimeout(() => {
      setFetchGateOpen(true);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [enabled, proactiveFetch, walletAddresses.length]);

  const shouldFetch = enabled && fetchGateOpen;

  const { data, error, isLoading, mutate } = useBatchWalletHud(walletAddresses, {
    enabled: shouldFetch,
  });

  return {
    data,
    error,
    isLoading,
    mutate,
  };
}
