import { useFavorites } from './useFavorites';

/**
 * Hook that provides favorite check functionality
 * Returns ONLY the isFavorite check - no toggle logic
 *
 * IMPORTANT: This is a READ-ONLY hook
 * For adding/removing favorites, use the global FavoriteModal (TODO: create this)
 */
export function useFavoriteToggle() {
  const { favorites } = useFavorites();
  const favoriteAddresses = new Set(favorites.map(fav => fav.walletAddress));

  const isFavorite = (address: string) => favoriteAddresses.has(address);

  return {
    favorites,
    favoriteAddresses,
    isFavorite,
  };
}
