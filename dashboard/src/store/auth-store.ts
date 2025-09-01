import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSecureStorage, TokenManager } from '../lib/secure-storage';

export interface User {
  id: string;
  email: string | null;
  isDemo: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    isDemo: boolean;
    emailVerified: boolean;
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
  login: (token: string, user: User) => void;
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
      login: (token: string, user: User) => {
        // Store token securely
        tokenManager.setAccessToken(token);
        
        set({
          token,
          user,
          isAuthenticated: true,
          isUsingApiKey: false,
          apiKey: null, // Clear API key when using JWT
        });
      },

      logout: () => {
        // Clear tokens securely
        tokenManager.clearTokens();
        
        // Call logout endpoint to clear httpOnly cookies
        fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include', // Include cookies
          headers: {
            'Authorization': get().getAuthHeader() || '',
          },
        }).catch(error => {
          console.error('Logout API call failed:', error);
        });
        
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
          console.error('Failed to validate API key:', error);
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
        // In a complete implementation, this would call a refresh endpoint
        // For now, return false to trigger re-authentication
        const token = tokenManager.getAccessToken();
        if (!token) {
          get().clearAuth();
          return false;
        }
        return true;
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
              state.clearAuth();
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