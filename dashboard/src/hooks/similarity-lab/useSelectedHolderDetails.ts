import { useMemo } from 'react';
import { useTopHolders } from '@/hooks/useTopHolders';

export interface SelectedHolderDetail {
  address: string;
  rank?: number;
  knownType?: string;
  knownLabel?: string;
}

export function useSelectedHolderDetails(tokenMint: string | null, selectedAddresses: string[]) {
  const { data: holdersData } = useTopHolders(tokenMint ?? undefined, 'finalized');
  const holders = useMemo(
    () => (holdersData?.holders || []).filter(h => !!h.ownerAccount),
    [holdersData]
  );
  const holderMap = useMemo(() => {
    return new Map(
      holders.map(h => [h.ownerAccount || h.tokenAccount, h])
    );
  }, [holders]);

  const selectedHolderDetails = useMemo<SelectedHolderDetail[]>(() => {
    if (selectedAddresses.length === 0) return [];
    const selectedSet = new Set(selectedAddresses);
    const ordered = holders
      .filter(h => selectedSet.has(h.ownerAccount || h.tokenAccount))
      .map(h => ({
        address: h.ownerAccount || h.tokenAccount,
        rank: h.rank,
        knownType: h.knownType,
        knownLabel: h.knownLabel,
      }));
    const missing = selectedAddresses
      .filter(addr => !holderMap.has(addr))
      .map(addr => ({ address: addr }));
    return [...ordered, ...missing];
  }, [holders, holderMap, selectedAddresses]);

  return { selectedHolderDetails };
}
