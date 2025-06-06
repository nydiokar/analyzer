import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fetcher } from '@/lib/fetcher'; // Assuming fetcher can be used here

interface ApiKeyStore {
  apiKey: string | null;
  isDemo: boolean;
  setApiKey: (key: string | null) => Promise<void>;
  isInitialized: boolean; // To track if the store has been hydrated from localStorage
}

export const useApiKeyStore = create<ApiKeyStore>()(
  persist(
    (set) => ({
      apiKey: null,
      isDemo: false, // Default to false
      isInitialized: false,
      setApiKey: async (key) => {
        if (!key) {
          set({ apiKey: null, isDemo: false });
          return;
        }
        
        // Temporarily set the key to allow the fetcher to use it
        set({ apiKey: key, isDemo: false });

        try {
          // Fetch user profile to check demo status
          const profile = await fetcher('/api/v1/users/me');
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