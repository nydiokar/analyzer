'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { useFavorites } from '@/hooks/useFavorites';
import { fetcher } from '@/lib/fetcher';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/error-messages';
import QuickAddForm from '@/components/layout/QuickAddForm';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FavoriteModalContextType {
  openFavoriteDialog: (address: string, initialNickname?: string) => void;
  isFavorite: (address: string) => boolean;
}

const FavoriteModalContext = createContext<FavoriteModalContextType | null>(null);

export function FavoriteModalProvider({ children }: { children: ReactNode }) {
  const { favorites, mutate: mutateFavorites } = useFavorites();
  const favoriteAddresses = new Set(favorites.map(fav => fav.walletAddress));

  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [initialNickname, setInitialNickname] = useState<string | undefined>(undefined);

  const isFavorite = (address: string) => favoriteAddresses.has(address);

  // Add to favorites
  const addFavorite = async (address: string, nickname?: string, collectionName?: string) => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: address,
          nickname,
          collectionName,
        }),
      });
      await mutateFavorites();
      toast.success("Added to tracked wallets", {
        description: nickname
          ? `${nickname} has been added to your tracked list.`
          : "Wallet has been added to your tracked list.",
      });
    } catch (err: unknown) {
      const message = getErrorMessage("discover-add-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  // Remove from favorites
  const removeFavorite = async (address: string) => {
    try {
      await fetcher(`/users/me/favorites/${address}`, {
        method: 'DELETE',
      });
      await mutateFavorites();
      toast.success("Removed from tracked wallets", {
        description: "Wallet has been removed from your tracked list.",
      });
    } catch (err: unknown) {
      const message = getErrorMessage("discover-remove-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  // Open appropriate modal based on current state
  const openFavoriteDialog = (address: string, nickname?: string) => {
    setSelectedAddress(address);
    setInitialNickname(nickname);
    if (favoriteAddresses.has(address)) {
      setShowDeleteConfirm(true);
    } else {
      setShowQuickAddModal(true);
    }
  };

  // Handle save from QuickAddForm
  const handleQuickAddSave = async (data: { nickname?: string; collectionName?: string }) => {
    if (!selectedAddress) return;
    await addFavorite(selectedAddress, data.nickname, data.collectionName);
    setShowQuickAddModal(false);
    setSelectedAddress(null);
  };

  // Handle delete confirmation
  const handleConfirmDelete = async () => {
    if (!selectedAddress) return;
    await removeFavorite(selectedAddress);
    setShowDeleteConfirm(false);
    setSelectedAddress(null);
  };

  return (
    <FavoriteModalContext.Provider value={{ openFavoriteDialog, isFavorite }}>
      {children}

      {/* Global modals - single instance for entire app */}
      <QuickAddForm
        isOpen={showQuickAddModal}
        onClose={() => {
          setShowQuickAddModal(false);
          setSelectedAddress(null);
          setInitialNickname(undefined);
        }}
        onSave={handleQuickAddSave}
        walletAddress={selectedAddress || ''}
        initialNickname={initialNickname}
        title="Organize Wallet"
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => {
        setShowDeleteConfirm(open);
        if (!open) setSelectedAddress(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from tracked wallets?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedAddress
                ? `This will remove ${selectedAddress.slice(0, 8)}...${selectedAddress.slice(-4)} from your tracked wallets.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FavoriteModalContext.Provider>
  );
}

/**
 * Hook to access favorite modal actions
 * Use this in any component that needs to trigger favorite add/remove
 */
export function useFavoriteActions() {
  const context = useContext(FavoriteModalContext);
  if (!context) {
    throw new Error('useFavoriteActions must be used within FavoriteModalProvider');
  }
  return context;
}
