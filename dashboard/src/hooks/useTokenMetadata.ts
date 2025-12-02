import { useState, useEffect, useCallback, useRef } from 'react';
import { fetcher } from '@/lib/fetcher';

interface TokenMetadata {
  name?: string;
  symbol?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
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
  private cache: Map<string, TokenMetadata | null> = new Map();
  private timeoutId: NodeJS.Timeout | null = null;
  private isFetching = false;
  // Track active subscriptions for auto-refresh
  private subscribers: Map<string, Set<(metadata: TokenMetadata | null) => void>> = new Map();

  // Add a token to the batch queue
  request(mint: string, callback: (metadata: TokenMetadata | null) => void) {
    // Subscribe for updates (for auto-refresh after enrichment)
    if (!this.subscribers.has(mint)) {
      this.subscribers.set(mint, new Set());
    }
    this.subscribers.get(mint)!.add(callback);

    // Check cache first
    if (this.cache.has(mint)) {
      callback(this.cache.get(mint)!);
      return;
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
      console.log(`[TokenMetadataBatcher] Fetching metadata for ${mints.length} tokens in ONE batch`);

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
          resultMap.set(tokenData.tokenAddress || tokenData.mint, metadata);
          this.cache.set(tokenData.tokenAddress || tokenData.mint, metadata);
        });
      }

      // Notify all callbacks with immediate data
      mints.forEach(mint => {
        const callbacks = this.callbacks.get(mint) || [];
        const metadata = resultMap.get(mint) || null;

        // Cache even if null (token doesn't exist)
        if (!this.cache.has(mint)) {
          this.cache.set(mint, metadata);
        }

        callbacks.forEach(cb => cb(metadata));
        this.callbacks.delete(mint);
      });

      // PHASE 2: Auto-refresh after 2 seconds to get enriched data
      // Backend triggers enrichment (fire-and-forget), enrichment typically completes in ~200-500ms
      // DexScreener stage takes longer, so we wait 2s then re-fetch
      setTimeout(() => {
        this.refreshEnrichedData(mints);
      }, 2000);

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
  private async refreshEnrichedData(mints: string[]) {
    try {
      console.log(`[TokenMetadataBatcher] Refreshing enriched metadata for ${mints.length} tokens`);

      const response = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: mints }),
      });

      // Update cache with enriched data AND notify all subscribers
      if (response && Array.isArray(response)) {
        response.forEach((tokenData: any) => {
          const metadata: TokenMetadata = {
            name: tokenData.name,
            symbol: tokenData.symbol,
            imageUrl: tokenData.imageUrl,
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
          this.cache.set(mintKey, metadata);

          // Notify ALL active subscribers (triggers React re-render)
          const subscribers = this.subscribers.get(mintKey);
          if (subscribers) {
            subscribers.forEach(callback => callback(metadata));
          }
        });
      }
    } catch (error) {
      console.error('[TokenMetadataBatcher] Failed to refresh enriched data:', error);
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
export function useTokenMetadata(mint: string, providedMetadata?: TokenMetadata) {
  const [metadata, setMetadata] = useState<TokenMetadata | null>(providedMetadata || null);
  const [isLoading, setIsLoading] = useState(!providedMetadata);

  useEffect(() => {
    // If metadata was provided, don't fetch
    if (providedMetadata) {
      setMetadata(providedMetadata);
      setIsLoading(false);
      return;
    }

    // Callback for updates
    const updateCallback = (fetchedMetadata: TokenMetadata | null) => {
      setMetadata(fetchedMetadata);
      setIsLoading(false);
    };

    // Request metadata (will be batched automatically)
    setIsLoading(true);
    globalBatcher.request(mint, updateCallback);

    // Cleanup: unsubscribe on unmount
    return () => {
      globalBatcher.unsubscribe(mint, updateCallback);
    };
  }, [mint, providedMetadata]);

  return { metadata, isLoading };
}

// Export for manual cache clearing if needed
export const clearTokenMetadataCache = () => globalBatcher.clearCache();
