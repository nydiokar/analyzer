"use client";

import React, { useState, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import TimeRangeSelector from '@/components/shared/TimeRangeSelector';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  CopyIcon, 
  WalletIcon, 
  ChevronUp, 
  ChevronDown, 
  LayoutDashboard, // Overview
  ListChecks,      // Token Performance (could also be BarChartHorizontal or similar)
  Calculator,      // Account Stats & PNL
  Users,           // Behavioral Patterns (could also be Zap or ActivitySquare)
  FileText,        // Notes
  RefreshCw,     // Added for the refresh button
  Star           // Added Star icon for favorites
} from 'lucide-react' 
import { useToast } from "@/hooks/use-toast"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTimeRangeStore } from '@/store/time-range-store';
import { isValid, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import ReviewerLogTab from '@/components/dashboard/ReviewerLogTab';

// Basic fetcher function - can be co-located or imported if it's shared
const fetcher = async (url: string, options?: RequestInit) => {
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  let baseHeaders: HeadersInit = {};
  if (apiKey) baseHeaders['X-API-Key'] = apiKey;
  const mergedHeaders = { ...baseHeaders, ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers: mergedHeaders });
  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(errorPayload.message || 'An error occurred') as any;
    error.status = res.status;
    error.payload = errorPayload;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
};

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

const truncateWalletAddress = (address: string, startChars = 6, endChars = 4): string => {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
};

