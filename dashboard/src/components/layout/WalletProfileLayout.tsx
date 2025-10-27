"use client";

import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import dynamic from 'next/dynamic';
import useSWR, { useSWRConfig } from 'swr';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import TimeRangeSelector from '@/components/shared/TimeRangeSelector';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

  Tags,
  FolderOpen,
  Edit2,
  Bot,          // Edit icon for wallet data
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
import { createCacheKey, invalidateWalletCache } from '@/lib/swr-config';
import { useFavorites } from '@/hooks/useFavorites';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { useJobProgress, UseJobProgressCallbacks } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData, EnrichmentCompletionData, JobQueueToStartData } from '@/types/websockets';
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
import { useSearchParams } from 'next/navigation';

import type { BehavioralPatternsTabProps } from '@/components/dashboard/BehavioralPatternsTab';
import type { TokenPerformanceTabProps } from '@/components/dashboard/TokenPerformanceTab';
import type { AccountStatsPnlTabProps } from '@/components/dashboard/AccountStatsPnlTab';
import type { ReviewerLogTabProps } from '@/components/dashboard/ReviewerLogTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
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
  () => import('@/components/dashboard/AccountStatsPnlTab'),
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

const TAB_VALUES = new Set<string>(['overview', 'token-performance', 'account-stats', 'behavioral-patterns', 'notes']);
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
  const { apiKey, isDemo: isDemoAccount } = useApiKeyStore();
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(() => {
    // Try to get the saved state from localStorage, default to true
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('wallet-profile-header-expanded');
      return saved !== null ? JSON.parse(saved) : true;
    }
    return true;
  });

  // Save the header expanded state to localStorage with throttling to prevent excessive writes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Use a ref to throttle localStorage writes
      const timeoutId = setTimeout(() => {
        localStorage.setItem('wallet-profile-header-expanded', JSON.stringify(isHeaderExpanded));
      }, 500); // Throttle to 500ms to reduce excessive writes
      
      return () => clearTimeout(timeoutId);
    }
  }, [isHeaderExpanded]);
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

  const jobIdToScopeRef = useRef<Record<string, DashboardAnalysisScope>>({});

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

  const handleTokenDataPrimed = useCallback(() => {
    setHasInitialTokenSnapshot(true);
  }, []);

  const registerJobSubscription = useCallback(
    async (scope: DashboardAnalysisScope, jobId: string) => {
      jobIdToScopeRef.current[jobId] = scope;
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
        console.warn('subscribeToJob not ready when registering job subscription', jobId);
        return;
      }

      await subscribeFn(jobId);
    },
    [],
  );

  const clearJobSubscription = useCallback(
    async (jobId: string) => {
      if (jobIdToScopeRef.current[jobId]) {
        delete jobIdToScopeRef.current[jobId];
      }

      const unsubscribeFn = unsubscribeFromJobRef.current;
      if (!unsubscribeFn) {
        return;
      }

      try {
        unsubscribeFn(jobId);
      } catch (err) {
        // ignore unsubscribe failures
      }
    },
    [],
  );

  const searchParams = useSearchParams();

  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');
    if (jobIdFromUrl && !jobIdToScopeRef.current[jobIdFromUrl]) {
      registerJobSubscription('deep', jobIdFromUrl).catch((error) =>
        console.error('Failed to subscribe to job from URL', error),
      );
    }
  }, [searchParams, registerJobSubscription]);

  // Job progress callbacks
  const jobProgressCallbacks: UseJobProgressCallbacks = {
    onJobProgress: (data: JobProgressData) => {
      const scope = jobIdToScopeRef.current[data.jobId];
      if (!scope) {
        return;
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
      const scope = jobIdToScopeRef.current[data.jobId];
      if (!scope) {
        return;
      }

      await clearJobSubscription(data.jobId);

      const resultData = data.result;
      const followUpQueue = Array.isArray(resultData?.followUpJobsQueued)
        ? resultData.followUpJobsQueued
        : [];

      setScopeProgress((prev) => ({ ...prev, [scope]: 100 }));
      setScopeStates((prev) => {
        const nextState: typeof prev = {
          ...prev,
          [scope]: {
            ...prev[scope],
            status: 'completed',
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

      toast.success(`${scopeLabels[scope]} ready`, {
        description:
          scope === 'deep'
            ? 'Full history synced and enriched.'
            : scope === 'working'
              ? '30-day view synced. Deep history will continue in the background.'
              : 'Recent snapshot refreshed.',
      });

      try {
        await globalMutate(
          createCacheKey.walletSummary(walletAddress),
          () => fetcher(createCacheKey.walletSummary(walletAddress)),
          { populateCache: true, revalidate: false },
        );
      } catch (error) {
        console.error('Error refreshing wallet summary after completion', error);
      }
    },
    onJobFailed: (data: JobFailedData) => {
      const scope = jobIdToScopeRef.current[data.jobId];
      if (!scope) {
        return;
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
    onEnrichmentComplete: () => {
      setEnrichmentJobId(null);
      setTimeout(() => {
        globalMutate(
          (key) => typeof key === 'string' && key.startsWith(`/wallets/${walletAddress}/token-performance`),
        );
        toast.success("Token data updated", {
          description: "Token metadata and prices have been updated.",
        });
      }, 1500);
    },
    onEnrichmentError: ({ error }) => {
      setEnrichmentJobId(null);
      toast.error("Token enrichment failed", {
        description: error || "An unexpected error occurred during enrichment.",
      });
    },
    onConnectionChange: (connected) => {
      if (!connected) {
        console.warn('WebSocket disconnected; awaiting reconnection for live job updates.');
      }
    },
    onJobQueueToStart: (data: JobQueueToStartData) => {
      const scope = jobIdToScopeRef.current[data.jobId];
      if (!scope) return;
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
  const walletSummaryKey = walletAddress ? createCacheKey.walletSummary(walletAddress) : null;
  const { data: walletSummary, error: summaryError } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      refreshInterval: isConnected ? 0 : 15000,
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
      Object.keys(jobIdToScopeRef.current).forEach((jobId) => {
        const unsubscribeFn = unsubscribeFromJobRef.current;
        if (unsubscribeFn) {
          try { unsubscribeFn(jobId); } catch { /* ignore unsubscribe failures */ }
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
  }, [enrichmentJobId]);

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

      setScopeStates((prev) => ({
        ...prev,
        [scope]: { ...prev[scope], status: 'queued', errorMessage: undefined },
      }));
      setScopeProgress((prev) => ({ ...prev, [scope]: 0 }));

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

        const response: DashboardAnalysisResponse = await fetcher('/analyses/wallets/dashboard-analysis', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (response.alreadyRunning && response.jobId) {
          jobIdToScopeRef.current[response.jobId] = scope;
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
            toast.info(`${scopeLabels[scope]} already fresh`, {
              description: response.skipReason ? response.skipReason.replace(/-/g, ' ') : 'No new data detected.',
            });
          }
        } else if (response.jobId) {
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
                  errorMessage: undefined,
                },
              }));
              setScopeProgress((prev) => ({ ...prev, [followUpScope]: 0 }));
            });
          }
        }

        if (typeof window !== 'undefined' && options.triggerSource === 'auto') {
          sessionStorage.setItem(`autoTrigger:${walletAddress}`, new Date().toISOString());
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
    const activeScope = scopeSequence.find(
      (scope) => scopeStates[scope].status === 'running' || scopeStates[scope].status === 'queued',
    );

    if (!activeScope) {
      return null;
    }

    const state = scopeStates[activeScope];
    const progress = scopeProgress[activeScope];
    const statusLabel =
      state.status === 'queued'
        ? 'Queued...'
        : `Processing ${Math.min(100, Math.max(0, Math.round(progress)))}%`;

    return (
      <div className="space-y-2 w-full">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {scopeLabels[activeScope]} · {statusLabel}
          </span>
          {state.status === 'running' && (
            <span className="text-muted-foreground">{Math.min(100, Math.max(0, Math.round(progress)))}%</span>
          )}
        </div>
        {state.status === 'running' && (
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(Math.round(progress), 5)}%` }}
            />
          </div>
        )}
      </div>
    );
  };

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
          : 'Run full rebuild';

    return (
      <div className="flex flex-col items-start gap-1 w-full md:w-auto">
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

        {renderAnalysisProgress()}

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
    <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col w-full bg-muted/40">
      <header className="sticky top-0 z-30 bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-x-4 py-2 px-1 md:py-3">
          
          <div className='flex flex-col items-start gap-3 md:gap-2 md:pl-11'> 
            {walletAddress && isHeaderExpanded && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {/* Use WalletBadge component */}
                    <WalletBadge address={walletAddress} className="text-sm" />
                    
                    {/* Display nickname if available */}
                    {currentFavoriteData?.nickname && (
                      <span className="text-sm font-medium text-muted-foreground">
                        ({currentFavoriteData.nickname})
                      </span>
                    )}
                    
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
                </div>
                <ExpandedAnalysisControl />
              </>
            )}

            {walletAddress && !isHeaderExpanded && (
              <div className="w-full flex items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-1 flex-shrink min-w-0">
                  {/* Use WalletBadge component for collapsed state */}
                  <WalletBadge address={walletAddress} className="text-xs" />
                  
                  {/* Display nickname if available */}
                  {currentFavoriteData?.nickname && (
                    <span className="text-xs font-medium text-muted-foreground truncate">
                      ({currentFavoriteData.nickname})
                    </span>
                  )}
                  
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
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-6 w-6 flex items-center justify-center">
                            <Bot className="h-3 w-3 text-orange-500" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>High-frequency trading wallet</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
            <div className={cn(
              "flex flex-col md:flex-row items-start md:items-center gap-x-2 gap-y-2",
              isHeaderExpanded ? "opacity-100 visible" : "opacity-0 invisible h-0 overflow-hidden"
            )}>
              <AccountSummaryCard 
                walletAddress={walletAddress}
                className="w-full sm:w-auto md:max-w-none"
                triggerAnalysis={handleTriggerAnalysis} 
                isAnalyzingGlobal={isAnalyzing}
                walletSummary={walletSummary}
                summaryError={summaryError}
                summaryIsLoading={!walletSummary && !summaryError}
              />
              <div className="flex flex-wrap items-center gap-1 mt-2">
                {scopeSequence.map((scope) => {
                  const state = scopeStates[scope];
                  const progress = scopeProgress[scope];
                  if (!state || state.status === 'idle') {
                    return null;
                  }
                  const label = state.status === 'running'
                    ? `${Math.min(100, Math.max(0, Math.round(progress)))}%`
                    : state.status === 'completed'
                      ? state.lastCompletedAt
                        ? `Updated ${formatDistanceToNow(state.lastCompletedAt, { addSuffix: true })}`
                        : 'Completed'
                      : state.status === 'skipped'
                        ? 'Fresh'
                        : state.status === 'queued'
                          ? 'Queued'
                          : state.status === 'error'
                            ? 'Failed'
                            : 'Idle';
                  return (
                    <Badge
                      key={scope}
                      variant="secondary"
                      className={cn('text-xs font-normal', scopeStatusStyles[state.status])}
                    >
                      {scopeLabels[scope]} · {label}
                    </Badge>
                  );
                })}
              </div>
              <TimeRangeSelector />
            </div>
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
          <LazyTabContent value="overview" activeTab={activeTab} className="mt-4" defer={false}>
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

          <LazyTabContent value="token-performance" activeTab={activeTab} className="mt-0 p-0 flex flex-col" defer={true}>
            <MemoizedTokenPerformanceTab walletAddress={walletAddress} isAnalyzingGlobal={isAnalyzing} triggerAnalysisGlobal={handleTriggerAnalysis} onInitialLoad={handleTokenDataPrimed} />
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
                  Removing <span className="font-medium">{currentFavoriteData?.nickname || 'this wallet'}</span> from favorites will delete it&apos;s metadata.
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
