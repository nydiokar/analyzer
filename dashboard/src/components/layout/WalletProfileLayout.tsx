"use client";

import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import dynamic from 'next/dynamic';
import useSWR, { useSWRConfig } from 'swr';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import TimeRangeSelector from '@/components/shared/TimeRangeSelector';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import EmptyState from '@/components/shared/EmptyState'
import {
  ListChecks,      // Token Performance
  Calculator,      // Account Stats & PNL
  Users,           // Behavioral Patterns
  FileText,        // Notes
  RefreshCw,
  Bot,             // Edit icon for wallet data
  Loader2
} from 'lucide-react' 
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { isValid, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { WalletSummaryData, DashboardAnalysisRequest, DashboardAnalysisResponse, DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '@/types/api';
import { createCacheKey } from '@/lib/swr-config';
import { useFavorites } from '@/hooks/useFavorites';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { useJobProgress, UseJobProgressCallbacks } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData, JobQueueToStartData } from '@/types/websockets';
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
import { getCollectionColorFilled } from '@/lib/color-utils';
import { useSearchParams } from 'next/navigation';
import { useTimeRangeStore } from '@/store/time-range-store';

import type { BehavioralPatternsTabProps } from '@/components/dashboard/BehavioralPatternsTab';
import type { TokenPerformanceTabProps } from '@/components/dashboard/TokenPerformanceTab';
import type { AccountStatsPnlTabProps } from '@/components/dashboard/AccountStatsPnlTab';
import type { ReviewerLogTabProps } from '@/components/dashboard/ReviewerLogTab';
import { WalletEditForm } from './WalletEditForm';
import QuickAddForm from './QuickAddForm';
import LazyTabContent from './LazyTabContent';
import { FavoriteWallet } from '@/types/api';
import { WalletBadge } from '@/components/shared/WalletBadge';

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

type SubscribeToJobFn = (jobId: string) => Promise<void>;
type UnsubscribeFromJobFn = (jobId: string) => void;

const TabLoadingFallback = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-sm text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
    <span>Loading {label}...</span>
  </div>
);

const TokenPerformanceTabLazy = dynamic<TokenPerformanceTabProps>(
  () => import('@/components/dashboard/TokenPerformanceTab'),
  {
    loading: () => <TabLoadingFallback label="token performance" />,
    ssr: false,
  },
);

const AccountStatsPnlTabLazy = dynamic<AccountStatsPnlTabProps>(
  () => import('@/components/dashboard/AccountStatsPnlTab').catch(err => {
    console.error('Error loading AccountStatsPnlTab:', err);
    return { default: (props: AccountStatsPnlTabProps) => (
      <div className="p-6">
        <EmptyState 
          variant="error" 
          title="Failed to load Account Stats" 
          description="There was an error loading this component. Please try refreshing the page." 
        />
      </div>
    )};
  }),
  {
    loading: () => <TabLoadingFallback label="account statistics" />,
    ssr: false,
  },
);

const BehavioralPatternsTabLazy = dynamic<BehavioralPatternsTabProps>(
  () => import('@/components/dashboard/BehavioralPatternsTab'),
  {
    loading: () => <TabLoadingFallback label="behavioral patterns" />,
    ssr: false,
  },
);

const ReviewerLogTabLazy = dynamic<ReviewerLogTabProps>(
  () => import('@/components/dashboard/ReviewerLogTab'),
  {
    loading: () => <TabLoadingFallback label="notes" />,
    ssr: false,
  },
);

const TAB_VALUES = new Set<string>(['token-performance', 'account-stats', 'behavioral-patterns', 'notes']);
const DEFAULT_TAB = 'token-performance';

