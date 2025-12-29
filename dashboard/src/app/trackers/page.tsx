'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Bookmark, Loader2, Info, FolderOpen, Wallet, TrendingUp, X, Search, Plus, Upload, Download } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback } from 'react';
import { WalletEditForm } from '@/components/layout/WalletEditForm';
import { toast } from 'sonner';
import { FavoriteWallet } from '@/types/api';
import { cn } from '@/lib/utils';
import { getCollectionColor } from '@/lib/color-utils';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WalletBadge } from '@/components/shared/WalletBadge';

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

  // Filter and search state
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit/delete state
  const [editingWallet, setEditingWallet] = useState<FavoriteWallet | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<FavoriteWallet | null>(null);

  // Extract unique collections
  const allCollections = useMemo(() => {
    if (!favoriteWallets) return [];
    const collections = new Set<string>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.collections?.forEach((c: string) => collections.add(c));
    });
    return Array.from(collections).sort();
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

  // Filter and search wallets
  const filteredWallets = useMemo(() => {
    if (!favoriteWallets) return [];

    let filtered = favoriteWallets;

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
  }, [favoriteWallets, selectedCollections, searchQuery]);

  const handleRemoveWallet = useCallback(async (walletAddress: string) => {
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'DELETE',
      });
      toast.success('Wallet removed from tracked list');
      mutateFavorites();
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove wallet');
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
    } catch (error: any) {
      toast.error(error.message || 'Failed to update wallet');
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
  };

  // Loading state
  if (!favoriteWallets && !error) {
    return (
      <AppShell>
        <div className="w-full px-6 py-12">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </AppShell>
    );
  }

  // Error state
  if (error) {
    return (
      <AppShell>
        <div className="w-full px-6 py-12">
          <Card className="p-12 rounded-xl border-dashed text-center">
            <div className="max-w-md mx-auto">
              <Info className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Failed to load tracked wallets</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {error.message || 'An error occurred while fetching your tracked wallets.'}
              </p>
              <Button onClick={() => mutateFavorites()}>
                Retry
              </Button>
            </div>
          </Card>
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
          {/* Header Row - Title + Controls on Same Line (Like Discover) */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Bookmark className="h-6 w-6 text-purple-500" />
              <h1 className="text-2xl font-bold">Tracked Wallets</h1>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search wallets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 w-64"
                />
              </div>

              {/* Action Buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import wallets (coming soon)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export wallets (coming soon)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="h-9 bg-purple-600 hover:bg-purple-700">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Wallet
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add wallet by address (coming soon)</TooltipContent>
              </Tooltip>
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
                              onFavoriteToggle={() => handleRemoveWallet(wallet.walletAddress)}
                              onEdit={() => setEditingWallet(wallet)}
                              favoriteData={wallet}
                            />
                            {wallet.collections && wallet.collections.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className={cn('text-xs', getCollectionColor(wallet.collections[0]))}
                                  >
                                    {wallet.collections[0]}
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

              {/* Filters */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Filters</CardTitle>
                    {(selectedCollections.length > 0 || searchQuery) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        className="h-7 text-xs"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Collections Filter */}
                  {allCollections.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <label className="text-sm font-medium">Collections</label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {allCollections.map((collection) => (
                          <Badge
                            key={collection}
                            variant={selectedCollections.includes(collection) ? 'default' : 'outline'}
                            className={cn(
                              'cursor-pointer transition-all',
                              selectedCollections.includes(collection) && getCollectionColor(collection)
                            )}
                            onClick={() => toggleCollectionFilter(collection)}
                          >
                            {collection}
                            {selectedCollections.includes(collection) && (
                              <X className="ml-1 h-3 w-3" />
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {allCollections.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No collections yet. Add collections when editing wallets.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

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
                <AlertDialogTitle>Remove tracked wallet?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to remove{' '}
                  <span className="font-medium">{deletingWallet?.nickname || deletingWallet?.walletAddress}</span>{' '}
                  from your tracked wallets? This action cannot be undone.
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
