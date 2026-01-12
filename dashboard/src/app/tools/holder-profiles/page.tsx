'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { JobProgressData, JobFailedData, JobCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { Loader2, Search } from 'lucide-react';
import type { HolderProfilesResult } from '@/components/holder-profiles/types';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import type { SimilarityStatus } from '@/components/holder-profiles/v2/SimilaritySidebar';
import type { JobResult } from '@/types/websockets';
import { TokenPulse } from '@/components/holder-profiles/v2/TokenPulse';
import {
  WalletClassifier,
  WalletClassifierEntry,
} from '@/components/holder-profiles/v2/WalletClassifier';
import { AppShell } from '@/components/layout/AppShell';
import { useAuthStore } from '@/store/auth-store';

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';
type AnalysisMode = 'token' | 'wallet';

type WalletParseResult = {
  list: string[];
  truncated: number;
};

type SimilarityJobResponse = {
  jobId: string;
};

function parseWalletList(raw: string): WalletParseResult {
  const tokens = raw
    .split(/\s|,/)
    .map((token) => token.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const ordered: string[] = [];
  tokens.forEach((token) => {
    if (!seen.has(token)) {
      seen.add(token);
      ordered.push(token);
    }
  });
  // No limit - allow unlimited wallets
  return { list: ordered, truncated: 0 };
}

function normalizeHolderProfilesError(message?: string | null): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid token mint') || normalized.includes('not a token mint')) {
    return 'Invalid token mint. Check the address and try again.';
  }
  return message;
}

