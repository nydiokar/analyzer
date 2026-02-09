'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Bookmark, Wallet, TrendingUp, X, Search, Plus, Upload, Download, Filter, Trash2, PlayCircle, Sparkles, Eraser, Loader2 } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback, useRef, memo, useEffect } from 'react';
import { useJobProgress } from '@/hooks/useJobProgress';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { WalletEditForm } from '@/components/layout/WalletEditForm';
import QuickAddForm from '@/components/layout/QuickAddForm';
import { toast } from 'sonner';
import { FavoriteWallet, WalletHudDto } from '@/types/api';
import { cn } from '@/lib/utils';
import { getCollectionColorFilled } from '@/lib/color-utils';
import EmptyState from '@/components/shared/EmptyState';
import { PageTitle } from '@/components/shared/PageTitle';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/error-messages';
import { USER_FAVORITES_IMPORT_FLASH_BATCH, USER_FAVORITES_MAX } from '@/lib/constants';
import { useWalletHudCache } from '@/hooks/useWalletHudCache';
import { encodeHudName, stripHudEncoding } from '@/lib/wallet-name-encoding';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WalletBadge } from '@/components/shared/WalletBadge';
import { CollectionAnalytics, CollectionStat } from '@/components/trackers/CollectionAnalytics';

// Helper function to format SOL values
function formatSOL(val: number): string {
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '+';

  if (absVal >= 1000000) {
    return `${sign}${(absVal / 1000000).toFixed(1)}M`;
  } else if (absVal >= 1000) {
    return `${sign}${(absVal / 1000).toFixed(1)}k`;
  } else if (absVal >= 100) {
    return `${sign}${absVal.toFixed(0)}`;
  } else {
    return `${sign}${absVal.toFixed(2)}`;
  }
}

