import { CACHE_DURATIONS } from './swr-config';

type CacheKey = string;

interface CacheEntry {
  value: any;
  expiry: number;
}

// A simple TTL cache that properly implements the Map interface required by SWR.
export class AppCacheProvider extends Map<CacheKey, any> {
  private cache = new Map<CacheKey, CacheEntry>();

  private getTTL(key: CacheKey): number {
    if (key.startsWith('/wallets/') && key.endsWith('/summary')) {
      return CACHE_DURATIONS.WALLET_SUMMARY;
    }
    if (key.startsWith('/wallets/') && key.includes('/token-performance')) {
      return CACHE_DURATIONS.TOKEN_PERFORMANCE;
    }
    if (key.startsWith('/wallets/') && key.includes('/behavior-analysis')) {
      return CACHE_DURATIONS.BEHAVIORAL_ANALYSIS;
    }
    if (key.startsWith('/wallets/') && key.includes('/pnl-overview')) {
      return CACHE_DURATIONS.PNL_DATA;
    }
    if (key.startsWith('/users/me/favorites')) {
      return CACHE_DURATIONS.FAVORITES;
    }
    if (key.startsWith('/wallets/search')) {
      return CACHE_DURATIONS.SEARCH;
    }
    // Return longer TTL for unknown keys instead of null
    return 10 * 60 * 1000; // 10 minutes default
  }

  set(key: CacheKey, value: any): this {
    const ttl = this.getTTL(key);
    const expiry = Date.now() + ttl;
    this.cache.set(key, { value, expiry });
    
    // Also set in the parent Map for SWR compatibility
    super.set(key, value);
    return this;
  }

  get(key: CacheKey): any {
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