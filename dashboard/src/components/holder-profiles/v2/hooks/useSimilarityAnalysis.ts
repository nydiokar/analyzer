import { useState, useCallback, useRef, useEffect } from 'react';
import { fetcher } from '@/lib/fetcher';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import type { SimilarityStatus } from '../SimilaritySidebar';
import type { JobCompletionData, JobFailedData, JobProgressData } from '@/types/websockets';

interface UseSimilarityAnalysisOptions {
  /** Minimum profiles before triggering first analysis */
  minProfiles?: number;
  /** Whether to auto-trigger when threshold is met */
  autoTrigger?: boolean;
  /** Debounce delay in ms before triggering analysis */
  debounceMs?: number;
}

interface UseSimilarityAnalysisReturn {
  /** Current similarity analysis result */
  result: CombinedSimilarityResult | null;
  /** Current status of similarity analysis */
  status: SimilarityStatus;
  /** Number of wallets in current/pending analysis */
  analyzedWalletCount: number;
  /** Whether this is the final analysis with all wallets */
  isFinalAnalysis: boolean;
  /** Trigger similarity analysis with given wallet addresses */
  triggerAnalysis: (walletAddresses: string[]) => Promise<void>;
  /** Update profile count (for threshold-based auto-trigger) */
  onProfilesUpdate: (profiles: Array<{ walletAddress: string }>, isComplete: boolean) => void;
  /** Reset state for new analysis */
  reset: () => void;
}

interface SimilarityJobResponse {
  jobId: string;
  requestId: string;
  status: string;
  queueName: string;
  walletCount: number;
}

interface SimilarityFlowResult {
  success: boolean;
  data: CombinedSimilarityResult;
  requestId: string;
  timestamp: number;
  processingTimeMs: number;
  enrichmentJobId?: string;
  metadata: {
    requestedWallets: number;
    processedWallets: number;
    failedWallets: number;
    invalidWallets?: string[];
    successRate: number;
    processingTimeMs: number;
  };
}

