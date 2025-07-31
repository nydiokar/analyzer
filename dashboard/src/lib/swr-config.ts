import { SWRConfiguration } from 'swr';
import { fetcher } from './fetcher';

// Cache durations in milliseconds
export const CACHE_DURATIONS = {
  // Wallet summary data – keep previous data in memory for 5 minutes so UI never flashes blank while a revalidation is in-flight.
  // Wallet summary data – never auto-expire; we will invalidate it manually when analysis completes.
  WALLET_SUMMARY: 10 * 1000, // 10 seconds only
  
  // Token performance data - SHORT cache since it changes with enrichment
  TOKEN_PERFORMANCE: 10 * 1000, // 10 seconds only
  
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
  dedupingInterval: 15000, // Increase to 15 seconds to prevent rapid duplicates during tab switching
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
  // Remove automatic summary preloading - summary is already loaded in layout
  // and cached properly by SWR. No need to trigger additional fetches on tab changes.
  // Each tab component will handle its own data loading when rendered.
}; 