// Helper function to format time ago
function timeAgo(timestamp: number | string | undefined): string {
  if (!timestamp) return 'Never';

  const date = typeof timestamp === 'number'
    ? new Date(timestamp * 1000) // Unix timestamp in seconds
    : new Date(timestamp); // ISO string

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// Memoized table row component to prevent unnecessary re-renders
interface WalletRowProps {
  wallet: FavoriteWallet;
  isSelected: boolean;
  onToggleSelection: (address: string) => void;
  onSetDeleting: (wallet: FavoriteWallet) => void;
  onSetEditing: (wallet: FavoriteWallet) => void;
}

const WalletRow = memo(({ wallet, isSelected, onToggleSelection, onSetDeleting, onSetEditing }: WalletRowProps) => {
  const handleCheckboxChange = useCallback(() => {
    onToggleSelection(wallet.walletAddress);
  }, [wallet.walletAddress, onToggleSelection]);

  const handleFavoriteToggle = useCallback(() => {
    onSetDeleting(wallet);
  }, [wallet, onSetDeleting]);

  const handleEdit = useCallback(() => {
    onSetEditing(wallet);
  }, [wallet, onSetEditing]);

  return (
    <TableRow key={wallet.walletAddress} className="hover:bg-accent/30">
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleCheckboxChange}
          aria-label={`Select ${wallet.walletAddress}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <WalletBadge
            address={wallet.walletAddress}
            size="m"
            variant="inline"
            showMetrics={false}
            showActions={true}
            isFavorite={true}
            onFavoriteToggle={handleFavoriteToggle}
            onEdit={handleEdit}
            favoriteData={wallet}
            knownType={wallet.knownType}
            knownLabel={wallet.knownLabel}
            showHud={true}
            hudDisplay="tooltip"
            hudDelayMs={800}
          />
          {wallet.collections && wallet.collections.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  className={cn(
                    'text-xs font-medium',
                    getCollectionColorFilled(wallet.collections[0])
                  )}
                >
                  {wallet.collections[0]}
                  {wallet.collections.length > 1 && (
                    <span className="ml-1 opacity-80">({wallet.collections.length})</span>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {wallet.collections.length > 1 ? (
                  <>
                    Collections: {wallet.collections.join(', ')}
                  </>
                ) : (
                  `Collection: ${wallet.collections[0]}`
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm">
        {wallet.pnl !== undefined ? (
          <span className={wallet.pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
            {formatSOL(wallet.pnl)} SOL
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {wallet.winRate !== undefined ? (
          <span>{wallet.winRate.toFixed(1)}%</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {wallet.lastActiveTimestamp ? timeAgo(wallet.lastActiveTimestamp) + ' ago' : 'Unknown'}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {wallet.currentSolBalance !== undefined ? (
          <span>{wallet.currentSolBalance.toFixed(2)} SOL</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
    </TableRow>
  );
});
WalletRow.displayName = 'WalletRow';

export default function TrackersPage() {
  const { favorites: favoriteWallets, error, mutate: mutateFavorites } = useFavorites();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter and search state
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Selection and batch analyze state
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set());
  const [batchAnalyzeScope, setBatchAnalyzeScope] = useState<'flash' | 'working' | 'deep'>('working');
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);

  // Edit/delete/add state
  const [editingWallet, setEditingWallet] = useState<FavoriteWallet | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<FavoriteWallet | null>(null);
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [isEncodingNames, setIsEncodingNames] = useState(false);
  const [importCollection, setImportCollection] = useState('');
  const [importJobsInProgress, setImportJobsInProgress] = useState<string[]>([]);
  const importJobsRef = useRef(importJobsInProgress);
  importJobsRef.current = importJobsInProgress;

  // Extract unique collections and count wallets per collection
  const allCollections = useMemo(() => {
    if (!favoriteWallets) return [];
    const collections = new Set<string>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.collections?.forEach((c: string) => collections.add(c));
    });
    return Array.from(collections).sort();
  }, [favoriteWallets]);

  // Count wallets per collection
  const collectionCounts = useMemo(() => {
    if (!favoriteWallets) return new Map<string, number>();
    const counts = new Map<string, number>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.collections?.forEach((c: string) => {
        counts.set(c, (counts.get(c) || 0) + 1);
      });
    });
    return counts;
  }, [favoriteWallets]);

  // Portfolio stats
  // Job progress tracking
  const { subscribeToJob } = useJobProgress({
    onJobProgress: useCallback(() => {
      // Progress updates handled by internal hook state
    }, []),
    onJobCompleted: useCallback((data) => {
      if (importJobsRef.current.includes(data.jobId)) {
        setImportJobsInProgress(prev => prev.filter(id => id !== data.jobId));
        mutateFavorites();
        if (importJobsRef.current.length === 1) {
          toast.success('All imported wallets analyzed!');
        }
      }
    }, [mutateFavorites]),
    onJobFailed: useCallback((data) => {
      if (importJobsRef.current.includes(data.jobId)) {
        setImportJobsInProgress(prev => prev.filter(id => id !== data.jobId));
        toast.error('Analysis failed', { description: data.error || 'Unknown error' });
      }
    }, []),
    onEnrichmentComplete: useCallback(() => {
      // Not needed for import tracking
    }, []),
  });

  const portfolioStats = useMemo(() => {
    if (!favoriteWallets?.length) return null;

    const totalPnl = favoriteWallets.reduce((sum: number, wallet: FavoriteWallet) => sum + (wallet.pnl || 0), 0);
    const totalBalance = favoriteWallets.reduce((sum: number, wallet: FavoriteWallet) => sum + (wallet.currentSolBalance || 0), 0);
    const totalWallets = favoriteWallets.length;
    const analyzedWallets = favoriteWallets.filter((w: FavoriteWallet) => w.pnl !== undefined).length;

    return {
      totalPnl,
      totalBalance,
      totalWallets,
      analyzedWallets,
    };
  }, [favoriteWallets]);

  const collectionStats = useMemo<CollectionStat[]>(() => {
    if (!favoriteWallets?.length) return [];
    const stats = new Map<string, { walletCount: number; totalPnl: number; totalBalance: number; pnlCount: number; balanceCount: number }>();

    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      // Add "Main" collection for wallets without any collections
      const collections = wallet.collections?.length ? wallet.collections : ['Main'];

      collections.forEach((collection: string) => {
        const existing = stats.get(collection) || { walletCount: 0, totalPnl: 0, totalBalance: 0, pnlCount: 0, balanceCount: 0 };
        stats.set(collection, {
          walletCount: existing.walletCount + 1,
          // Only add to total if the value exists (not null/undefined)
          totalPnl: existing.totalPnl + (wallet.pnl ?? 0),
          totalBalance: existing.totalBalance + (wallet.currentSolBalance ?? 0),
          // Track how many wallets actually have data
          pnlCount: existing.pnlCount + (wallet.pnl != null ? 1 : 0),
          balanceCount: existing.balanceCount + (wallet.currentSolBalance != null ? 1 : 0),
        });
      });
    });

    return Array.from(stats.entries())
      .map(([collection, data]) => ({
        collection,
        walletCount: data.walletCount,
        totalPnl: data.totalPnl,
        totalBalance: data.totalBalance,
        // Calculate average only from wallets that have data
        avgPnl: data.pnlCount > 0 ? data.totalPnl / data.pnlCount : 0,
        avgBalance: data.balanceCount > 0 ? data.totalBalance / data.balanceCount : 0,
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl);
  }, [favoriteWallets]);

  // Calculate active wallets (last 24h)
  const activeWalletCount = useMemo(() => {
    if (!favoriteWallets) return 0;
    return favoriteWallets.filter((wallet: FavoriteWallet) => {
      if (!wallet.lastActiveTimestamp) return false;
      const hoursSinceActive = (Date.now() - wallet.lastActiveTimestamp * 1000) / (1000 * 60 * 60);
      return hoursSinceActive < 24;
    }).length;
  }, [favoriteWallets]);

  // Filter and search wallets
  const filteredWallets = useMemo(() => {
    if (!favoriteWallets) return [];

    let filtered = favoriteWallets;

    // Apply active filter (last 24h)
    if (showActiveOnly) {
      filtered = filtered.filter((wallet: FavoriteWallet) => {
        if (!wallet.lastActiveTimestamp) return false;
        const hoursSinceActive = (Date.now() - wallet.lastActiveTimestamp * 1000) / (1000 * 60 * 60);
        return hoursSinceActive < 24;
      });
    }

    // Apply collection filter
    if (selectedCollections.length > 0) {
      filtered = filtered.filter((wallet: FavoriteWallet) => {
        return wallet.collections?.some(c => selectedCollections.includes(c));
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((wallet: FavoriteWallet) => {
        return (
          wallet.walletAddress.toLowerCase().includes(query) ||
          wallet.nickname?.toLowerCase().includes(query) ||
          wallet.collections?.some(c => c.toLowerCase().includes(query))
        );
      });
    }

    return filtered;
  }, [favoriteWallets, selectedCollections, searchQuery, showActiveOnly]);

  // Lazy HUD cache - only fetch when explicitly needed (for encode operations)
  const [hudFetchEnabled, setHudFetchEnabled] = useState(false);
  const [hudTargetWallets, setHudTargetWallets] = useState<string[]>([]);
  const pendingEncodeRef = useRef(false);

  const { data: hudData, isLoading: isHudLoading, error: hudError } = useWalletHudCache(hudTargetWallets, {
    enabled: hudFetchEnabled && hudTargetWallets.length > 0,
    proactiveFetch: false
  });

  const handleRemoveWallet = useCallback(async (walletAddress: string) => {
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'DELETE',
      });
      toast.success('Wallet removed from tracked list');
      mutateFavorites();
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-remove', error);
      toast.error(message.title, { description: message.description });
    }
  }, [mutateFavorites]);

  const handleUpdateWallet = useCallback(async (walletAddress: string, updates: { nickname: string; collections: string[] }) => {
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      toast.success('Wallet updated');
      mutateFavorites();
      setEditingWallet(null);
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-update', error);
      toast.error(message.title, { description: message.description });
    }
  }, [mutateFavorites]);

  const handleAddWallet = useCallback(async (formData: { walletAddress: string; nickname: string; collections: string[] }) => {
    if ((favoriteWallets?.length ?? 0) >= USER_FAVORITES_MAX) {
      toast.error('Favorites limit reached', {
        description: `You can track up to ${USER_FAVORITES_MAX} wallets.`,
      });
      return;
    }

    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: formData.walletAddress,
          nickname: formData.nickname.trim() || undefined,
          collections: formData.collections,
        }),
      });
      mutateFavorites();
      toast.success('Wallet added', {
        description: `${formData.nickname || 'Wallet'} added to tracked wallets.`,
      });
      setShowAddWalletModal(false);
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-add', error);
      toast.error(message.title, { description: message.description });
    }
  }, [favoriteWallets, mutateFavorites]);

  const toggleCollectionFilter = (collection: string) => {
    setSelectedCollections(prev =>
      prev.includes(collection) ? prev.filter(c => c !== collection) : [...prev, collection]
    );
  };

  const clearFilters = () => {
    setSelectedCollections([]);
    setSearchQuery('');
    setShowActiveOnly(false);
  };

  const handleCollectionSelect = (collection: string) => {
    setSelectedCollections((prev) => {
      if (prev.length === 1 && prev[0] === collection) return [];
      return [collection];
    });
  };

  const resolveActionTargets = useCallback(() => {
    if (!favoriteWallets || favoriteWallets.length === 0) {
      return [];
    }

    if (selectedWallets.size > 0) {
      return favoriteWallets.filter((wallet) => selectedWallets.has(wallet.walletAddress));
    }

    return filteredWallets;
  }, [favoriteWallets, selectedWallets, filteredWallets]);

  const handleExportWallets = useCallback(() => {
    const targets = resolveActionTargets();
    if (targets.length === 0) {
      toast.error('No wallets to export');
      return;
    }

    // Export as .txt file with JSON structure (competitors format)
    const jsonData = targets.map((wallet: FavoriteWallet) => ({
      trackedWalletAddress: wallet.walletAddress,
      name: wallet.nickname || '',
      emoji: wallet.metadata?.emoji || '😀',
      alertsOn: wallet.metadata?.alertsOn ?? true,
    }));

    const jsonContent = JSON.stringify(jsonData, null, 2);

    // Create blob and download as .txt
    const blob = new Blob([jsonContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tracked-wallets-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Wallets exported', {
      description: `${targets.length} wallet${targets.length === 1 ? '' : 's'} exported to TXT.`,
    });
  }, [resolveActionTargets]);

  const handleHudNameTransform = useCallback(async (mode: 'encode' | 'strip') => {
    if (!favoriteWallets || favoriteWallets.length === 0) {
      toast.error('No wallets to update');
      return;
    }

    const targets = resolveActionTargets();
    if (targets.length === 0) {
      toast.error('No wallets selected');
      return;
    }

    if (mode === 'encode') {
      const targetAddresses = targets.map((w) => w.walletAddress);
      const missingForTargets = targetAddresses.filter((addr) => !hudData?.[addr]).length;

      // If we need to fetch HUD data first
      if (missingForTargets > 0) {
        if (!isHudLoading && !hudFetchEnabled) {
          setHudTargetWallets(targetAddresses);
          setHudFetchEnabled(true);
          pendingEncodeRef.current = true;
          toast.info('Fetching HUD data...', {
            description: `Loading metrics for ${missingForTargets} wallet${missingForTargets === 1 ? '' : 's'}...`,
          });
        }
        return;
      }

      // Clear pending encode flag when we proceed
      pendingEncodeRef.current = false;
    }

    setIsEncodingNames(true);
    try {
      const updates: Array<{ walletAddress: string; nickname: string }> = [];
      const clears: string[] = [];
      let missingHud = 0;
      let unchanged = 0;

      targets.forEach((wallet) => {
        const currentName = wallet.nickname || '';

        if (mode === 'encode') {
          const hud = hudData?.[wallet.walletAddress];
          if (!hud) {
            missingHud += 1;
            return;
          }
          const nextName = encodeHudName(currentName, hud);
          if (nextName === currentName) {
            unchanged += 1;
            return;
          }
          updates.push({ walletAddress: wallet.walletAddress, nickname: nextName });
          return;
        }

        const stripped = stripHudEncoding(currentName);
        if (stripped === currentName) {
          unchanged += 1;
          return;
        }
        if (!stripped) {
          clears.push(wallet.walletAddress);
          return;
        }
        updates.push({ walletAddress: wallet.walletAddress, nickname: stripped });
      });

      if (updates.length === 0 && clears.length === 0) {
        toast.info('Nothing to update', {
          description: missingHud > 0
            ? `${missingHud} wallet${missingHud === 1 ? '' : 's'} missing HUD data.`
            : 'No changes required for the selected wallets.',
        });
        return;
      }

      // Use PATCH to update nicknames directly (more efficient than import)
      if (updates.length > 0) {
        await Promise.all(
          updates.map(({ walletAddress, nickname }) =>
            fetcher(`/users/me/favorites/${walletAddress}`, {
              method: 'PATCH',
              body: JSON.stringify({ nickname }),
            })
          )
        );
      }

      if (clears.length > 0) {
        await Promise.all(
          clears.map((walletAddress) =>
            fetcher(`/users/me/favorites/${walletAddress}`, {
              method: 'PATCH',
              body: JSON.stringify({ nickname: null }),
            })
          )
        );
      }

      await mutateFavorites();

      const updatedCount = updates.length + clears.length;
      const scopeLabel = selectedWallets.size > 0 ? 'selected' : 'filtered';
      toast.success('Wallet names updated', {
        description: `${updatedCount} ${scopeLabel} wallet${updatedCount === 1 ? '' : 's'} updated${missingHud > 0 ? `, ${missingHud} missing HUD` : ''}${unchanged > 0 ? `, ${unchanged} unchanged` : ''}.`,
      });
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-update', error);
      toast.error(message.title, { description: message.description });
    } finally {
      setIsEncodingNames(false);
    }
  }, [favoriteWallets, resolveActionTargets, hudData, isHudLoading, hudError, hudFetchEnabled, mutateFavorites, selectedWallets.size]);

  // Auto-encode when HUD data finishes loading
  useEffect(() => {
    if (pendingEncodeRef.current && !isHudLoading && hudData && hudTargetWallets.length > 0) {
      const allDataLoaded = hudTargetWallets.every((addr) => hudData[addr]);
      if (allDataLoaded) {
        pendingEncodeRef.current = false;
        // Small delay to ensure state is updated
        setTimeout(() => {
          handleHudNameTransform('encode');
        }, 100);
      }
    }
  }, [isHudLoading, hudData, hudTargetWallets, handleHudNameTransform]);

  const handleImportWallets = useCallback(async (file: File) => {
    setIsImporting(true);
    setShowImportModal(false);

    try {
      const currentCount = favoriteWallets?.length ?? 0;
      if (currentCount >= USER_FAVORITES_MAX) {
        toast.error('Favorites limit reached', {
          description: `You can track up to ${USER_FAVORITES_MAX} wallets.`,
        });
        return;
      }

      const text = await file.text();
      const trimmed = text.trim();
      const errors: string[] = [];

      const defaultCollections = importCollection.trim()
        ? [importCollection.trim()]
        : [];

      const buildImportPayload = (wallets: Array<{ walletAddress: string; nickname?: string; collections?: string[]; metadata?: any }>) => ({
        wallets,
        defaultCollections: defaultCollections.length > 0 ? defaultCollections : undefined,
      });

      const tryParseJson = () => {
        if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) {
          return null;
        }

        try {
          return JSON.parse(trimmed);
        } catch {
          return null;
        }
      };

      const parsedJson = tryParseJson();
      let walletsToImport: Array<{ walletAddress: string; nickname?: string; collections?: string[]; metadata?: any }> = [];

      if (parsedJson) {
        const payload = Array.isArray(parsedJson)
          ? { wallets: parsedJson, defaultCollections: undefined }
          : {
              wallets: parsedJson.wallets || parsedJson.items || parsedJson.data || [],
              defaultCollections: parsedJson.defaultCollections || parsedJson.collections || parsedJson.collection,
            };

        const jsonDefaultCollections = Array.isArray(payload.defaultCollections)
          ? payload.defaultCollections
          : typeof payload.defaultCollections === 'string'
            ? [payload.defaultCollections]
            : [];

        const mergedDefaults = Array.from(new Set([...defaultCollections, ...jsonDefaultCollections]));

        walletsToImport = (payload.wallets || []).map((item: any) => {
          const walletAddress = item.walletAddress || item.trackedWalletAddress || item.address || '';
          const nickname = item.nickname || item.name || '';
          const itemCollections = Array.isArray(item.collections)
            ? item.collections
            : typeof item.collection === 'string'
              ? [item.collection]
              : [];
          const collections = Array.from(new Set([...mergedDefaults, ...itemCollections.filter(Boolean)]));
          const metadata = {
            ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
            ...(item.emoji ? { emoji: item.emoji } : {}),
            ...(typeof item.alertsOn === 'boolean' ? { alertsOn: item.alertsOn } : {}),
          };

          return {
            walletAddress,
            nickname: nickname || undefined,
            collections: collections.length > 0 ? collections : undefined,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          };
        });
      } else {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);

        const dataLines = lines.slice(1);

        if (dataLines.length === 0) {
          toast.error('No wallets found in CSV file');
          return;
        }

        for (let i = 0; i < dataLines.length; i++) {
          const line = dataLines[i];

          const parts: string[] = [];
          let currentField = '';
          let insideQuotes = false;

          for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const nextChar = line[j + 1];

            if (char === '"') {
              if (insideQuotes && nextChar === '"') {
                currentField += '"';
                j++;
              } else {
                insideQuotes = !insideQuotes;
              }
            } else if (char === ',' && !insideQuotes) {
              parts.push(currentField.trim());
              currentField = '';
            } else {
              currentField += char;
            }
          }
          parts.push(currentField.trim());

          if (parts.length < 1) {
            errors.push(`Row ${i + 2}: Invalid format`);
            continue;
          }

          const walletAddress = parts[0];
          const nickname = parts[1] || '';
          const collectionsStr = parts[2] || '';
          const csvCollections = collectionsStr ? collectionsStr.split(';').map(c => c.trim()).filter(c => c) : [];
          const collections = Array.from(new Set([...defaultCollections, ...csvCollections]));

          if (!isValidSolanaAddress(walletAddress)) {
            errors.push(`Row ${i + 2}: Invalid wallet address "${walletAddress}"`);
            continue;
          }

          const isDuplicate = favoriteWallets?.some((w: FavoriteWallet) => w.walletAddress === walletAddress);
          if (isDuplicate) {
            continue;
          }

          walletsToImport.push({
            walletAddress,
            nickname: nickname || undefined,
            collections: collections.length > 0 ? collections : undefined,
          });
        }
      }

      if (favoriteWallets?.length) {
        walletsToImport = walletsToImport.filter(item => {
          return !favoriteWallets.some((w: FavoriteWallet) => w.walletAddress === item.walletAddress);
        });
      }

      const remainingSlots = Math.max(0, USER_FAVORITES_MAX - (favoriteWallets?.length ?? 0));
      if (walletsToImport.length > remainingSlots) {
        walletsToImport = walletsToImport.slice(0, remainingSlots);
      }

      if (walletsToImport.length === 0) {
        if (errors.length > 0) {
          const message = getErrorMessage('trackers-import');
          toast.error(message.title, {
            description: `No valid wallets to import. ${errors.length} errors found.`,
          });
        } else {
          toast.info('All wallets already tracked', {
            description: 'No new wallets to import.',
          });
        }
        return;
      }

      const response = await fetcher('/users/me/favorites/import', {
        method: 'POST',
        body: JSON.stringify(buildImportPayload(walletsToImport)),
      });

      await mutateFavorites();

      const added = response?.added ?? 0;
      const updated = response?.updated ?? 0;
      const skipped = response?.skipped ?? 0;
      const invalidCount = response?.invalidWallets?.length || 0;
      const overLimit = response?.overLimit ?? 0;
      const flashQueued = response?.analysisQueued ?? 0;
      const jobIds = response?.analysisJobIds ?? [];

      // Track import jobs for progress visibility
      if (jobIds.length > 0 && subscribeToJob) {
        setImportJobsInProgress(jobIds);
        jobIds.forEach((jobId: string) => subscribeToJob(jobId));
      }

      toast.success('Wallets imported', {
        description: `${added} added, ${updated} updated, ${skipped} skipped${invalidCount > 0 ? `, ${invalidCount} invalid` : ''}${overLimit > 0 ? `, ${overLimit} over the ${USER_FAVORITES_MAX} cap` : ''}. ${flashQueued} queued for quick flash analysis. Open a wallet to run deep analysis.`,
      });
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-import', error);
      toast.error(message.title, {
        description: message.description,
      });
    } finally {
      setIsImporting(false);
      setImportCollection('');
    }
  }, [favoriteWallets, importCollection, mutateFavorites, subscribeToJob]);

  const handleClearAllWallets = useCallback(async () => {
    setIsClearingAll(true);
    try {
      const response = await fetcher('/users/me/favorites', { method: 'DELETE' });
      clearFilters();
      await mutateFavorites();
      toast.success('Tracked wallets cleared', {
        description: `${response?.removed ?? 0} wallets removed.`,
      });
      setShowClearAllModal(false);
    } catch (error: unknown) {
      const message = getErrorMessage('trackers-clear', error);
      toast.error(message.title, { description: message.description });
    } finally {
      setIsClearingAll(false);
    }
  }, [clearFilters, mutateFavorites]);

  // Batch analyze handlers
  const handleBatchAnalyze = useCallback(async () => {
    if (selectedWallets.size === 0) {
      toast.error('No wallets selected', { description: 'Please select wallets to analyze' });
      return;
    }

    if (selectedWallets.size > 20) {
      toast.error('Too many wallets', { description: 'Maximum 20 wallets per batch' });
      return;
    }

    setIsBatchAnalyzing(true);
    try {
      const response = await fetcher('/users/me/favorites/batch-analyze', {
        method: 'POST',
        body: JSON.stringify({
          walletAddresses: Array.from(selectedWallets),
          scope: batchAnalyzeScope,
        }),
      });

      toast.success(`Analysis queued for ${response.queued} wallets`, {
        description: `Scope: ${batchAnalyzeScope}. Wallets analyzed recently will be skipped automatically.`,
      });

      // Clear selection after successful queue
      setSelectedWallets(new Set());
    } catch (error: unknown) {
      const message = getErrorMessage('batch-analyze', error);
      toast.error(message.title, { description: message.description });
    } finally {
      setIsBatchAnalyzing(false);
    }
  }, [selectedWallets, batchAnalyzeScope]);

  const toggleWalletSelection = useCallback((walletAddress: string) => {
    setSelectedWallets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(walletAddress)) {
        newSet.delete(walletAddress);
      } else {
        newSet.add(walletAddress);
      }
      return newSet;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedWallets.size === filteredWallets.length) {
      setSelectedWallets(new Set());
    } else {
      setSelectedWallets(new Set(filteredWallets.map(w => w.walletAddress)));
    }
  }, [selectedWallets.size, filteredWallets]);

  const clearSelection = useCallback(() => {
    setSelectedWallets(new Set());
  }, []);

  // Stable callbacks for WalletBadge to prevent unnecessary re-renders
  const handleSetDeletingWallet = useCallback((wallet: FavoriteWallet) => {
    setDeletingWallet(wallet);
  }, []);

  const handleSetEditingWallet = useCallback((wallet: FavoriteWallet) => {
    setEditingWallet(wallet);
  }, []);

  const handleImportFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Show modal for collection input
    setShowImportModal(true);
  }, []);

  // Loading state
  if (!favoriteWallets && !error) {
    return (
      <AppShell>
        <div className="w-full px-6 py-4 space-y-4">
          <PageTitle
            title="Tracked Wallets"
            icon={Bookmark}
            titleExtra={<Skeleton className="h-6 w-24" />}
          />

          <div className="flex gap-6">
            <div className="flex-1">
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Added</TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Wallet</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            The wallet address and its primary collection badge.
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-32">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Last Active</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Last observed activity based on analyzed transactions.
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-40 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Balance</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Current SOL balance captured during the last analysis.
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={`tracker-skeleton-${index}`}>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-56" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Skeleton className="h-4 w-20 ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
            <div className="w-80 flex-shrink-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Portfolio Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Error state
  if (error) {
    const message = getErrorMessage('trackers-load', error);
    return (
      <AppShell>
        <div className="w-full px-6 py-12">
          <EmptyState
            variant="error"
            title={message.title}
            description={message.description}
            actionText="Retry"
            onActionClick={() => mutateFavorites()}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TooltipProvider>
        <div className="w-full px-6 py-4 space-y-3">
          {/* Header Row - Title + Filters + Controls (Like Discover) */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <PageTitle
                title="Tracked Wallets"
                icon={Bookmark}
                titleExtra={
                  <div className="flex items-center gap-2">
                    {favoriteWallets && (
                      <Badge variant="outline" className="text-xs">
                        {favoriteWallets.length}/{USER_FAVORITES_MAX}
                      </Badge>
                    )}
                    {importJobsInProgress.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        <span className="text-xs text-blue-500 font-medium">
                          Analyzing {importJobsInProgress.length} wallet{importJobsInProgress.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                }
              />
              {/* Filters - Priority to Active */}
              <div className="flex items-center gap-2">
                {/* Active Filter (24h) - Priority Position with Visual Flair */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn(
                        'cursor-pointer transition-all h-8 px-3 text-sm font-medium',
                        showActiveOnly
                          ? 'bg-green-50 dark:bg-green-950/30 border-green-500 text-green-700 dark:text-green-400 shadow-sm shadow-green-500/20'
                          : 'border-green-300 dark:border-green-800 text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20 hover:border-green-400'
                      )}
                      onClick={() => setShowActiveOnly(!showActiveOnly)}
                    >
                      Active (24h)
                      {showActiveOnly && <X className="ml-1.5 h-3.5 w-3.5" />}
                      <span className="ml-2 opacity-70">({activeWalletCount})</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Show wallets active in the last 24 hours
                  </TooltipContent>
                </Tooltip>

                {/* Collections Dropdown Filter */}
                {allCollections.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 px-2.5 gap-1.5">
                        <Filter className="h-3.5 w-3.5" />
                        Collections
                        {selectedCollections.length > 0 && (
                          <Badge variant="outline" className="h-5 px-1.5 text-xs ml-1 bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400">
                            {selectedCollections.length}
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuLabel>Filter by collection</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {allCollections.map((collection) => {
                        const walletCount = collectionCounts.get(collection) || 0;

                        return (
                          <DropdownMenuCheckboxItem
                            key={collection}
                            checked={selectedCollections.includes(collection)}
                            onCheckedChange={() => toggleCollectionFilter(collection)}
                            className={cn(
                              'border-b border-purple-200 dark:border-purple-800',
                              selectedCollections.includes(collection) && 'font-medium bg-purple-50 dark:bg-purple-950/20'
                            )}
                          >
                            <span className="flex-1">{collection}</span>
                            <span className="text-xs opacity-60 ml-2">({walletCount})</span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Clear Filters Button */}
                  {(selectedCollections.length > 0 || showActiveOnly) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="h-7 text-xs px-2"
                    >
                      Clear
                    </Button>
                  )}
              </div>
            </div>
          </div>

          <div className="flex gap-6">
            {/* Main Content - 3/4 width */}
            <div className="flex-1 space-y-4">
              {/* Search and Action Buttons - Above Table */}
              <div className="flex items-center justify-between gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tracked wallets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9 w-64"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        {isImporting ? 'Importing...' : 'Import'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs space-y-1">
                        <div className="font-semibold">Import wallets from file</div>
                        <div>Accepts: .json, .csv, .txt formats</div>
                        <div className="text-muted-foreground">Auto-queues flash analysis for {USER_FAVORITES_IMPORT_FLASH_BATCH} wallets</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={handleImportFileSelected}
                    className="hidden"
                  />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={handleExportWallets}
                        disabled={!favoriteWallets || favoriteWallets.length === 0}
                      >
                        <Download className="h-4 w-4 mr-1.5" />
                        Export
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export tracked wallets to TXT (JSON format, compatible with import)</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => handleHudNameTransform('encode')}
                        disabled={isEncodingNames || !favoriteWallets || favoriteWallets.length === 0}
                      >
                        {isHudLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            Loading HUD...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-1.5" />
                            {isEncodingNames ? 'Encoding...' : 'Encode HUD'}
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {hudFetchEnabled
                        ? 'Appends HUD metrics to wallet names (uses selected wallets if any, otherwise filtered list).'
                        : 'Click to fetch HUD data and encode wallet names.'
                      }
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => handleHudNameTransform('strip')}
                        disabled={isEncodingNames || !favoriteWallets || favoriteWallets.length === 0}
                      >
                        <Eraser className="h-4 w-4 mr-1.5" />
                        {isEncodingNames ? 'Removing...' : 'Remove HUD'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Removes HUD encoding from wallet names (uses selected wallets if any, otherwise filtered list).
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-9"
                        onClick={() => setShowClearAllModal(true)}
                        disabled={!favoriteWallets || favoriteWallets.length === 0}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                     </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove all tracked wallets</TooltipContent>
                  </Tooltip>
                  <Button
                    size="sm"
                    className="h-9 bg-purple-600 hover:bg-purple-700"
                    onClick={() => setShowAddWalletModal(true)}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Wallet
                  </Button>
                </div>
              </div>

              {/* Batch Actions Toolbar */}
              {selectedWallets.size > 0 && (
                <Card className="mb-4">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">
                          {selectedWallets.size} wallet{selectedWallets.size !== 1 ? 's' : ''} selected
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearSelection}
                        >
                          Clear
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Scope:</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm">
                                {batchAnalyzeScope === 'flash' ? 'Flash (7d)' : batchAnalyzeScope === 'working' ? 'Working (30d)' : 'Deep (All)'}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuLabel>Analysis Scope</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuCheckboxItem
                                checked={batchAnalyzeScope === 'flash'}
                                onCheckedChange={() => setBatchAnalyzeScope('flash')}
                              >
                                Flash (7 days, 250 sigs)
                              </DropdownMenuCheckboxItem>
                              <DropdownMenuCheckboxItem
                                checked={batchAnalyzeScope === 'working'}
                                onCheckedChange={() => setBatchAnalyzeScope('working')}
                              >
                                Working (30 days, 2000 sigs)
                              </DropdownMenuCheckboxItem>
                              <DropdownMenuCheckboxItem
                                checked={batchAnalyzeScope === 'deep'}
                                onCheckedChange={() => setBatchAnalyzeScope('deep')}
                              >
                                Deep (All time, 3000 sigs)
                              </DropdownMenuCheckboxItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <Button
                          onClick={handleBatchAnalyze}
                          disabled={isBatchAnalyzing || selectedWallets.size === 0 || selectedWallets.size > 20}
                          size="sm"
                        >
                          {isBatchAnalyzing ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Queueing...
                            </>
                          ) : (
                            <>
                              <PlayCircle className="mr-2 h-4 w-4" />
                              Analyze Selected
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Wallets Table */}
              <Card>
                <div className="flex items-center justify-between px-4 py-2 border-b">
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedWallets.size === filteredWallets.length && filteredWallets.length > 0}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all wallets"
                        />
                      </TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead className="w-32">Total PnL</TableHead>
                      <TableHead className="w-24">Winrate</TableHead>
                      <TableHead className="w-32">Last Active</TableHead>
                      <TableHead className="w-32 text-right">SOL Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWallets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8">
                          <EmptyState
                            variant="info"
                            title={favoriteWallets.length === 0 ? 'No tracked wallets yet' : 'No wallets match your filters'}
                            description={
                              favoriteWallets.length === 0
                                ? 'Start tracking wallets using the Add Wallet button or import a list.'
                                : 'Try clearing filters or adjust your search.'
                            }
                            actionText={favoriteWallets.length === 0 ? 'Add Wallet' : 'Clear Filters'}
                            onActionClick={favoriteWallets.length === 0 ? () => setShowAddWalletModal(true) : clearFilters}
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredWallets.map((wallet: FavoriteWallet) => (
                        <WalletRow
                          key={wallet.walletAddress}
                          wallet={wallet}
                          isSelected={selectedWallets.has(wallet.walletAddress)}
                          onToggleSelection={toggleWalletSelection}
                          onSetDeleting={handleSetDeletingWallet}
                          onSetEditing={handleSetEditingWallet}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>

            {/* Sidebar - 1/4 width */}
            <div className="w-80 flex-shrink-0 space-y-4">
              {/* Portfolio Stats */}
              {portfolioStats && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Portfolio Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Total Wallets</span>
                      </div>
                      <span className="font-bold">{portfolioStats.totalWallets}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className={`h-4 w-4 ${portfolioStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`} />
                        <span className="text-sm text-muted-foreground">Total P&L</span>
                      </div>
                      <span className={`font-bold ${portfolioStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {portfolioStats.totalPnl >= 0 ? '+' : ''}{portfolioStats.totalPnl.toFixed(2)} SOL
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Total Balance</span>
                      </div>
                      <span className="font-bold font-mono">{portfolioStats.totalBalance.toFixed(2)} SOL</span>
                    </div>

                    <div className="pt-3 border-t">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Analyzed</span>
                        <span className="text-muted-foreground">
                          {portfolioStats.analyzedWallets} / {portfolioStats.totalWallets} ({((portfolioStats.analyzedWallets / portfolioStats.totalWallets) * 100).toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <CollectionAnalytics
                stats={collectionStats}
                activeCollections={selectedCollections}
                onSelectCollection={handleCollectionSelect}
                onClearFilters={clearFilters}
              />

            </div>
          </div>

          {/* Add Wallet Modal */}
          <QuickAddForm
            isOpen={showAddWalletModal}
            onClose={() => setShowAddWalletModal(false)}
            onSave={handleAddWallet}
            title="Add Wallet to Tracked"
          />

          {/* Import Modal */}
          {showImportModal && (
            <AlertDialog open={showImportModal} onOpenChange={setShowImportModal}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Import Wallets</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Collection name <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <Input
                          placeholder="all wallets from the list will be asigned to this collection"
                          value={importCollection}
                          onChange={(e) => setImportCollection(e.target.value)}
                          className="h-10 bg-background/50"
                          autoFocus
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                  
                        {importCollection && (
                          <>
                            <br />• All wallets tagged with <span className="font-semibold text-foreground">&ldquo;{importCollection}&rdquo;</span>
                          </>
                        )}
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => {
                    const file = fileInputRef.current?.files?.[0];
                    if (file) handleImportWallets(file);
                  }}>
                    Import
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {/* Clear All Confirmation */}
          <AlertDialog open={showClearAllModal} onOpenChange={(open) => !open && setShowClearAllModal(false)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove all tracked wallets?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <div>
                      This will permanently remove all tracked wallets, including nicknames and collections.
                    </div>
                    {favoriteWallets?.length ? (
                      <div className="text-sm text-muted-foreground">
                        {favoriteWallets.length} wallet{favoriteWallets.length === 1 ? '' : 's'} will be removed.
                      </div>
                    ) : null}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isClearingAll}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearAllWallets}
                  className="bg-red-600 hover:bg-red-700"
                  disabled={isClearingAll}
                >
                  {isClearingAll ? 'Clearing...' : 'Remove All'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Edit Modal */}
          {editingWallet && (
            <WalletEditForm
              isOpen={true}
              onClose={() => setEditingWallet(null)}
              onSave={(updates) => handleUpdateWallet(editingWallet.walletAddress, updates)}
              initialData={{
                nickname: editingWallet.nickname || '',
                collections: editingWallet.collections || [],
              }}
              title="Edit Wallet"
            />
          )}

          {/* Delete Confirmation */}
          <AlertDialog open={!!deletingWallet} onOpenChange={(open) => !open && setDeletingWallet(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove from Tracked?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <div>
                      Removing <span className="font-medium">{deletingWallet?.nickname || 'this wallet'}</span> from tracked will delete its metadata.
                    </div>

                    {/* Show what will be lost */}
                    {(deletingWallet?.nickname || (deletingWallet?.collections && deletingWallet.collections.length > 0)) && (
                      <div className="p-3 bg-muted/50 border rounded-md">
                        <div className="text-sm font-medium mb-2">This will also remove:</div>
                        <div className="space-y-2">
                          {deletingWallet?.nickname && (
                            <div>
                              <span className="text-xs text-muted-foreground font-medium">Nickname:</span>
                              <div className="mt-0.5">
                                <Badge variant="outline" className="text-xs">{deletingWallet.nickname}</Badge>
                              </div>
                            </div>
                          )}

                          {deletingWallet?.collections && deletingWallet.collections.length > 0 && (
                            <div>
                              <span className="text-xs text-muted-foreground font-medium">Collections ({deletingWallet.collections.length}):</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {deletingWallet.collections.slice(0, 3).map((collection: string) => (
                                  <Badge key={collection} className={`text-xs font-medium ${getCollectionColorFilled(collection)}`}>
                                    {collection}
                                  </Badge>
                                ))}
                                {deletingWallet.collections.length > 3 && (
                                  <Badge variant="secondary" className="text-xs">
                                    +{deletingWallet.collections.length - 3} more
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (deletingWallet) {
                      handleRemoveWallet(deletingWallet.walletAddress);
                      setDeletingWallet(null);
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </AppShell>
  );
}
