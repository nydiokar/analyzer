import { useBulkTrackHolders } from '@/hooks/trackers/useBulkTrackHolders';
import { useTokenTrackDefaults } from '@/hooks/trackers/useTokenTrackDefaults';
import { useSelectedHolderDetails } from '@/hooks/similarity-lab/useSelectedHolderDetails';
import type { FavoriteWallet } from '@/types/api';

interface Params {
  tokenMint: string | null;
  selectedAddresses: string[];
  favorites: FavoriteWallet[];
  onSaved?: () => Promise<unknown> | void;
}

export function useSimilarityLabTrackersFlow({
  tokenMint,
  selectedAddresses,
  favorites,
  onSaved,
}: Params) {
  const { selectedHolderDetails } = useSelectedHolderDetails(tokenMint, selectedAddresses);
  const { defaultCollectionName, defaultNicknamePrefix } = useTokenTrackDefaults(tokenMint);
  const bulkTrack = useBulkTrackHolders({
    selectedHolders: selectedHolderDetails,
    favorites,
    defaultCollectionName,
    defaultNicknamePrefix,
    onSaved,
  });

  return {
    selectedHolderDetails,
    defaultCollectionName,
    defaultNicknamePrefix,
    bulkTrack,
  };
}
