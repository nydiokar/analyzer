import { create } from 'zustand';

interface UIStore {
  // Auth modal state
  showAuthModal: boolean;
  authModalReason?: 'session_expired' | 'unauthorized' | 'manual';
  setShowAuthModal: (show: boolean, reason?: 'session_expired' | 'unauthorized' | 'manual') => void;

  // Other UI state can be added here
}

export const useUIStore = create<UIStore>((set) => ({
  showAuthModal: false,
  authModalReason: undefined,

  setShowAuthModal: (show: boolean, reason?: 'session_expired' | 'unauthorized' | 'manual') => {
    set({ showAuthModal: show, authModalReason: reason });
  },
}));
