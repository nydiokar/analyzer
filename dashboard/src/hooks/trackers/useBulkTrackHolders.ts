import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetcher } from '@/lib/fetcher';
import { toast } from 'sonner';
import type { FavoriteWallet } from '@/types/api';

export interface SelectedHolder {
  address: string;
  rank?: number;
  knownType?: string;
  knownLabel?: string;
}

interface UseBulkTrackHoldersParams {
  selectedHolders: SelectedHolder[];
  favorites: FavoriteWallet[];
  defaultCollectionName: string;
  defaultNicknamePrefix: string;
  onSaved?: () => Promise<unknown> | void;
}

type BulkTrackAction = 'add' | 'update' | 'noop' | 'skip';

interface BulkTrackItem {
  address: string;
  rank: number;
  generatedNickname: string;
  existingNickname?: string;
  existingCollections: string[];
  finalCollections: string[];
  action: BulkTrackAction;
  knownType?: string;
  knownLabel?: string;
  isExcluded: boolean;
}

interface BulkTrackSummary {
  adds: number;
  updates: number;
  noops: number;
  skips: number;
}

export function useBulkTrackHolders({
  selectedHolders,
  favorites,
  defaultCollectionName,
  defaultNicknamePrefix,
  onSaved,
}: UseBulkTrackHoldersParams) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [collectionInput, setCollectionInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [debouncedCollectionInput, setDebouncedCollectionInput] = useState('');
  const [debouncedNicknameInput, setDebouncedNicknameInput] = useState('');

  const excludedKnownTypes = useMemo(() => new Set(['LP', 'SYSTEM', 'PROTOCOL', 'EXCHANGE', 'BURN']), []);

  const normalizeCollectionName = useCallback((value: string) => {
    const cleaned = value
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    return cleaned || 'TRACKED_TH';
  }, []);

  const normalizeNicknamePrefix = useCallback((value: string) => {
    const cleaned = value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    return cleaned || 'token_th_';
  }, []);

  const resolvedCollectionName = useMemo(
    () => normalizeCollectionName(collectionInput || defaultCollectionName),
    [collectionInput, defaultCollectionName, normalizeCollectionName]
  );

  const resolvedNicknamePrefix = useMemo(() => {
    const base = normalizeNicknamePrefix(nicknameInput || defaultNicknamePrefix);
    return base.endsWith('_') ? base : `${base}_`;
  }, [nicknameInput, defaultNicknamePrefix, normalizeNicknamePrefix]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCollectionInput(collectionInput);
    }, 280);
    return () => clearTimeout(timer);
  }, [collectionInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNicknameInput(nicknameInput);
    }, 280);
    return () => clearTimeout(timer);
  }, [nicknameInput]);

  const displayCollectionName = useMemo(
    () => normalizeCollectionName(debouncedCollectionInput || defaultCollectionName),
    [debouncedCollectionInput, defaultCollectionName, normalizeCollectionName]
  );

  const displayNicknamePrefix = useMemo(() => {
    const base = normalizeNicknamePrefix(debouncedNicknameInput || defaultNicknamePrefix);
    return base.endsWith('_') ? base : `${base}_`;
  }, [debouncedNicknameInput, defaultNicknamePrefix, normalizeNicknamePrefix]);

  const preview = useMemo<BulkTrackItem[]>(() => {
    return selectedHolders.map((holder, index) => {
      const rank = holder.rank ?? index + 1;
      const generatedNickname = `${resolvedNicknamePrefix}${rank}`;
      const existing = favorites.find(fav => fav.walletAddress === holder.address);
      const existingCollections = existing?.collections || [];
      const hasCollection = existingCollections.includes(resolvedCollectionName);
      const finalCollections = hasCollection
        ? existingCollections
        : Array.from(new Set([...existingCollections, resolvedCollectionName]));
      const isExcluded = holder.knownType ? excludedKnownTypes.has(holder.knownType) : false;
      const action: BulkTrackAction = isExcluded
        ? 'skip'
        : existing
          ? (hasCollection ? 'noop' : 'update')
          : 'add';

      return {
        address: holder.address,
        rank,
        generatedNickname,
        existingNickname: existing?.nickname,
        existingCollections,
        finalCollections,
        action,
        knownType: holder.knownType,
        knownLabel: holder.knownLabel,
        isExcluded,
      };
    });
  }, [selectedHolders, favorites, resolvedCollectionName, resolvedNicknamePrefix, excludedKnownTypes]);

  const summary = useMemo<BulkTrackSummary>(() => {
    return preview.reduce(
      (acc, item) => {
        if (item.action === 'add') acc.adds += 1;
        if (item.action === 'update') acc.updates += 1;
        if (item.action === 'noop') acc.noops += 1;
        if (item.action === 'skip') acc.skips += 1;
        return acc;
      },
      { adds: 0, updates: 0, noops: 0, skips: 0 }
    );
  }, [preview]);

  const open = useCallback(() => {
    setCollectionInput(defaultCollectionName);
    setNicknameInput(defaultNicknamePrefix);
    setIsOpen(true);
  }, [defaultCollectionName, defaultNicknamePrefix]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const confirm = useCallback(async () => {
    const actionableItems = preview.filter(item => item.action === 'add' || item.action === 'update');
    if (actionableItems.length === 0) {
      const description = summary.skips > 0
        ? 'All selected wallets are either already tracked or excluded (system/LP).'
        : 'All selected wallets are already in this collection.';
      toast.info('No changes needed', { description });
      setIsOpen(false);
      return;
    }

    setIsSaving(true);
    let successCount = 0;
    let failCount = 0;

    for (const item of actionableItems) {
      try {
        if (item.action === 'add') {
          await fetcher('/users/me/favorites', {
            method: 'POST',
            body: JSON.stringify({
              walletAddress: item.address,
              nickname: item.generatedNickname,
              collections: item.finalCollections,
            }),
          });
        } else {
          await fetcher(`/users/me/favorites/${item.address}`, {
            method: 'PATCH',
            body: JSON.stringify({
              collections: item.finalCollections,
            }),
          });
        }
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }

    await onSaved?.();
    setIsSaving(false);
    setIsOpen(false);

    if (successCount > 0) {
      toast.success('Tracked wallets updated', {
        description: `${successCount} wallet${successCount !== 1 ? 's' : ''} saved to ${resolvedCollectionName}${failCount > 0 ? `, ${failCount} failed` : ''}.`,
      });
    } else {
      toast.error('Bulk add failed', {
        description: 'No wallets were added to tracked.',
      });
    }
  }, [preview, summary, onSaved, resolvedCollectionName]);

  return {
    isOpen,
    isSaving,
    collectionInput,
    nicknameInput,
    setCollectionInput,
    setNicknameInput,
    displayCollectionName,
    displayNicknamePrefix,
    preview,
    summary,
    open,
    close,
    confirm,
    excludedKnownTypes,
  };
}
