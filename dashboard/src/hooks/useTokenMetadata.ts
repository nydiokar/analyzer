import { useState, useEffect } from 'react';
import { fetcher } from '@/lib/fetcher';
import { CACHE_DURATIONS } from '@/lib/swr-config';
interface TokenMetadata {
  name?: string;
  symbol?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  marketCapUsd?: number | null;
  priceUsd?: string | number | null;
  onchainName?: string;
  onchainSymbol?: string;
  onchainImageUrl?: string;
  onchainWebsiteUrl?: string;
  onchainTwitterUrl?: string;
  onchainTelegramUrl?: string;
}

// Global queue for batching token metadata requests
class TokenMetadataBatcher {
  private queue: Set<string> = new Set();
  private callbacks: Map<string, Array<(metadata: TokenMetadata | null) => void>> = new Map();
  private cache: Map<string, { data: TokenMetadata | null; fetchedAt: number }> = new Map();
  private timeoutId: NodeJS.Timeout | null = null;
  private isFetching = false;
  // Track active subscriptions for auto-refresh
  private subscribers: Map<string, Set<(metadata: TokenMetadata | null) => void>> = new Map();
  private readonly CACHE_TTL_MS = CACHE_DURATIONS.TOKEN_METADATA;
  // Track pending refresh timers for each batch
  private refreshTimers: Map<string, NodeJS.Timeout[]> = new Map();

  // Add a token to the batch queue
  request(mint: string, callback: (metadata: TokenMetadata | null) => void) {
    // Subscribe for updates (for auto-refresh after enrichment)
    if (!this.subscribers.has(mint)) {
      this.subscribers.set(mint, new Set());
    }
    this.subscribers.get(mint)!.add(callback);

    // Check cache first
    const cached = this.cache.get(mint);
    if (cached) {
      callback(cached.data);
      const cacheAge = Date.now() - cached.fetchedAt;
      if (cacheAge < this.CACHE_TTL_MS) {
        return;
      }
    }

    // Add to queue
    this.queue.add(mint);

    // Register callback
    if (!this.callbacks.has(mint)) {
      this.callbacks.set(mint, []);
    }
    this.callbacks.get(mint)!.push(callback);

    // Schedule batch fetch (debounced)
    this.scheduleBatch();
  }

  // Subscribe for enrichment updates WITHOUT triggering initial fetch
  // Used when component already has metadata from parent
  subscribeOnly(mint: string, callback: (metadata: TokenMetadata | null) => void) {
    if (!this.subscribers.has(mint)) {
      this.subscribers.set(mint, new Set());
    }
    this.subscribers.get(mint)!.add(callback);
  }

