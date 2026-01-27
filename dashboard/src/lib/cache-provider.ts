import { CACHE_DURATIONS } from './swr-config';

type CacheKey = string;

interface CacheEntry<T = unknown> {
  value: T;
  expiry: number;
}

// A simple TTL cache that properly implements the Map interface required by SWR.
export class AppCacheProvider extends Map<CacheKey, unknown> {
  private cache = new Map<CacheKey, CacheEntry>();

  private normalizeKey(key: CacheKey): CacheKey {
    // Strip query string and hash to ensure TTL rules match stable paths.
    const queryIndex = key.indexOf('?');
    const hashIndex = key.indexOf('#');
    const cutIndex = queryIndex === -1 ? hashIndex : (hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex));
    return cutIndex === -1 ? key : key.slice(0, cutIndex);
  }

  private getTTL(key: CacheKey): number {
    const baseKey = this.normalizeKey(key);
    if (baseKey.startsWith('/wallets/') && baseKey.endsWith('/summary')) {
      return CACHE_DURATIONS.WALLET_SUMMARY;
    }
    if (baseKey.startsWith('/wallets/') && baseKey.includes('/token-performance')) {
      return CACHE_DURATIONS.TOKEN_PERFORMANCE;
    }
    if (baseKey.startsWith('/wallets/') && baseKey.includes('/behavior-analysis')) {
      return CACHE_DURATIONS.BEHAVIORAL_ANALYSIS;
    }
    if (baseKey.startsWith('/wallets/') && baseKey.includes('/pnl-overview')) {
      return CACHE_DURATIONS.PNL_DATA;
    }
    if (baseKey.startsWith('/users/me/favorites')) {
      return CACHE_DURATIONS.FAVORITES;
    }
    if (baseKey.startsWith('/wallets/search')) {
      return CACHE_DURATIONS.SEARCH;
    }
    if (baseKey.startsWith('/token-info/') && baseKey.includes('/top-holders')) {
      return CACHE_DURATIONS.TOKEN_HOLDERS;
    }
    if (baseKey.startsWith('/token-info')) {
      return CACHE_DURATIONS.TOKEN_METADATA;
    }
    // Return longer TTL for unknown keys instead of null
    return 10 * 60 * 1000; // 10 minutes default
  }

  set(key: CacheKey, value: unknown): this {
    const ttl = this.getTTL(key);
    const expiry = Date.now() + ttl;
    this.cache.set(key, { value, expiry });
    
    // Also set in the parent Map for SWR compatibility
    super.set(key, value);
    return this;
  }

  get(key: CacheKey): unknown {
    const entry = this.cache.get(key);
    if (!entry) {
      return super.get(key); // Fallback to parent Map
    }

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      super.delete(key);
      return undefined;
    }

    return entry.value;
  }

  has(key: CacheKey): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return super.has(key);
    }

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      super.delete(key);
      return false;
    }

    return true;
  }

  delete(key: CacheKey): boolean {
    this.cache.delete(key);
    return super.delete(key);
  }

  clear(): void {
    this.cache.clear();
    super.clear();
  }

  get size(): number {
    // Clean expired entries first
    this.cleanExpired();
    return this.cache.size;
  }

  keys(): MapIterator<CacheKey> {
    // Clean expired entries first
    this.cleanExpired();
    return super.keys();
  }

  private cleanExpired(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (Date.now() > entry.expiry) {
        this.cache.delete(key);
        super.delete(key);
      }
    }
  }
} 
