'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { JobProgressData, JobFailedData, JobCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { Loader2, Search } from 'lucide-react';
import type { HolderProfilesResult } from '@/components/holder-profiles/types';
import { TokenPulse } from '@/components/holder-profiles/v2/TokenPulse';
import {
  WalletClassifier,
  WalletClassifierEntry,
} from '@/components/holder-profiles/v2/WalletClassifier';
import { AppShell } from '@/components/layout/AppShell';

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';
type AnalysisMode = 'token' | 'wallet';

type WalletParseResult = {
  list: string[];
  truncated: number;
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

export default function HolderProfilesPage() {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('token');
  const [tokenMint, setTokenMint] = useState('');
  const [topN, setTopN] = useState(10);
  const [walletInput, setWalletInput] = useState('');
  const [walletEntries, setWalletEntries] = useState<WalletClassifierEntry[]>([]);
  const [tokenResult, setTokenResult] = useState<HolderProfilesResult | null>(null);
  const [tokenPartialResult, setTokenPartialResult] = useState<HolderProfilesResult | null>(null);
  const tokenJobIdRef = useRef<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<JobStatus>('idle');
  const [tokenProgress, setTokenProgress] = useState(0);

  const parsedWallets = useMemo(() => parseWalletList(walletInput), [walletInput]);

  // Use a ref to store unsubscribeFromJob so we can call it from callbacks
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);

  const updateWalletEntryByJob = useCallback((jobId: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
    setWalletEntries((prev) => prev.map((entry) => (entry.jobId === jobId ? updater(entry) : entry)));
  }, []);

  const updateWalletEntryByAddress = useCallback(
    (walletAddress: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
      setWalletEntries((prev) => prev.map((entry) => (entry.walletAddress === walletAddress ? updater(entry) : entry)));
    },
    []
  );

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
        updateWalletEntryByJob(data.jobId, (entry) => ({
          ...entry,
          status: 'running',
          progress: data.progress,
          message: data.status,
        }));
      },
      [updateWalletEntryByJob]
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
            // Unsubscribe from the completed job
            if (unsubscribeFromJobRef.current) {
              unsubscribeFromJobRef.current(tokenJobIdRef.current);
            }
            tokenJobIdRef.current = null;
            toast.success('Holder profiles ready', {
              description: `Analyzed ${resultData.metadata.totalHoldersAnalyzed} holders`,
            });
          }
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
      [updateWalletEntryByJob]
    ),

    onJobFailed: useCallback(
      (data: JobFailedData) => {
        if (tokenJobIdRef.current && data.jobId === tokenJobIdRef.current) {
          setTokenStatus('failed');
          setTokenProgress(0);
          // Unsubscribe from the failed job
          if (unsubscribeFromJobRef.current) {
            unsubscribeFromJobRef.current(tokenJobIdRef.current);
          }
          tokenJobIdRef.current = null;
          toast.error('Token analysis failed', { description: data.error });
          return;
        }
        updateWalletEntryByJob(data.jobId, (entry) => ({
          ...entry,
          status: 'failed',
          progress: 0,
          error: data.error,
        }));
      },
      [updateWalletEntryByJob]
    ),

    onEnrichmentComplete: () => {},
    onConnectionChange: () => {},
  });

  // Store the unsubscribe function in the ref so callbacks can use it
  unsubscribeFromJobRef.current = unsubscribeFromJob;

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
          const response = await fetcher('/analyses/holder-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenMint, topN }),
      });
      tokenJobIdRef.current = response.jobId;
      toast.success('Token analysis queued');
      subscribeToJob(response.jobId);
    } catch (error: any) {
      setTokenStatus('failed');
      toast.error('Failed to start analysis', { description: error.message || 'Unknown error' });
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

        {analysisMode === 'token' && (tokenResult || tokenPartialResult) && (
          <TokenPulse
            result={(tokenResult ?? tokenPartialResult)!}
            isComplete={tokenStatus === 'completed'}
          />
        )}

        {analysisMode === 'wallet' && walletEntries.length > 0 && <WalletClassifier entries={walletEntries} />}
      </div>
    </AppShell>
  );
}