  // Unsubscribe from updates
  unsubscribe(mint: string, callback: (metadata: TokenMetadata | null) => void) {
    const subs = this.subscribers.get(mint);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        this.subscribers.delete(mint);
      }
    }
  }

  private scheduleBatch() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Wait 50ms to collect all requests, then batch fetch
    this.timeoutId = setTimeout(() => {
      this.executeBatch();
    }, 50);
  }

  private async executeBatch() {
    if (this.isFetching || this.queue.size === 0) return;

    this.isFetching = true;
    const mints = Array.from(this.queue);
    this.queue.clear();

    try {
      // PHASE 1: Fetch immediate cached data from database
      const response = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: mints }),
      });

      // Cache and notify with immediate data (might have "Unknown Token" or partial data)
      const resultMap = new Map<string, TokenMetadata>();
      if (response && Array.isArray(response)) {
        response.forEach((tokenData: any) => {
      const metadata: TokenMetadata = {
        name: tokenData.name,
        symbol: tokenData.symbol,
        imageUrl: tokenData.imageUrl,
        marketCapUsd: tokenData.marketCapUsd,
        priceUsd: tokenData.priceUsd,
        onchainName: tokenData.onchainName,
        onchainSymbol: tokenData.onchainSymbol,
        onchainImageUrl: tokenData.onchainImageUrl,
        websiteUrl: tokenData.websiteUrl,
        twitterUrl: tokenData.twitterUrl,
            telegramUrl: tokenData.telegramUrl,
            onchainWebsiteUrl: tokenData.onchainWebsiteUrl,
            onchainTwitterUrl: tokenData.onchainTwitterUrl,
            onchainTelegramUrl: tokenData.onchainTelegramUrl,
          };
          const mintKey = tokenData.tokenAddress || tokenData.mint;
          resultMap.set(mintKey, metadata);
          this.cache.set(mintKey, { data: metadata, fetchedAt: Date.now() });
        });
      }

      // Notify all callbacks with immediate data
      mints.forEach(mint => {
        const callbacks = this.callbacks.get(mint) || [];
        const metadata = resultMap.get(mint) || null;

        // Cache even if null (token doesn't exist)
        if (!this.cache.has(mint)) {
          this.cache.set(mint, { data: metadata, fetchedAt: Date.now() });
        }

        callbacks.forEach(cb => cb(metadata));
        this.callbacks.delete(mint);
      });

      // PHASE 2: Auto-refresh after enrichment completes
      // Backend triggers enrichment (fire-and-forget), enrichment typically completes in ~200-500ms
      // DexScreener stage can take longer (especially for new tokens), so we:
      // - First retry after 2s (catches most enrichments)
      // - Second retry after 5s (catches slower DexScreener responses)

      // Create batch key for tracking timers
      const batchKey = mints.sort().join(',');
      const timers: NodeJS.Timeout[] = [];

      const timer1 = setTimeout(() => {
        this.refreshEnrichedData(mints, batchKey, true);
      }, 2000);
      timers.push(timer1);

      const timer2 = setTimeout(() => {
        this.refreshEnrichedData(mints, batchKey, true);
      }, 5000);
      timers.push(timer2);

      // Store timers for potential cancellation
      this.refreshTimers.set(batchKey, timers);

    } catch (error) {
      console.error('[TokenMetadataBatcher] Failed to fetch batch:', error);

      // Notify callbacks with null
      mints.forEach(mint => {
        const callbacks = this.callbacks.get(mint) || [];
        callbacks.forEach(cb => cb(null));
        this.callbacks.delete(mint);
      });
    } finally {
      this.isFetching = false;
    }
  }

  // Refresh data after enrichment completes
  private async refreshEnrichedData(mints: string[], batchKey?: string, force = false) {
    try {
      // Avoid unnecessary calls unless explicitly forced (e.g., post-enrichment refresh)
      const now = Date.now();
      const staleMints = force ? mints : mints.filter(mint => {
        const cached = this.cache.get(mint);
        if (!cached) return true; // Not cached = fetch it
        const age = now - cached.fetchedAt;
        return age >= this.CACHE_TTL_MS; // Stale = fetch it
      });

      // Skip API call if nothing is stale
      if (staleMints.length === 0) {
        // Cancel remaining timers for this batch since everything is fresh
        if (batchKey) {
          this.cancelRefreshTimers(batchKey);
        }
        return;
      }

      const response = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: staleMints }),
      });

      // Update cache with enriched data AND notify all subscribers
      if (response && Array.isArray(response)) {
        let allFresh = true; // Track if all tokens are now fresh

        response.forEach((tokenData: any) => {
      const metadata: TokenMetadata = {
        name: tokenData.name,
        symbol: tokenData.symbol,
        imageUrl: tokenData.imageUrl,
        marketCapUsd: tokenData.marketCapUsd,
        priceUsd: tokenData.priceUsd,
        onchainName: tokenData.onchainName,
        onchainSymbol: tokenData.onchainSymbol,
        onchainImageUrl: tokenData.onchainImageUrl,
        websiteUrl: tokenData.websiteUrl,
        twitterUrl: tokenData.twitterUrl,
            telegramUrl: tokenData.telegramUrl,
            onchainWebsiteUrl: tokenData.onchainWebsiteUrl,
            onchainTwitterUrl: tokenData.onchainTwitterUrl,
            onchainTelegramUrl: tokenData.onchainTelegramUrl,
          };
          const mintKey = tokenData.tokenAddress || tokenData.mint;

          // Update cache
          this.cache.set(mintKey, { data: metadata, fetchedAt: Date.now() });

          // Notify ALL active subscribers (triggers React re-render)
          const subscribers = this.subscribers.get(mintKey);
          if (subscribers) {
            subscribers.forEach(callback => callback(metadata));
          }
        });

        // Check if ALL original mints are now fresh (not just the ones we fetched)
        allFresh = mints.every(mint => {
          const cached = this.cache.get(mint);
          if (!cached) return false;
          const age = Date.now() - cached.fetchedAt;
          return age < this.CACHE_TTL_MS;
        });

        // If all tokens are fresh, cancel remaining refresh timers
        if (allFresh && batchKey) {
          this.cancelRefreshTimers(batchKey);
        }
      }
    } catch (error) {
      console.error('[TokenMetadataBatcher] Failed to refresh enriched data:', error);
    }
  }

  // Cancel all pending refresh timers for a batch
  private cancelRefreshTimers(batchKey: string) {
    const timers = this.refreshTimers.get(batchKey);
    if (timers) {
      timers.forEach(timer => clearTimeout(timer));
      this.refreshTimers.delete(batchKey);
    }
  }

  // Clear cache (for testing or forced refresh)
  clearCache() {
    this.cache.clear();
  }
}

// Global singleton batcher
const globalBatcher = new TokenMetadataBatcher();

/**
 * Hook to fetch token metadata with automatic batching and auto-refresh
 * Multiple components requesting metadata simultaneously will be batched into ONE API call
 * Auto-refreshes after 2 seconds to show enriched data
 */
export function useTokenMetadata(mint?: string, providedMetadata?: TokenMetadata) {
  const [metadata, setMetadata] = useState<TokenMetadata | null>(providedMetadata || null);
  const [isLoading, setIsLoading] = useState(!providedMetadata);

  useEffect(() => {
    if (!mint) {
      setMetadata(providedMetadata || null);
      setIsLoading(false);
      return;
    }

    setMetadata(providedMetadata || null);

    // Callback for updates
    const updateCallback = (fetchedMetadata: TokenMetadata | null) => {
      setMetadata(fetchedMetadata);
      setIsLoading(false);
    };

    // Skip batch request if provided metadata is "complete enough"
    // Complete = has name/symbol (essential fields)
    const isMetadataComplete = providedMetadata && (providedMetadata.name || providedMetadata.onchainName);
    setIsLoading(!isMetadataComplete && !providedMetadata);

    // CRITICAL FIX: Only request if metadata is incomplete
    // If metadata is complete, just subscribe for future enrichment updates (no fetch)
    if (!isMetadataComplete) {
      globalBatcher.request(mint, updateCallback);
    } else {
      globalBatcher.subscribeOnly(mint, updateCallback);
    }

    // Cleanup: unsubscribe on unmount
    return () => {
      if (mint) {
        globalBatcher.unsubscribe(mint, updateCallback);
      }
    };
  }, [mint, providedMetadata]);

  return { metadata, isLoading };
}

// Export for manual cache clearing if needed
export const clearTokenMetadataCache = () => globalBatcher.clearCache();
