'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bookmark, Trash2, Star, Loader2, Info, Edit2, Tags, FolderOpen, ChevronDown, ChevronRight, Filter, Plus, TrendingUp, Wallet } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback } from 'react';
import { WalletEditForm } from '@/components/layout/WalletEditForm';
import { toast } from 'sonner';
import Link from 'next/link';
import { FavoriteWallet } from '@/types/api';
import { cn } from '@/lib/utils';
import { getTagColor, getCollectionColor } from '@/lib/color-utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

export default function TrackersPage() {
  const { favorites: favoriteWallets, error, mutate: mutateFavorites } = useFavorites();

  // Filter state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Edit/delete state
  const [editingWallet, setEditingWallet] = useState<FavoriteWallet | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<FavoriteWallet | null>(null);

  // Extract unique tags and collections
  const allTags = useMemo(() => {
    if (!favoriteWallets) return [];
    const tags = new Set<string>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.tags?.forEach((tag: string) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [favoriteWallets]);

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
    const totalWallets = favoriteWallets.length;
    const walletsWithPnl = favoriteWallets.filter((w: FavoriteWallet) => w.pnl !== undefined).length;

    return {
      totalPnl,
      totalWallets,
      walletsWithPnl,
    };
  }, [favoriteWallets]);

  // Filter wallets
  const filteredWallets = useMemo(() => {
    if (!favoriteWallets) return [];
    return favoriteWallets.filter((wallet: FavoriteWallet) => {
      if (selectedTags.length > 0 && !selectedTags.some(tag => wallet.tags?.includes(tag))) {
        return false;
      }
      if (selectedCollections.length > 0 && !wallet.collections?.some(c => selectedCollections.includes(c))) {
        return false;
      }
      return true;
    });
  }, [favoriteWallets, selectedTags, selectedCollections]);

  // Group by collection
  const groupedWallets = useMemo(() => {
    const groups: Record<string, FavoriteWallet[]> = {};
    filteredWallets.forEach((wallet: FavoriteWallet) => {
      const walletCollections = wallet.collections && wallet.collections.length > 0
        ? wallet.collections
        : ['Uncategorized'];

      walletCollections.forEach((collection: string) => {
        if (!groups[collection]) groups[collection] = [];
        groups[collection].push(wallet);
      });
    });
    return groups;
  }, [filteredWallets]);

  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(new Set());

  const toggleCollection = (collection: string) => {
    setCollapsedCollections(prev => {
      const next = new Set(prev);
      if (next.has(collection)) {
        next.delete(collection);
      } else {
        next.add(collection);
      }
      return next;
    });
  };

  const handleDeleteWallet = useCallback(async (walletAddress: string) => {
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

  const handleUpdateWallet = useCallback(async (walletAddress: string, updates: { nickname: string; tags: string[]; collections: string[] }) => {
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

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleCollectionFilter = (collection: string) => {
    setSelectedCollections(prev =>
      prev.includes(collection) ? prev.filter(c => c !== collection) : [...prev, collection]
    );
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setSelectedCollections([]);
  };

  const activeFilterCount = selectedTags.length + selectedCollections.length;

  // Loading state
  if (!favoriteWallets && !error) {
    return (
      <AppShell>
        <div className="container max-w-6xl mx-auto px-6 py-12">
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
        <div className="container max-w-6xl mx-auto px-6 py-12">
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
        <div className="container max-w-6xl mx-auto px-6 py-12">
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
              <Star className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No tracked wallets yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Start tracking wallets by clicking the star icon on any wallet profile page.
              </p>
              <p className="text-xs text-muted-foreground">
                Use the search bar to find and analyze wallets.
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
        <div className="container max-w-7xl mx-auto px-6 py-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-6">
              <Bookmark className="h-8 w-8 text-purple-500" />
              <h1 className="text-4xl font-bold">Tracked Wallets</h1>
            </div>

            {/* Portfolio Stats */}
            {portfolioStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Wallets</p>
                        <p className="text-2xl font-bold">{portfolioStats.totalWallets}</p>
                      </div>
                      <Wallet className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Portfolio P&L</p>
                        <p className={`text-2xl font-bold ${portfolioStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {portfolioStats.totalPnl >= 0 ? '+' : ''}{portfolioStats.totalPnl.toFixed(2)} SOL
                        </p>
                      </div>
                      <TrendingUp className={`h-8 w-8 ${portfolioStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">With P&L Data</p>
                        <p className="text-2xl font-bold">{portfolioStats.walletsWithPnl}</p>
                        <p className="text-xs text-muted-foreground">
                          {((portfolioStats.walletsWithPnl / portfolioStats.totalWallets) * 100).toFixed(0)}% analyzed
                        </p>
                      </div>
                      <Star className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {/* Filter Toggle */}
                <Button
                  variant={activeFilterCount > 0 ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="relative"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {filteredWallets.length} of {favoriteWallets.length} wallets
                </div>
              </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <Card className="p-4 mb-4">
                <div className="space-y-4">
                  {/* Tags Filter */}
                  {allTags.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Tags className="h-4 w-4" />
                          Tags
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => (
                          <Badge
                            key={tag}
                            variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                            className={cn(
                              'cursor-pointer',
                              selectedTags.includes(tag) && getTagColor(tag)
                            )}
                            onClick={() => toggleTag(tag)}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Collections Filter */}
                  {allCollections.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <FolderOpen className="h-4 w-4" />
                          Collections
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {allCollections.map((collection) => (
                          <Badge
                            key={collection}
                            variant={selectedCollections.includes(collection) ? 'default' : 'outline'}
                            className={cn(
                              'cursor-pointer',
                              selectedCollections.includes(collection) && getCollectionColor(collection)
                            )}
                            onClick={() => toggleCollectionFilter(collection)}
                          >
                            {collection}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clear Filters */}
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      Clear all filters
                    </Button>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Wallets List - Grouped by Collection */}
          <div className="space-y-6">
            {Object.entries(groupedWallets).map(([collection, wallets]) => {
              const isCollapsed = collapsedCollections.has(collection);
              return (
                <Card key={collection} className="overflow-hidden">
                  <CardHeader
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => toggleCollection(collection)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isCollapsed ? (
                          <ChevronRight className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                        <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        <CardTitle className="text-xl">{collection}</CardTitle>
                        <Badge variant="secondary">{wallets.length}</Badge>
                      </div>
                    </div>
                  </CardHeader>

                  {!isCollapsed && (
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {wallets.map((wallet: FavoriteWallet) => (
                          <div
                            key={wallet.walletAddress}
                            className="p-4 hover:bg-accent/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-2">
                                  <Link
                                    href={`/wallets/${wallet.walletAddress}`}
                                    className="font-medium text-lg hover:text-primary transition-colors truncate"
                                  >
                                    {wallet.nickname || wallet.walletAddress}
                                  </Link>
                                  {wallet.tags && wallet.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {wallet.tags.map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="outline"
                                          className={cn('text-xs', getTagColor(tag))}
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <code className="text-xs text-muted-foreground block truncate">
                                  {wallet.walletAddress}
                                </code>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setEditingWallet(wallet)}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit wallet</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setDeletingWallet(wallet)}
                                    >
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove wallet</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Edit Modal */}
          {editingWallet && (
            <WalletEditForm
              isOpen={true}
              onClose={() => setEditingWallet(null)}
              onSave={(updates) => handleUpdateWallet(editingWallet.walletAddress, updates)}
              initialData={{
                nickname: editingWallet.nickname || '',
                tags: editingWallet.tags || [],
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
                      handleDeleteWallet(deletingWallet.walletAddress);
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
