'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useJobProgress } from '@/hooks/useJobProgress';
import { JobProgressData, JobFailedData } from '@/types/websockets';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { Loader2, Search } from 'lucide-react';
import { HolderProfilesTable } from '@/components/holder-profiles/HolderProfilesTable';
import { HolderProfilesStats } from '@/components/holder-profiles/HolderProfilesStats';

interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;
  behaviorType: string | null;
  exitPattern: string | null;
  dataQualityTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
}

interface HolderProfilesResult {
  tokenMint: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export default function HolderProfilesPage() {
  const [tokenMint, setTokenMint] = useState('');
  const [topN, setTopN] = useState(10);
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<HolderProfilesResult | null>(null);

  const { isConnected: wsConnected, subscribeToJob } = useJobProgress({
    onJobProgress: useCallback(
      (data: JobProgressData) => {
        if (data.jobId === currentJobId && jobStatus === 'running') {
          console.log('📊 Holder profiles progress:', data.jobId, data.progress);
          setJobProgress(data.progress);
          setProgressMessage(data.status || 'Analyzing holders...');
        }
      },
      [currentJobId, jobStatus]
    ),

    onJobCompleted: useCallback(
      async (data: any) => {
        console.log('✅ Holder profiles job completed:', data.jobId);

        if (data.jobId === currentJobId) {
          setJobProgress(100);
          setProgressMessage('Analysis complete!');

          try {
            if (!data.result || !data.result.profiles) {
              throw new Error('Result data missing profiles');
            }

            const resultData = data.result as HolderProfilesResult;
            setResult(resultData);
            setJobStatus('completed');

            toast.success('Holder Profiles Complete', {
              description: `Analyzed ${resultData.metadata.totalHoldersAnalyzed} holders in ${Math.round(resultData.metadata.totalProcessingTimeMs / 1000)}s`,
            });

            setCurrentJobId(null);
            setJobProgress(0);
            setProgressMessage('');
          } catch (error: any) {
            console.error('❌ Error processing result:', error);
            setJobStatus('failed');
            setCurrentJobId(null);
            toast.error('Failed to process results', {
              description: error.message || 'Unknown error',
            });
          }
        }
      },
      [currentJobId]
    ),

    onJobFailed: useCallback(
      (data: JobFailedData) => {
        console.error('❌ Holder profiles job failed:', data.jobId, data.error);
        if (data.jobId === currentJobId) {
          setJobStatus('failed');
          setJobProgress(0);
          setProgressMessage('');
          setCurrentJobId(null);

          toast.error('Analysis Failed', {
            description: data.error || 'Unknown error',
          });
        }
      },
      [currentJobId]
    ),

    onEnrichmentComplete: () => {},
    onConnectionChange: (connected: boolean) => {
      console.log(connected ? '✅ WebSocket connected' : '🔌 WebSocket disconnected');
    },
  });

  const handleAnalyze = async () => {
    if (!tokenMint || !isValidSolanaAddress(tokenMint)) {
      toast.error('Invalid token address', {
        description: 'Please enter a valid Solana token mint address',
      });
      return;
    }

    if (topN < 1 || topN > 50) {
      toast.error('Invalid holder count', {
        description: 'Please enter a value between 1 and 50',
      });
      return;
    }

    try {
      setJobStatus('running');
      setJobProgress(0);
      setProgressMessage('Starting analysis...');
      setResult(null);

      const response = await fetcher('/analyses/holder-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenMint, topN }),
      });

      console.log('✅ Job queued:', response.jobId);
      setCurrentJobId(response.jobId);

      if (wsConnected) {
        subscribeToJob(response.jobId);
      } else {
        toast.warning('WebSocket not connected', {
          description: 'Job queued but real-time updates may not work',
        });
      }
    } catch (error: any) {
      console.error('❌ Failed to queue job:', error);
      setJobStatus('failed');
      toast.error('Failed to start analysis', {
        description: error.message || 'Unknown error',
      });
    }
  };

  const isRunning = jobStatus === 'running';

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Token Holder Profiles{' '}
          <span className="text-muted-foreground">— analyze holding behavior</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Analyze holding patterns for top token holders: median/avg hold time, flip ratio (&lt;5min
          positions), behavior classification
        </p>
      </header>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="tokenMint">Token Mint Address</Label>
              <Input
                id="tokenMint"
                placeholder="e.g., JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
                value={tokenMint}
                onChange={(e) => setTokenMint(e.target.value)}
                disabled={isRunning}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="topN">Top N Holders</Label>
              <Input
                id="topN"
                type="number"
                min="1"
                max="50"
                value={topN}
                onChange={(e) => setTopN(parseInt(e.target.value) || 10)}
                disabled={isRunning}
              />
            </div>
          </div>

          <Button onClick={handleAnalyze} disabled={isRunning} className="w-full md:w-auto">
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing... {jobProgress}%
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Analyze Holders
              </>
            )}
          </Button>

          {isRunning && progressMessage && (
            <div className="mt-2 text-sm text-muted-foreground">{progressMessage}</div>
          )}
        </div>
      </Card>

      {result && (
        <>
          <HolderProfilesStats result={result} />
          <HolderProfilesTable profiles={result.profiles} tokenMint={result.tokenMint} />
        </>
      )}
    </div>
  );
}
