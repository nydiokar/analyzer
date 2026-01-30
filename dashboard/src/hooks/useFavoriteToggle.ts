import { useFavorites } from './useFavorites';
import { fetcher } from '@/lib/fetcher';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/error-messages';

/**
 * Hook that provides favorite toggle functionality for wallet addresses
 * Returns isFavorite check function and handleToggle function
 */
export function useFavoriteToggle() {
  const { favorites, mutate: mutateFavorites } = useFavorites();
  const favoriteAddresses = new Set(favorites.map(fav => fav.walletAddress));

  const isFavorite = (address: string) => favoriteAddresses.has(address);

  const handleAddFavorite = async (address: string) => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: address,
        }),
      });
      await mutateFavorites();
      toast.success("Added to tracked wallets", {
        description: "Wallet has been added to your tracked list.",
      });
    } catch (err: unknown) {
      const message = getErrorMessage("add-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  const handleRemoveFavorite = async (address: string) => {
    try {
      await fetcher(`/users/me/favorites/${address}`, {
        method: 'DELETE',
      });
      await mutateFavorites();
      toast.success("Removed from tracked wallets", {
        description: "Wallet has been removed from your tracked list.",
      });
    } catch (err: unknown) {
      const message = getErrorMessage("remove-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  const handleToggle = (address: string) => {
    if (favoriteAddresses.has(address)) {
      return handleRemoveFavorite(address);
    } else {
      return handleAddFavorite(address);
    }
  };

  return {
    favorites,
    favoriteAddresses,
    isFavorite,
    handleToggle,
    handleAddFavorite,
    handleRemoveFavorite,
  };
}