export default function WalletProfileLayout({
  children,
  walletAddress,
}: WalletProfileLayoutProps) {
  const { toast } = useToast();
  const { mutate, cache } = useSWRConfig();
  const { startDate, endDate } = useTimeRangeStore();
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<Date | null>(null);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState<boolean>(false);

  const apiKey = process.env.NEXT_PUBLIC_API_KEY; // To check if favorites can be used
  const favoritesSWRKey = apiKey ? `/api/v1/users/me/favorites` : null;
  const { data: favoritesData, error: favoritesError, mutate: mutateFavorites } = useSWR<Array<{walletAddress: string}>>(
    favoritesSWRKey,
    fetcher,
    { revalidateOnFocus: false } // No need to revalidate on focus for this usually
  );

  const isCurrentWalletFavorite = React.useMemo(() => {
    return !!favoritesData?.find(fav => fav.walletAddress === walletAddress);
  }, [favoritesData, walletAddress]);

  // SWR hook to fetch wallet summary data
  const walletSummaryKey = walletAddress ? `/api/v1/wallets/${walletAddress}/summary` : null;
  const { data: walletSummary, error: summaryError, isLoading: isLoadingWalletSummary } = useSWR<{ lastAnalyzedAt?: string | null, [key: string]: any }>(
    walletSummaryKey,
    fetcher,
    {
      revalidateOnFocus: false, // Optional: prevent re-fetch on window focus for this piece of data
    }
  );

  // Effect to initialize analysis status from fetched summary
  useEffect(() => {
    if (walletSummary && typeof walletSummary.lastAnalyzedAt === 'string') {
      const analysisDate = new Date(walletSummary.lastAnalyzedAt);
      if (isValid(analysisDate)) {
        setLastAnalysisTimestamp(analysisDate);
        const now = new Date();
        // Consider analysis fresh if within the last 24 hours
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        if (analysisDate > twentyFourHoursAgo) {
          setLastAnalysisStatus('success'); // Fresh
        } else {
          setLastAnalysisStatus('idle');    // Stale (was successful, but old)
        }
      } else { // Invalid date string from backend
        setLastAnalysisTimestamp(null);
        setLastAnalysisStatus('idle'); // Treat as never analyzed or unknown
      }
    } else if (walletSummary && !walletSummary.lastAnalyzedAt) { // Explicitly null or undefined means never analyzed
      setLastAnalysisTimestamp(null);
      setLastAnalysisStatus('idle'); // Means "never analyzed"
    }
    // If summaryError, we don't automatically set analysis status to 'error'
    // as this effect is for initial load. `handleTriggerAnalysis` handles specific analysis errors.
  }, [walletSummary]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(walletAddress)
      .then(() => {
        toast({
          title: "Copied!",
          description: "Wallet address copied to clipboard.",
          duration: 2000,
        });
      })
      .catch(err => {
        toast({
          title: "Failed to copy",
          description: "Could not copy address to clipboard.",
          variant: "destructive",
          duration: 2000,
        });
        console.error('Failed to copy: ', err);
      });
  };

  const handleTriggerAnalysis = async () => {
    if (!walletAddress) {
      toast({
        title: "Wallet Address Missing",
        description: "Cannot trigger analysis without a wallet address.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    toast({
      title: "Analysis Queued",
      description: `Fetching and analyzing data for ${truncateWalletAddress(walletAddress)}. This may take a few moments.`,
    });

    try {
      await fetcher(`/api/v1/analyses/wallets/${walletAddress}/trigger-analysis`, {
        method: 'POST',
      });
      
      toast({
        title: "Analysis In Progress",
        description: `Data for ${truncateWalletAddress(walletAddress)} is being refreshed. UI will update shortly.`,
      });

      if (cache instanceof Map) {
        for (const key of cache.keys()) {
          if (typeof key === 'string' && key.startsWith(`/api/v1/wallets/${walletAddress}`)) {
            mutate(key);
          }
        }
      } else {
        if (walletSummaryKey) mutate(walletSummaryKey);
      }

    } catch (err: any) {
      console.error("Error triggering analysis:", err);
      setLastAnalysisStatus('error');
      toast({
        title: "Analysis Failed to Trigger",
        description: err.message || "An unexpected error occurred. Please check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!walletAddress || !apiKey || !favoritesSWRKey) {
      toast({
        title: "Cannot update favorites",
        description: "API Key not available, no wallet selected, or favorites not loaded.",
        variant: "destructive",
      });
      return;
    }

    setIsTogglingFavorite(true);
    const currentIsFavorite = isCurrentWalletFavorite;
    const method = currentIsFavorite ? 'DELETE' : 'POST';
    const url = currentIsFavorite
      ? `/api/v1/users/me/favorites/${walletAddress}`
      : `/api/v1/users/me/favorites`;

    const body = currentIsFavorite ? undefined : JSON.stringify({ walletAddress });
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    // Optimistic UI update
    const previousFavorites = favoritesData ? [...favoritesData] : [];
    let newOptimisticFavorites: Array<{ walletAddress: string }>;

    if (currentIsFavorite) {
      // Optimistically remove
      newOptimisticFavorites = previousFavorites.filter(fav => fav.walletAddress !== walletAddress);
    } else {
      // Optimistically add
      newOptimisticFavorites = [...previousFavorites, { walletAddress }];
    }

    // Update local SWR cache immediately with optimistic data
    // and prevent revalidation for this immediate mutation
    mutateFavorites(newOptimisticFavorites, false);

    try {
      await fetcher(url, {
        method,
        body,
        headers,
      });
      toast({
        title: currentIsFavorite ? "Removed from Favorites" : "Added to Favorites",
        description: `${truncateWalletAddress(walletAddress, 10, 8)} ${currentIsFavorite ? 'removed from' : 'added to'} your favorites.`,
      });
      // Trigger a revalidation from the server to ensure consistency.
      // Pass undefined as data and true for revalidation option.
      mutateFavorites(undefined, true);

    } catch (err: any) {
      toast({
        title: "Favorite Update Failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      // Rollback optimistic update on error
      mutateFavorites(previousFavorites, false);
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  // Helper component for the Analysis Button and its Status (for expanded view)
  const ExpandedAnalysisControl = () => (
    <div className="flex flex-col items-start gap-1 mt-2 w-full md:w-auto">
      <Button 
        onClick={handleTriggerAnalysis} 
        variant="outline"
        size="sm"
        className="w-full md:w-auto"
        disabled={isAnalyzing || !walletAddress}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
        {isAnalyzing 
          ? 'Analyzing...' 
          : (lastAnalysisTimestamp ? 'Refresh Wallet Data' : 'Analyze Wallet')}
      </Button>
      {!isAnalyzing && lastAnalysisTimestamp && isValid(lastAnalysisTimestamp) ? (
        <div className="flex items-center space-x-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              lastAnalysisStatus === 'success' && "bg-green-500",
              lastAnalysisStatus === 'error' && "bg-red-500",
              lastAnalysisStatus === 'idle' && "bg-yellow-500",
            )}
            title={
              lastAnalysisStatus === 'success' ? 'Analysis data is fresh' :
              lastAnalysisStatus === 'error'   ? 'Last analysis attempt failed' :
              lastAnalysisStatus === 'idle'    ? 'Analysis data may be outdated' : ''
            }
          />
          <span>{formatDistanceToNow(lastAnalysisTimestamp, { addSuffix: true })}</span>
        </div>
      ) : lastAnalysisStatus === 'idle' && !isAnalyzing ? (
        <div className="flex items-center space-x-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-gray-400" title="Not analyzed" />
              <span>Not yet analyzed</span>
        </div>
      ) : null }
    </div>
  );

  return (
    <Tabs defaultValue="overview" className="flex flex-col w-full h-full bg-muted/40">
      <header className="sticky top-0 z-30 bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-x-4 py-2 px-1 md:py-3">
          
          {/* === LEFT COLUMN (Wallet ID & Refresh for Expanded, or full Collapsed View) === */}
          <div className='flex flex-col items-start gap-1 flex-shrink-0'> 
            {walletAddress && isHeaderExpanded && (
              <>
                {/* Wallet Identity (Icon, Address, Copy, Favorite) */}
                <div className="flex items-center gap-1">
                  <WalletIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <Badge variant="outline" className="px-2 py-1 text-xs md:text-sm font-mono truncate">
                    {truncateWalletAddress(walletAddress, 8, 6)} 
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                    <CopyIcon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="sr-only">Copy wallet address</span>
                  </Button>
                  {apiKey && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleToggleFavorite} 
                            disabled={isTogglingFavorite || !favoritesData}
                            className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0"
                          >
                            <Star 
                              className={`h-3.5 w-3.5 md:h-4 md:w-4 ${isCurrentWalletFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} 
                            />
                            <span className="sr-only">{isCurrentWalletFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>{isCurrentWalletFavorite ? 'Remove from favorites' : 'Add to favorites'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {/* Refresh Control - Placed directly under wallet identity in expanded view */}
                <ExpandedAnalysisControl />
              </>
            )}

            {walletAddress && !isHeaderExpanded && (
              // COLLAPSED VIEW: Single line, flex layout (as previously implemented and approved)
              <div className="w-full flex items-center justify-between gap-2 py-1">
                {/* Left side: Wallet address, copy, favorite */}
                <div className="flex items-center gap-1 flex-shrink min-w-0">
                  <WalletIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <Badge variant="outline" className="px-1.5 py-0.5 text-xs font-mono truncate">
                    {truncateWalletAddress(walletAddress, 6, 4)}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-6 w-6 flex-shrink-0">
                    <CopyIcon className="h-3 w-3" />
                  </Button>
                  {apiKey && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleToggleFavorite} 
                            disabled={isTogglingFavorite || !favoritesData}
                            className="h-6 w-6 flex-shrink-0"
                          >
                            <Star className={`h-3 w-3 ${isCurrentWalletFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom"><p>{isCurrentWalletFavorite ? 'Remove' : 'Add'} Favorite</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {/* Right side: Analyze/Refresh button and status (compact) */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!isAnalyzing && lastAnalysisTimestamp && isValid(lastAnalysisTimestamp) ? (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={cn(
                              "h-2.5 w-2.5 rounded-full", 
                              lastAnalysisStatus === 'success' && "bg-green-500",
                              lastAnalysisStatus === 'error' && "bg-red-500",
                              lastAnalysisStatus === 'idle' && "bg-yellow-500",
                              "cursor-help hidden sm:block"
                            )}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>Last scan: {formatDistanceToNow(lastAnalysisTimestamp, { addSuffix: true })} ({lastAnalysisStatus})</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : lastAnalysisStatus === 'idle' && !isAnalyzing ? (
                     <TooltipProvider delayDuration={100}>
                       <Tooltip>
                         <TooltipTrigger asChild>
                            <div className="h-2.5 w-2.5 rounded-full bg-gray-400 cursor-help hidden sm:block" title="Not yet analyzed" />
                         </TooltipTrigger>
                         <TooltipContent side="bottom"><p>Not yet analyzed</p></TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                  ) : null}
                  <Button 
                    onClick={handleTriggerAnalysis} 
                    variant="outline"
                    size="sm"
                    className="px-2 py-1 h-auto text-xs"
                    disabled={isAnalyzing || !walletAddress}
                  >
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {isAnalyzing ? '...' : (lastAnalysisTimestamp ? 'Refresh' : 'Analyze')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* === RIGHT COLUMN (Account Summary, Time Range, and Toggles) === */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-end gap-x-2 gap-y-2 mt-2 md:mt-0 flex-grow">
            {isHeaderExpanded && (
              <> {/* Fragment to group AccountSummaryCard and TimeRangeSelector for layout purposes */}
                <AccountSummaryCard 
                  walletAddress={walletAddress} 
                  className="w-full sm:w-auto md:max-w-sm"
                  triggerAnalysis={handleTriggerAnalysis} 
                  isAnalyzingGlobal={isAnalyzing}
                />
                <TimeRangeSelector />
              </>
            )}
            {/* Toggles (Collapse/Expand, Theme) - positioned after conditional elements in this column */}
            <div className={cn(
              "flex items-center gap-1 self-stretch justify-end", // self-stretch for vertical alignment, justify-end for horizontal
              isHeaderExpanded ? "md:ml-2" : "w-full mt-2 md:mt-0" // Margin if expanded, full-width if collapsed (to push to end)
            )}>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setIsHeaderExpanded(!isHeaderExpanded)} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                      {isHeaderExpanded ? <ChevronUp className="h-4 w-4 md:h-5 md:w-5" /> : <ChevronDown className="h-4 w-4 md:h-5 md:w-5" />}
                      <span className="sr-only">{isHeaderExpanded ? 'Collapse Summary' : 'Expand Summary'}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>{isHeaderExpanded ? 'Collapse summary' : 'Expand summary'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <ThemeToggleButton />
            </div>
          </div>
        </div>
        <TabsList className="flex items-center justify-start gap-0.5 p-0.5 px-1 border-t w-full bg-muted/20">
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="overview" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span>Overview</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Overview</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="token-performance" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>Token Performance</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Token Performance</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="account-stats" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Account Stats & PNL</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Account Stats & PNL</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="behavioral-patterns" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <Users className="h-3.5 w-3.5" />
                  <span>Behavioral Patterns</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Behavioral Patterns</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="notes" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Notes</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Reviewer Log / Notes</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TabsList>
      </header>

      <main className="flex-1 overflow-y-auto p-0">
        <div className="w-full h-full">
          <TabsContent value="overview">
            {children}
            <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
              <h3 className="text-lg font-semibold mb-2">Overview Section Placeholder</h3>
              <p className="text-sm text-muted-foreground">This is where the main page content (passed as children) is displayed.</p>
              <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center"> (Overview Content Area) </div>
            </div>
          </TabsContent>

          <TabsContent value="token-performance">
            <TokenPerformanceTab walletAddress={walletAddress} triggerAnalysisGlobal={handleTriggerAnalysis} isAnalyzingGlobal={isAnalyzing} />
          </TabsContent>

          <TabsContent value="account-stats">
            <AccountStatsPnlTab 
              walletAddress={walletAddress} 
              triggerAnalysisGlobal={handleTriggerAnalysis} 
              isAnalyzingGlobal={isAnalyzing} 
              lastAnalysisTimestamp={lastAnalysisTimestamp}
            />
          </TabsContent>

          <TabsContent value="behavioral-patterns">
            <BehavioralPatternsTab walletAddress={walletAddress} triggerAnalysisGlobal={handleTriggerAnalysis} isAnalyzingGlobal={isAnalyzing} />
          </TabsContent>

          <TabsContent value="notes">
            <ReviewerLogTab walletAddress={walletAddress} />
          </TabsContent>
        </div>
      </main>
    </Tabs>
  );
} 