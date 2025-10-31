import { SWRConfiguration, MutatorCallback } from 'swr';
import { fetcher } from './fetcher';

// Cache durations in milliseconds - optimized for performance
export const CACHE_DURATIONS = {
  // Wallet summary data – extended cache to prevent frequent re-fetches
  WALLET_SUMMARY: 20 * 60 * 1000, // 20 minutes
  
  // Token performance data - longer cache to reduce requests
  TOKEN_PERFORMANCE: 10 * 60 * 1000, // 10 minutes
  
  // Behavioral analysis - much longer caching as it's very expensive
  BEHAVIORAL_ANALYSIS: 30 * 60 * 1000, // 30 minutes
  
  // PNL data - extended caching
  PNL_DATA: 15 * 60 * 1000, // 15 minutes
  
  // User favorites - moderate caching
  FAVORITES: 5 * 60 * 1000, // 5 minutes
  
  // Search results - moderate caching
  SEARCH: 2 * 60 * 1000, // 2 minutes
};

// Optimized SWR configuration for performance
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: false, // Disable to prevent unnecessary requests
  revalidateOnMount: true, // Allow initial data loading
  dedupingInterval: 5000, // 5 seconds - allow faster cache updates after enrichment
  keepPreviousData: false, // CHANGED: Don't show stale data - show loading state instead
  revalidateIfStale: true, // CHANGED: Allow revalidation when cache is stale
  shouldRetryOnError: (error) => {
    // Don't retry on 4xx errors (client errors)
    if (error?.status >= 400 && error?.status < 500) {
      return false;
    }
    return true;
  },
  errorRetryCount: 1, // Reduce retry attempts
  errorRetryInterval: 2000, // Slightly longer retry interval
  refreshInterval: 0, // Disable auto refresh by default
  // Add focusThrottleInterval to prevent rapid revalidations
  focusThrottleInterval: 60000, // 1 minute - allow more frequent updates
};

// Create cache keys with consistent patterns
export const createCacheKey = {
  walletSummary: (walletAddress: string) => `/wallets/${walletAddress}/summary`,
  tokenPerformance: (walletAddress: string, params?: Record<string, string>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/token-performance${searchParams ? '?' + searchParams : ''}`;
  },
  behaviorAnalysis: (walletAddress: string, params?: Record<string, string>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/behavior-analysis${searchParams ? '?' + searchParams : ''}`;
  },
  pnlOverview: (walletAddress: string, params?: Record<string, string>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/pnl-overview${searchParams ? '?' + searchParams : ''}`;
  },
  favorites: () => '/users/me/favorites',
  search: (query: string) => `/wallets/search?query=${encodeURIComponent(query)}`,
};

// Simplified cache invalidation patterns
export const invalidateWalletCache = (mutate: MutatorCallback, walletAddress: string) => {
  // Invalidate all wallet-related cache keys
  mutate((key: unknown) => {
    if (typeof key === 'string') {
      return key.startsWith(`/wallets/${walletAddress}`);
    }
    return false;
  });
};
