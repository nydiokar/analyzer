'use client';

import { WalletBadge, type WalletBadgeProps } from '@/components/shared/WalletBadge';
import { useFavoriteActions } from '@/providers/FavoriteModalProvider';

type SimilarityWalletBadgeProps = Omit<
  WalletBadgeProps,
  'addressClickAction' | 'isFavorite' | 'onFavoriteToggle'
>;

export function SimilarityWalletBadge(props: SimilarityWalletBadgeProps) {
  const { address } = props;
  const { isFavorite, openFavoriteDialog } = useFavoriteActions();

  return (
    <WalletBadge
      {...props}
      address={address}
      addressClickAction="copy-address"
      isFavorite={isFavorite(address)}
      onFavoriteToggle={() => openFavoriteDialog(address)}
    />
  );
}