export default function HolderProfilesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const userId = useAuthStore((state) => state.user?.id) ?? 'anon';
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('token');
  const [tokenMint, setTokenMint] = useState('');
  const [topN, setTopN] = useState(10);
  const [walletInput, setWalletInput] = useState('');
  const [walletEntries, setWalletEntries] = useState<WalletClassifierEntry[]>([]);
  const [tokenResult, setTokenResult] = useState<HolderProfilesResult | null>(null);
  const [tokenPartialResult, setTokenPartialResult] = useState<HolderProfilesResult | null>(null);
  const [lastSuccessfulTokenResult, setLastSuccessfulTokenResult] = useState<HolderProfilesResult | null>(null);
  const [lastSuccessfulTokenTimestamp, setLastSuccessfulTokenTimestamp] = useState<number | null>(null);
  const [tokenFailureError, setTokenFailureError] = useState<string | null>(null);
  const tokenJobIdRef = useRef<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<JobStatus>('idle');
  const [tokenProgress, setTokenProgress] = useState(0);
  const [similarityResult, setSimilarityResult] = useState<CombinedSimilarityResult | null>(null);
  const [similarityStatus, setSimilarityStatus] = useState<SimilarityStatus>('idle');
  const similarityJobIdRef = useRef<string | null>(null);
  const similarityTriggeredRef = useRef(false);
  const initializedFromUrlRef = useRef(false);
  const resumeAttemptedRef = useRef<string | null>(null);

  const debugFailAfterProfiles = useMemo(() => {
    const raw = searchParams.get('debugFailAfterProfiles');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }, [searchParams]);

  const parsedWallets = useMemo(() => parseWalletList(walletInput), [walletInput]);
  const tokenStorageKey = useMemo(() => {
    if (analysisMode !== 'token' || !tokenMint) return null;
    return `holder-profiles:${userId}:${tokenMint}:${topN}`;
  }, [analysisMode, tokenMint, topN, userId]);

  // Use a ref to store unsubscribeFromJob so we can call it from callbacks
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);
  const subscribeToJobRef = useRef<((jobId: string) => void) | null>(null);

  const updateWalletEntryByJob = useCallback((jobId: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
    setWalletEntries((prev) => prev.map((entry) => (entry.jobId === jobId ? updater(entry) : entry)));
  }, []);

  const updateWalletEntryByAddress = useCallback(
    (walletAddress: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
      setWalletEntries((prev) => prev.map((entry) => (entry.walletAddress === walletAddress ? updater(entry) : entry)));
    },
    []
  );

  // NOTE: We only trigger similarity after holder profiles completes to avoid mid-stream churn.
  // TODO: Use a cache-only flag once similarity can rely on BalanceCacheService for cached balances.
  const queueSimilarityAnalysis = useCallback(async (walletAddresses: string[]) => {
    if (walletAddresses.length < 2) {
      return;
    }
    // Guard against duplicate queuing - check both the job ref and the triggered flag
    if (similarityJobIdRef.current || similarityTriggeredRef.current) {
      return;
    }
    // Set flag immediately to prevent race conditions
    similarityTriggeredRef.current = true;
    setSimilarityStatus('pending');
    try {
      const response = await fetcher('/analyses/similarity/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddresses,
          vectorType: 'capital',
        }),
      }) as SimilarityJobResponse;
      similarityJobIdRef.current = response.jobId;
      setSimilarityStatus('running');
      subscribeToJobRef.current?.(response.jobId);
    } catch (error: any) {
      similarityTriggeredRef.current = false;
      setSimilarityStatus('failed');
      toast.error('Failed to start similarity analysis', {
        description: error.message || 'Unknown error',
      });
    }
  }, []);

  // NOTE: Similarity returns a standard JobResult wrapper; unwrap and normalize here.
  // TODO: Align this with the shared queue job result types once refactoring is prioritized.
  const extractSimilarityResult = useCallback((payload: JobResult | unknown): CombinedSimilarityResult | null => {
    if (!payload) {
      return null;
    }
    const maybeJobResult = payload as JobResult;
    const data = (maybeJobResult && typeof maybeJobResult === 'object' && 'data' in maybeJobResult)
      ? maybeJobResult.data
      : payload;
    const directResult = data as CombinedSimilarityResult;
    return directResult?.pairwiseSimilarities ? directResult : null;
  }, []);

  const { subscribeToJob, unsubscribeFromJob } = useJobProgress({
    onJobProgress: useCallback(
      (data: JobProgressData) => {
        if (tokenJobIdRef.current && data.jobId === tokenJobIdRef.current) {
          setTokenStatus('running');

          // Handle incremental holder profiles via progress payload
          if (typeof data.progress === 'object' && data.progress !== null && (data.progress as any).mode === 'token') {
            const payload = data.progress as any;
            const total = payload.totalHoldersRequested ?? payload.profiles?.length ?? 0;
            const analyzed = payload.analyzedCount ?? payload.profiles?.length ?? 0;
            const percent = total > 0 ? Math.min(100, Math.round((analyzed / total) * 100)) : 0;
            setTokenProgress(percent);
            setTokenPartialResult({
              mode: 'token',
              tokenMint: tokenMint || payload.tokenMint,
              profiles: payload.profiles ?? [],
              metadata: {
                totalHoldersRequested: total,
                totalHoldersAnalyzed: analyzed,
                totalProcessingTimeMs: 0,
                avgProcessingTimePerWalletMs: 0,
              },
            });
          } else if (typeof data.progress === 'number') {
            setTokenProgress(data.progress);
          }
          return;
        }
        if (similarityJobIdRef.current && data.jobId === similarityJobIdRef.current) {
          setSimilarityStatus('running');
          return;
        }
        updateWalletEntryByJob(data.jobId, (entry) => ({
          ...entry,
          status: 'running',
          progress: data.progress,
          message: data.status,
        }));
      },
      [updateWalletEntryByJob, tokenMint]
    ),

    onJobCompleted: useCallback(
      (data: JobCompletionData) => {
        if (tokenJobIdRef.current && data.jobId === tokenJobIdRef.current) {
          const resultData = data.result as unknown as HolderProfilesResult;
          if (resultData?.profiles) {
            setTokenResult(resultData);
            setTokenPartialResult(null);
            setTokenStatus('completed');
            setTokenProgress(100);
            setLastSuccessfulTokenResult(resultData);
            setLastSuccessfulTokenTimestamp(Date.now());
            setTokenFailureError(null);
            setSimilarityResult(null);
            setSimilarityStatus('idle');
            similarityTriggeredRef.current = false;
            if (similarityJobIdRef.current && unsubscribeFromJobRef.current) {
              unsubscribeFromJobRef.current(similarityJobIdRef.current);
              similarityJobIdRef.current = null;
            }
            // Unsubscribe from the completed job
            if (unsubscribeFromJobRef.current) {
              unsubscribeFromJobRef.current(tokenJobIdRef.current);
            }
            tokenJobIdRef.current = null;
            toast.success('Holder profiles ready', {
              description: `Analyzed ${resultData.metadata.totalHoldersAnalyzed} holders`,
            });
            if (resultData.profiles.length >= 2) {
              queueSimilarityAnalysis(resultData.profiles.map((profile) => profile.walletAddress));
            }
            if (typeof window !== 'undefined' && tokenStorageKey) {
              window.localStorage.removeItem(tokenStorageKey);
            }
          }
          return;
        }
        if (similarityJobIdRef.current && data.jobId === similarityJobIdRef.current) {
          const similarityData = extractSimilarityResult(data.result);
          if (similarityData) {
            setSimilarityResult(similarityData);
            setSimilarityStatus('completed');
          } else {
            console.warn('Similarity job completed without usable payload', data.result);
            setSimilarityStatus('failed');
          }
          if (unsubscribeFromJobRef.current) {
            unsubscribeFromJobRef.current(similarityJobIdRef.current);
          }
          similarityJobIdRef.current = null;
          return;
        }
        updateWalletEntryByJob(data.jobId, (entry) => ({
          ...entry,
          status: 'completed',
          progress: 100,
          message: 'Complete',
          result: data.result as unknown as HolderProfilesResult,
        }));
      },
      [updateWalletEntryByJob, extractSimilarityResult, queueSimilarityAnalysis, tokenStorageKey]
    ),

    onJobFailed: useCallback(
      (data: JobFailedData) => {
        if (tokenJobIdRef.current && data.jobId === tokenJobIdRef.current) {
          setTokenStatus('failed');
          setTokenProgress(0);
          setTokenResult(null);
          setTokenPartialResult(null);
          setTokenFailureError(normalizeHolderProfilesError(data.error) || 'Unknown error');
          if (typeof window !== 'undefined' && tokenStorageKey) {
            window.localStorage.removeItem(tokenStorageKey);
          }
          // Unsubscribe from the failed job
          if (unsubscribeFromJobRef.current) {
            unsubscribeFromJobRef.current(tokenJobIdRef.current);
          }
          tokenJobIdRef.current = null;
          toast.error('Token analysis failed', { description: normalizeHolderProfilesError(data.error) || data.error });
          return;
        }
        if (similarityJobIdRef.current && data.jobId === similarityJobIdRef.current) {
          setSimilarityStatus('failed');
          if (unsubscribeFromJobRef.current) {
            unsubscribeFromJobRef.current(similarityJobIdRef.current);
          }
          similarityJobIdRef.current = null;
          return;
        }
        updateWalletEntryByJob(data.jobId, (entry) => ({
          ...entry,
          status: 'failed',
          progress: 0,
          error: data.error,
        }));
      },
      [updateWalletEntryByJob, tokenStorageKey]
    ),

    onEnrichmentComplete: () => {},
    onConnectionChange: () => {},
  });

  // Store the unsubscribe function in the ref so callbacks can use it
  unsubscribeFromJobRef.current = unsubscribeFromJob;
  subscribeToJobRef.current = subscribeToJob;

  const resumeTokenJobFromStorage = useCallback(async () => {
    if (!tokenStorageKey || resumeAttemptedRef.current === tokenStorageKey) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    resumeAttemptedRef.current = tokenStorageKey;
    const jobId = window.localStorage.getItem(tokenStorageKey);
    if (!jobId) {
      return;
    }
    try {
      const jobStatus = await fetcher(`/jobs/${jobId}`);
      if (jobStatus?.status === 'completed') {
        const resultResponse = await fetcher(`/jobs/${jobId}/result`);
        const resultData = resultResponse?.result as HolderProfilesResult | undefined;
        if (resultData?.profiles) {
          setTokenResult(resultData);
          setTokenPartialResult(null);
          setTokenStatus('completed');
          setTokenProgress(100);
          setLastSuccessfulTokenResult(resultData);
          setLastSuccessfulTokenTimestamp(Date.now());
          setTokenFailureError(null);
          setSimilarityResult(null);
          setSimilarityStatus('idle');
          similarityTriggeredRef.current = false;
          if (resultData.profiles.length >= 2) {
            queueSimilarityAnalysis(resultData.profiles.map((profile) => profile.walletAddress));
          }
        }
        if (unsubscribeFromJobRef.current) {
          unsubscribeFromJobRef.current(jobId);
        }
        tokenJobIdRef.current = null;
        window.localStorage.removeItem(tokenStorageKey);
        return;
      }
      if (jobStatus?.status === 'failed') {
        setTokenStatus('failed');
        setTokenProgress(0);
        setTokenFailureError(normalizeHolderProfilesError(jobStatus?.error) || 'Unknown error');
        if (unsubscribeFromJobRef.current) {
          unsubscribeFromJobRef.current(jobId);
        }
        tokenJobIdRef.current = null;
        window.localStorage.removeItem(tokenStorageKey);
        return;
      }
      tokenJobIdRef.current = jobId;
      setTokenStatus('running');
      if (typeof jobStatus?.progress === 'number') {
        setTokenProgress(jobStatus.progress);
      } else {
        setTokenProgress(0);
      }
      subscribeToJobRef.current?.(jobId);
    } catch (error: any) {
      if (error?.status === 404) {
        window.localStorage.removeItem(tokenStorageKey);
        tokenJobIdRef.current = null;
        setTokenStatus('idle');
        setTokenProgress(0);
        setTokenFailureError(null);
        return;
      }
      console.warn('Failed to resume holder profiles job', error);
    }
  }, [tokenStorageKey, queueSimilarityAnalysis]);

  useEffect(() => {
    if (initializedFromUrlRef.current) {
      return;
    }
    const urlMode = searchParams.get('mode');
    if (urlMode === 'wallet' || urlMode === 'token') {
      setAnalysisMode(urlMode);
    }
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setTokenMint(urlToken);
    }
    const urlTopN = Number(searchParams.get('topN'));
    if (Number.isFinite(urlTopN) && urlTopN >= 1 && urlTopN <= 50) {
      setTopN(urlTopN);
    }
    initializedFromUrlRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!initializedFromUrlRef.current) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', analysisMode);
    if (analysisMode === 'token') {
      if (tokenMint) {
        params.set('token', tokenMint);
      } else {
        params.delete('token');
      }
      params.set('topN', String(topN));
    } else {
      params.delete('token');
      params.delete('topN');
    }
    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(`${pathname}?${nextQuery}`, { scroll: false });
    }
  }, [analysisMode, tokenMint, topN, pathname, router, searchParams]);

  useEffect(() => {
    if (!initializedFromUrlRef.current) {
      return;
    }
    if (analysisMode !== 'token') {
      return;
    }
    if (tokenStatus !== 'idle' || tokenResult || tokenPartialResult) {
      return;
    }
    resumeTokenJobFromStorage();
  }, [analysisMode, tokenResult, tokenPartialResult, tokenStatus, resumeTokenJobFromStorage]);

  const handleTokenAnalyze = async () => {
    if (!tokenMint || !isValidSolanaAddress(tokenMint)) {
      toast.error('Enter a valid token mint address');
      return;
    }

    if (topN < 1 || topN > 50) {
      toast.error('Top N must be between 1 and 50');
      return;
    }

    try {
      setTokenStatus('running');
      setTokenProgress(0);
      setTokenResult(null);
      setTokenPartialResult(null);
      setTokenFailureError(null);
      setSimilarityResult(null);
      setSimilarityStatus('idle');
      similarityTriggeredRef.current = false;
      if (similarityJobIdRef.current && unsubscribeFromJobRef.current) {
        unsubscribeFromJobRef.current(similarityJobIdRef.current);
        similarityJobIdRef.current = null;
      }
      const payload: Record<string, unknown> = { tokenMint, topN };
      if (process.env.NODE_ENV !== 'production' && debugFailAfterProfiles !== null) {
        payload.debugFailAfterProfiles = debugFailAfterProfiles;
      }
      const response = await fetcher('/analyses/holder-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      tokenJobIdRef.current = response.jobId;
      if (typeof window !== 'undefined' && tokenStorageKey) {
        window.localStorage.setItem(tokenStorageKey, response.jobId);
      }
      toast.success('Token analysis queued');
      subscribeToJob(response.jobId);
    } catch (error: any) {
      setTokenStatus('failed');
      const friendlyError = normalizeHolderProfilesError(error.message);
      setTokenFailureError(friendlyError || error.message || 'Unknown error');
      toast.error('Failed to start analysis', { description: friendlyError || error.message || 'Unknown error' });
    }
  };

  const handleWalletAnalyze = async () => {
    if (!parsedWallets.list.length) {
      toast.error('Add at least one wallet address');
      return;
    }

    const invalid = parsedWallets.list.filter((address) => !isValidSolanaAddress(address));
    if (invalid.length) {
      toast.error('Invalid wallet addresses', { description: invalid.join(', ') });
      return;
    }

    setWalletEntries(parsedWallets.list.map((walletAddress) => ({
      walletAddress,
      status: 'running',
      progress: 0,
    })));

    // Queue all jobs and subscribe via WebSocket
    for (const walletAddress of parsedWallets.list) {
      try {
        const response = await fetcher('/analyses/holder-profiles/wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        });
        updateWalletEntryByAddress(walletAddress, (entry) => ({
          ...entry,
          jobId: response.jobId,
          message: 'Queued',
        }));
        // WebSocket subscription happens immediately, HTTP poll is delayed in the hook
        subscribeToJob(response.jobId);
      } catch (error: any) {
        updateWalletEntryByAddress(walletAddress, (entry) => ({
          ...entry,
          status: 'failed',
          error: error.message || 'Failed to queue analysis',
        }));
      }
    }
  };

  const handleAnalyze = () => {
    if (analysisMode === 'token') handleTokenAnalyze();
    else handleWalletAnalyze();
  };

  const handleRemoveWallet = (address: string) => {
    const updated = parsedWallets.list.filter((value) => value !== address);
    setWalletInput(updated.join('\n'));
  };

  const isTokenRunning = tokenStatus === 'running';
  const isWalletRunning = walletEntries.some((entry) => entry.status === 'running');
  const disableAnalyze = analysisMode === 'token' ? isTokenRunning : isWalletRunning || parsedWallets.list.length === 0;
  const shouldShowLastSuccess = tokenStatus === 'failed'
    && lastSuccessfulTokenResult
    && lastSuccessfulTokenResult.tokenMint === tokenMint;
  const displayedTokenResult = tokenResult
    ?? tokenPartialResult
    ?? (shouldShowLastSuccess ? lastSuccessfulTokenResult : null);
  const lastSuccessLabel = lastSuccessfulTokenTimestamp
    ? new Date(lastSuccessfulTokenTimestamp).toLocaleString()
    : 'the previous run';
  const tokenNotice = shouldShowLastSuccess
    ? {
        title: 'Latest run failed',
        description: `${tokenFailureError ? `Error: ${tokenFailureError}. ` : ''}Showing last successful snapshot from ${lastSuccessLabel}.`,
        variant: 'default' as const,
      }
    : null;

  const retrySimilarity = useCallback(() => {
    if (!displayedTokenResult?.profiles?.length) {
      return;
    }
    // Reset state to allow retry
    similarityJobIdRef.current = null;
    similarityTriggeredRef.current = false;
    setSimilarityResult(null);
    setSimilarityStatus('idle');
    queueSimilarityAnalysis(displayedTokenResult.profiles.map((profile) => profile.walletAddress));
  }, [displayedTokenResult, queueSimilarityAnalysis]);

  return (
    <AppShell>
      <div className="w-full mx-auto px-4 md:px-6 lg:px-10 space-y-8 pb-8">
        <div className="max-w-6xl mx-auto space-y-1">
          <h1 className="text-2xl font-semibold">Holder Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Scan holder behavior patterns and conviction signals across top wallets.
          </p>
        </div>
        <Card className="max-w-6xl mx-auto p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              {analysisMode === 'token' ? (
                <Input
                  id="tokenMint"
                  placeholder="Token mint address"
                  value={tokenMint}
                  onChange={(e) => setTokenMint(e.target.value)}
                  disabled={tokenStatus === 'running'}
                  className="h-9"
                />
              ) : (
                <Input
                  id="walletAddresses"
                  placeholder="Wallet addresses (comma or space separated)"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  className="h-9"
                />
              )}
            </div>

            {analysisMode === 'token' && (
              <Select value={String(topN)} onValueChange={(value) => setTopN(parseInt(value, 10))}>
                <SelectTrigger className="h-9 w-[96px]">
                  <SelectValue placeholder="Top N" />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      Top {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button onClick={handleAnalyze} disabled={disableAnalyze} size="sm" className="h-9 px-5">
              {analysisMode === 'token' && isTokenRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tokenProgress}%
                </>
              ) : analysisMode === 'wallet' && isWalletRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" /> Check
                </>
              )}
            </Button>

            <Tabs value={analysisMode} onValueChange={(value) => setAnalysisMode(value as AnalysisMode)}>
              <TabsList className="h-9 grid w-[140px] grid-cols-2">
                <TabsTrigger value="token" className="text-xs">Token</TabsTrigger>
                <TabsTrigger value="wallet" className="text-xs">Wallet</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {analysisMode === 'wallet' && parsedWallets.list.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {parsedWallets.list.length} wallet{parsedWallets.list.length !== 1 ? 's' : ''} detected
            </p>
          )}
        </Card>

        {analysisMode === 'token' && displayedTokenResult && (
          <TokenPulse
            result={displayedTokenResult}
            similarityResult={similarityResult}
            similarityStatus={similarityStatus}
            isFinalAnalysis={similarityStatus !== 'idle'}
            notice={tokenNotice}
            onRetrySimilarity={retrySimilarity}
          />
        )}

        {analysisMode === 'token' && tokenStatus === 'failed' && !displayedTokenResult && (
          <Alert variant="destructive" className="max-w-6xl mx-auto">
            <AlertTitle>Holder profile analysis failed</AlertTitle>
            <AlertDescription>
              {tokenFailureError || 'No results available. Please check the token mint and try again.'}
            </AlertDescription>
          </Alert>
        )}

        {analysisMode === 'wallet' && walletEntries.length > 0 && <WalletClassifier entries={walletEntries} />}
      </div>
    </AppShell>
  );
}
