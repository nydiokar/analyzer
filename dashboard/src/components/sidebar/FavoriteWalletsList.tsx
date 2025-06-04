import useSWR, { mutate } from 'swr';
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

// Frontend type matching the expected structure from GET /api/v1/users/me/favorites
interface FavoriteWalletDisplayItem {
  walletAddress: string;
  pnl?: number;
  winRate?: number; // Placeholder, actual metric might differ (e.g., flipperScore)
  favoritedAt: string; // ISO date string
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

// Removed userId from props
interface UseFavoriteWalletsProps {
  apiKey?: string;
}

// Removed userId from props and SWR key construction
function useFavoriteWallets({ apiKey }: UseFavoriteWalletsProps) {
  const { data, error, isLoading } = useSWR<FavoriteWalletDisplayItem[]>(
    apiKey ? `${API_BASE_URL}/users/me/favorites` : null, // Path changed to /users/me/favorites
    fetcher,
    { revalidateOnFocus: false }
  );
  return { data, error, isLoading };
}

interface FavoriteWalletsListProps {
  isCollapsed: boolean;
}

export function FavoriteWalletsList({ isCollapsed }: FavoriteWalletsListProps) {
  // Removed userId from environment variables
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;

  // Removed userId from hook call
  const { data: favoriteWallets, error, isLoading } = useFavoriteWallets({ apiKey });

  const handleRemoveFavorite = async (walletAddress: string) => {
    // Removed userId from check
    if (!apiKey) {
      toast.error('API Key is not configured for this action.');
      return;
    }
    try {
      // Path changed to /users/me/favorites
      const deleteUrl = `${API_BASE_URL}/users/me/favorites/${walletAddress}`;
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'X-API-Key': apiKey,
        },
      });
      toast.success(`Wallet ${walletAddress.substring(0, 6)}... removed from favorites.`);
      // Path changed for SWR mutate
      mutate(`${API_BASE_URL}/users/me/favorites`); 
    } catch (err: any) {
      toast.error(`Failed to remove favorite: ${err.message}`);
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

  // Shared logic for rendering the list content (used by both expanded and popover views)
  const renderFavoritesContent = () => {
    if (!apiKey) {
      return (
        <div className="p-4 text-center">
          <Info className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Favorites list requires API Key configuration.</p>
          <p className="text-xs text-muted-foreground mt-1">Please set NEXT_PUBLIC_API_KEY.</p>
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
          <p className="text-sm">Error: {error.message}</p>
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
                <div className="text-xs text-muted-foreground flex space-x-5 mt-0.5">
                  <span>PNL: {typeof fav.pnl === 'number' ? fav.pnl.toFixed(2) : 'N/A'}</span>
                  <span>WinRate: {typeof fav.winRate === 'number' ? fav.winRate.toFixed(2) : 'N/A'}</span> 
                </div>
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
    // Render Popover for collapsed state
    if (!apiKey || isLoading || error || !favoriteWallets || favoriteWallets.length === 0) {
      // For loading/error/empty states when collapsed, show a simple icon.
      // The full message will be inside the popover if they click.
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
    
    // Collapsed view with favorites
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

  // Default expanded view
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