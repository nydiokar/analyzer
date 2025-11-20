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

  // Add a token to the batch queue
  request(mint: string, callback: (metadata: TokenMetadata | null) => void) {
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

      const response = await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: mints }),
      });

      // Cache results
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

      // Notify all callbacks
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

  // Clear cache (for testing or forced refresh)
  clearCache() {
    this.cache.clear();
  }
}

// Global singleton batcher
const globalBatcher = new TokenMetadataBatcher();

/**
 * Hook to fetch token metadata with automatic batching
 * Multiple components requesting metadata simultaneously will be batched into ONE API call
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

    // Request metadata (will be batched automatically)
    setIsLoading(true);
    globalBatcher.request(mint, (fetchedMetadata) => {
      setMetadata(fetchedMetadata);
      setIsLoading(false);
    });
  }, [mint, providedMetadata]);

  return { metadata, isLoading };
}

// Export for manual cache clearing if needed
export const clearTokenMetadataCache = () => globalBatcher.clearCache();