export function useSimilarityAnalysis(options: UseSimilarityAnalysisOptions = {}): UseSimilarityAnalysisReturn {
  const { minProfiles = 5, autoTrigger = true, debounceMs = 500 } = options;

  const [result, setResult] = useState<CombinedSimilarityResult | null>(null);
  const [status, setStatus] = useState<SimilarityStatus>('idle');
  const [analyzedWalletCount, setAnalyzedWalletCount] = useState(0);
  const [isFinalAnalysis, setIsFinalAnalysis] = useState(false);

  // Track state for auto-triggering
  const currentJobIdRef = useRef<string | null>(null);
  const hasTriggeredInitialRef = useRef(false);
  const lastAnalyzedWalletsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isJobInFlightRef = useRef(false);

  // Store unsubscribe function in ref to avoid circular dependency
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);

  // WebSocket subscription for job progress
  const { subscribeToJob, unsubscribeFromJob } = useJobProgress({
    onJobProgress: useCallback((data: JobProgressData) => {
      if (currentJobIdRef.current && data.jobId === currentJobIdRef.current) {
        setStatus('running');
      }
    }, []),

    onJobCompleted: useCallback((data: JobCompletionData) => {
      if (currentJobIdRef.current && data.jobId === currentJobIdRef.current) {
        isJobInFlightRef.current = false;
        const flowResult = data.result as unknown as SimilarityFlowResult;
        if (flowResult?.data) {
          setResult(flowResult.data);
          setStatus('completed');
          setAnalyzedWalletCount(flowResult.metadata?.processedWallets ?? 0);
        } else {
          // Try to extract from different result structure
          const directResult = data.result as unknown as CombinedSimilarityResult;
          if (directResult?.pairwiseSimilarities) {
            setResult(directResult);
            setStatus('completed');
          } else {
            console.warn('[useSimilarityAnalysis] Completed but no valid result data');
            setStatus('failed');
          }
        }
        if (unsubscribeFromJobRef.current && currentJobIdRef.current) {
          unsubscribeFromJobRef.current(currentJobIdRef.current);
        }
        currentJobIdRef.current = null;
      }
    }, []),

    onJobFailed: useCallback((data: JobFailedData) => {
      if (currentJobIdRef.current && data.jobId === currentJobIdRef.current) {
        console.error('[useSimilarityAnalysis] Job failed:', data.error);
        isJobInFlightRef.current = false;
        setStatus('failed');
        if (unsubscribeFromJobRef.current && currentJobIdRef.current) {
          unsubscribeFromJobRef.current(currentJobIdRef.current);
        }
        currentJobIdRef.current = null;
      }
    }, []),

    onEnrichmentComplete: useCallback(() => {
      // Not used for similarity, but required by hook
    }, []),
  });

  // Store the unsubscribe function in ref after hook initialization
  unsubscribeFromJobRef.current = unsubscribeFromJob;

  // Trigger similarity analysis
  const triggerAnalysis = useCallback(async (walletAddresses: string[], isFinal = false) => {
    // Need at least 2 wallets for pairwise comparison
    if (walletAddresses.length < 2) {
      return;
    }

    // Prevent duplicate requests for same wallet set
    const newWalletSet = new Set(walletAddresses);
    const isSameSet =
      newWalletSet.size === lastAnalyzedWalletsRef.current.size &&
      walletAddresses.every((w) => lastAnalyzedWalletsRef.current.has(w));

    if (isSameSet && isJobInFlightRef.current) {
      return;
    }

    // Cancel existing job if running
    if (currentJobIdRef.current && unsubscribeFromJobRef.current) {
      unsubscribeFromJobRef.current(currentJobIdRef.current);
      currentJobIdRef.current = null;
    }

    setStatus('pending');
    setAnalyzedWalletCount(walletAddresses.length);
    setIsFinalAnalysis(isFinal);
    isJobInFlightRef.current = true;

    try {
      const response = await fetcher('/analyses/similarity/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddresses,
          vectorType: 'capital',
        }),
      }) as SimilarityJobResponse;

      currentJobIdRef.current = response.jobId;
      setStatus('running');
      subscribeToJob(response.jobId);

      // Track which wallets we analyzed
      lastAnalyzedWalletsRef.current = new Set(walletAddresses);
    } catch (error) {
      console.error('[useSimilarityAnalysis] Failed to queue analysis:', error);
      isJobInFlightRef.current = false;
      setStatus('failed');
    }
  }, [subscribeToJob]);

  // Handle profile updates for auto-triggering with debounce
  const onProfilesUpdate = useCallback((
    profiles: Array<{ walletAddress: string }>,
    isComplete: boolean
  ) => {
    if (!autoTrigger) return;

    const walletAddresses = profiles.map((p) => p.walletAddress);
    const profileCount = walletAddresses.length;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Check if holder profiles job is complete - trigger final analysis
    if (isComplete && profileCount >= 2) {
      const currentWallets = new Set(walletAddresses);
      const previousWallets = lastAnalyzedWalletsRef.current;

      // Check if we have new wallets that weren't in the last analysis
      const hasNewWallets = walletAddresses.some((w) => !previousWallets.has(w));
      const walletCountChanged = currentWallets.size !== previousWallets.size;

      if (hasNewWallets || walletCountChanged || !hasTriggeredInitialRef.current) {
        // Final analysis - trigger immediately
        hasTriggeredInitialRef.current = true;
        triggerAnalysis(walletAddresses, true);
      }
      return;
    }

    // Initial trigger at threshold - with debounce
    if (!hasTriggeredInitialRef.current && profileCount >= minProfiles) {
      debounceTimerRef.current = setTimeout(() => {
        if (!hasTriggeredInitialRef.current) {
          hasTriggeredInitialRef.current = true;
          triggerAnalysis(walletAddresses, false);
        }
      }, debounceMs);
    }
  }, [autoTrigger, minProfiles, debounceMs, triggerAnalysis]);

  // Reset state
  const reset = useCallback(() => {
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (currentJobIdRef.current && unsubscribeFromJobRef.current) {
      unsubscribeFromJobRef.current(currentJobIdRef.current);
      currentJobIdRef.current = null;
    }
    setResult(null);
    setStatus('idle');
    setAnalyzedWalletCount(0);
    setIsFinalAnalysis(false);
    hasTriggeredInitialRef.current = false;
    lastAnalyzedWalletsRef.current = new Set();
    isJobInFlightRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (currentJobIdRef.current && unsubscribeFromJobRef.current) {
        unsubscribeFromJobRef.current(currentJobIdRef.current);
      }
    };
  }, []);

  return {
    result,
    status,
    analyzedWalletCount,
    isFinalAnalysis,
    triggerAnalysis: useCallback((wallets: string[]) => triggerAnalysis(wallets, false), [triggerAnalysis]),
    onProfilesUpdate,
    reset,
  };
}
