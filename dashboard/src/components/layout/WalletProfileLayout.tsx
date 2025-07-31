"use client";

import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
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
  Edit2,
  Bot          // Edit icon for wallet data
} from 'lucide-react' 
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { useTimeRangeStore } from '@/store/time-range-store';
import { isValid, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { WalletSummaryData, DashboardAnalysisRequest, DashboardAnalysisResponse } from '@/types/api';
import { createCacheKey, invalidateWalletCache, preloadWalletData, CACHE_DURATIONS } from '@/lib/swr-config';
import { useFavorites } from '@/hooks/useFavorites';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { useJobProgress, UseJobProgressCallbacks } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData, EnrichmentCompletionData } from '@/types/websockets';
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
import { getTagColor, getCollectionColor } from '@/lib/color-utils';
import { usePathname, useSearchParams } from 'next/navigation';


// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import ReviewerLogTab from '@/components/dashboard/ReviewerLogTab';
import { WalletEditForm } from './WalletEditForm';
import QuickAddForm from './QuickAddForm';
import LazyTabContent from './LazyTabContent';
import { FavoriteWallet } from '@/types/api';

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

function truncateWalletAddress(address: string, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

// Memoized components to prevent unnecessary re-renders during tab switching
const MemoizedTokenPerformanceTab = memo(TokenPerformanceTab);
const MemoizedAccountStatsPnlTab = memo(AccountStatsPnlTab);
const MemoizedBehavioralPatternsTab = memo(BehavioralPatternsTab);
const MemoizedReviewerLogTab = memo(ReviewerLogTab);



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
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);

  const searchParams = useSearchParams();

  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');
    if (jobIdFromUrl) {
      setAnalysisJobId(jobIdFromUrl);
      setIsAnalyzing(true);
      setJobProgress(0);
      subscribeToJob(jobIdFromUrl);
    }
  }, [searchParams]);
  
  // Job progress callbacks
  const jobProgressCallbacks: UseJobProgressCallbacks = {
    onJobProgress: (data: JobProgressData) => {
      setJobProgress(data.progress);
      
    },
    onJobCompleted: (data: JobCompletionData) => {
      
      // Case 1: The main analysis job has completed
      if (data.jobId === analysisJobId) {
        // Stop any polling immediately since WebSocket got the completion
        setIsPolling(false);
        setAnalysisRequestTime(null);
        
        setJobProgress(100);
        setLastAnalysisStatus('success');
        
        try {
          if (!data.result) {
            throw new Error("WebSocket completion event missing result data");
          }
          const resultData = data.result;
          
          // Set the enrichment job ID from the result payload (like similarity lab)
          if (resultData.enrichmentJobId) {
            setEnrichmentJobId(resultData.enrichmentJobId);
            toast.success("Analysis Complete", {
              description: "Wallet data updated. Syncing token metadata...",
            });
          } else {
            toast.success("Analysis Complete", {
              description: "Wallet data has been successfully updated.",
            });

          }
          // Immediately fetch fresh data from database - no cache to worry about
          // Force-refetch the summary immediately; keepPreviousData makes sure UI doesn’t blank.
          globalMutate(
            createCacheKey.walletSummary(walletAddress),
            undefined,
            { revalidate: true }
          );

          setIsAnalyzing(false);
          setAnalysisJobId(null);
          // If there's an enrichment job, isAnalyzing remains true
        } catch (error: any) {
          // ... error handling
          setIsAnalyzing(false);
          setJobProgress(0);
        }
      } else if (data.jobId === enrichmentJobId) {
        // Stop any remaining polling since enrichment completed via WebSocket
        setIsPolling(false);
        setAnalysisRequestTime(null);
        
        setEnrichmentJobId(null);
        toast.success("Token Data Updated", {
          description: "Token metadata and prices have been updated.",
        });
        // Revalidate token performance data but keep showing existing data during fetch
        setTimeout(() => {
          // Refresh token performance tables
          globalMutate(
            (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`)
          );
          // And refresh wallet summary as the enrichment step can affect balance / classification
          globalMutate(
            createCacheKey.walletSummary(walletAddress),
            undefined,
            { revalidate: true }
          );
        }, 1000); // Give enrichment time to fully complete
        // All jobs are done; clear analysis state
        setIsAnalyzing(false);
        setJobProgress(0);
        
      }
    },
    onJobFailed: (data: JobFailedData) => {
      console.error('❌ Job failed:', data.jobId, data.error);
      setIsAnalyzing(false);
      setIsPolling(false);
      setAnalysisJobId(null);
      setEnrichmentJobId(null);
      setLastAnalysisStatus('error');
      setJobProgress(0);
      toast.error("Analysis Failed", {
        description: data.error || "An unexpected error occurred during analysis.",
      });
    },
    onEnrichmentComplete: (data: EnrichmentCompletionData) => {
      // This is handled via onJobCompleted for enrichment queue, but here for completeness
    },
    onConnectionChange: (connected) => {
      if (!connected && isAnalyzing && analysisJobId) {
        // Only start polling if WebSocket has been disconnected for more than 5 seconds
        // This prevents temporary disconnections from triggering polling
        setTimeout(() => {
          if (!isConnected && isAnalyzing && analysisJobId) {
            setIsPolling(true);
            setAnalysisRequestTime(new Date());
          }
        }, 5000);
      } else if (connected && isPolling) {
        // WebSocket reconnected - stop polling immediately
        setIsPolling(false);
        setAnalysisRequestTime(null);
      }
    }
  };

  // Use the existing job progress hook
  const { subscribeToJob, unsubscribeFromJob, isConnected, error: wsError } = useJobProgress(jobProgressCallbacks);
  
  // Quick add modal state
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  
  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state updates are fast - no debouncing needed for responsive typing

  // Use the centralized hook
  const { favorites: favoritesData, mutate: mutateFavorites } = useFavorites();

  const currentFavoriteData = React.useMemo(() => {
    return favoritesData?.find((fav: FavoriteWallet) => fav.walletAddress === walletAddress);
  }, [favoritesData, walletAddress]);

  const isCurrentWalletFavorite = !!currentFavoriteData;

  // Progressive loading: Start with summary, then load detailed data
  // Remove isInitialized dependency - let SWR handle the request with or without API key
  const walletSummaryKey = walletAddress ? createCacheKey.walletSummary(walletAddress) : null;
  const { data: walletSummary, error: summaryError, isLoading: isLoadingWalletSummary } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      refreshInterval: isPolling && !isConnected ? 10000 : 0, // Only poll when WebSocket is unavailable
      revalidateOnMount: true, // Allow initial data loading
      // Do not disrupt the UI by revalidating on every tab or network change –
      // we will explicitly invalidate the cache when running a new analysis.
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Prevent hammering the API by deduping identical requests for 15 s.
      dedupingInterval: 15_000,
      // Keep the previous summary visible while a background revalidation is running.
      keepPreviousData: true,
      revalidateIfStale: true,
      errorRetryCount: 0 // Don't retry on error to avoid constant fetching
    }
  );

  // Each component will handle its own data loading
  // No detailed data loading at layout level
  
  // Tab state management
  const [activeTab, setActiveTab] = useState<string>('token-performance');
  const [debouncedActiveTab, setDebouncedActiveTab] = useState<string>('token-performance');
  
  // Debounce active tab changes to prevent performance spikes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedActiveTab(activeTab);
    }, 150); // 150ms debounce to smooth out rapid tab switching

    return () => clearTimeout(timeoutId);
  }, [activeTab]);
  
  // Simplified tab change handler with debouncing
  const handleTabChange = useCallback((value: string) => {
    if (value === activeTab) return; // Skip if already active
    setActiveTab(value);
  }, [activeTab]);

  // Simplified preloading - only preload summary when needed
  useEffect(() => {
    if (walletSummary && walletAddress) {
      preloadWalletData(globalMutate, walletAddress, debouncedActiveTab);
    }
  }, [walletSummary, debouncedActiveTab, walletAddress, globalMutate]);

  // Removed redundant manual fetch - SWR handles initial loading automatically

  // CRITICAL FIX: Add validation to prevent stale SWR data from causing errors.
  // This ensures that the rendered data actually belongs to the wallet address in the URL.
  const isValidData = walletSummary && walletSummary.walletAddress === walletAddress;

  useEffect(() => {
    // This effect handles the completion of polling - ONLY when WebSocket is unavailable
    if (isPolling && walletSummary && analysisRequestTime && !isConnected) {
      const lastAnalyzedDate = walletSummary.lastAnalyzedAt ? new Date(walletSummary.lastAnalyzedAt) : null;
      if (lastAnalyzedDate && lastAnalyzedDate > analysisRequestTime) {
        setIsPolling(false);
        setIsAnalyzing(false);
        setAnalysisRequestTime(null);
        setLastAnalysisStatus('success');
        setLastAnalysisTimestamp(lastAnalyzedDate);
        toast.success("Analysis Complete", {
          description: "Wallet data has been successfully updated.",
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
        
        // Polling fallback complete - refresh all wallet data
        invalidateWalletCache(globalMutate, walletAddress);
      }
    }
  }, [walletSummary, isPolling, analysisRequestTime, cache, globalMutate, walletAddress, walletSummaryKey, isConnected]);

  useEffect(() => {
    // This effect handles polling timeout
    let timeoutId: NodeJS.Timeout;
    if (isPolling) {
      timeoutId = setTimeout(() => {
        setIsPolling(false);
        setIsAnalyzing(false);
        setAnalysisRequestTime(null);
        setLastAnalysisStatus('error');
        setJobProgress(0); // Reset progress
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


  // Cleanup job subscription when component unmounts or job completes
  useEffect(() => {
    return () => {
      if (analysisJobId) {
        unsubscribeFromJob(analysisJobId);
      }
      if (enrichmentJobId) {
        unsubscribeFromJob(enrichmentJobId);
      }
      // Reset subscription tracking
      setSubscribedEnrichmentJobId(null);
    };
  }, [analysisJobId, enrichmentJobId, unsubscribeFromJob]);

  // Subscribe to enrichment job when it's set (with duplicate prevention)
  const [subscribedEnrichmentJobId, setSubscribedEnrichmentJobId] = useState<string | null>(null);
  
  useEffect(() => {
    // Only subscribe if we have an enrichment job ID, we're connected, and we haven't subscribed to this job yet
    if (enrichmentJobId && isConnected && enrichmentJobId !== subscribedEnrichmentJobId) {
      subscribeToJob(enrichmentJobId);
      setSubscribedEnrichmentJobId(enrichmentJobId);
    }
  }, [enrichmentJobId, subscribedEnrichmentJobId, isConnected, subscribeToJob]);

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
    setJobProgress(0);
    setEnrichmentJobId(null); // Clear any previous enrichment job
    toast.info("Analysis Queued", {
      description: `Analysis submitted for ${truncateWalletAddress(walletAddress)}. Expect real-time updates shortly.`,
    });

    try {
      const requestData: DashboardAnalysisRequest = {
        walletAddress,
        forceRefresh: true,
        enrichMetadata: true,
      };

      const response: DashboardAnalysisResponse = await fetcher('/analyses/wallets/dashboard-analysis', {
        method: 'POST',
        body: JSON.stringify(requestData),
      });

      setAnalysisJobId(response.jobId);
      
      // Check WebSocket connection status before subscribing
      if (isConnected) {
        await subscribeToJob(response.jobId);
      } else {
        // Fall back to polling if WebSocket is not connected
        setIsPolling(true);
        setAnalysisRequestTime(new Date());
      }

    } catch (error: any) {
      setIsAnalyzing(false);
      setJobProgress(0);
      
      toast.error("Analysis Failed to Trigger", {
        description: error.message || "An unexpected error occurred. Please try again.",
      });
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

  // Quick add modal function
  const handleQuickAddSave = async (formData: { nickname: string; tags: string[]; collections: string[] }) => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          nickname: formData.nickname.trim() || undefined,
          tags: formData.tags,
          collections: formData.collections,
        }),
      });
      
      await mutateFavorites();
      
      toast.success("Added to Favorites", {
        description: `${formData.nickname || truncateWalletAddress(walletAddress, 10, 8)} has been organized.`,
      });
    } catch (err: any) {
      toast.error("Failed to add favorite", {
        description: err.message || "An unexpected error occurred.",
      });
    }
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
  const openEditModal = useCallback(() => {
    if (currentFavoriteData) {
      setShowEditModal(true);
    }
  }, [currentFavoriteData]);

  const handleEditSave = useCallback(async (formData: { nickname: string; tags: string[]; collections: string[] }) => {
    if (!currentFavoriteData) return;
    
    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'PUT',
        body: JSON.stringify({
          nickname: formData.nickname.trim() || undefined,
          tags: formData.tags,
          collections: formData.collections,
        }),
      });
      
      await mutateFavorites();
      
      toast.success("Wallet updated", {
        description: `${formData.nickname || truncateWalletAddress(walletAddress, 10, 8)} has been updated.`,
      });
    } catch (err: any) {
      toast.error("Failed to update wallet", {
        description: err.message || "An unexpected error occurred.",
      });
    }
  }, [currentFavoriteData, walletAddress, mutateFavorites]);

  const renderAnalysisProgress = () => {
    if (!isAnalyzing) return null;

    return (
      <div className="space-y-2 w-full">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {jobProgress === 0 && 'Queued...'}
            {jobProgress > 0 && jobProgress < 100 && 'Analyzing wallet...'}
            {jobProgress === 100 && 'Analysis complete'}
          </span>
          <span className="text-muted-foreground">{jobProgress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
            style={{ width: `${Math.max(jobProgress, 5)}%` }}
          />
        </div>
      </div>
    );
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
        {lastAnalysisTimestamp ? 'Refresh Wallet Data' : 'Analyze Wallet'}
      </Button>
      
      {/* Show progress during analysis */}
      {renderAnalysisProgress()}
      
      {/* Connection status is handled by useJobProgress internally */}
      
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

  // REMOVED problematic global loading gate that was hiding the entire UI
  // Each component now handles its own loading state properly
  // Only block rendering for critical errors, not for loading states

  return (
    <Tabs defaultValue="token-performance" value={activeTab} onValueChange={handleTabChange} className="flex flex-col w-full bg-muted/40">
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
                                disabled={isTogglingFavorite}
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
                      {currentFavoriteData.tags?.map((tag: string) => (
                        <Badge 
                          key={tag} 
                          variant="secondary" 
                          className={`text-xs px-2 py-0.5 border ${getTagColor(tag)}`}
                        >
                          <Tags className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {currentFavoriteData.collections?.map((collection: string) => (
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
                    <div className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />
                    </div>
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
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={handleToggleFavorite} 
                          disabled={isTogglingFavorite}
                          className="h-6 w-6 flex-shrink-0"
                        >
                          <Star className={`h-3 w-3 ${isCurrentWalletFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
                        </Button>
                        
                        {/* Edit button for favorites */}
                        {isCurrentWalletFavorite && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={openEditModal} 
                            className="h-6 w-6 flex-shrink-0"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span className="sr-only">Edit wallet data</span>
                          </Button>
                        )}
                      </>
                    )}
                    {/* High-frequency wallet indicator (collapsed) */}
                  {isValidData && walletSummary?.classification === 'high_frequency' && (
                    <div className="h-6 w-6 flex items-center justify-center">
                      <Bot className="h-3 w-3 text-orange-500" />
                    </div>  
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!isAnalyzing && lastAnalysisTimestamp && isValid(lastAnalysisTimestamp) ? (
                    <div className={cn(
                        "h-2.5 w-2.5 rounded-full", 
                        lastAnalysisStatus === 'success' && "bg-green-500",
                        lastAnalysisStatus === 'error' && "bg-red-500",
                        lastAnalysisStatus === 'idle' && "bg-yellow-500",
                        "cursor-help hidden sm:block"
                      )}
                    />
                  ) : lastAnalysisStatus === 'idle' && !isAnalyzing ? (
                     <div className="h-2.5 w-2.5 rounded-full bg-gray-400 cursor-help hidden sm:block" title="Not yet analyzed" />
                  ) : null}
                  <Button 
                    onClick={handleTriggerAnalysis} 
                    variant="outline"
                    size="sm"
                    className="px-2 py-1 h-auto text-xs"
                    disabled={isAnalyzing || !walletAddress}
                  >
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {lastAnalysisTimestamp ? 'Refresh' : 'Analyze'}
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
              <Button variant="ghost" size="icon" onClick={() => setIsHeaderExpanded(!isHeaderExpanded)} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                {isHeaderExpanded ? <ChevronUp className="h-4 w-4 md:h-5 md:w-5" /> : <ChevronDown className="h-4 w-4 md:h-5 md:w-5" />}
                <span className="sr-only">{isHeaderExpanded ? 'Collapse Summary' : 'Expand Summary'}</span>
              </Button>
              <ThemeToggleButton />
            </div>
          </div>
        </div>
        <TabsList className="flex items-center justify-start gap-0.5 p-0.5 px-1 border-t w-full bg-muted/20">
          <TabsTrigger 
            value="token-performance" 
            className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
            <ListChecks className="h-3.5 w-3.5" />
            Token Performance
          </TabsTrigger>
          <TabsTrigger 
            value="account-stats" 
            className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
            <Calculator className="h-3.5 w-3.5" />
            Account Stats & PNL
          </TabsTrigger>
          <TabsTrigger 
            value="behavioral-patterns" 
            className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
            <Users className="h-3.5 w-3.5" />
            Behavioral Patterns
          </TabsTrigger>
          <TabsTrigger 
            value="notes" 
            className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
            <FileText className="h-3.5 w-3.5" />
            Notes
          </TabsTrigger>
          <TabsTrigger 
            value="overview" 
            className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
        </TabsList>
      </header>

      <main className="flex-1 overflow-y-auto p-0">
        <div className="w-full h-full flex flex-col">
          <LazyTabContent value="overview" activeTab={debouncedActiveTab} className="mt-4" defer={false} preloadOnHover={false}>
            <div>
              {children}
              <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
                <h3 className="text-lg font-semibold mb-2">AI Overview Coming Soon</h3>
                <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p>AI-powered wallet insights are being developed...</p>
                  </div>
                </div>
              </div>
            </div>
          </LazyTabContent>

          <LazyTabContent value="token-performance" activeTab={debouncedActiveTab} className="mt-0 p-0 flex flex-col" defer={true} preloadOnHover={false}>
            <MemoizedTokenPerformanceTab walletAddress={walletAddress} isAnalyzingGlobal={isAnalyzing} triggerAnalysisGlobal={handleTriggerAnalysis} />
          </LazyTabContent>

          <LazyTabContent value="account-stats" activeTab={debouncedActiveTab} className="mt-0 p-0" defer={true} preloadOnHover={false}>
            <MemoizedAccountStatsPnlTab 
              walletAddress={walletAddress} 
              triggerAnalysisGlobal={handleTriggerAnalysis} 
              isAnalyzingGlobal={isAnalyzing} 
              lastAnalysisTimestamp={lastAnalysisTimestamp}
            />
          </LazyTabContent>

          <LazyTabContent value="behavioral-patterns" activeTab={debouncedActiveTab} className="mt-0 p-0" defer={true} preloadOnHover={false}>
            <MemoizedBehavioralPatternsTab walletAddress={walletAddress} />
          </LazyTabContent>

          <LazyTabContent value="notes" activeTab={debouncedActiveTab} className="mt-0 p-0" defer={true} preloadOnHover={false}>
            <MemoizedReviewerLogTab walletAddress={walletAddress} />
          </LazyTabContent>
        </div>
      </main>
      
      {/* Quick Add Modal */}
      <QuickAddForm
        isOpen={showQuickAddModal}
        onClose={() => setShowQuickAddModal(false)}
        onSave={handleQuickAddSave}
        walletAddress={walletAddress}
        title="Organize Wallet"
      />
      
      {/* Edit Modal */}
      <WalletEditForm
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleEditSave}
        initialData={{
          nickname: currentFavoriteData?.nickname || '',
          tags: currentFavoriteData?.tags || [],
          collections: currentFavoriteData?.collections || [],
        }}
        title="Edit Wallet Data"
      />
      
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
                            {currentFavoriteData.tags.slice(0, 3).map((tag: string) => (
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
                            {currentFavoriteData.collections.slice(0, 3).map((collection: string) => (
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