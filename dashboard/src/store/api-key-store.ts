import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fetcher } from '@/lib/fetcher';

// This is the actual API key that is marked as `isDemo` in your backend.
// When a user selects "Try Demo Mode", this key will be used.

interface ApiKeyStore {
  apiKey: string | null;
  isDemo: boolean;
  setApiKey: (key: string | null) => Promise<void>;
  setDemoMode: () => Promise<void>;
  clearApiKey: () => void;
  isInitialized: boolean;
}

export const useApiKeyStore = create<ApiKeyStore>()(
  persist(
    (set, get) => ({
      apiKey: null,
      isDemo: false,
      isInitialized: false,
      setDemoMode: async () => {
        const demoKey = process.env.NEXT_PUBLIC_DEMO_API_KEY;
        if (!demoKey) {
          console.error("Demo API Key is not configured. Please set Demo key.");
          // Optionally, show a toast or error message to the user
          return;
        }
        // Use the standard setApiKey flow with the key from the environment variable.
        await get().setApiKey(demoKey);
      },
      clearApiKey: () => {
        set({ apiKey: null, isDemo: false });
      },
      setApiKey: async (key) => {
        if (!key) {
          set({ apiKey: null, isDemo: false });
          return;
        }

        // Temporarily set the key to allow the fetcher to use it.
        // The special logic for a demo key is no longer needed here.
        set({ apiKey: key, isDemo: false });

        try {
          // Fetch user profile to check demo status from the backend
          const profile = await fetcher('/users/me');
          if (profile && typeof profile.isDemo === 'boolean') {
            set({ apiKey: key, isDemo: profile.isDemo });
          } else {
            // Keep the key, but assume not demo if profile is malformed
            set({ apiKey: key, isDemo: false });
          }
        } catch (error) {
          console.error("Failed to fetch user profile, assuming not a demo key.", error);
          // If the key is invalid, the user will get 401 on subsequent requests.
          // For now, we keep the key but flag as non-demo.
          set({ apiKey: key, isDemo: false });
        }
      },
    }),
    {
      name: 'api-key-storage', // name of the item in the storage (must be unique)
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
          // When rehydrating, we might want to re-validate the key's demo status
          // For now, we trust the persisted isDemo value.
        }
      },
    }
  )
); 