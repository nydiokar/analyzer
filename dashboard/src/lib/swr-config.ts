import { SWRConfiguration } from 'swr';
import { fetcher } from './fetcher';

// Cache durations in milliseconds
export const CACHE_DURATIONS = {
  // Wallet summary data - moderate caching since it changes with new analysis
  WALLET_SUMMARY: 2 * 60 * 1000, // 2 minutes
  
  // Token performance data - longer caching as it's expensive to compute
  TOKEN_PERFORMANCE: 2 * 60 * 1000, // 2 minutes
  
  // Behavioral analysis - longer caching as it's very expensive
  BEHAVIORAL_ANALYSIS: 2 * 60 * 1000, // 2 minutes
  
  // PNL data - moderate caching
  PNL_DATA: 2 * 60 * 1000, // 2 minutes
  
  // User favorites - short caching as user can modify frequently
  FAVORITES: 2 * 60 * 1000, // 2 minutes
  
  // Search results - very short caching
  SEARCH: 30 * 1000, // 30 seconds
};

// Simplified SWR configuration
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: false, // Disable to prevent unnecessary requests
  revalidateOnMount: true, // Allow initial data loading
  dedupingInterval: 10000, // Reduce to 10 seconds to prevent rapid duplicates
  shouldRetryOnError: (error) => {
    // Don't retry on 4xx errors (client errors)
    if (error?.status >= 400 && error?.status < 500) {
      return false;
    }
    return true;
  },
  errorRetryCount: 1, // Reduce retry attempts
  errorRetryInterval: 1000, // Faster retry interval
  refreshInterval: 0, // Disable auto refresh by default
  // Add focusThrottleInterval to prevent rapid revalidations
  focusThrottleInterval: 5000,
};

// Create cache keys with consistent patterns
export const createCacheKey = {
  walletSummary: (walletAddress: string) => `/wallets/${walletAddress}/summary`,
  tokenPerformance: (walletAddress: string, params?: Record<string, any>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/token-performance${searchParams ? '?' + searchParams : ''}`;
  },
  behaviorAnalysis: (walletAddress: string, params?: Record<string, any>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/behavior-analysis${searchParams ? '?' + searchParams : ''}`;
  },
  pnlOverview: (walletAddress: string, params?: Record<string, any>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/pnl-overview${searchParams ? '?' + searchParams : ''}`;
  },
  favorites: () => '/users/me/favorites',
  search: (query: string) => `/wallets/search?query=${encodeURIComponent(query)}`,
};

// Simplified cache invalidation patterns
export const invalidateWalletCache = (mutate: any, walletAddress: string) => {
  // Invalidate all wallet-related cache keys
  mutate((key: any) => {
    if (typeof key === 'string') {
      return key.startsWith(`/wallets/${walletAddress}`);
    }
    return false;
  });
};

// Simplified preload function  
export const preloadWalletData = (mutate: any, walletAddress: string, currentTab: string) => {
  // Only preload wallet summary to avoid overwhelming the server
  if (currentTab !== 'overview') {
    mutate(createCacheKey.walletSummary(walletAddress));
  }
}; 