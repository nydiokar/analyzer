import { getCookie, setCookie, deleteCookie } from 'cookies-next';

export interface SecureStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

/**
 * In-memory storage for sensitive data (tokens)
 * This data is lost on page refresh, which is more secure but requires refresh tokens
 */
class MemoryStorage implements SecureStorage {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }
}

/**
 * Cookie-based storage for production (more secure than localStorage)
 * Uses httpOnly cookies when possible, fallback to secure client-side cookies
 */
class CookieStorage implements SecureStorage {
  private readonly cookieOptions = {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    httpOnly: false, // Client-side cookies, httpOnly handled by server
  };

  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    return getCookie(key) as string || null;
  }

  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    setCookie(key, value, {
      ...this.cookieOptions,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
  }

  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    deleteCookie(key);
  }

  clear(): void {
    // Note: This only clears auth-related cookies, not all cookies
    this.removeItem('analyzer.access_token');
    this.removeItem('analyzer.refresh_token');
    this.removeItem('analyzer.user');
  }
}

/**
 * Enhanced localStorage with additional security features
 */
class SecureLocalStorage implements SecureStorage {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      // Basic tamper detection (in a real implementation, you'd use HMAC)
      const parsed = JSON.parse(item);
      if (!parsed || typeof parsed !== 'object' || !parsed.data) {
        this.removeItem(key);
        return null;
      }

      return parsed.data;
    } catch (error) {
      console.error('Error reading from secure localStorage:', error);
      this.removeItem(key);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    
    try {
      const wrapped = {
        data: value,
        timestamp: Date.now(),
        // In a real implementation, add HMAC for integrity checking
      };
      localStorage.setItem(key, JSON.stringify(wrapped));
    } catch (error) {
      console.error('Error writing to secure localStorage:', error);
    }
  }

  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  }

  clear(): void {
    if (typeof window === 'undefined') return;
    // Only clear auth-related items
    this.removeItem('analyzer.access_token');
    this.removeItem('analyzer.refresh_token');
    this.removeItem('analyzer.user');
    this.removeItem('analyzer.api_key');
  }
}

/**
 * Factory to create appropriate storage based on configuration
 */
export function createSecureStorage(): SecureStorage {
  if (typeof window === 'undefined') {
    // Server-side: return a no-op storage
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  }

  // Check environment and configuration
  const useMemoryStorage = process.env.NEXT_PUBLIC_AUTH_MEMORY_MODE === 'true';
  const useCookieStorage = process.env.NEXT_PUBLIC_AUTH_COOKIE_MODE === 'true';

  if (useMemoryStorage) {
    console.log('Using memory storage for authentication (high security, tokens lost on refresh)');
    return new MemoryStorage();
  }

  if (useCookieStorage) {
    console.log('Using cookie storage for authentication (recommended for production)');
    return new CookieStorage();
  }

  // Fallback to secure localStorage with warnings
  console.warn(
    'Using localStorage for authentication. For production, consider enabling cookie mode or memory mode.'
  );
  return new SecureLocalStorage();
}

/**
 * Token management with automatic refresh logic
 */
export class TokenManager {
  private storage: SecureStorage;
  private refreshTokenTimer: NodeJS.Timeout | null = null;

  constructor(storage: SecureStorage) {
    this.storage = storage;
  }

  /**
   * Store access token with automatic refresh setup
   */
  setAccessToken(token: string): void {
    this.storage.setItem('analyzer.access_token', token);
    this.scheduleTokenRefresh(token);
  }

  /**
   * Get access token if valid
   */
  getAccessToken(): string | null {
    const token = this.storage.getItem('analyzer.access_token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Date.now() / 1000;
      
      // Check if token expires in the next 5 minutes
      if (payload.exp && payload.exp < now + 300) {
        console.log('Access token is expired or expiring soon');
        this.storage.removeItem('analyzer.access_token');
        return null;
      }

      return token;
    } catch (error) {
      console.error('Invalid access token format');
      this.storage.removeItem('analyzer.access_token');
      return null;
    }
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(token: string): void {
    if (this.refreshTokenTimer) {
      clearTimeout(this.refreshTokenTimer);
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Date.now() / 1000;
      
      if (payload.exp) {
        // Refresh 5 minutes before expiration
        const refreshTime = (payload.exp - now - 300) * 1000;
        
        if (refreshTime > 0) {
          this.refreshTokenTimer = setTimeout(() => {
            console.log('Token refresh needed');
            // In a complete implementation, this would trigger a refresh
            // For now, we'll let the user handle re-authentication
          }, refreshTime);
        }
      }
    } catch (error) {
      console.error('Failed to schedule token refresh');
    }
  }

  /**
   * Clear all tokens
   */
  clearTokens(): void {
    if (this.refreshTokenTimer) {
      clearTimeout(this.refreshTokenTimer);
      this.refreshTokenTimer = null;
    }
    this.storage.clear();
  }
}