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
  Edit2,
  Bot          // Edit icon for wallet data
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
import { WalletSummaryData, DashboardAnalysisRequest, DashboardAnalysisResponse } from '@/types/api';
import { useFavorites } from '@/hooks/useFavorites';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { useJobProgress, UseJobProgressCallbacks } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData } from '@/types/websockets';
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


// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import ReviewerLogTab from '@/components/dashboard/ReviewerLogTab';
import { WalletEditForm } from './WalletEditForm';
import QuickAddForm from './QuickAddForm';

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
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [jobStatus, setJobStatus] = useState<string>('idle');
  
  // Job progress callbacks
  const jobProgressCallbacks: UseJobProgressCallbacks = {
    onJobProgress: (data: JobProgressData) => {
      setJobProgress(data.progress);
      setJobStatus('active');
    },
    onJobCompleted: (data: JobCompletionData) => {
      console.log('✅ Dashboard job completed:', data.jobId);
      
      // Case 1: The main analysis job has completed
      if (data.jobId === analysisJobId) {
        console.log('✅ Processing completion for MAIN dashboard job:', data.jobId);
        setJobProgress(100);
        setJobStatus('completed');
        setLastAnalysisStatus('success');
        
        try {
          if (!data.result) {
            throw new Error("WebSocket completion event missing result data");
          }
          
          const resultData = data.result;
          console.log('✅ Using dashboard result data from WebSocket:', { 
            hasEnrichmentJob: !!resultData.enrichmentJobId,
            processingTime: resultData.processingTimeMs
          });
          
          // Set the enrichment job ID from the result payload (like similarity lab)
          if (resultData.enrichmentJobId) {
            console.log('🎨 Setting enrichment job ID:', resultData.enrichmentJobId);
            setEnrichmentJobId(resultData.enrichmentJobId);
          }
          
          // Show success message
          if (resultData.enrichmentJobId) {
            toast.success("Analysis Complete", {
              description: "Wallet data has been successfully updated. Token metadata is loading in the background.",
            });
          } else {
            toast.success("Analysis Complete", {
              description: "Wallet data has been successfully updated.",
            });
          }
          
          // Refresh wallet data
          globalMutate(`/wallets/${walletAddress}/summary`);
          
          // Clear main analysis tracking but keep enrichment job ID
          setAnalysisJobId(null);
          setIsAnalyzing(false);
          setIsPolling(false);
          
        } catch (error: any) {
          console.error('❌ Error processing dashboard job result:', error);
          setLastAnalysisStatus('error');
          toast.error("Analysis Failed", {
            description: error.message || "Failed to process job results.",
          });
          setAnalysisJobId(null);
          setIsAnalyzing(false);
          setIsPolling(false);
        }
      } 
      // Case 2: Enrichment job completed
      else if (data.jobId === enrichmentJobId) {
        console.log('🎨 Processing completion for ENRICHMENT job:', data.jobId);
        setEnrichmentJobId(null);
        toast.success("Token Data Updated", {
          description: "Token metadata and prices have been updated.",
        });
        // Refresh wallet data to show updated token information
        globalMutate(`/wallets/${walletAddress}/summary`);
        
        // CRITICAL FIX: Also refresh token performance data to show enriched token metadata
        // This ensures the TokenPerformanceTab shows updated token icons and metadata
        if (cache instanceof Map) {
          for (const key of cache.keys()) {
            if (
              typeof key === 'string' &&
              key.startsWith(`/wallets/${walletAddress}/token-performance`)
            ) {
              console.log('🔄 Refreshing token performance data:', key);
              globalMutate(key);
            }
          }
        }
        
        // ENHANCED FIX: Also invalidate any cached token performance data patterns
        // This ensures fresh data even if the tab hasn't been loaded yet
        globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`),
          undefined,
          { revalidate: true }
        );
      }
      // Case 3: Unrelated job
      else {
        console.log('Ignoring completion for unrelated job:', data.jobId);
      }
    },
    onJobFailed: (data: JobFailedData) => {
      console.error('❌ Job failed:', data.jobId, data.error);
      
      if (data.jobId === analysisJobId) {
        setJobStatus('failed');
        setIsAnalyzing(false);
        setIsPolling(false);
        setAnalysisJobId(null);
        setLastAnalysisStatus('error');
        
        // Enhanced error handling similar to similarity lab
        const errorMessage = data.error;
        if (errorMessage.includes('already in progress')) {
          toast.warning("Analysis Already Running", {
            description: "An analysis is already in progress for this wallet. Please wait for it to complete.",
          });
        } else if (errorMessage.includes('Invalid wallet')) {
          toast.error("Invalid Wallet Address", {
            description: "The wallet address is invalid or has no transaction data.",
          });
        } else {
          toast.error("Analysis Failed", {
            description: errorMessage || "The analysis job failed. Please try again.",
          });
        }
      } else if (data.jobId === enrichmentJobId) {
        setEnrichmentJobId(null);
        setSubscribedEnrichmentJobId(null);
        toast.error("Token Enrichment Failed", {
          description: "Failed to load token metadata. You can still view the analysis results.",
        });
        // Even on failure, refresh token performance data to show current state
        if (cache instanceof Map) {
          for (const key of cache.keys()) {
            if (
              typeof key === 'string' &&
              key.startsWith(`/wallets/${walletAddress}/token-performance`)
            ) {
              console.log('🔄 Refreshing token performance data after enrichment failure:', key);
              globalMutate(key);
            }
          }
        }
        
        // ENHANCED FIX: Also invalidate any cached token performance data patterns
        // This ensures fresh data even if the tab hasn't been loaded yet
        globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`),
          undefined,
          { revalidate: true }
        );
      }
    },
    onEnrichmentComplete: (data) => {
      console.log('🎨 Enrichment complete callback:', data);
      setEnrichmentJobId(null);
      setSubscribedEnrichmentJobId(null);
      toast.success("Token Data Updated", {
        description: "Token metadata and prices have been updated.",
      });
      // Refresh wallet data to show updated token information
      globalMutate(`/wallets/${walletAddress}/summary`);
      
      // CRITICAL FIX: Also refresh token performance data to show enriched token metadata
      // This ensures the TokenPerformanceTab shows updated token icons and metadata
      if (cache instanceof Map) {
        for (const key of cache.keys()) {
          if (
            typeof key === 'string' &&
            key.startsWith(`/wallets/${walletAddress}/token-performance`)
          ) {
            console.log('🔄 Refreshing token performance data:', key);
            globalMutate(key);
          }
        }
      }
      
      // ENHANCED FIX: Also invalidate any cached token performance data patterns
      // This ensures fresh data even if the tab hasn't been loaded yet
      globalMutate(
        (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`),
        undefined,
        { revalidate: true }
      );
    },
    onConnectionChange: (connected) => {
      if (!connected) {
        // If WebSocket disconnects during analysis, fall back to polling
        if (isAnalyzing && analysisJobId) {
          setIsPolling(true);
          setAnalysisRequestTime(new Date());
        }
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
  const { favorites: favoritesData, mutate: mutateFavorites, isLoading: isLoadingFavorites } = useFavorites();

  const currentFavoriteData = React.useMemo(() => {
    return favoritesData?.find(fav => fav.walletAddress === walletAddress);
  }, [favoritesData, walletAddress]);

  const isCurrentWalletFavorite = !!currentFavoriteData;

  const walletSummaryKey = isInitialized && walletAddress ? `/wallets/${walletAddress}/summary` : null;
  const { data: walletSummary, error: summaryError, isLoading: isLoadingWalletSummary } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnMount: false, // Prevent duplicate initial calls
      revalidateOnReconnect: false,
      refreshInterval: isPolling ? 10000 : 0, // Poll every 10s when isPolling is true (reduced from 5s)
      dedupingInterval: 5000, // Prevent duplicate requests within 5 seconds
    }
  );

  // Ensure initial fetch happens when walletSummaryKey becomes available
  useEffect(() => {
    if (walletSummaryKey && !walletSummary) {
      globalMutate(walletSummaryKey);
    }
  }, [walletSummaryKey, walletSummary, globalMutate]);

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
    if (enrichmentJobId && isConnected && enrichmentJobId !== subscribedEnrichmentJobId) {
      console.log('🎨 Subscribing to enrichment job:', enrichmentJobId);
      subscribeToJob(enrichmentJobId);
      setSubscribedEnrichmentJobId(enrichmentJobId);
    }
  }, [enrichmentJobId, isConnected, subscribedEnrichmentJobId]);

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
    setJobStatus('starting');
    setEnrichmentJobId(null); // Clear any previous enrichment job
    toast.info("Analysis Queued", {
      description: `Analysis job submitted for ${truncateWalletAddress(walletAddress)}. You'll receive real-time updates.`,
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
      setJobStatus('failed');
      
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
    if (jobStatus === 'idle' || !isAnalyzing) return null;

    return (
      <div className="space-y-2 w-full">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {jobStatus === 'starting' && 'Starting analysis...'}
            {jobStatus === 'active' && 'Analyzing wallet...'}
            {jobStatus === 'completed' && 'Analysis completed'}
            {jobStatus === 'failed' && 'Analysis failed'}
          </span>
          <span className="text-muted-foreground">{jobProgress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
            style={{ width: `${jobProgress}%` }}
          />
        </div>
        {/* Show enrichment status */}
        {enrichmentJobId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>Loading token metadata...</span>
          </div>
        )}
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
        {isAnalyzing 
          ? 'Analyzing...' 
          : (lastAnalysisTimestamp ? 'Refresh Wallet Data' : 'Analyze Wallet')}
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