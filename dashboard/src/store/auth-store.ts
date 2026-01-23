import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSecureStorage, TokenManager } from '../lib/secure-storage';
import { getErrorMessage, getErrorDetails } from '../../../src/core/utils/error-utils';
export interface User {
  id: string;
  email: string | null;
  isDemo: boolean;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  displayName?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email: string;
    isDemo: boolean;
    emailVerified: boolean;
    isAdmin: boolean;
  };
}

interface AuthStore {
  // JWT Authentication
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  
  // API Key Authentication (legacy)
  apiKey: string | null;
  isUsingApiKey: boolean;
  
  // Initialization
  isInitialized: boolean;
  
  // Actions
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  setApiKey: (key: string | null) => Promise<void>;
  setDemoMode: () => Promise<void>;
  clearAuth: () => void;
  updateUser: (user: User) => void;
  
  // Security features
  refreshToken: () => Promise<boolean>;
  isTokenValid: () => boolean;
  
  // Computed
  isDemoMode: () => boolean;
  getAuthHeader: () => string | null;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

// Global refresh lock to prevent race conditions between proactive refresh and fetcher retry
let refreshPromise: Promise<boolean> | null = null;
let isRefreshing = false;

// Create secure storage instance
const secureStorage = createSecureStorage();
const tokenManager = new TokenManager(secureStorage);

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // State
      user: null,
      token: null,
      isAuthenticated: false,
      apiKey: null,
      isUsingApiKey: false,
      isInitialized: false,

      // Actions
      login: (token: string, user: User, refreshToken?: string) => {
        // Store tokens securely
        tokenManager.setAccessToken(token);
        if (refreshToken) {
          tokenManager.setRefreshToken(refreshToken);
        }

        set({
          token,
          user,
          isAuthenticated: true,
          isUsingApiKey: false,
          apiKey: null, // Clear API key when using JWT
        });
      },

