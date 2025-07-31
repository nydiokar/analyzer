import { useFavorites } from '@/hooks/useFavorites';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Trash2, Star, Loader2, Info, Edit2, Tags, FolderOpen, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback, memo, useEffect } from 'react';
import { WalletEditForm } from '../layout/WalletEditForm';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
} from "@/components/ui/tooltip";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useApiKeyStore } from '@/store/api-key-store';
import { FavoriteWallet } from '@/types/api';
import { cn } from '@/lib/utils';
import { getTagColor, getCollectionColor } from '@/lib/color-utils';

interface FavoriteWalletsListProps {
  isCollapsed: boolean;
}



export function FavoriteWalletsList({ isCollapsed }: FavoriteWalletsListProps) {
  const { favorites: favoriteWallets, error, mutate: mutateFavorites } = useFavorites();
  const { isInitialized, apiKey: hasApiKey } = useApiKeyStore();
  
  // Filter state
  const [filterMode, setFilterMode] = useState<'all' | 'tag' | 'collection'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // Edit state
  const [editingWallet, setEditingWallet] = useState<string | null>(null);
  
  // Delete confirmation state
  const [walletToDelete, setWalletToDelete] = useState<FavoriteWallet | null>(null);

  // Portfolio stats
  const portfolioStats = useMemo(() => {
    if (!favoriteWallets?.length) return null;
    
    const totalPnl = favoriteWallets.reduce((sum: number, wallet: FavoriteWallet) => sum + (wallet.pnl || 0), 0);
    const recentWallet = favoriteWallets
      .sort((a: FavoriteWallet, b: FavoriteWallet) => {
        const aTime = a.lastViewedAt ? new Date(a.lastViewedAt).getTime() : new Date(a.createdAt).getTime();
        const bTime = b.lastViewedAt ? new Date(b.lastViewedAt).getTime() : new Date(b.createdAt).getTime();
        return bTime - aTime;
      })[0];
    
    return {
      totalPnl,
      totalWallets: favoriteWallets.length,
      recentWallet
    };
  }, [favoriteWallets]);

  // Pre-computed wallet times to avoid expensive date parsing on every sort
  const walletTimesCache = useMemo(() => {
    if (!favoriteWallets?.length) return new Map();
    
    const cache = new Map<string, number>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      const time = wallet.lastViewedAt ? new Date(wallet.lastViewedAt).getTime() : new Date(wallet.createdAt).getTime();
      cache.set(wallet.walletAddress, time);
    });
    return cache;
  }, [favoriteWallets]);

  // Separate expensive computations to avoid recalculating everything
  const allTags = useMemo(() => {
    if (!favoriteWallets?.length) return [];
    const tagSet = new Set<string>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.tags?.forEach((tag: string) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [favoriteWallets]);

  const allCollections = useMemo(() => {
    if (!favoriteWallets?.length) return [];
    const collectionSet = new Set<string>();
    favoriteWallets.forEach((wallet: FavoriteWallet) => {
      wallet.collections?.forEach((collection: string) => collectionSet.add(collection));
    });
    return Array.from(collectionSet).sort();
  }, [favoriteWallets]);

  // Optimize filtering - only recalculate when filter changes
  const filteredWallets = useMemo(() => {
    if (!favoriteWallets?.length) return [];
    
    let filtered = favoriteWallets;
    
    if (filterMode === 'tag' && selectedTag) {
      filtered = favoriteWallets.filter((wallet: FavoriteWallet) => 
        wallet.tags?.includes(selectedTag)
      );
    } else if (filterMode === 'collection' && selectedCollection) {
      filtered = favoriteWallets.filter((wallet: FavoriteWallet) => 
        wallet.collections?.includes(selectedCollection)
      );
    }

    // Sort using cached times - much faster
    return [...filtered].sort((a, b) => {
      const aTime = walletTimesCache.get(a.walletAddress) || 0;
      const bTime = walletTimesCache.get(b.walletAddress) || 0;
      return bTime - aTime;
    });
  }, [favoriteWallets, filterMode, selectedTag, selectedCollection, walletTimesCache]);

  // Memoized callbacks for performance
  const handleRemoveFavorite = useCallback((walletAddress: string) => {
    const wallet = favoriteWallets?.find((w: FavoriteWallet) => w.walletAddress === walletAddress);
    if (wallet) {
      setWalletToDelete(wallet);
    }
  }, [favoriteWallets]);

  const confirmDeleteWallet = useCallback(async () => {
    if (!walletToDelete) return;
    
    try {
      await fetcher(`/users/me/favorites/${walletToDelete.walletAddress}`, { method: 'DELETE' });
      toast.success("Wallet removed from favorites", {
        description: `${walletToDelete.nickname || 'Wallet'} and all its tags have been removed.`
      });
      mutateFavorites(); 
      setWalletToDelete(null);
    } catch (err: any) {
      toast.error(`Failed to remove: ${err.message}`);
    }
  }, [walletToDelete, mutateFavorites]);

  const handleCopyAddress = useCallback(async (walletAddress: string) => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Address copied!");
    } catch (err) {
      toast.error("Failed to copy address");
    }
  }, []);

  const openEditDialog = useCallback((wallet: FavoriteWallet) => {
    setEditingWallet(wallet.walletAddress);
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditingWallet(null);
  }, []);

  const handleSaveEdit = useCallback(async (formData: { nickname: string; tags: string[]; collections: string[] }) => {
    if (!editingWallet) return;
    
    try {
      await fetcher(`/users/me/favorites/${editingWallet}`, {
        method: 'PUT',
        body: JSON.stringify({
          nickname: formData.nickname.trim() || undefined,
          tags: formData.tags,
          collections: formData.collections,
        }),
      });
      toast.success("Favorite updated!");
      closeEditDialog();
      mutateFavorites();
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    }
  }, [editingWallet, closeEditDialog, mutateFavorites]);

  const selectTagFilter = (tag: string) => {
    if (filterMode === 'tag' && selectedTag === tag) {
      setFilterMode('all');
      setSelectedTag(null);
    } else {
      setFilterMode('tag');
      setSelectedTag(tag);
      setSelectedCollection(null);
    }
  };

  const selectCollectionFilter = (collection: string) => {
    if (filterMode === 'collection' && selectedCollection === collection) {
      setFilterMode('all');
      setSelectedCollection(null);
    } else {
      setFilterMode('collection');
      setSelectedCollection(collection);
      setSelectedTag(null);
    }
  };

  const renderCompactWallet = (wallet: FavoriteWallet, index: number) => {
    const displayName = wallet.nickname || `${wallet.walletAddress.substring(0, 6)}...${wallet.walletAddress.substring(wallet.walletAddress.length - 4)}`;
    const isEven = index % 2 === 0;
    
    // Generate initials for avatar
    const getInitials = (name: string) => {
      if (wallet.nickname) {
        return wallet.nickname.slice(0, 2).toUpperCase();
      }
      return wallet.walletAddress.slice(0, 2).toUpperCase();
    };
    
    return (
              <div 
          key={wallet.walletAddress} 
          className={`group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/70 transition-all duration-200 border ${
            isEven ? 'bg-muted/20' : 'bg-background'
          } hover:border-primary/20`}
        >
        {/* Discreet Number & Avatar */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
            {index + 1}
          </div>
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 text-white text-xs font-medium">
            {getInitials(displayName)}
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <Link href={`/wallets/${wallet.walletAddress}`} className="block group-hover:text-primary transition-colors">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium truncate block">
                  {displayName}
                </span>
                {/* Tags and Collections */}
                {((wallet.tags?.length || 0) > 0 || (wallet.collections?.length || 0) > 0) && (
                  <div className="flex items-center gap-2 text-xs mt-1">
                    {(wallet.tags?.length || 0) > 0 && (
                      <div className="flex items-center gap-1 text-purple-600">
                        <Tags className="h-3 w-3" />
                        <span>{wallet.tags?.length || 0}</span>
                      </div>
                    )}
                    {(wallet.collections?.length || 0) > 0 && (
                      <div className="flex items-center gap-1 text-blue-600">
                        <FolderOpen className="h-3 w-3" />
                        <span>{wallet.collections?.length || 0}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {wallet.pnl && (
                <div className="text-right flex-shrink-0 ml-3">
                  <span className={`text-sm font-semibold ${wallet.pnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {wallet.pnl > 0 ? '+' : ''}{wallet.pnl.toFixed(1)} SOL
                  </span>
                </div>
              )}
            </div>
          </Link>
        </div>
          
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-all duration-200 ml-3 flex-shrink-0">
          {/* Details popout */}
          {((wallet.tags?.length || 0) > 0 || (wallet.collections?.length || 0) > 0) && (
            <Popover>
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950"
                  >
                    <Filter className="h-3 w-3" />
                  </Button>
                    </PopoverTrigger>
                </TooltipTrigger>
                  <TooltipContent><p>Details</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
              <PopoverContent className="w-80 p-3" side="right">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">
                      {wallet.nickname || `${wallet.walletAddress.substring(0, 6)}...${wallet.walletAddress.substring(wallet.walletAddress.length - 4)}`}
                    </span>
                  </div>
                  
                  {wallet.tags && wallet.tags.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-2">
                        <Tags className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Tags</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {wallet.tags?.map((tag: string) => (
                          <Badge 
                            key={tag} 
                            variant="secondary" 
                            className={`text-xs px-2 py-1 border ${getTagColor(tag)}`}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {wallet.collections && wallet.collections.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-2">
                        <FolderOpen className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Collections</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {wallet.collections?.map((collection: string) => (
                          <Badge 
                            key={collection} 
                            className={`text-xs px-2 py-1 ${getCollectionColor(collection)}`}
                          >
                            {collection}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                                     {wallet.pnl && (
                     <div className="flex items-center justify-between text-sm pt-2 border-t">
                       <span className="text-muted-foreground">PnL</span>
                       <span className={`font-mono font-medium ${wallet.pnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                         {wallet.pnl > 0 ? '+' : ''}{wallet.pnl.toFixed(1)} <span className="text-xs opacity-75">SOL</span>
                       </span>
                     </div>
                   )}
                </div>
              </PopoverContent>
            </Popover>
          )}
            
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950"
                    onClick={() => openEditDialog(wallet)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
              <TooltipContent><p>Edit tags</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => handleRemoveFavorite(wallet.walletAddress)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
              <TooltipContent><p>Remove</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
    );
  };

  const renderFilterSection = () => (
    <div className="space-y-2 px-2">
      {/* Filter Mode Buttons */}
      <div className="flex items-center space-x-1 overflow-hidden">
        <Button
          variant={filterMode === 'all' ? 'default' : 'ghost'}
          size="sm"
          className="h-6 px-2 text-xs flex-shrink-0"
          onClick={() => {
            setFilterMode('all');
            setSelectedTag(null);
            setSelectedCollection(null);
          }}
        >
          All ({favoriteWallets?.length || 0})
        </Button>
        
        {allTags.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={filterMode === 'tag' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs flex-shrink-0"
              >
                Tags <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" side="right">
              <div className="space-y-1">
                {allTags.map((tag: string) => (
                  <Button
                    key={tag}
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start h-8 ${selectedTag === tag ? 'bg-muted' : ''}`}
                    onClick={() => selectTagFilter(tag)}
                  >
                    <Badge className={`mr-2 ${getTagColor(tag)}`}>
                  {tag}
                </Badge>
                    ({favoriteWallets?.filter((w: FavoriteWallet) => w.tags?.includes(tag)).length || 0})
                  </Button>
              ))}
            </div>
            </PopoverContent>
          </Popover>
        )}
        
        {allCollections.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={filterMode === 'collection' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs flex-shrink-0"
              >
                Collections <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" side="right">
              <div className="space-y-1">
                {allCollections.map((collection: string) => (
                  <Button
                    key={collection}
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start h-8 ${selectedCollection === collection ? 'bg-muted' : ''}`}
                    onClick={() => selectCollectionFilter(collection)}
                  >
                    <Badge className={`mr-2 ${getCollectionColor(collection)}`}>
                  {collection}
                </Badge>
                    ({favoriteWallets?.filter((w: FavoriteWallet) => w.collections?.includes(collection)).length || 0})
                  </Button>
              ))}
            </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Active Filter Display */}
      {filterMode !== 'all' && (
        <div className="flex items-center space-x-2 text-xs text-muted-foreground">
          <span>Showing:</span>
          {selectedTag && (
            <Badge className={getTagColor(selectedTag)}>
              {selectedTag}
            </Badge>
          )}
          {selectedCollection && (
            <Badge className={getCollectionColor(selectedCollection)}>
              {selectedCollection}
            </Badge>
          )}
        </div>
      )}
      </div>
    );

  const renderFavoritesContent = () => {
    if (!isInitialized) {
      return (
        <div className="p-4 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      );
    }

    if (!hasApiKey) {
      return (
        <div className="p-4 text-center">
          <Info className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Enter an API Key in</p>
          <Link href="/settings" className="text-sm text-blue-500 hover:underline">Settings</Link>
        </div>
      );
    }
  
    if (error) {
      return (
        <div className="p-4 text-center text-red-500">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
          <p className="text-sm">Error: {(error as Error).message}</p>
        </div>
      );
    }
  
    if (!favoriteWallets || favoriteWallets.length === 0) {
      return (
        <div className="p-4 text-center">
          <Star className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No favorite wallets yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Star wallets to organize them here</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {/* Portfolio Stats */}
        {portfolioStats && (
          <div className="px-3 py-2 bg-muted/20 rounded-lg mx-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-muted-foreground">Portfolio</span>
              <span className={`text-sm font-mono font-semibold ${portfolioStats.totalPnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {portfolioStats.totalPnl > 0 ? '+' : ''}{portfolioStats.totalPnl.toFixed(1)} <span className="text-xs opacity-75">SOL</span>
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Recent</span>
              <span className="text-xs truncate max-w-20">
                {portfolioStats.recentWallet?.nickname || 
                 `${portfolioStats.recentWallet?.walletAddress.substring(0, 6)}...`}
              </span>
            </div>
          </div>
        )}

        {/* Filter Section */}
        {renderFilterSection()}

        {/* Wallet List */}
        <div className="space-y-2">
          {filteredWallets.length > 0 ? (
            filteredWallets.map((wallet, index) => renderCompactWallet(wallet, index))
          ) : (
            <div className="text-center p-4 text-sm text-muted-foreground">
              No wallets match the current filter
            </div>
          )}
        </div>
      </div>
    );
  };

  // Get current editing wallet data
  const currentEditingWallet = useMemo(() => {
    return editingWallet ? favoriteWallets?.find((w: FavoriteWallet) => w.walletAddress === editingWallet) : null;
  }, [editingWallet, favoriteWallets]);

  // Render favorites trigger button for sidebar
  const renderFavoritesTrigger = () => {
    if (!favoriteWallets?.length) {
      return (
        <div className="flex items-center justify-between py-2 px-3 text-sm text-muted-foreground">
          <div className="flex items-center">
            <Star className="h-4 w-4 mr-2" />
            {!isCollapsed && <span>No Favorites</span>}
          </div>
        </div>
      );
    }

    const displayCount = favoriteWallets.length;
    const recentWallet = portfolioStats?.recentWallet;

    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
        <div className="flex items-center min-w-0 flex-1">
          <Star className="h-4 w-4 mr-2 text-yellow-500 flex-shrink-0" />
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Favorites ({displayCount})</span>
                {portfolioStats && (
                  <span className={`text-xs font-mono ${portfolioStats.totalPnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {portfolioStats.totalPnl > 0 ? '+' : ''}{portfolioStats.totalPnl.toFixed(1)} <span className="opacity-75">SOL</span>
                  </span>
                )}
              </div>
              {recentWallet && (
                <div className="text-xs text-muted-foreground truncate">
                  Recent: {recentWallet.nickname || `${recentWallet.walletAddress.substring(0, 6)}...`}
                </div>
              )}
            </div>
          )}
        </div>
        {!isCollapsed && <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </div>
    );
  };

  return (
    <>
      {/* Always use popover approach for better UX */}
      <Popover>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <div className="w-full">
                  {renderFavoritesTrigger()}
                </div>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side={isCollapsed ? "right" : "top"} align="center">
              <p>Show Favorites</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent 
          side={isCollapsed ? "right" : "left"} 
          align="start" 
          className="w-96 p-3"
          sideOffset={isCollapsed ? 8 : 12}
        >
          <CardHeader className="px-2 py-2">
            <CardTitle className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">
              Favorites
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-96 overflow-y-auto">
            {renderFavoritesContent()}
          </CardContent>
        </PopoverContent>
      </Popover>
      
      {/* Edit Form */}
      <WalletEditForm
        isOpen={!!editingWallet}
        onClose={closeEditDialog}
        onSave={handleSaveEdit}
        initialData={{
          nickname: currentEditingWallet?.nickname || '',
          tags: currentEditingWallet?.tags || [],
          collections: currentEditingWallet?.collections || [],
        }}
        title="Edit Favorite Wallet"
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!walletToDelete} onOpenChange={(open) => !open && setWalletToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Favorites?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div>
                  Remove <span className="font-medium">{walletToDelete?.nickname || 'this wallet'}</span> from your favorites?
                </div>
                
                {/* Show what will be lost */}
                {(walletToDelete?.nickname || walletToDelete?.tags?.length || walletToDelete?.collections?.length) && (
                  <div className="p-3 bg-muted/50 border rounded-md">
                    <div className="text-sm font-medium mb-2">This will also remove:</div>
                    <div className="space-y-2">
                      {walletToDelete?.nickname && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Nickname:</span>
                          <div className="mt-1">
                            <Badge variant="secondary" className="text-xs">{walletToDelete.nickname}</Badge>
                          </div>
                        </div>
                      )}
                      
                      {walletToDelete?.tags && walletToDelete.tags.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Tags ({walletToDelete.tags.length}):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {walletToDelete.tags.slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className={cn("text-xs", getTagColor(tag))}>
                                {tag}
                              </Badge>
                            ))}
                            {walletToDelete.tags.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{walletToDelete.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {walletToDelete?.collections && walletToDelete.collections.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Collections ({walletToDelete.collections.length}):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {walletToDelete.collections.slice(0, 3).map(collection => (
                              <Badge key={collection} className={cn("text-xs", getCollectionColor(collection))}>
                                {collection}
                              </Badge>
                            ))}
                            {walletToDelete.collections.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{walletToDelete.collections.length - 3} more
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
              onClick={confirmDeleteWallet}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
} 