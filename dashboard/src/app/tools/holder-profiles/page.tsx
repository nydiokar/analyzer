'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { JobProgressData, JobFailedData, JobCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { Loader2, Search, X } from 'lucide-react';
import type { HolderProfilesResult } from '@/components/holder-profiles/types';
import { TokenPulse } from '@/components/holder-profiles/v2/TokenPulse';
import {
  WalletClassifier,
  WalletClassifierEntry,
} from '@/components/holder-profiles/v2/WalletClassifier';

const MAX_WALLETS = 6;

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
  const list = ordered.slice(0, MAX_WALLETS);
  return { list, truncated: Math.max(0, ordered.length - list.length) };
}

export default function HolderProfilesPage() {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('token');
  const [tokenMint, setTokenMint] = useState('');
  const [topN, setTopN] = useState(10);
  const [walletInput, setWalletInput] = useState('');
  const [walletEntries, setWalletEntries] = useState<WalletClassifierEntry[]>([]);
  const [tokenResult, setTokenResult] = useState<HolderProfilesResult | null>(null);
  const tokenJobIdRef = useRef<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<JobStatus>('idle');
  const [tokenProgress, setTokenProgress] = useState(0);
  const [tokenMessage, setTokenMessage] = useState('');

  const parsedWallets = useMemo(() => parseWalletList(walletInput), [walletInput]);

  const updateWalletEntryByJob = useCallback((jobId: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
    setWalletEntries((prev) => prev.map((entry) => (entry.jobId === jobId ? updater(entry) : entry)));
  }, []);

  const updateWalletEntryByAddress = useCallback(
    (walletAddress: string, updater: (entry: WalletClassifierEntry) => WalletClassifierEntry) => {
      setWalletEntries((prev) => prev.map((entry) => (entry.walletAddress === walletAddress ? updater(entry) : entry)));
    },
    []
  );

  const { subscribeToJob } = useJobProgress({
    onJobProgress: useCallback(
      (data: JobProgressData) => {
        if (tokenJobIdRef.current && data.jobId === tokenJobIdRef.current) {
          setTokenStatus('running');
          setTokenProgress(data.progress);
          setTokenMessage(data.status || 'Analyzing holders...');
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
            setTokenStatus('completed');
            setTokenProgress(100);
            setTokenMessage('Analysis complete');
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
          setTokenMessage('Analysis failed');
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
      setTokenMessage('Queued');
      setTokenResult(null);
      const response = await fetcher('/analyses/holder-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenMint, topN }),
      });
      tokenJobIdRef.current = response.jobId;
      toast.success('Token analysis queued', { description: `Job ${response.jobId}` });
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
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Holder Profiles</h1>
        <p className="text-sm text-muted-foreground">Outcome-first analysis for token cohorts and wallet scouts.</p>
      </header>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 p-3 rounded-lg border bg-card">
        <Tabs value={analysisMode} onValueChange={(value) => setAnalysisMode(value as AnalysisMode)}>
          <TabsList className="h-9">
            <TabsTrigger value="token" className="text-xs">Token</TabsTrigger>
            <TabsTrigger value="wallet" className="text-xs">Wallet</TabsTrigger>
          </TabsList>
        </Tabs>

        {analysisMode === 'token' ? (
          <>
            <Input
              id="tokenMint"
              placeholder="Token mint address"
              value={tokenMint}
              onChange={(e) => setTokenMint(e.target.value)}
              disabled={tokenStatus === 'running'}
              className="h-9 flex-1"
            />
            <Input
              id="topN"
              type="number"
              min={1}
              max={50}
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value, 10) || 10)}
              disabled={tokenStatus === 'running'}
              className="h-9 w-20"
              placeholder="Top N"
            />
          </>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <Input
              id="walletAddresses"
              placeholder="Paste wallet addresses (comma separated)"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="h-9 flex-1"
            />
            {parsedWallets.list.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {parsedWallets.list.slice(0, 3).map((address) => (
                  <Badge key={address} variant="secondary" className="h-6 text-xs px-2">
                    {address.slice(0, 4)}...{address.slice(-4)}
                  </Badge>
                ))}
                {parsedWallets.list.length > 3 && (
                  <Badge variant="secondary" className="h-6 text-xs px-2">
                    +{parsedWallets.list.length - 3}
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}

        <Button onClick={handleAnalyze} disabled={disableAnalyze} size="sm" className="h-9">
          {analysisMode === 'token' && isTokenRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing... {tokenProgress}%
            </>
          ) : analysisMode === 'wallet' && isWalletRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing wallets
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" /> {analysisMode === 'token' ? 'Analyze token' : 'Analyze wallets'}
            </>
          )}
        </Button>
      </div>

      {analysisMode === 'token' && isTokenRunning && tokenMessage && (
        <p className="text-xs text-muted-foreground px-3">{tokenMessage}</p>
      )}

      {analysisMode === 'token' && tokenResult && <TokenPulse result={tokenResult} />}

      {analysisMode === 'wallet' && walletEntries.length > 0 && <WalletClassifier entries={walletEntries} />}
    </div>
  );
}