      logout: () => {
        // Get refresh token before clearing
        const refreshToken = tokenManager.getRefreshToken();

        // Call logout endpoint to revoke session
        fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include', // Include cookies
          headers: {
            'Authorization': get().getAuthHeader() || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: refreshToken }), // ✅ Send refresh token to revoke session
        }).catch(error => {
          console.error('Logout API call failed:', getErrorMessage(error));
        });

        // Clear tokens securely
        tokenManager.clearTokens();

        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isUsingApiKey: false,
          apiKey: null,
        });
      },

      setApiKey: async (key: string | null) => {
        if (!key) {
          get().clearAuth();
          return;
        }

        // Clear JWT auth when using API key
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          apiKey: key,
          isUsingApiKey: true,
        });

        try {
          // Validate API key by fetching user profile
          const response = await fetch(`${API_BASE_URL}/users/me`, {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': key,
            },
          });

          if (response.ok) {
            const profile = await response.json();
            set({
              user: profile,
              isAuthenticated: true,
            });
          } else {
            // Invalid API key
            set({
              apiKey: null,
              isUsingApiKey: false,
              user: null,
              isAuthenticated: false,
            });
          }
        } catch (error) {
          console.error('Failed to validate API key:', getErrorMessage(error));
          set({
            apiKey: null,
            isUsingApiKey: false,
            user: null,
            isAuthenticated: false,
          });
        }
      },

      setDemoMode: async () => {
        const demoKey = process.env.NEXT_PUBLIC_DEMO_API_KEY;
        if (!demoKey) {
          console.error('Demo API Key is not configured.');
          return;
        }
        await get().setApiKey(demoKey);
      },

      clearAuth: () => {
        tokenManager.clearTokens();
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          apiKey: null,
          isUsingApiKey: false,
        });
      },

      updateUser: (user: User) => {
        set({ user });
      },

      // Computed properties
      isDemoMode: () => {
        const state = get();
        // Demo mode if:
        // 1. User explicitly marked as demo, OR
        // 2. JWT user who hasn't verified their email yet
        return state.user?.isDemo || (state.user && !state.user.emailVerified && !state.isUsingApiKey) || false;
      },

      getAuthHeader: () => {
        const state = get();
        
        // For JWT, always get fresh token from secure storage
        if (!state.isUsingApiKey) {
          const freshToken = tokenManager.getAccessToken();
          if (freshToken) {
            return `Bearer ${freshToken}`;
          }
        }
        
        // Legacy API key support
        if (state.apiKey) {
          return state.apiKey;
        }
        
        return null;
      },
      
      // Security features
      refreshToken: async (): Promise<boolean> => {
        // Global lock: if already refreshing, return the existing promise
        if (refreshPromise) return refreshPromise;

        const refreshToken = tokenManager.getRefreshToken();
        if (!refreshToken) {
          return false;
        }

        // Prevent multiple simultaneous refresh attempts
        if (isRefreshing) {
          console.log('Refresh already in progress, waiting...');
          return refreshPromise || false;
        }

        isRefreshing = true;
        refreshPromise = (async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include', // support cookie-based auth mode
              body: JSON.stringify({ refresh_token: refreshToken }),
            });

            if (!response.ok) {
              // Check if it's a 401 (refresh token expired) vs network error
              if (response.status === 401) {
                console.log('Refresh token expired, clearing auth');
                tokenManager.clearTokens();
                set({
                  token: null,
                  user: null,
                  isAuthenticated: false,
                  isUsingApiKey: false,
                  apiKey: null,
                });
              }
              return false;
            }

            const data: AuthResponse = await response.json();

            // Update tokens (rotate refresh if provided)
            tokenManager.setAccessToken(data.access_token);
            if (data.refresh_token) {
              tokenManager.setRefreshToken(data.refresh_token);
            }

            set({
              token: data.access_token,
              user: {
                id: data.user.id,
                email: data.user.email,
                isDemo: data.user.isDemo,
                emailVerified: data.user.emailVerified,
                isAdmin: data.user.isAdmin,
                createdAt: new Date().toISOString(),
                lastLoginAt: new Date().toISOString(),
              },
              isAuthenticated: true,
              isUsingApiKey: false,
            });

            console.log('Token refreshed successfully');
            return true;
          } catch (error) {
            console.error('Token refresh failed with error:', getErrorMessage(error));
            return false;
          } finally {
            isRefreshing = false;
            refreshPromise = null;
          }
        })();

        return refreshPromise;
      },
      
      isTokenValid: (): boolean => {
        const state = get();
        if (state.isUsingApiKey) {
          return Boolean(state.apiKey);
        }
        return Boolean(tokenManager.getAccessToken());
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => {
        // Use secure storage for Zustand persistence
        // Note: This still persists non-sensitive data like user profile
        return {
          getItem: (key: string) => {
            // Only persist user data, not tokens
            const stored = secureStorage.getItem(`zustand.${key}`);
            if (stored) {
              try {
                const parsed = JSON.parse(stored);
                // Remove sensitive data from persistence
                if (parsed.state) {
                  delete parsed.state.token;
                  delete parsed.state.apiKey;
                }
                return JSON.stringify(parsed);
              } catch {
                return stored;
              }
            }
            return stored;
          },
          setItem: (key: string, value: string) => {
            try {
              const parsed = JSON.parse(value);
              // Remove sensitive data before storing
              if (parsed.state) {
                delete parsed.state.token;
                delete parsed.state.apiKey;
              }
              secureStorage.setItem(`zustand.${key}`, JSON.stringify(parsed));
            } catch {
              secureStorage.setItem(`zustand.${key}`, value);
            }
          },
          removeItem: (key: string) => secureStorage.removeItem(`zustand.${key}`),
        };
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
          
          // Check for valid tokens in secure storage
          const validToken = tokenManager.getAccessToken();
          
          if (state.user && !state.isUsingApiKey) {
            if (validToken) {
              // We have a valid token, restore JWT authentication
              state.token = validToken;
              state.isAuthenticated = true;
              console.log('Restored valid JWT authentication from secure storage');
            } else {
              // No valid token, clear authentication
              console.log('No valid token found, clearing authentication');
              tokenManager.clearTokens();
              state.token = null;
              state.user = null;
              state.isAuthenticated = false;
              state.apiKey = null;
              state.isUsingApiKey = false;
            }
          } else if (state.apiKey && state.isUsingApiKey) {
            // API key authentication - validate it
            console.log('Restored API key authentication');
          }
        }
      },
      // Don't persist sensitive data like tokens in some cases
      partialize: (state) => ({
        ...state,
        // Only persist what we need
      }),
    }
  )
);
