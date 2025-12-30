'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Bookmark, Wallet, TrendingUp, X, Search, Plus, Upload, Download, Filter } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback, useRef } from 'react';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { WalletEditForm } from '@/components/layout/WalletEditForm';
import QuickAddForm from '@/components/layout/QuickAddForm';
import { toast } from 'sonner';
import { FavoriteWallet } from '@/types/api';
import { cn } from '@/lib/utils';
import { getCollectionColorFilled } from '@/lib/color-utils';
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/error-messages';
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

export default function TrackersPage() {
  const { favorites: favoriteWallets, error, mutate: mutateFavorites } = useFavorites();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter and search state
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Edit/delete/add state
  const [editingWallet, setEditingWallet] = useState<FavoriteWallet | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<FavoriteWallet | null>(null);
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

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
    const stats = new Map<string, { walletCount: number; totalPnl: number; totalBalance: number }>();

    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.collections?.forEach((collection: string) => {
        const existing = stats.get(collection) || { walletCount: 0, totalPnl: 0, totalBalance: 0 };
        stats.set(collection, {
          walletCount: existing.walletCount + 1,
          totalPnl: existing.totalPnl + (wallet.pnl || 0),
          totalBalance: existing.totalBalance + (wallet.currentSolBalance || 0),
        });
      });
    });

    return Array.from(stats.entries())
      .map(([collection, data]) => ({
        collection,
        ...data,
        avgPnl: data.walletCount > 0 ? data.totalPnl / data.walletCount : 0,
        avgBalance: data.walletCount > 0 ? data.totalBalance / data.walletCount : 0,
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
  }, [mutateFavorites]);

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

  const handleExportWallets = useCallback(() => {
    if (!favoriteWallets || favoriteWallets.length === 0) {
      toast.error('No wallets to export');
      return;
    }

    // Prepare CSV data
    const csvHeader = 'walletAddress,nickname,collections\n';
    const csvRows = favoriteWallets.map((wallet: FavoriteWallet) => {
      const address = wallet.walletAddress;
      const nickname = wallet.nickname || '';
      const collections = (wallet.collections || []).join(';');
      // Escape fields that contain commas or quotes
      const escapedNickname = nickname.includes(',') || nickname.includes('"') ? `"${nickname.replace(/"/g, '""')}"` : nickname;
      return `${address},${escapedNickname},${collections}`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tracked-wallets-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Wallets exported', {
      description: `${favoriteWallets.length} wallets exported to CSV.`,
    });
  }, [favoriteWallets]);

  const handleImportWallets = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setIsImporting(true);

    try {
      const text = await file.text();
      const lines = text.split('\n').map(line => line.trim()).filter(line => line);

      // Skip header
      const dataLines = lines.slice(1);

      if (dataLines.length === 0) {
        toast.error('No wallets found in CSV file');
        return;
      }

      // Parse CSV rows
      const walletsToImport: { walletAddress: string; nickname: string; collections: string[] }[] = [];
      const errors: string[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i];
        // Simple CSV parsing (handles basic cases)
        const parts = line.split(',');

        if (parts.length < 1) {
          errors.push(`Row ${i + 2}: Invalid format`);
          continue;
        }

        const walletAddress = parts[0].trim();
        const nickname = parts[1]?.trim().replace(/^"|"$/g, '') || ''; // Remove quotes if present
        const collectionsStr = parts.slice(2).join(',').trim(); // Handle collections that might have commas
        const collections = collectionsStr ? collectionsStr.split(';').map(c => c.trim()).filter(c => c) : [];

        // Validate wallet address
        if (!isValidSolanaAddress(walletAddress)) {
          errors.push(`Row ${i + 2}: Invalid wallet address "${walletAddress}"`);
          continue;
        }

        // Check for duplicates in current tracked wallets
        const isDuplicate = favoriteWallets?.some((w: FavoriteWallet) => w.walletAddress === walletAddress);
        if (isDuplicate) {
          continue; // Skip duplicates silently
        }

        walletsToImport.push({ walletAddress, nickname, collections });
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

      // Batch import wallets
      let successCount = 0;
      let failCount = 0;

      for (const wallet of walletsToImport) {
        try {
          await fetcher('/users/me/favorites', {
            method: 'POST',
            body: JSON.stringify(wallet),
          });
          successCount++;
        } catch (error: unknown) {
          failCount++;
          errors.push(`Failed to add ${wallet.walletAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Refresh favorites list
      await mutateFavorites();

      // Show result toast
      if (successCount > 0) {
        toast.success('Wallets imported', {
          description: `${successCount} wallets imported successfully${failCount > 0 ? `, ${failCount} failed` : ''}.`,
        });
      } else {
        const message = getErrorMessage('trackers-import');
        toast.error(message.title, {
          description: `Failed to import wallets. ${errors.length} errors found.`,
        });
      }

    } catch (error: unknown) {
      const message = getErrorMessage('trackers-import', error);
      toast.error(message.title, {
        description: message.description,
      });
    } finally {
      setIsImporting(false);
    }
  }, [favoriteWallets, mutateFavorites]);

  // Loading state
  if (!favoriteWallets && !error) {
    return (
      <AppShell>
        <div className="w-full px-6 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <Bookmark className="h-6 w-6 text-purple-500" />
            <h1 className="text-2xl font-bold">Tracked Wallets</h1>
            <Skeleton className="h-6 w-24" />
          </div>

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

  // Empty state
  if (favoriteWallets.length === 0) {
    return (
      <AppShell>
        <div className="w-full px-6 py-12">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <Bookmark className="h-8 w-8 text-purple-500" />
              <h1 className="text-4xl font-bold">Tracked Wallets</h1>
            </div>
            <p className="text-lg text-muted-foreground">
              Track your favorite Solana wallets and monitor their performance.
            </p>
          </div>

          <Card className="p-12 rounded-xl border-dashed text-center">
            <div className="max-w-md mx-auto">
              <Bookmark className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No tracked wallets yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Start tracking wallets by clicking the star icon on any wallet profile page or in the Discover section.
              </p>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TooltipProvider>
        <div className="w-full px-6 py-4 space-y-3">
          {/* Header Row - Title + Filters + Controls (Like Discover) */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Bookmark className="h-6 w-6 text-purple-500" />
              <h1 className="text-2xl font-bold">Tracked Wallets</h1>

              {/* Filters - Priority to Active */}
              <div className="flex items-center gap-2 ml-4">
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

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tracked wallets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 w-64"
                />
              </div>

              {/* Action Buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import wallets from CSV</TooltipContent>
              </Tooltip>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportWallets}
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
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export tracked wallets to CSV</TooltipContent>
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

          <div className="flex gap-6">
            {/* Main Content - 3/4 width */}
            <div className="flex-1">
              {/* Wallets Table */}
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Added</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            The time this wallet was added to tracked wallets
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead className="w-32">Last Active</TableHead>
                      <TableHead className="w-40 text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWallets.map((wallet: FavoriteWallet) => (
                      <TableRow key={wallet.walletAddress} className="hover:bg-accent/30">
                        <TableCell className="font-medium text-muted-foreground text-sm">
                          {timeAgo(wallet.favoritedAt)} ago
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
                              onFavoriteToggle={() => setDeletingWallet(wallet)}
                              onEdit={() => setEditingWallet(wallet)}
                              favoriteData={wallet}
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
                    ))}
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