function truncateWalletAddress(address: string, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

// Memoized wrappers prevent unnecessary re-renders during tab switching once modules are loaded
const MemoizedTokenPerformanceTab = memo(function MemoizedTokenPerformanceTab(props: TokenPerformanceTabProps) {
  return <TokenPerformanceTabLazy {...props} />;
});

const MemoizedAccountStatsPnlTab = memo(function MemoizedAccountStatsPnlTab(props: AccountStatsPnlTabProps) {
  return <AccountStatsPnlTabLazy {...props} />;
});

const MemoizedBehavioralPatternsTab = memo(function MemoizedBehavioralPatternsTab(props: BehavioralPatternsTabProps) {
  return <BehavioralPatternsTabLazy {...props} />;
});

const MemoizedReviewerLogTab = memo(function MemoizedReviewerLogTab(props: ReviewerLogTabProps) {
  return <ReviewerLogTabLazy {...props} />;
});


export default function WalletProfileLayout({
  children,
  walletAddress,
}: WalletProfileLayoutProps) {
  const { mutate: globalMutate, cache } = useSWRConfig();
  const { isDemo: isDemoAccount } = useApiKeyStore();
  const { startDate, endDate } = useTimeRangeStore();
  // REMOVED: Header expand/collapse state - no longer needed with natural scroll
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<Date | null>(null);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState<boolean>(false);
  type ScopeStatusValue = {
    jobId: string | null;
    status: 'idle' | 'queued' | 'running' | 'completed' | 'skipped' | 'error';
    lastCompletedAt?: Date;
    errorMessage?: string;
  };

  const scopeLabels = React.useMemo<Record<DashboardAnalysisScope, string>>(
    () => ({
      flash: 'Recent snapshot',
      working: '30-day view',
      deep: 'Full history',
    }),
    [],
  );

  const scopeSequence = React.useMemo<DashboardAnalysisScope[]>(() => ['flash', 'working', 'deep'], []);

  const scopeStatusStyles = React.useMemo<Record<ScopeStatusValue['status'], string>>(
    () => ({
      idle: 'bg-muted text-muted-foreground',
      queued: 'bg-muted text-muted-foreground',
      running: 'bg-blue-500/10 text-blue-500 border border-blue-500/30',
      completed: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30',
      skipped: 'bg-muted text-muted-foreground',
      error: 'bg-destructive/10 text-destructive border border-destructive/30',
    }),
    [],
  );

  const [scopeStates, setScopeStates] = useState<Record<DashboardAnalysisScope, ScopeStatusValue>>({
    flash: { jobId: null, status: 'idle' },
    working: { jobId: null, status: 'idle' },
    deep: { jobId: null, status: 'idle' },
  });

  const [scopeProgress, setScopeProgress] = useState<Record<DashboardAnalysisScope, number>>({
    flash: 0,
    working: 0,
    deep: 0,
  });

  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);

  const [hasInitialTokenSnapshot, setHasInitialTokenSnapshot] = useState(false);
  const isAutoTriggeringRef = useRef(false);

  // REMOVED: jobIdToScopeRef - scope is now read directly from job completion event
  // const jobIdToScopeRef = useRef<Record<string, DashboardAnalysisScope>>({});

  const isAnalyzing = React.useMemo(
    () => Object.values(scopeStates).some((state) => state.status === 'queued' || state.status === 'running'),
    [scopeStates],
  );

  useEffect(() => {
    setHasInitialTokenSnapshot(false);
    isAutoTriggeringRef.current = false;
  }, [walletAddress]);

  const subscribeToJobRef = useRef<SubscribeToJobFn | null>(null);
  const unsubscribeFromJobRef = useRef<UnsubscribeFromJobFn | null>(null);

  // NEW: Store reference to TokenPerformanceTab's mutate function
  const tokenPerformanceMutateRef = useRef<(() => Promise<void>) | null>(null);

  const handleTokenDataPrimed = useCallback(() => {
    setHasInitialTokenSnapshot(true);
  }, []);

  const handleTokenPerformanceMutateReady = useCallback((mutate: () => Promise<void>) => {
    tokenPerformanceMutateRef.current = mutate;
  }, []);

  const registerJobSubscription = useCallback(
    async (scope: DashboardAnalysisScope, jobId: string) => {
      // No more ref tracking - scope will be read from job completion event

      setScopeStates((prev) => ({
        ...prev,
        [scope]: {
          ...prev[scope],
          jobId,
          status: 'queued',
          errorMessage: undefined,
        },
      }));
      setScopeProgress((prev) => ({ ...prev, [scope]: 0 }));

      const subscribeFn = subscribeToJobRef.current;
      if (!subscribeFn) {
        console.error('[WalletProfile] subscribeToJob not ready when registering job subscription', jobId);
        return;
      }

      await subscribeFn(jobId);
    },
    [],
  );
  const clearJobSubscription = useCallback(
    async (jobId: string) => {
      // No more ref cleanup needed

      const unsubscribeFn = unsubscribeFromJobRef.current;
      if (!unsubscribeFn) {
        console.error(`[WalletProfile] unsubscribeFromJob not available for jobId: ${jobId}`);
        return;
      }

      try {
        unsubscribeFn(jobId);
      } catch (err) {
        console.error(`[WalletProfile] Error unsubscribing from job ${jobId}:`, err);
      }
    },
    [],
  );

  const searchParams = useSearchParams();

  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');

    // Check if this job is already being tracked
    const isJobTracked = Object.values(scopeStates).some(state => state.jobId === jobIdFromUrl);

    if (jobIdFromUrl && !isJobTracked) {
      // Validate job exists before subscribing (prevents phantom job subscriptions)
      const validateAndSubscribe = async () => {
        try {
          const job = await fetcher(`/jobs/${jobIdFromUrl}`);
          if (job && (job.status === 'running' || job.status === 'queued')) {
            // Job exists and is active - subscribe to it
            await registerJobSubscription('deep', jobIdFromUrl);
          } else if (job && (job.status === 'completed' || job.status === 'failed')) {
            console.log(`[WalletProfile] Job ${jobIdFromUrl} from URL already ${job.status} - skipping subscription`);
          }
        } catch (error: any) {
          if (error.status === 404) {
            console.warn(`[WalletProfile] Job ${jobIdFromUrl} from URL not found - may have expired or never existed`);
          } else {
            console.error('Failed to validate job from URL', error);
          }
        }
      };

      validateAndSubscribe();
    }
  }, [searchParams, registerJobSubscription, scopeStates]);

  // Job progress callbacks
  const jobProgressCallbacks: UseJobProgressCallbacks = {
    onJobProgress: (data: JobProgressData) => {
      // Find scope from current state by matching jobId
      const scope = Object.entries(scopeStates).find(
        ([_, state]) => state.jobId === data.jobId
      )?.[0] as DashboardAnalysisScope | undefined;

      if (!scope) {
        return; // Job not tracked in this component
      }

      if (typeof data.progress === 'number') {
        setScopeProgress((prev) => {
          const current = prev[scope];
          if (Math.abs(data.progress - current) < 5 && data.progress !== 100) {
            return prev;
          }
          return { ...prev, [scope]: data.progress };
        });
      }
      setScopeStates((prev) => ({
        ...prev,
        [scope]: { ...prev[scope], status: 'running' },
      }));
    },
    onJobCompleted: async (data: JobCompletionData) => {
      // Read scope from job result (backend includes this in the return value)
      const resultData = data.result;
      const scope = resultData?.analysisScope as DashboardAnalysisScope | undefined;

      if (!scope) {
        console.warn(
          `[WalletProfile] Job completed without scope in result. JobId: ${data.jobId}`,
          `Result:`, resultData
        );

        // Fallback: try to find scope by matching jobId in scopeStates
        const matchingScope = Object.entries(scopeStates).find(
          ([_, state]) => state.jobId === data.jobId
        )?.[0] as DashboardAnalysisScope | undefined;

        // Clean up subscription even if scope wasn't found
        await clearJobSubscription(data.jobId);

        if (matchingScope) {
          console.log(`[WalletProfile] Recovered scope from state: ${matchingScope}`);

          const wasSkipped = resultData?.analysisSkipped === true;
          const finalStatus = wasSkipped ? 'skipped' : 'completed';

          setScopeProgress((prev) => ({ ...prev, [matchingScope]: 100 }));
          setScopeStates((prev) => ({
            ...prev,
            [matchingScope]: {
              ...prev[matchingScope],
              status: finalStatus,
              jobId: null,
              lastCompletedAt: new Date(data.timestamp),
              errorMessage: undefined,
            },
          }));
          setLastAnalysisStatus('success');
          setLastAnalysisTimestamp(new Date(data.timestamp));
        }
        return;
      }

      // Scope found in result - proceed with normal completion handling
      const followUpQueue = Array.isArray(resultData?.followUpJobsQueued)
        ? resultData.followUpJobsQueued
        : [];

      // Check if analysis was skipped (known wallet)
      const wasSkipped = resultData?.analysisSkipped === true;
      const finalStatus = wasSkipped ? 'skipped' : 'completed';

      setScopeProgress((prev) => ({ ...prev, [scope]: 100 }));
      setScopeStates((prev) => {
        const nextState: typeof prev = {
          ...prev,
          [scope]: {
            ...prev[scope],
            status: finalStatus,
            jobId: null,
            lastCompletedAt: new Date(data.timestamp),
            errorMessage: undefined,
          },
        };

        const followUpScopeSet = new Set(followUpQueue.map((f) => f.scope));
        scopeSequence.forEach((seqScope) => {
          if (seqScope === scope) {
            return;
          }
          const existing = prev[seqScope];
          if (existing.status === 'queued' && !followUpScopeSet.has(seqScope)) {
            nextState[seqScope] = {
              ...existing,
              status: 'skipped',
              jobId: null,
              errorMessage: undefined,
              lastCompletedAt: existing.lastCompletedAt ?? new Date(data.timestamp),
            };
          }
        });

        return nextState;
      });
      setLastAnalysisStatus('success');
      setLastAnalysisTimestamp(new Date(data.timestamp));

      if (followUpQueue.length) {
        await Promise.all(
          followUpQueue.map(async (followUp) => {
            await registerJobSubscription(followUp.scope, followUp.jobId);
          }),
        );
      }

      if (resultData?.enrichmentJobId) {
        setEnrichmentJobId(resultData.enrichmentJobId);
        const subscribeFn = subscribeToJobRef.current;
        if (subscribeFn) {
          await subscribeFn(resultData.enrichmentJobId);
        }
      }

      // Only show success notification for flash (7-day) analysis
      if (scope === 'flash') {
        toast.success(`${scopeLabels[scope]} ready`, {
          description: 'Recent snapshot refreshed.',
        });
      }

      try {
        // Small delay to ensure backend has finished writing updated data
        await new Promise(resolve => setTimeout(resolve, 500));

        // Refresh wallet summary for all time ranges (invalidate all summary cache keys)
        await globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/summary`),
        );
        // Also refresh dependent views so UI stops showing skeletons
        await globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`),
        );
        await globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/pnl-overview`),
        );
        await globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/behavioral-patterns`),
        );
      } catch (error) {
        console.error('Error refreshing wallet summary after completion', error);
      }

      // CHANGED: Direct mutate call instead of global cache invalidation
      // This ensures TokenPerformanceTab immediately refetches data
      if (scope === 'flash' || scope === 'working' || scope === 'deep') {
        try {
          const mutateFn = tokenPerformanceMutateRef.current;
          if (mutateFn) {
            await mutateFn();
          } else {
            console.error(`[WalletProfile] TokenPerformance mutate function not available yet`);
          }
        } catch (error) {
          console.error('Error refreshing token performance after scope completion', error);
        }
      }

      // Clean up subscription after all processing is complete
      // This ensures we don't lose the scope reference during processing
      await clearJobSubscription(data.jobId);
    },
    onJobFailed: (data: JobFailedData) => {
      // Find scope from current state by matching jobId
      const scope = Object.entries(scopeStates).find(
        ([_, state]) => state.jobId === data.jobId
      )?.[0] as DashboardAnalysisScope | undefined;

      if (!scope) {
        return; // Job not tracked in this component
      }

      clearJobSubscription(data.jobId);
      setScopeStates((prev) => ({
        ...prev,
        [scope]: {
          ...prev[scope],
          status: 'error',
          jobId: null,
          errorMessage: data.error,
        },
      }));
      setScopeProgress((prev) => ({ ...prev, [scope]: 0 }));
      setLastAnalysisStatus('error');
      toast.error(`${scopeLabels[scope]} failed`, {
        description: data.error || "An unexpected error occurred during analysis.",
      });
    },
    onEnrichmentComplete: async () => {
      setEnrichmentJobId(null);
      // CHANGED: Direct mutate call for immediate image refresh
      try {
        const mutateFn = tokenPerformanceMutateRef.current;
        if (mutateFn) {
          await mutateFn();
        }
        // Enrichment completes quietly without notification
      } catch (error) {
        console.error('Error refreshing token performance after enrichment', error);
      }
    },
    onEnrichmentError: ({ error }) => {
      setEnrichmentJobId(null);
      toast.error("Token enrichment failed", {
        description: error || "An unexpected error occurred during enrichment.",
      });
    },
    onJobQueueToStart: (data: JobQueueToStartData) => {
      // Find scope from current state by matching jobId
      const scope = Object.entries(scopeStates).find(
        ([_, state]) => state.jobId === data.jobId
      )?.[0] as DashboardAnalysisScope | undefined;

      if (!scope) return; // Job not tracked in this component

      setScopeStates((prev) => ({
        ...prev,
        [scope]: { ...prev[scope], status: 'running' },
      }));
    },
  };

  // Use the existing job progress hook
  const { subscribeToJob, unsubscribeFromJob, isConnected } = useJobProgress(jobProgressCallbacks);
  subscribeToJobRef.current = subscribeToJob;
  unsubscribeFromJobRef.current = unsubscribeFromJob;
  
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

  // Build wallet summary key with time range parameters
  let walletSummaryKey: string | null = null;
  if (walletAddress) {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate.toISOString();
    if (endDate) params.endDate = endDate.toISOString();
    walletSummaryKey = createCacheKey.walletSummary(walletAddress, Object.keys(params).length > 0 ? params : undefined);
  }
  const { data: walletSummary, error: summaryError } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      // No polling - we rely on WebSocket events and manual cache invalidation
      refreshInterval: 0,
      // Keep data fresh but don't auto-revalidate on every focus/reconnect
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Use global SWR config for all other settings
    }
  );

  // Each component will handle its own data loading
  // No detailed data loading at layout level
  const tabParam = searchParams.get('tab');

  // Tab state management - simplified without debouncing
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (tabParam && TAB_VALUES.has(tabParam)) {
      return tabParam;
    }
    return DEFAULT_TAB;
  });

  useEffect(() => {
    if (tabParam && TAB_VALUES.has(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam, activeTab]);
  
  // Direct tab change handler - no debouncing needed
  const handleTabChange = useCallback((value: string) => {
    if (value === activeTab) return; // Skip if already active
    setActiveTab(value);
  }, [activeTab]);

  // Removed preloading effect - preloadWalletData is empty and was causing unnecessary re-renders
  // Each tab component handles its own data loading when rendered

  // Removed redundant manual fetch - SWR handles initial loading automatically

  // CRITICAL FIX: Add validation to prevent stale SWR data from causing errors.
  // This ensures that the rendered data actually belongs to the wallet address in the URL.
  const isValidData = walletSummary && walletSummary.walletAddress === walletAddress;
  const isRestrictedWallet = walletSummary?.status === 'restricted';



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
      // Cleanup active scope jobs
      Object.entries(scopeStates).forEach(([_, state]) => {
        if (state.jobId) {
          const unsubscribeFn = unsubscribeFromJobRef.current;
          if (unsubscribeFn) {
            try { unsubscribeFn(state.jobId); } catch { /* ignore unsubscribe failures */ }
          }
        }
      });

      if (enrichmentJobId) {
        const unsubscribeFn = unsubscribeFromJobRef.current;
        if (unsubscribeFn) {
          try { unsubscribeFn(enrichmentJobId); } catch { /* ignore unsubscribe failures */ }
        }
      }
      setSubscribedEnrichmentJobId(null);
    };
  }, [enrichmentJobId, scopeStates]);

  // Subscribe to enrichment job when it's set (with duplicate prevention)
  const [subscribedEnrichmentJobId, setSubscribedEnrichmentJobId] = useState<string | null>(null);
  
  useEffect(() => {
    if (enrichmentJobId && isConnected && enrichmentJobId !== subscribedEnrichmentJobId) {
      subscribeToJob(enrichmentJobId);
      setSubscribedEnrichmentJobId(enrichmentJobId);
    }
    return () => {
      if (subscribedEnrichmentJobId && subscribedEnrichmentJobId !== enrichmentJobId) {
        const unsubscribeFn = unsubscribeFromJobRef.current;
        if (unsubscribeFn) {
          try { unsubscribeFn(subscribedEnrichmentJobId); } catch { /* ignore unsubscribe failures */ }
        }
      }
    };
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

  const triggerDashboardScope = useCallback(
    async (
      scope: DashboardAnalysisScope,
      options: {
        triggerSource: DashboardAnalysisTriggerSource;
        historyWindowDays?: number;
        targetSignatureCount?: number;
        queueWorkingAfter?: boolean;
        queueDeepAfter?: boolean;
        forceRefresh?: boolean;
        enrichMetadata?: boolean;
      },
    ) => {
      if (!isValidSolanaAddress(walletAddress)) {
        toast.error("Invalid Wallet Address", {
          description: "The address in the URL is not a valid Solana wallet address.",
        });
        return;
      }

      if (isRestrictedWallet) {
        if (options.triggerSource !== 'auto') {
          toast.info("Analysis unavailable", {
            description: "This wallet is restricted; analysis cannot be triggered.",
          });
        }
        return;
      }

      if (scopeStates[scope].status === 'running' || scopeStates[scope].status === 'queued') {
        if (options.triggerSource !== 'auto') {
          toast.info(`${scopeLabels[scope]} already in progress`, {
            description: "Please wait for the current run to finish before starting another.",
          });
        }
        return;
      }

      // Don't set status='queued' yet - wait for backend response
      // This prevents phantom "queued" states when analysis is skipped

        try {
          const payload: DashboardAnalysisRequest = {
            walletAddress,
            analysisScope: scope,
            triggerSource: options.triggerSource,
            forceRefresh: options.forceRefresh ?? false,
            historyWindowDays: options.historyWindowDays,
            targetSignatureCount: options.targetSignatureCount,
            queueWorkingAfter: options.queueWorkingAfter,
            queueDeepAfter: options.queueDeepAfter,
            enrichMetadata: options.enrichMetadata,
          };

          if (typeof window !== 'undefined' && options.triggerSource === 'auto') {
            // Prevent auto-trigger retry storms when a request fails.
            sessionStorage.setItem(`autoTrigger:${walletAddress}`, new Date().toISOString());
          }

          const response: DashboardAnalysisResponse = await fetcher('/analyses/wallets/dashboard-analysis', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

        if (response.alreadyRunning && response.jobId) {
          // Job already running - just subscribe to track it
          const subscribeFn = subscribeToJobRef.current;
          if (subscribeFn) {
            await subscribeFn(response.jobId);
          }
          setScopeStates((prev) => ({
            ...prev,
            [scope]: {
              ...prev[scope],
              status: 'running',
              jobId: response.jobId,
              errorMessage: undefined,
            },
          }));
          setScopeProgress((prev) => ({ ...prev, [scope]: prev[scope] ?? 0 }));
          if (options.triggerSource !== 'auto') {
            toast.info(`${scopeLabels[scope]} already running`, {
              description: 'Live updates will continue.',
            });
          }
        } else if (response.skipped) {
          setScopeStates((prev) => ({
            ...prev,
            [scope]: {
              ...prev[scope],
              status: 'skipped',
              jobId: null,
              lastCompletedAt: new Date(),
            },
          }));
          if (options.triggerSource !== 'auto') {
            const skipReason = response.skipReason ?? '';
            if (skipReason.startsWith('known-') || skipReason === 'known-wallet') {
              const knownLabel = skipReason.startsWith('known-') && skipReason !== 'known-wallet'
                ? skipReason.slice('known-'.length)
                : '';
              toast.warning('Analysis Blocked', {
                description: knownLabel
                  ? `This wallet is classified as a known ${knownLabel} and cannot be analyzed.`
                  : 'This is a known system or protocol wallet and cannot be analyzed.',
                duration: 5000,
              });
            } else {
              toast.info(`${scopeLabels[scope]} already fresh`, {
                description: skipReason ? skipReason.replace(/-/g, ' ') : 'No new data detected.',
              });
            }
          }
        } else if (response.jobId) {
          // NOW set status='queued' with the actual jobId
          await registerJobSubscription(scope, response.jobId);
          if (options.triggerSource !== 'auto') {
            toast.info(`${scopeLabels[scope]} queued`, {
              description: "Live updates will appear as soon as the job starts.",
            });
          }
          if (response.queuedFollowUpScopes?.length) {
            response.queuedFollowUpScopes.forEach((followUpScope) => {
              setScopeStates((prev) => ({
                ...prev,
                [followUpScope]: {
                  ...prev[followUpScope],
                  status: 'queued',
                  jobId: null,
                  errorMessage: undefined,
                },
              }));
              setScopeProgress((prev) => ({ ...prev, [followUpScope]: 0 }));
            });
          }
        }

        } catch (error: any) {
          console.error(`Failed to trigger ${scope} analysis`, error);
        setScopeStates((prev) => ({
          ...prev,
          [scope]: {
            ...prev[scope],
            status: 'error',
            jobId: null,
            errorMessage: error?.message || 'Unexpected error',
          },
        }));
        setScopeProgress((prev) => ({ ...prev, [scope]: 0 }));
        toast.error(`Failed to trigger ${scopeLabels[scope]}`, {
          description: error?.message || "An unexpected error occurred. Please try again.",
        });
      }
    },
    [walletAddress, registerJobSubscription, scopeLabels, scopeStates, isRestrictedWallet],
  );

    const shouldAutoTriggerFlash = useCallback(() => {
      if (!walletSummary || !walletAddress) {
        return false;
      }
      if (!isValidSolanaAddress(walletAddress)) {
        return false;
      }
      if (isDemoAccount) {
        return false;
      }
    if (walletSummary.status === 'restricted') {
      return false;
    }
    const currentStatus = scopeStates.flash.status;
    if (currentStatus === 'queued' || currentStatus === 'running') {
      return false;
    }
    const freshnessWindowMs = 30 * 60 * 1000; // 30 minutes
    if (walletSummary.lastAnalyzedAt) {
      const lastAnalyzed = new Date(walletSummary.lastAnalyzedAt);
      if (!Number.isNaN(lastAnalyzed.getTime()) && Date.now() - lastAnalyzed.getTime() < freshnessWindowMs) {
        return false;
      }
    }
    if (typeof window !== 'undefined') {
      const lastAuto = sessionStorage.getItem(`autoTrigger:${walletAddress}`);
      if (lastAuto) {
        const last = new Date(lastAuto);
        if (!Number.isNaN(last.getTime()) && Date.now() - last.getTime() < freshnessWindowMs) {
          return false;
        }
      }
    }
    return true;
  }, [walletSummary, walletAddress, scopeStates.flash.status, isDemoAccount]);

  useEffect(() => {
    if (!walletAddress || !hasInitialTokenSnapshot) {
      return;
    }
    if (isAutoTriggeringRef.current) {
      return;
    }
    if (!shouldAutoTriggerFlash()) {
      return;
    }

    isAutoTriggeringRef.current = true;
    triggerDashboardScope('flash', {
      triggerSource: 'auto',
      historyWindowDays: 7,
      targetSignatureCount: 250,
      queueWorkingAfter: true,
      queueDeepAfter: false,
    }).finally(() => {
      isAutoTriggeringRef.current = false;
    });
  }, [walletAddress, hasInitialTokenSnapshot, shouldAutoTriggerFlash, triggerDashboardScope]);

  const handleTriggerAnalysis = useCallback(async () => {
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

    if (isDemoAccount) {
      toast.info("This is a demo account", {
        description: "Triggering a new analysis is not available for demo accounts.",
        action: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    setLastAnalysisStatus('idle');

    await triggerDashboardScope('deep', {
      triggerSource: 'manual',
      forceRefresh: true,
      queueWorkingAfter: false,
      queueDeepAfter: false,
      enrichMetadata: true,
    });
  }, [triggerDashboardScope, isDemoAccount]);

  const handleToggleFavorite = async () => {
    if (!walletAddress || isTogglingFavorite) {
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
    if (!walletAddress) return;
    
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
  const handleQuickAddSave = async (formData: { nickname: string; collections: string[] }) => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          nickname: formData.nickname.trim() || undefined,
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

  // Edit modal functions
  const openEditModal = useCallback(() => {
    if (currentFavoriteData) {
      setShowEditModal(true);
    }
  }, [currentFavoriteData]);

  const handleEditSave = useCallback(async (formData: { nickname: string; collections: string[] }) => {
    if (!currentFavoriteData) return;

    try {
      await fetcher(`/users/me/favorites/${walletAddress}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nickname: formData.nickname.trim() || undefined,
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


  const ExpandedAnalysisControl = () => {
    const deepState = scopeStates.deep;
    const deepBusy = deepState.status === 'running' || deepState.status === 'queued';
    const ctaBusy = isAnalyzing;
    const ctaDisabled = ctaBusy || !walletAddress || isRestrictedWallet || isDemoAccount;
    const ctaLabel = isRestrictedWallet
      ? 'Analysis restricted'
      : isDemoAccount
        ? 'Analysis unavailable in demo'
        : deepBusy
          ? 'Deep sync running...'
          : ctaBusy
            ? 'Analysis running...'
          : 'Refresh';

    return (
      <div className="flex flex-col items-start gap-1 w-full md:w-auto">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleTriggerAnalysis}
                variant="outline"
                size="sm"
                className="w-full md:w-auto"
                disabled={ctaDisabled}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${ctaBusy ? 'animate-spin' : ''}`} />
                {ctaLabel}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Trigger full wallet analysis to refresh all data</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {!ctaBusy && !isRestrictedWallet && !isDemoAccount && lastAnalysisTimestamp && isValid(lastAnalysisTimestamp) ? (
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
        ) : null}
      </div>
    );
  };

  // REMOVED problematic global loading gate that was hiding the entire UI
  // Each component now handles its own loading state properly
  // Only block rendering for critical errors, not for loading states

  return (
    <div className="flex flex-col w-full bg-muted/40">
      {/* Header - wallet info, summary, filters */}
      <div className="bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-x-4 py-3 px-1 md:py-4">

          <div className='flex flex-col items-start gap-3 md:gap-2 md:pl-11'>
            {walletAddress && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {/* Use WalletBadge component with favorite data, toggle, and edit */}
                    <WalletBadge
                      address={walletAddress}
                      className="text-sm"
                      favoriteData={currentFavoriteData}
                      isFavorite={isCurrentWalletFavorite}
                      onFavoriteToggle={handleToggleFavorite}
                      onEdit={openEditModal}
                      showActions={true}
                      showMetrics={false}
                      knownType={walletSummary?.knownType ?? undefined}
                      knownLabel={walletSummary?.knownLabel ?? undefined}
                    />

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
                            <p>High-frequency trading wallet</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>

                  {/* Collections Display */}
                  {currentFavoriteData && currentFavoriteData.collections && currentFavoriteData.collections.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {currentFavoriteData.collections.map((collection: string) => (
                        <Badge
                          key={collection}
                          className={`text-xs px-2 py-0.5 font-medium ${getCollectionColorFilled(collection)}`}
                        >
                          {collection}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <ExpandedAnalysisControl />
              </>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-end gap-x-2 gap-y-2 mt-2 md:mt-0 flex-grow">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-x-2 gap-y-2">
              <AccountSummaryCard
                walletAddress={walletAddress}
                className=""
                triggerAnalysis={handleTriggerAnalysis}
                isAnalyzingGlobal={isAnalyzing}
                walletSummary={walletSummary}
                summaryError={summaryError}
                summaryIsLoading={!walletSummary && !summaryError}
              />
              <TimeRangeSelector />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col">
        <div className="bg-background border-b shadow-sm">
          <TabsList className="flex items-center justify-start gap-0.5 p-0.5 px-1 w-full bg-muted/20">
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
          </TabsList>
        </div>

        {/* Tab Content - flows naturally with page scroll */}
        <div className="w-full">

          <LazyTabContent value="token-performance" activeTab={activeTab} className="mt-0 p-0" defer={true}>
            <MemoizedTokenPerformanceTab walletAddress={walletAddress} isAnalyzingGlobal={isAnalyzing} triggerAnalysisGlobal={handleTriggerAnalysis} onInitialLoad={handleTokenDataPrimed} onMutateReady={handleTokenPerformanceMutateReady} />
          </LazyTabContent>

          <LazyTabContent value="account-stats" activeTab={activeTab} className="mt-0 p-0" defer={true}>
            <MemoizedAccountStatsPnlTab 
              walletAddress={walletAddress} 
              triggerAnalysisGlobal={handleTriggerAnalysis} 
              isAnalyzingGlobal={isAnalyzing} 
              lastAnalysisTimestamp={lastAnalysisTimestamp}
            />
          </LazyTabContent>

          <LazyTabContent value="behavioral-patterns" activeTab={activeTab} className="mt-0 p-0" defer={true}>
            <MemoizedBehavioralPatternsTab walletAddress={walletAddress} />
          </LazyTabContent>

          <LazyTabContent value="notes" activeTab={activeTab} className="mt-0 p-0" defer={true}>
            <MemoizedReviewerLogTab walletAddress={walletAddress} />
          </LazyTabContent>
        </div>
    </Tabs>

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
          collections: currentFavoriteData?.collections || [],
        }}
        title="Edit Wallet Data"
      />
      
      {/* Remove Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Tracked?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div>
                  Removing <span className="font-medium">{currentFavoriteData?.nickname || 'this wallet'}</span> from tracked will delete it&apos;s metadata.
                </div>
                
                {/* Show what will be lost */}
                {(currentFavoriteData?.nickname || (currentFavoriteData?.collections && currentFavoriteData.collections.length > 0)) && (
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

                      {currentFavoriteData?.collections && currentFavoriteData.collections.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground font-medium">Collections ({currentFavoriteData.collections.length}):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentFavoriteData.collections.slice(0, 3).map((collection: string) => (
                              <Badge key={collection} className={`text-xs font-medium ${getCollectionColorFilled(collection)}`}>
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
    </div>
  );
}
