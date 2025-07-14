'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { WalletInputForm } from '@/components/similarity-lab/WalletInputForm'; // Import the new form

import { SimilarityResultDisplay } from '@/components/similarity-lab/results/SimilarityResultDisplay';
import { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { useToast } from '@/hooks/use-toast';
import { useJobProgress } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData, EnrichmentCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from "@/lib/solana-utils";
import { useApiKeyStore } from '@/store/api-key-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Clock, Info, Sparkles } from 'lucide-react';



// Memoize the heavy SimilarityResultDisplay component to prevent unnecessary re-renders
const MemoizedSimilarityResultDisplay = memo(SimilarityResultDisplay);

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export default function AnalysisLabPage() {
  const [jobStatuses, setJobStatuses] = useState<{ analysis: JobStatus, enrichment: JobStatus }>({
    analysis: 'idle',
    enrichment: 'idle',
  });
  const [walletList, setWalletList] = useState<string[]>([]); // State to hold the final list of wallets
  const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);

  const [syncMessage, setSyncMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Job tracking for analysis
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  
  const { toast } = useToast();
  const apiKey = useApiKeyStore((state) => state.apiKey);

  // Simple WebSocket callbacks that DON'T depend on changing state
  const {
    isConnected: wsConnected,
    subscribeToJob,
    unsubscribeFromJob,
    cleanup: cleanupWebSocket
  } = useJobProgress({
    onJobProgress: useCallback((data: JobProgressData) => {
      // Only update the main progress bar for the main analysis job
      if (data.jobId === currentJobId) {
        console.log('📊 Main job progress:', data.jobId, data.progress);
        setJobProgress(data.progress);
        setSyncMessage(`Job in progress... ${data.status || 'processing'} (${Math.round(data.progress)}%)`);
      } else {
        console.log('🎨 Ignoring progress for other job:', data.jobId);
      }
    }, [currentJobId]),
    
    onJobCompleted: useCallback(async (data: any) => {
      console.log('✅ Job completed hook fired. Job ID:', data.jobId);

      // Case 1: The main analysis job has completed.
      if (data.jobId === currentJobId) {
        console.log('✅ Processing completion for MAIN job:', data.jobId);
        setJobProgress(100);
        setSyncMessage('Analysis complete! Fetching results...');
        try {
          const result = await fetcher(`/jobs/${data.jobId}/result`);
          if (!result || !result.result || !result.result.data) throw new Error("Job completed but returned no data.");
          
          const resultData = result.result;
          setAnalysisResult(resultData.data);
          setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
          
          // CRITICAL: Set the enrichmentJobId from the result payload
          if (resultData.enrichmentJobId) {
            setEnrichmentJobId(resultData.enrichmentJobId);
          }
          
          setCurrentJobId(null); // Clear the main job ID
          setSyncMessage('');
          toast({ title: "Analysis Complete", description: "Results are ready to view." });
        } catch (error: any) {
          console.error('❌ Error fetching main job result:', error);
          setError(error.message || 'Failed to fetch job results.');
          setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          setCurrentJobId(null);
        }
      } 
      // All enrichment logic is now in onEnrichmentComplete
      else {
        console.log('Ignoring completion for unrelated job:', data.jobId);
      }
    }, [toast, currentJobId]),
    
    onJobFailed: useCallback((data: JobFailedData) => {
      console.error('❌ Job failed:', data.jobId, data.error);
      if (data.jobId === currentJobId) {
        setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
      }
      if (data.jobId === enrichmentJobId) {
        setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
      }
      setError(data.error);
      setSyncMessage(data.error);
      setJobProgress(0);
      setCurrentJobId(null);
      toast({
        variant: "destructive",
        title: "Job Failed",
        description: data.error,
      });
    }, [toast, currentJobId, enrichmentJobId]),
    
    onEnrichmentComplete: useCallback(async (data: EnrichmentCompletionData) => {
      console.log('🎨 Processing completion for ENRICHMENT job:', data);
      try {
        // The enrichment data is passed directly in the event payload
        if (!data || !data.enrichedBalances) {
          throw new Error("Enrichment job returned no balance data.");
        }

        // Merge enriched data into the existing analysis result
        setAnalysisResult(prevResult => {
          if (!prevResult) return null; // Should not happen if flow is correct
          return {
            ...prevResult,
            walletBalances: data.enrichedBalances,
          };
        });

        setJobStatuses(prev => ({ ...prev, enrichment: 'completed' }));
        toast({ title: "Token Data Loaded", description: "Prices and metadata have been updated." });
      } catch (error: any) {
        console.error('❌ Error processing enrichment data:', error);
        // Non-critical error, just toast it.
        toast({ variant: "destructive", title: "Enrichment Failed", description: error.message });
        setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
        setIsRefreshing(false);
      }
    }, [toast]),
  });

  const isRunning = useMemo(() => jobStatuses.analysis === 'running' || jobStatuses.enrichment === 'running' || isRefreshing, [jobStatuses, isRefreshing]);

  // When enrichment is complete, no matter how it was triggered, stop the refreshing state.
  useEffect(() => {
    if (jobStatuses.enrichment === 'completed' || jobStatuses.enrichment === 'failed') {
      setIsRefreshing(false);
    }
  }, [jobStatuses.enrichment]);

  useEffect(() => {
    try {
      const savedResult = localStorage.getItem('analysisResult');
      if (savedResult) {
        const parsedResult = JSON.parse(savedResult);
        if (parsedResult?.pairwiseSimilarities?.[0] && parsedResult.pairwiseSimilarities[0].capitalAllocation === undefined) {
          console.warn('Stale analysis result found in localStorage. Discarding.');
          localStorage.removeItem('analysisResult');
        } else {
          setAnalysisResult(parsedResult);
        }
      }
    } catch (error) {
      console.error("Failed to parse analysis result from localStorage", error);
      localStorage.removeItem('analysisResult');
    }
  }, []);

  useEffect(() => {
    // This effect is no longer needed as we merge the state
  }, [analysisResult]);

  // Subscribe to enrichment job when ID is set
  useEffect(() => {
    if (enrichmentJobId && wsConnected) {
      console.log('🔔 Subscribing to enrichment job:', enrichmentJobId);
      subscribeToJob(enrichmentJobId);
      setJobStatuses(prev => ({ ...prev, enrichment: 'running' }));
    }
  }, [enrichmentJobId, wsConnected, subscribeToJob]);

  // This callback will be passed to the new form component
  const handleWalletsChange = useCallback((wallets: string[]) => {
    setWalletList(wallets);
  }, []);

  const handleRefreshPrices = useCallback(async () => {
    if (!analysisResult?.walletBalances) {
      toast({
        variant: 'destructive',
        title: 'Cannot Refresh',
        description: 'There are no balances to refresh.',
      });
      return;
    }
    setIsRefreshing(true);
    toast({ title: "Refreshing Prices...", description: "Fetching the latest token market data." });
    
    try {
      // Queue an enrichment job
      const job = await fetcher('/analyses/similarity/enrich-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey || '' },
        body: JSON.stringify({ walletBalances: analysisResult.walletBalances }),
      });

      if (job.jobId) {
        setEnrichmentJobId(job.jobId); // Set the ID to be tracked
        subscribeToJob(job.jobId);     // Subscribe to its progress
      } else {
        throw new Error("Failed to queue enrichment job.");
      }

    } catch (error: any) {
      setIsRefreshing(false);
      toast({
        variant: 'destructive',
        title: 'Refresh Failed',
        description: error.message || "Could not start the price refresh job.",
      });
    }
  }, [analysisResult, apiKey, subscribeToJob, toast, setEnrichmentJobId]);

  const handleEnrichData = async () => {
    if (!analysisResult?.walletBalances) return;
    setJobStatuses(prev => ({ ...prev, enrichment: 'running' }));
    
    try {
      const enrichmentJob = await fetcher('/analyses/similarity/enrich-balances', {
        method: 'POST',
        body: JSON.stringify({ walletBalances: analysisResult.walletBalances }),
      });
      
      if (enrichmentJob.jobId && wsConnected) {
        setEnrichmentJobId(enrichmentJob.jobId);
        subscribeToJob(enrichmentJob.jobId);
        
        toast({
          title: "Enrichment Started",
          description: "Fetching token prices and metadata...",
        });
      } else {
        throw new Error('Failed to start enrichment job');
      }
    } catch (error: any) {
      console.error('Error starting enrichment job:', error);
      setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
      
      toast({
        variant: 'destructive',
        title: "Enrichment Failed",
        description: error.message || "Could not start token enrichment.",
      });
    }
  };

  const handleAnalyze = async () => {
    setJobStatuses({ analysis: 'running', enrichment: 'idle' });
    setAnalysisResult(null);
    setSyncMessage('');
    setCurrentJobId(null);
    setJobProgress(0);

    if (walletList.length === 0) {
      setJobStatuses({ analysis: 'idle', enrichment: 'idle' });
      return;
    }

    const invalidWallets = walletList.filter(w => !isValidSolanaAddress(w.trim()));
    if (invalidWallets.length > 0) {
      toast({
        variant: "destructive",
        title: "Invalid Wallet Addresses",
        description: `Please correct: ${invalidWallets.join(', ')}`,
      });
      setJobStatuses({ analysis: 'idle', enrichment: 'idle' });
      return;
    }

    // Skip status checking - let the similarity processor handle sync intelligently
    await runAnalysis(walletList);
  };



  const runAnalysis = async (walletList: string[]) => {
    setSyncMessage('Submitting job to queue...');
    setJobProgress(0);
    
    try {
      const jobResponse = await fetcher('/analyses/similarity/queue', {
        method: 'POST',
        body: JSON.stringify({
          walletAddresses: walletList,
          vectorType: 'capital',
          failureThreshold: 0.8,
          timeoutMinutes: 30,
          enrichMetadata: true,
        }),
      });

      setCurrentJobId(jobResponse.jobId);
      setSyncMessage(`Job submitted! ID: ${jobResponse.jobId.slice(0, 8)}...`);
      
      if (wsConnected) {
        console.log('🔌 Using WebSocket for job updates');
        subscribeToJob(jobResponse.jobId);
        
        // Fallback to polling if no progress
        setTimeout(() => {
          if (jobProgress === 0 && jobStatuses.analysis === 'running') {
            console.log('⚠️ No WebSocket progress - falling back to polling');
            pollJobStatus(jobResponse.jobId);
          }
        }, 5000);
      } else {
        console.log('📊 WebSocket not connected - using polling');
        await pollJobStatus(jobResponse.jobId);
      }
      
    } catch (error: any) {
      console.error('Error submitting job:', error);
      const errorMessage = error?.payload?.message || error.message || 'Failed to submit job.';
      setSyncMessage(errorMessage);
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Job Submission Failed",
        description: errorMessage,
      });
      setJobStatuses({ analysis: 'failed', enrichment: 'idle' });
    }
  };

  const pollJobStatus = async (jobId: string) => {
    console.log('📊 Starting polling for job:', jobId);
    let attempts = 0;
    const maxAttempts = 60;
    
    const poll = async () => {
      if (attempts >= maxAttempts || jobStatuses.analysis !== 'running') return;
      
      attempts++;
      
      try {
        const jobStatus = await fetcher(`/jobs/${jobId}/status`);
        
        if (jobStatus.status === 'completed') {
          setJobProgress(100);
          setSyncMessage('Analysis complete! Fetching results...');
          
          const result = await fetcher(`/jobs/${jobId}/result`);
          setAnalysisResult(result.result.data);
          setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
          setCurrentJobId(null);
          setSyncMessage('');
          
          toast({
            title: "Analysis Complete",
            description: "Results are ready to view.",
          });
        } else if (jobStatus.status === 'failed') {
          setError(jobStatus.error || 'Job failed');
          setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          setCurrentJobId(null);
          
          toast({
            variant: "destructive",
            title: "Analysis Failed",
            description: jobStatus.error || "Job failed.",
          });
        } else if (jobStatus.status === 'active') {
          const progress = jobStatus.progress || 0;
          setJobProgress(progress);
          setSyncMessage(`Processing... ${Math.round(progress)}%`);
          setTimeout(poll, 2000);
        } else {
          setTimeout(poll, 2000);
        }
      } catch (error: any) {
        console.error('Error polling job status:', error);
        setTimeout(poll, 3000);
      }
    };
    
    setTimeout(poll, 1000);
  };

  const getWalletList = () => {
    return walletList;
  };

  return (
    <div className="container mx-auto p-4 md:p-5">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Similarity LAB <span className="text-muted-foreground">- discover hidden connections</span>
        </h1>
      </header>
      
      <div className="bg-card p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-semibold mb-2">Wallet Group Similarity</h2>
        <p className="text-muted-foreground mb-4">
          Enter a list of wallet addresses to analyze their similarity based on trading behavior and capital allocation.
        </p>
        
        <WalletInputForm
          onWalletsChange={handleWalletsChange}
          onAnalyze={handleAnalyze}
          isRunning={isRunning}
        />
        
        {syncMessage && <p className="mt-4 text-center text-sm text-muted-foreground">{syncMessage}</p>}
        
        {/* Job Progress */}
        {jobStatuses.analysis === 'running' && (
          <Alert className="mt-4">
            <Clock className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Job Progress</span>
                  <span className="text-sm font-mono">{Math.round(jobProgress)}%</span>
                </div>
                <Progress value={jobProgress} className="w-full" />
                <div className="text-xs text-muted-foreground">
                  Job ID: {currentJobId?.slice(0, 8)}...
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {analysisResult && (
        <div className="mt-6">
          <MemoizedSimilarityResultDisplay 
            results={analysisResult} 
            onRefreshPrices={handleRefreshPrices}
            isRefreshing={isRefreshing}
          />
        </div>
      )}


    </div>
  );
} 