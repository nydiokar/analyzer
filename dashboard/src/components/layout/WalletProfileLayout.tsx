"use client";

import React, { useState, useEffect, useCallback } from 'react';
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
  Star,          // Added Star icon for favorites
  Plus,
  X,
  Tags,
  FolderOpen,
  Edit2          // Edit icon for wallet data
} from 'lucide-react' 
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTimeRangeStore } from '@/store/time-range-store';
import { isValid, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { WalletSummaryData } from '@/types/api';
import { useFavorites } from '@/hooks/useFavorites';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Input } from "@/components/ui/input";
import { getTagColor, getCollectionColor } from '@/lib/color-utils';
import { debounce } from 'lodash';

// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import ReviewerLogTab from '@/components/dashboard/ReviewerLogTab';

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

function truncateWalletAddress(address: string, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}



export default function WalletProfileLayout({
  children,
  walletAddress,
}: WalletProfileLayoutProps) {
  const { mutate: globalMutate, cache } = useSWRConfig();
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized, isDemo } = useApiKeyStore();
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<Date | null>(null);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState<boolean>(false);
  const [analysisRequestTime, setAnalysisRequestTime] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  // Quick add modal state
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    nickname: '',
    tags: [] as string[],
    collections: [] as string[],
    newTag: '',
    newCollection: ''
  });
  
  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    nickname: '',
    tags: [] as string[],
    collections: [] as string[],
    newTag: '',
    newCollection: ''
  });
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Debounced input handlers for performance
  const debouncedSetQuickNickname = useCallback(debounce((nickname: string) => {
    setQuickAddForm(prev => ({ ...prev, nickname }));
  }, 200), []);
  
  const debouncedSetQuickNewTag = useCallback(debounce((newTag: string) => {
    setQuickAddForm(prev => ({ ...prev, newTag }));
  }, 200), []);
  
  const debouncedSetQuickNewCollection = useCallback(debounce((newCollection: string) => {
    setQuickAddForm(prev => ({ ...prev, newCollection }));
  }, 200), []);
  
  const debouncedSetEditNickname = useCallback(debounce((nickname: string) => {
    setEditForm(prev => ({ ...prev, nickname }));
  }, 200), []);
  
  const debouncedSetEditNewTag = useCallback(debounce((newTag: string) => {
    setEditForm(prev => ({ ...prev, newTag }));
  }, 200), []);
  
  const debouncedSetEditNewCollection = useCallback(debounce((newCollection: string) => {
    setEditForm(prev => ({ ...prev, newCollection }));
  }, 200), []);
  
  // Cleanup debounced functions
  useEffect(() => {
    return () => {
      debouncedSetQuickNickname.cancel();
      debouncedSetQuickNewTag.cancel();
      debouncedSetQuickNewCollection.cancel();
      debouncedSetEditNickname.cancel();
      debouncedSetEditNewTag.cancel();
      debouncedSetEditNewCollection.cancel();
    };
  }, [debouncedSetQuickNickname, debouncedSetQuickNewTag, debouncedSetQuickNewCollection, debouncedSetEditNickname, debouncedSetEditNewTag, debouncedSetEditNewCollection]);

  // Use the centralized hook
  const { favorites: favoritesData, mutate: mutateFavorites, isLoading: isLoadingFavorites } = useFavorites();

  const currentFavoriteData = React.useMemo(() => {
    return favoritesData?.find(fav => fav.walletAddress === walletAddress);
  }, [favoritesData, walletAddress]);

  const isCurrentWalletFavorite = !!currentFavoriteData;

  const walletSummaryKey = isInitialized && apiKey && walletAddress ? `/wallets/${walletAddress}/summary` : null;
  const { data: walletSummary, error: summaryError, isLoading: isLoadingWalletSummary } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: isPolling ? 5000 : 0, // Poll every 5s when isPolling is true
    }
  );

  // CRITICAL FIX: Add validation to prevent stale SWR data from causing errors.
  // This ensures that the rendered data actually belongs to the wallet address in the URL.
  const isValidData = walletSummary && walletSummary.walletAddress === walletAddress;

  useEffect(() => {
    // This effect handles the completion of polling
    if (isPolling && walletSummary && analysisRequestTime) {
      const lastAnalyzedDate = walletSummary.lastAnalyzedAt ? new Date(walletSummary.lastAnalyzedAt) : null;
      if (lastAnalyzedDate && lastAnalyzedDate > analysisRequestTime) {
        setIsPolling(false);
        setIsAnalyzing(false);
        setAnalysisRequestTime(null);
        setLastAnalysisStatus('success');
        setLastAnalysisTimestamp(lastAnalyzedDate);
        toast.success("Analysis Complete", {
          description: "Wallet data has been successfully updated. Hit Refresh button.",
        });
        // Manually revalidate other wallet-related data, since polling will now stop.
        // We explicitly skip revalidating the summary key itself, as we already have the latest from the poll.
        if (cache instanceof Map) {
          for (const key of cache.keys()) {
            if (
              typeof key === 'string' &&
              key.startsWith(`/wallets/${walletAddress}`) &&
              key !== walletSummaryKey
            ) {
              globalMutate(key);
            }
          }
        }
      }
    }
  }, [walletSummary, isPolling, analysisRequestTime, cache, globalMutate, walletAddress, walletSummaryKey]);

  useEffect(() => {
    // This effect handles polling timeout
    let timeoutId: NodeJS.Timeout;
    if (isPolling) {
      timeoutId = setTimeout(() => {
        setIsPolling(false);
        setIsAnalyzing(false);
        setAnalysisRequestTime(null);
        setLastAnalysisStatus('error');
        toast.warning("Analysis Taking Longer Than Expected", {
          description: "The button has been re-enabled. The dashboard will update automatically if the analysis completes.",
        });
      }, 180000); // 3 minute timeout
    }
    return () => clearTimeout(timeoutId);
  }, [isPolling]);

  useEffect(() => {
    if (walletSummary && typeof walletSummary.lastAnalyzedAt === 'string') {
      const analysisDate = new Date(walletSummary.lastAnalyzedAt);
      if (isValid(analysisDate)) {
        setLastAnalysisTimestamp(analysisDate);
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        if (analysisDate > twentyFourHoursAgo) {
          setLastAnalysisStatus('success');
        } else {
          setLastAnalysisStatus('idle');
        }
      } else {
        setLastAnalysisTimestamp(null);
        setLastAnalysisStatus('idle');
      }
    } else if (walletSummary && !walletSummary.lastAnalyzedAt) {
      setLastAnalysisTimestamp(null);
      setLastAnalysisStatus('idle');
    }
  }, [walletSummary]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(walletAddress)
      .then(() => {
        toast.success("Copied!", {
          description: "Wallet address copied to clipboard.",
          duration: 2000,
        });
      })
      .catch(err => {
        toast.error("Failed to copy", {
          description: "Could not copy address to clipboard.",
          duration: 2000,
        });
        console.error('Failed to copy: ', err);
      });
  };

  const handleTriggerAnalysis = async () => {
    if (!isValidSolanaAddress(walletAddress)) {
      toast.error("Invalid Wallet Address", {
        description: "The address in the URL is not a valid Solana wallet address.",
      });
      return;
    }

    if (isAnalyzing) {
      toast.warning("Analysis Already Running", {
        description: "An analysis is already in progress. Please wait for it to complete.",
      });
      return;
    }

    const { isDemo } = useApiKeyStore.getState();
    if (isDemo) {
      toast.info("This is a demo account", {
        description: "Triggering a new analysis is not available for demo accounts.",
        action: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    if (!walletAddress) {
      toast.error("Wallet Address Missing", {
        description: "Cannot trigger analysis without a wallet address.",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisRequestTime(new Date());
    toast.info("Analysis Queued", {
      description: `Fetching and analyzing data for ${truncateWalletAddress(walletAddress)}. This may take a few moments.`,
    });

    try {
      await fetcher('/analyses/wallets/trigger-analysis', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: [walletAddress] }),
      });
      
      setIsPolling(true); // Start polling for summary updates

    } catch (err: any) {
      console.error("Error triggering analysis:", err);
      setLastAnalysisStatus('error');
      setIsAnalyzing(false); // Re-enable button on trigger failure
      
      if (err.status === 503) {
        toast.warning("Analysis Already Running", {
          description: "An analysis is already in progress. Please wait for it to complete before starting a new one.",
        });
      } else {
        toast.error("Analysis Failed to Trigger", {
          description: err.message || "An unexpected error occurred. Please check the console for details.",
        });
      }
    }
  };

  const handleToggleFavorite = async () => {
    if (!walletAddress || !apiKey || isTogglingFavorite) {
      return;
    }
  
    const currentIsFavorite = isCurrentWalletFavorite;
    
    if (currentIsFavorite) {
      // Show confirmation dialog for removal
      setShowDeleteConfirm(true);
    } else {
      // Show quick add modal for new favorites
      setQuickAddForm({
        nickname: '',
        tags: [],
        collections: [],
        newTag: '',
        newCollection: ''
      });
      setShowQuickAddModal(true);
    }
  };

  const confirmRemoveFavorite = async () => {
    if (!walletAddress || !apiKey) return;
    
    setIsTogglingFavorite(true);
    
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, { method: 'DELETE' });
      await mutateFavorites();
      toast.success("Removed from Favorites", {
        description: `${currentFavoriteData?.nickname || 'Wallet'} has been removed.`,
      });
      setShowDeleteConfirm(false);
    } catch (err: any) {
      toast.error("Failed to remove favorite", {
        description: err.message || "An unexpected error occurred.",
      });
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  // Quick add modal functions
  const handleQuickAddSave = async () => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          nickname: quickAddForm.nickname.trim() || undefined,
          tags: quickAddForm.tags,
          collections: quickAddForm.collections,
        }),
      });
      
      await mutateFavorites();
      setShowQuickAddModal(false);
      
      toast.success("Added to Favorites", {
        description: `${quickAddForm.nickname || truncateWalletAddress(walletAddress, 10, 8)} has been organized.`,
      });
    } catch (err: any) {
      toast.error("Failed to add favorite", {
        description: err.message || "An unexpected error occurred.",
      });
    }
  };

  const addQuickTag = () => {
    if (quickAddForm.newTag.trim() && !quickAddForm.tags.includes(quickAddForm.newTag.trim())) {
      setQuickAddForm(prev => ({
        ...prev,
        tags: [...prev.tags, prev.newTag.trim()],
        newTag: ''
      }));
    }
  };

  const removeQuickTag = (tagToRemove: string) => {
    setQuickAddForm(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const addQuickCollection = () => {
    if (quickAddForm.newCollection.trim() && !quickAddForm.collections.includes(quickAddForm.newCollection.trim())) {
      setQuickAddForm(prev => ({
        ...prev,
        collections: [...prev.collections, prev.newCollection.trim()],
        newCollection: ''
      }));
    }
  };

  const removeQuickCollection = (collectionToRemove: string) => {
    setQuickAddForm(prev => ({
      ...prev,
      collections: prev.collections.filter(collection => collection !== collectionToRemove)
    }));
  };

  // Get wallet display name
  const getWalletDisplayName = (expanded: boolean = true) => {
    if (currentFavoriteData?.nickname) {
      return currentFavoriteData.nickname;
    }
    return expanded 
      ? truncateWalletAddress(walletAddress, 8, 6)
      : truncateWalletAddress(walletAddress, 6, 4);
  };

  // Edit modal functions
  const openEditModal = () => {
    if (currentFavoriteData) {
      setEditForm({
        nickname: currentFavoriteData.nickname || '',
        tags: currentFavoriteData.tags || [],
        collections: currentFavoriteData.collections || [],
        newTag: '',
        newCollection: ''
      });
      setShowEditModal(true);
    }
  };

  const handleEditSave = async () => {
    if (!currentFavoriteData) return;
    
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'PUT',
        body: JSON.stringify({
          nickname: editForm.nickname.trim() || undefined,
          tags: editForm.tags,
          collections: editForm.collections,
        }),
      });
      
      await mutateFavorites();
      setShowEditModal(false);
      
      toast.success("Wallet updated", {
        description: `${editForm.nickname || truncateWalletAddress(walletAddress, 10, 8)} has been updated.`,
      });
    } catch (err: any) {
      toast.error("Failed to update wallet", {
        description: err.message || "An unexpected error occurred.",
      });
    }
  };

  const addEditTag = () => {
    if (editForm.newTag.trim() && !editForm.tags.includes(editForm.newTag.trim())) {
      setEditForm(prev => ({
        ...prev,
        tags: [...prev.tags, prev.newTag.trim()],
        newTag: ''
      }));
    }
  };

  const removeEditTag = (tagToRemove: string) => {
    setEditForm(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const addEditCollection = () => {
    if (editForm.newCollection.trim() && !editForm.collections.includes(editForm.newCollection.trim())) {
      setEditForm(prev => ({
        ...prev,
        collections: [...prev.collections, prev.newCollection.trim()],
        newCollection: ''
      }));
    }
  };

  const removeEditCollection = (collectionToRemove: string) => {
    setEditForm(prev => ({
      ...prev,
      collections: prev.collections.filter(collection => collection !== collectionToRemove)
    }));
  };

  const ExpandedAnalysisControl = () => (
    <div className="flex flex-col items-start gap-1 w-full md:w-auto">
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

  // Render based on error state
  if (summaryError) {
    return (
        <div className="flex items-center justify-center h-screen">
            <div className="text-center p-8 bg-card rounded-lg shadow-lg">
                <h1 className="text-2xl font-bold text-destructive mb-2">Error Loading Wallet</h1>
                <p className="text-muted-foreground">Could not load data for {truncateWalletAddress(walletAddress)}.</p>
                <p className="text-xs mt-4 text-muted-foreground/50">Details: {summaryError.message}</p>
            </div>
        </div>
    );
  }

  // If we have no data yet (but not in an error state), show a loading screen.
  // This also handles the initial state before the first fetch completes.
  if (!walletSummary) {
      return (
          <div className="flex items-center justify-center h-screen">
              <div className="flex flex-col items-center gap-4">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-muted-foreground">Loading wallet data for {truncateWalletAddress(walletAddress)}...</p>
              </div>
          </div>
      );
  }

  return (
    <Tabs defaultValue="token-performance" className="flex flex-col w-full bg-muted/40">
      <header className="sticky top-0 z-30 bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-x-4 py-2 px-1 md:py-3">
          
          <div className='flex flex-col items-start gap-3 md:gap-2 md:pl-11'> 
            {walletAddress && isHeaderExpanded && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1">
                    <WalletIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    
                    {/* Display nickname if available, otherwise wallet address */}
                    {currentFavoriteData?.nickname ? (
                      <span className="text-sm font-medium">{currentFavoriteData.nickname}</span>
                    ) : (
                      <Badge variant="outline" className="px-2 py-1 text-xs md:text-sm font-mono truncate">
                        {truncateWalletAddress(walletAddress, 8, 6)} 
                      </Badge>
                    )}
                    
                    <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                      <CopyIcon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                      <span className="sr-only">Copy wallet address</span>
                    </Button>
                    {apiKey && (
                      <>
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={handleToggleFavorite} 
                                disabled={isTogglingFavorite || isLoadingFavorites}
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
                        
                        {/* Edit button for favorites */}
                        {isCurrentWalletFavorite && (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={openEditModal} 
                                  className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0"
                                >
                                  <Edit2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                  <span className="sr-only">Edit wallet data</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                <p>Edit wallet data</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </>
                    )}
                  </div>
                  
                  {/* Tags and Collections Display */}
                  {currentFavoriteData && ((currentFavoriteData.tags && currentFavoriteData.tags.length > 0) || (currentFavoriteData.collections && currentFavoriteData.collections.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {currentFavoriteData.tags?.map((tag) => (
                        <Badge 
                          key={tag} 
                          variant="secondary" 
                          className={`text-xs px-2 py-0.5 border ${getTagColor(tag)}`}
                        >
                          <Tags className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {currentFavoriteData.collections?.map((collection) => (
                        <Badge 
                          key={collection} 
                          className={`text-xs px-2 py-0.5 ${getCollectionColor(collection)}`}
                        >
                          <FolderOpen className="h-3 w-3 mr-1" />
                          {collection}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {/* High-frequency wallet indicator */}
                  {isValidData && walletSummary?.classification === 'high_frequency' && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center">
                            <Bot className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>High-frequency wallet - possible bot actviity. Analysis limited.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <ExpandedAnalysisControl />
              </>
            )}

            {walletAddress && !isHeaderExpanded && (
              <div className="w-full flex items-center justify-between gap-2 py-1">
                                  <div className="flex items-center gap-1 flex-shrink min-w-0">
                    <WalletIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    
                    {/* Display nickname if available, otherwise wallet address */}
                    {currentFavoriteData?.nickname ? (
                      <span className="text-xs font-medium truncate">{currentFavoriteData.nickname}</span>
                    ) : (
                      <Badge variant="outline" className="px-1.5 py-0.5 text-xs font-mono truncate">
                        {truncateWalletAddress(walletAddress, 6, 4)}
                      </Badge>
                    )}
                    
                    <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-6 w-6 flex-shrink-0">
                      <CopyIcon className="h-3 w-3" />
                    </Button>
                    {apiKey && (
                      <>
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={handleToggleFavorite} 
                                disabled={isTogglingFavorite || isLoadingFavorites}
                                className="h-6 w-6 flex-shrink-0"
                              >
                                <Star className={`h-3 w-3 ${isCurrentWalletFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"><p>{isCurrentWalletFavorite ? 'Remove' : 'Add'} Favorite</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        
                        {/* Edit button for favorites */}
                        {isCurrentWalletFavorite && (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={openEditModal} 
                                  className="h-6 w-6 flex-shrink-0"
                                >
                                  <Edit2 className="h-3 w-3" />
                                  <span className="sr-only">Edit wallet data</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom"><p>Edit wallet data</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </>
                    )}
                    {/* High-frequency wallet indicator (collapsed) */}
                  {isValidData && walletSummary?.classification === 'high_frequency' && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-6 w-6 flex items-center justify-center">
                            <Bot className="h-3 w-3 text-orange-500" />
                          </div>  
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>High-frequency wallet</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
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

          <div className="flex flex-col md:flex-row items-start md:items-center justify-end gap-x-2 gap-y-2 mt-2 md:mt-0 flex-grow">
            {isHeaderExpanded && (
              <>
                <AccountSummaryCard 
                  walletAddress={walletAddress}
                  summaryData={walletSummary || null}
                  isLoading={isLoadingWalletSummary}
                  error={summaryError}
                  className="w-full sm:w-auto md:max-w-sm"
                  triggerAnalysis={handleTriggerAnalysis} 
                  isAnalyzingGlobal={isAnalyzing}
                />
                <TimeRangeSelector />
              </>
            )}
            <div className={cn(
              "flex items-center gap-1 self-stretch justify-end",
              isHeaderExpanded ? "md:ml-2" : "w-full mt-2 md:mt-0"
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
                  value="token-performance" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>Token Performance</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Token Performance</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={100}>
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
          </TooltipProvider>
          <TooltipProvider delayDuration={100}>
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
          </TooltipProvider>
          <TooltipProvider delayDuration={100}>
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
          </TooltipProvider>
        </TabsList>
      </header>

      <main className="flex-1 overflow-y-auto p-0">
        <div className="w-full h-full flex flex-col">
          <TabsContent value="overview" className="mt-4">
            <div>
              {children}
              <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
                <h3 className="text-lg font-semibold mb-2">AI overview is comming soon ...</h3>
                <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center text-sm text-muted-foreground"> (This is being worked on, comming soon ...) </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="token-performance" className="mt-0 p-0 flex flex-col">
            <TokenPerformanceTab walletAddress={walletAddress} isAnalyzingGlobal={isAnalyzing} triggerAnalysisGlobal={handleTriggerAnalysis} />
          </TabsContent>

          <TabsContent value="account-stats" className="mt-0 p-0">
            <AccountStatsPnlTab 
              walletAddress={walletAddress} 
              triggerAnalysisGlobal={handleTriggerAnalysis} 
              isAnalyzingGlobal={isAnalyzing} 
              lastAnalysisTimestamp={lastAnalysisTimestamp}
            />
          </TabsContent>

          <TabsContent value="behavioral-patterns" className="mt-0 p-0">
            <BehavioralPatternsTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="notes" className="mt-0 p-0">
            <ReviewerLogTab walletAddress={walletAddress} />
          </TabsContent>
        </div>
      </main>
      
      {/* Quick Add Modal */}
      <Dialog open={showQuickAddModal} onOpenChange={setShowQuickAddModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Organize Wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nickname (optional)</label>
              <Input
                placeholder="Enter a memorable name..."
                value={quickAddForm.nickname}
                onChange={(e) => debouncedSetQuickNickname(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {quickAddForm.tags.map((tag) => (
                  <Badge 
                    key={tag} 
                    variant="secondary" 
                    className={`text-xs px-2 py-1 border cursor-pointer ${getTagColor(tag)}`}
                    onClick={() => removeQuickTag(tag)}
                  >
                    <Tags className="h-3 w-3 mr-1" />
                    {tag}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1">
                <Input
                  placeholder="Add tag..."
                  value={quickAddForm.newTag}
                  onChange={(e) => debouncedSetQuickNewTag(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addQuickTag()}
                />
                <Button onClick={addQuickTag} size="sm" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Collections</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {quickAddForm.collections.map((collection) => (
                  <Badge 
                    key={collection} 
                    className={`text-xs px-2 py-1 cursor-pointer ${getCollectionColor(collection)}`}
                    onClick={() => removeQuickCollection(collection)}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    {collection}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1">
                <Input
                  placeholder="Add collection..."
                  value={quickAddForm.newCollection}
                  onChange={(e) => debouncedSetQuickNewCollection(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addQuickCollection()}
                />
                <Button onClick={addQuickCollection} size="sm" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowQuickAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleQuickAddSave}>
              Add to Favorites
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Wallet Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nickname</label>
              <Input
                placeholder="Enter a memorable name..."
                value={editForm.nickname}
                onChange={(e) => debouncedSetEditNickname(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {editForm.tags.map((tag) => (
                  <Badge 
                    key={tag} 
                    variant="secondary" 
                    className={`text-xs px-2 py-1 border cursor-pointer ${getTagColor(tag)}`}
                    onClick={() => removeEditTag(tag)}
                  >
                    <Tags className="h-3 w-3 mr-1" />
                    {tag}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1">
                <Input
                  placeholder="Add tag..."
                  value={editForm.newTag}
                  onChange={(e) => debouncedSetEditNewTag(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addEditTag()}
                />
                <Button onClick={addEditTag} size="sm" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Collections</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {editForm.collections.map((collection) => (
                  <Badge 
                    key={collection} 
                    className={`text-xs px-2 py-1 cursor-pointer ${getCollectionColor(collection)}`}
                    onClick={() => removeEditCollection(collection)}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    {collection}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1">
                <Input
                  placeholder="Add collection..."
                  value={editForm.newCollection}
                  onChange={(e) => debouncedSetEditNewCollection(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addEditCollection()}
                />
                <Button onClick={addEditCollection} size="sm" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Remove Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Favorites?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div>
                  Removing <span className="font-medium">{currentFavoriteData?.nickname || 'this wallet'}</span> from favorites will delete it's metadata.
                </div>
                
                {/* Show what will be lost */}
                {(currentFavoriteData?.nickname || (currentFavoriteData?.tags && currentFavoriteData.tags.length > 0) || (currentFavoriteData?.collections && currentFavoriteData.collections.length > 0)) && (
                  <div className="p-3 bg-muted/50 border rounded-md">
                    <div className="text-sm font-medium mb-2">This will also remove:</div>
                    <div className="space-y-2">
                      {currentFavoriteData?.nickname && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Nickname:</span>
                          <div className="mt-1">
                            <Badge variant="secondary" className="text-xs">{currentFavoriteData.nickname}</Badge>
                          </div>
                        </div>
                      )}
                      
                      {currentFavoriteData?.tags && currentFavoriteData.tags.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Tags ({currentFavoriteData.tags.length}):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentFavoriteData.tags.slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className={`text-xs ${getTagColor(tag)}`}>
                                {tag}
                              </Badge>
                            ))}
                            {currentFavoriteData.tags.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{currentFavoriteData.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {currentFavoriteData?.collections && currentFavoriteData.collections.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Collections ({currentFavoriteData.collections.length}):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentFavoriteData.collections.slice(0, 3).map(collection => (
                              <Badge key={collection} className={`text-xs ${getCollectionColor(collection)}`}>
                                {collection}
                              </Badge>
                            ))}
                            {currentFavoriteData.collections.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{currentFavoriteData.collections.length - 3} more
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
              onClick={confirmRemoveFavorite}
              className="bg-red-600 hover:bg-red-700"
              disabled={isTogglingFavorite}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
} 