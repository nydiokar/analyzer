import { useFavorites } from '@/hooks/useFavorites';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Trash2, Star, Loader2, Info, StarIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const API_BASE_URL = '/api/v1';

interface FavoriteWalletsListProps {
  isCollapsed: boolean;
}

export function FavoriteWalletsList({ isCollapsed }: FavoriteWalletsListProps) {
  const { favorites: favoriteWallets, error, isLoading, mutate: mutateFavorites } = useFavorites();
  const { isInitialized, apiKey: hasApiKey } = useApiKeyStore();

  const handleRemoveFavorite = async (walletAddress: string) => {
    try {
      const deleteUrl = `${API_BASE_URL}/users/me/favorites/${walletAddress}`;
      await fetcher(deleteUrl, {
        method: 'DELETE',
      });
      toast.success(`Wallet ${walletAddress.substring(0, 6)}... removed from favorites.`);
      mutateFavorites(); 
    } catch (err: any) {
      toast.error(`Failed to remove favorite: ${err.message}`);
      mutateFavorites();
    }
  };

  const handleCopyAddress = async (walletAddress: string) => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Address copied to clipboard!");
    } catch (err) {
      toast.error("Failed to copy address.");
      console.error('Failed to copy: ', err);
    }
  };

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
          {isCollapsed ? null : <Star className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />}
          <p className="text-sm text-muted-foreground">No favorite wallets yet.</p>
        </div>
      );
    }

    return (
      <ul className="space-y-0.5">
        {favoriteWallets.map((fav) => (
          <li key={fav.walletAddress} className="px-1 group">
            <div className="flex items-center justify-between py-1.5 px-1 rounded-md hover:bg-muted/60 transition-colors">
              <Link href={`/wallets/${fav.walletAddress}`} className="group flex-grow min-w-0">
                <p className="text-sm font-semibold group-hover:text-primary truncate" title={fav.walletAddress}>
                  {fav.walletAddress.substring(0, 6)}...{fav.walletAddress.substring(fav.walletAddress.length - 6)}
                </p>
                <FavoriteWalletItem walletAddress={fav.walletAddress} />
              </Link>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 ml-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-blue-500 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); handleCopyAddress(fav.walletAddress); }}
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={isCollapsed ? "right" : "top"}><p>Copy address</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 ml-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); handleRemoveFavorite(fav.walletAddress); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={isCollapsed ? "right" : "top"}><p>Remove from favorites</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  if (isCollapsed) {
    if (!hasApiKey || isLoading || error || !favoriteWallets || favoriteWallets.length === 0) {
      return (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="w-full h-10 flex items-center justify-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                  <StarIcon size={20} className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              <p>Show Favorite Wallets</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-64">
            {renderFavoritesContent()}
          </PopoverContent>
        </Popover>
      );
    }
    
    return (
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
            <p>Show Favorite Wallets</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-64 p-2">
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
    );
  }

  return (
    <div className="pt-2">
      <h3 className="text-xs font-semibold tracking-wider uppercase text-gray-500 dark:text-gray-400 mb-2 px-3 flex items-center">
        <StarIcon className="h-4 w-4 mr-2 flex-shrink-0" />
        Favorites
      </h3>
      {renderFavoritesContent()}
    </div>
  );
} 