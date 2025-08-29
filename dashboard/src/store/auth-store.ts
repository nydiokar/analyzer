import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  
  // Computed
  isDemoMode: () => boolean;
  getAuthHeader: () => string | null;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

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
        set({
          token,
          user,
          isAuthenticated: true,
          isUsingApiKey: false,
          apiKey: null, // Clear API key when using JWT
        });
      },

      logout: () => {
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
        return state.user?.isDemo || false;
      },

      getAuthHeader: () => {
        const state = get();
        if (state.token) {
          return `Bearer ${state.token}`;
        }
        if (state.apiKey) {
          return state.apiKey;
        }
        return null;
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
          
          // Validate stored JWT token
          if (state.token && !state.isUsingApiKey) {
            try {
              const payload = JSON.parse(atob(state.token.split('.')[1]));
              const now = Date.now() / 1000;
              
              // Check if token is expired
              if (payload.exp && payload.exp < now) {
                console.log('Stored JWT token is expired, clearing auth');
                state.clearAuth();
              }
            } catch (error) {
              console.log('Invalid JWT token in storage, clearing auth');
              state.clearAuth();
            }
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