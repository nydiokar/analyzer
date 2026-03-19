import { SWRConfiguration, MutatorCallback } from 'swr';
import { fetcher } from './fetcher';

// Cache durations in milliseconds - optimized for performance
export const CACHE_DURATIONS = {
  // Wallet summary data – extended cache to prevent frequent re-fetches
  WALLET_SUMMARY: 20 * 60 * 1000, // 20 minutes
  
  // Token performance data - shorter cache to keep prices fresher
  TOKEN_PERFORMANCE: 5 * 60 * 1000, // 5 minutes
  
  // Behavioral analysis - much longer caching as it's very expensive
  BEHAVIORAL_ANALYSIS: 30 * 60 * 1000, // 30 minutes
  
  // PNL data - extended caching
  PNL_DATA: 15 * 60 * 1000, // 15 minutes
  
  // User favorites - moderate caching
  FAVORITES: 5 * 60 * 1000, // 5 minutes
  
  // Search results - moderate caching
  SEARCH: 2 * 60 * 1000, // 2 minutes

  // Token metadata - align with backend price cache (30s)
  TOKEN_METADATA: 30 * 1000, // 30 seconds

  // Top holders - stable view with occasional manual refresh
  TOKEN_HOLDERS: 5 * 60 * 1000, // 5 minutes

  // Wallet HUD - short cache for high-signal metrics
  WALLET_HUD: 60 * 1000, // 60 seconds
};

// Optimized SWR configuration for performance
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: false, // Disable to prevent unnecessary requests
  revalidateOnMount: true, // Allow initial data loading
  dedupingInterval: 5000, // 5 seconds - allow faster cache updates after enrichment
  keepPreviousData: true, // Keep last known data during revalidation to prevent UI flicker
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
  walletSummary: (walletAddress: string, params?: Record<string, string>) => {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return `/wallets/${walletAddress}/summary${searchParams ? '?' + searchParams : ''}`;
  },
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
  userWatchedTokens: () => '/users/me/watched-tokens',
  search: (query: string) => `/wallets/search?query=${encodeURIComponent(query)}`,
  walletHud: (walletAddress: string) => `/wallets/${walletAddress}/hud`,
  walletHudBatch: (walletAddresses: string[]) => `/wallets/hud/batch:${walletAddresses.join(',')}`,
  walletHuntList: () => '/wallet-hunts',
  walletHuntDetail: (id: string) => `/wallet-hunts/${id}`,
  credits: () => '/users/me/credits',
  creditPacks: () => '/payments/packs',
  paymentStatus: (intentId: string) => `/payments/${intentId}/status`,
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
