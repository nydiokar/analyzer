import { useFavorites } from '@/hooks/useFavorites';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Trash2, Star, Loader2, Info, StarIcon, CopyIcon, Edit2, Check, X, Tags, FolderOpen, Plus, ChevronDown, ChevronRight, Filter, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useState, useMemo, useCallback, memo, useEffect } from 'react';
import { debounce } from 'lodash';
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
import FavoriteWalletItem from './FavoriteWalletItem';
import { FavoriteWallet } from '@/types/api';
import { cn } from '@/lib/utils';
import { getTagColor, getCollectionColor } from '@/lib/color-utils';

interface FavoriteWalletsListProps {
  isCollapsed: boolean;
}



export function FavoriteWalletsList({ isCollapsed }: FavoriteWalletsListProps) {
  const { favorites: favoriteWallets, error, isLoading, mutate: mutateFavorites } = useFavorites();
  const { isInitialized, apiKey: hasApiKey } = useApiKeyStore();
  
  // Filter state
  const [filterMode, setFilterMode] = useState<'all' | 'tag' | 'collection'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // Edit state
  const [editingWallet, setEditingWallet] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    nickname: '',
    tags: [] as string[],
    collections: [] as string[],
    newTag: '',
    newCollection: ''
  });
  
  // Debounced input handlers for performance (similar to WalletSearch)
  const debouncedSetNickname = useCallback(debounce((nickname: string) => {
    setEditForm(prev => ({ ...prev, nickname }));
  }, 200), []);
  
  const debouncedSetNewTag = useCallback(debounce((newTag: string) => {
    setEditForm(prev => ({ ...prev, newTag }));
  }, 200), []);
  
  const debouncedSetNewCollection = useCallback(debounce((newCollection: string) => {
    setEditForm(prev => ({ ...prev, newCollection }));
  }, 200), []);
  
  // Cleanup debounced functions
  useEffect(() => {
    return () => {
      debouncedSetNickname.cancel();
      debouncedSetNewTag.cancel();
      debouncedSetNewCollection.cancel();
    };
  }, [debouncedSetNickname, debouncedSetNewTag, debouncedSetNewCollection]);
  
  // Delete confirmation state
  const [walletToDelete, setWalletToDelete] = useState<FavoriteWallet | null>(null);

  // Portfolio stats
  const portfolioStats = useMemo(() => {
    if (!favoriteWallets?.length) return null;
    
    const totalPnl = favoriteWallets.reduce((sum, wallet) => sum + (wallet.pnl || 0), 0);
    const recentWallet = favoriteWallets
      .sort((a, b) => {
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
    favoriteWallets.forEach(wallet => {
      const time = wallet.lastViewedAt ? new Date(wallet.lastViewedAt).getTime() : new Date(wallet.createdAt).getTime();
      cache.set(wallet.walletAddress, time);
    });
    return cache;
  }, [favoriteWallets]);

  // Organize data for filters - optimized version
  const organizedData = useMemo(() => {
    if (!favoriteWallets?.length) return { tags: [], collections: [], filteredWallets: [] };
    
    // Get unique tags and collections
    const tagSet = new Set<string>();
    const collectionSet = new Set<string>();
    
    favoriteWallets.forEach(wallet => {
      wallet.tags?.forEach(tag => tagSet.add(tag));
      wallet.collections?.forEach(collection => collectionSet.add(collection));
    });

    // Filter wallets based on current selection
    let filteredWallets = favoriteWallets;
    
    if (filterMode === 'tag' && selectedTag) {
      filteredWallets = favoriteWallets.filter(wallet => 
        wallet.tags?.includes(selectedTag)
      );
    } else if (filterMode === 'collection' && selectedCollection) {
      filteredWallets = favoriteWallets.filter(wallet => 
        wallet.collections?.includes(selectedCollection)
      );
    }

    // Sort using cached times - much faster
    filteredWallets = [...filteredWallets].sort((a, b) => {
      const aTime = walletTimesCache.get(a.walletAddress) || 0;
      const bTime = walletTimesCache.get(b.walletAddress) || 0;
      return bTime - aTime;
    });

    return {
      tags: Array.from(tagSet).sort(),
      collections: Array.from(collectionSet).sort(),
      filteredWallets
    };
  }, [favoriteWallets, filterMode, selectedTag, selectedCollection, walletTimesCache]);

  // Memoized callbacks for performance
  const handleRemoveFavorite = useCallback((walletAddress: string) => {
    const wallet = favoriteWallets?.find(w => w.walletAddress === walletAddress);
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

  const openEditDialog = (wallet: FavoriteWallet) => {
    setEditForm({
      nickname: wallet.nickname || '',
      tags: wallet.tags || [],
      collections: wallet.collections || [],
      newTag: '',
      newCollection: ''
    });
    setEditingWallet(wallet.walletAddress);
  };

  const closeEditDialog = () => {
    setEditingWallet(null);
    setEditForm({ nickname: '', tags: [], collections: [], newTag: '', newCollection: '' });
  };

  const handleSaveEdit = async () => {
    if (!editingWallet) return;
    
    try {
      await fetcher(`/users/me/favorites/${editingWallet}`, {
        method: 'PUT',
        body: JSON.stringify({
          nickname: editForm.nickname.trim() || undefined,
          tags: editForm.tags,
          collections: editForm.collections,
        }),
      });
      toast.success("Favorite updated!");
      closeEditDialog();
      mutateFavorites();
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    }
  };

  const addTag = () => {
    if (editForm.newTag.trim() && !editForm.tags.includes(editForm.newTag.trim())) {
      setEditForm(prev => ({
        ...prev,
        tags: [...prev.tags, prev.newTag.trim()],
        newTag: ''
      }));
    }
  };

  const removeTag = (tagToRemove: string) => {
    setEditForm(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const addCollection = () => {
    if (editForm.newCollection.trim() && !editForm.collections.includes(editForm.newCollection.trim())) {
      setEditForm(prev => ({
        ...prev,
        collections: [...prev.collections, prev.newCollection.trim()],
        newCollection: ''
      }));
    }
  };

  const removeCollection = (collectionToRemove: string) => {
    setEditForm(prev => ({
      ...prev,
      collections: prev.collections.filter(collection => collection !== collectionToRemove)
    }));
  };

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

  const renderCompactWallet = (wallet: FavoriteWallet) => {
    const displayName = wallet.nickname || `${wallet.walletAddress.substring(0, 6)}...${wallet.walletAddress.substring(wallet.walletAddress.length - 4)}`;
    
    return (
      <div key={wallet.walletAddress} className="group flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 transition-colors">
        <div className="flex-1 min-w-0">
          <Link href={`/wallets/${wallet.walletAddress}`} className="block">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium truncate hover:text-primary">
                {displayName}
              </span>
              {wallet.pnl && (
                <span className={`text-xs font-mono ${wallet.pnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {wallet.pnl > 0 ? '+' : ''}{wallet.pnl.toFixed(1)} <span className="text-xs opacity-75">SOL</span>
                </span>
              )}
            </div>
            
            {/* Tags and Collections */}
            {((wallet.tags?.length || 0) > 0 || (wallet.collections?.length || 0) > 0) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {(wallet.tags?.length || 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <Tags className="h-3 w-3" />
                    <span>{wallet.tags?.length || 0}</span>
                  </div>
                )}
                {(wallet.collections?.length || 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    <span>{wallet.collections?.length || 0}</span>
                  </div>
                )}
              </div>
            )}
          </Link>
          </div>
          
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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
                        className="h-6 w-6 text-muted-foreground hover:text-purple-500"
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
                        {wallet.tags?.map(tag => (
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
                        {wallet.collections?.map(collection => (
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
                  className="h-6 w-6 text-muted-foreground hover:text-blue-500"
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
                  className="h-6 w-6 text-muted-foreground hover:text-red-500"
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
        
        {organizedData.tags.length > 0 && (
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
                {organizedData.tags.map(tag => (
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
                    ({favoriteWallets?.filter(w => w.tags?.includes(tag)).length || 0})
                  </Button>
              ))}
            </div>
            </PopoverContent>
          </Popover>
        )}
        
        {organizedData.collections.length > 0 && (
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
                {organizedData.collections.map(collection => (
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
                    ({favoriteWallets?.filter(w => w.collections?.includes(collection)).length || 0})
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
    
    if (isLoading) {
      return (
        <div className="p-4 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading favorites...</p>
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
        <div className="space-y-1">
          {organizedData.filteredWallets.length > 0 ? (
            organizedData.filteredWallets.map(wallet => renderCompactWallet(wallet))
          ) : (
            <div className="text-center p-4 text-sm text-muted-foreground">
              No wallets match the current filter
            </div>
          )}
        </div>
      </div>
    );
  };

  // Edit Dialog
  const editDialog = (
    <Dialog open={!!editingWallet} onOpenChange={(open) => !open && closeEditDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Favorite Wallet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Nickname */}
          <div>
            <label className="text-sm font-medium">Nickname</label>
            <Input
              value={editForm.nickname}
                              onChange={(e) => debouncedSetNickname(e.target.value)}
              placeholder="Enter nickname"
              className="mt-1"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <div className="mt-1 space-y-2">
              <div className="flex flex-wrap gap-1">
                {editForm.tags.map(tag => (
                  <Badge key={tag} className={`${getTagColor(tag)} group`}>
                    {tag}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 text-current hover:text-red-600"
                      onClick={() => removeTag(tag)}
                    >
                      <X className="h-2 w-2" />
                    </Button>
                  </Badge>
                ))}
              </div>
              <div className="flex space-x-1">
                <Input
                  value={editForm.newTag}
                  onChange={(e) => debouncedSetNewTag(e.target.value)}
                  placeholder="Add tag"
                  className="text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                />
                <Button size="sm" onClick={addTag}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Collections */}
          <div>
            <label className="text-sm font-medium">Collections</label>
            <div className="mt-1 space-y-2">
              <div className="flex flex-wrap gap-1">
                {editForm.collections.map(collection => (
                  <Badge key={collection} className={`${getCollectionColor(collection)} group`}>
                    {collection}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 text-current hover:text-red-600"
                      onClick={() => removeCollection(collection)}
                    >
                      <X className="h-2 w-2" />
                    </Button>
                  </Badge>
                ))}
              </div>
              <div className="flex space-x-1">
                <Input
                  value={editForm.newCollection}
                  onChange={(e) => debouncedSetNewCollection(e.target.value)}
                  placeholder="Add collection"
                  className="text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && addCollection()}
                />
                <Button size="sm" onClick={addCollection}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={closeEditDialog}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isCollapsed) {
      return (
      <>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="w-full h-10 flex items-center justify-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                  <StarIcon size={20} />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              <p>Show Favorites</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-80 p-2">
          <CardHeader className="px-2 py-2">
             <CardTitle className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">
                Favorites
             </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {renderFavoritesContent()}
          </CardContent>
        </PopoverContent>
      </Popover>
        {editDialog}
        
        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!walletToDelete} onOpenChange={(open) => !open && setWalletToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Remove Wallet from Favorites?
              </AlertDialogTitle>
              <AlertDialogDescription>
                <div className="space-y-3">
                  <p>
                    You're about to remove <span className="font-medium">{walletToDelete?.nickname || 'this wallet'}</span> from your favorites.
                  </p>
                  
                  {/* Show what will be lost */}
                  {(walletToDelete?.tags?.length || walletToDelete?.collections?.length) && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                      <p className="text-sm font-medium text-amber-800 mb-2">⚠️ This will permanently delete:</p>
                      <div className="space-y-2">
                        {walletToDelete?.tags && walletToDelete.tags.length > 0 && (
                          <div>
                            <span className="text-xs text-amber-700 font-medium">Tags ({walletToDelete.tags.length}):</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {walletToDelete.tags.slice(0, 3).map(tag => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                              {walletToDelete.tags.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{walletToDelete.tags.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {walletToDelete?.collections && walletToDelete.collections.length > 0 && (
                          <div>
                            <span className="text-xs text-amber-700 font-medium">Collections ({walletToDelete.collections.length}):</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {walletToDelete.collections.slice(0, 3).map(collection => (
                                <Badge key={collection} variant="outline" className="text-xs">
                                  {collection}
                                </Badge>
                              ))}
                              {walletToDelete.collections.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{walletToDelete.collections.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <p className="text-sm text-muted-foreground">
                    This action cannot be undone. You'll need to re-add the wallet and recreate all tags if you want to favorite it again.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDeleteWallet}
                className="bg-red-600 hover:bg-red-700"
              >
                Yes, Remove Wallet
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
    <Card className="mb-2">
      <CardHeader className="px-4 py-3 pb-2">
        <CardTitle className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">
          Favorites
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {renderFavoritesContent()}
      </CardContent>
    </Card>
      {editDialog}
      
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