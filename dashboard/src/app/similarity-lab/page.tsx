'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SyncConfirmationDialog } from '@/components/similarity-lab/SyncConfirmationDialog';
import { SimilarityResultDisplay } from '@/components/similarity-lab/results/SimilarityResultDisplay';
import { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { useToast } from '@/hooks/use-toast';
import { useJobProgress } from '@/hooks/useJobProgress';
import { JobProgressData, JobCompletionData, JobFailedData, EnrichmentCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from "@/lib/solana-utils";
import { useApiKeyStore } from '@/store/api-key-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Zap, Settings, Clock, Info, Sparkles } from 'lucide-react';

type WalletAnalysisStatus = 'READY' | 'STALE' | 'MISSING' | 'IN_PROGRESS';

interface WalletStatus {
  walletAddress: string;
  status: WalletAnalysisStatus;
}

interface WalletStatusResponse {
  statuses: WalletStatus[];
}

// Memoize the heavy SimilarityResultDisplay component to prevent unnecessary re-renders
const MemoizedSimilarityResultDisplay = memo(SimilarityResultDisplay);

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export default function AnalysisLabPage() {
  const [jobStatuses, setJobStatuses] = useState<{ analysis: JobStatus, enrichment: JobStatus }>({
    analysis: 'idle',
    enrichment: 'idle',
  });
  const [wallets, setWallets] = useState('');
  const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);
  const [missingWallets, setMissingWallets] = useState<string[]>([]);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Analysis method selection
  const [analysisMethod, setAnalysisMethod] = useState<'quick' | 'advanced'>('quick');
  
  // Job tracking for advanced method
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  
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
      // Case 2: The enrichment job has completed.
      else if (data.jobId === enrichmentJobId) {
        console.log('🎨 Processing completion for ENRICHMENT job:', data.jobId);
        try {
          const result = await fetcher(`/jobs/${data.jobId}/result`);
          // CORRECTED: The result is at result.result.enrichedBalances, not result.result.data.enrichedBalances
          if (!result || !result.result?.enrichedBalances) throw new Error("Enrichment job returned no balance data.");

          const enrichmentData = result.result;

          // Merge enriched data into the existing analysis result
          setAnalysisResult(prevResult => {
            if (!prevResult) return null; // Should not happen if flow is correct
            return {
              ...prevResult,
              walletBalances: enrichmentData.enrichedBalances,
            };
          });

          setJobStatuses(prev => ({ ...prev, enrichment: 'completed' }));
          toast({ title: "Token Data Loaded", description: "Prices and metadata have been updated." });
        } catch (error: any) {
          console.error('❌ Error fetching enrichment job result:', error);
          // Non-critical error, just toast it.
          toast({ variant: "destructive", title: "Enrichment Failed", description: error.message });
        }
      }
      // Case 3: An unrelated job completed. Ignore it.
      else {
        console.log('Ignoring completion for unrelated job:', data.jobId);
      }
    }, [toast, currentJobId, enrichmentJobId]),
    
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
    
    onEnrichmentComplete: useCallback((data: EnrichmentCompletionData) => {
      // THIS LOGIC IS NOW HANDLED IN onJobCompleted.
      // This callback remains to satisfy the hook but does nothing.
      console.log('🎨 onEnrichmentComplete fired but is handled by onJobCompleted.');
    }, []),
  });

  const isRunning = useMemo(() => jobStatuses.analysis === 'running' || jobStatuses.enrichment === 'running', [jobStatuses]);


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
    if (analysisMethod === 'quick') {
      await handleQuickAnalyze();
    } else {
      await handleAdvancedAnalyze();
    }
  };

  const handleQuickAnalyze = async () => {
    setJobStatuses({ analysis: 'running', enrichment: 'idle' });
    setAnalysisResult(null);
    setSyncMessage('');

    const walletList = Array.from(new Set(
      wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));

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

    try {
      const statusResponse: WalletStatusResponse = await fetcher('/analyses/wallets/status', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: walletList }),
      });
      
      const walletsNeedingWork = statusResponse?.statuses
        ?.filter((s) => s.status === 'STALE' || s.status === 'MISSING')
        .map((s) => s.walletAddress) || [];

      if (walletsNeedingWork.length > 0) {
        setMissingWallets(walletsNeedingWork);
        setIsSyncDialogOpen(true);
        setJobStatuses({ analysis: 'idle', enrichment: 'idle' });
      } else {
        await runQuickAnalysis(walletList);
      }
    } catch (error: any) {
      console.error('Error checking wallet status:', error);
      const errorMessage = error?.payload?.message || error.message || 'Error checking wallet status.';
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: errorMessage,
      });
      setSyncMessage(errorMessage);
      setJobStatuses({ analysis: 'failed', enrichment: 'idle' });
    }
  };

  const handleAdvancedAnalyze = async () => {
    setJobStatuses({ analysis: 'running', enrichment: 'idle' });
    setAnalysisResult(null);
    setSyncMessage('');
    setCurrentJobId(null);
    setJobProgress(0);

    const walletList = Array.from(new Set(
      wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));

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

    await runAdvancedAnalysis(walletList);
  };

  const handleConfirmSync = async () => {
    setIsSyncDialogOpen(false);
    setJobStatuses({ analysis: 'running', enrichment: 'idle' });
    setSyncMessage(`Triggering sync for ${missingWallets.length} wallet(s)...`);

    try {
      await fetcher('/analyses/wallets/trigger-analysis', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: missingWallets }),
      });

      toast({
        title: "Sync Triggered",
        description: "Syncing missing wallets...",
      });

      // Simple polling for sync completion
      const checkSync = async () => {
        const allWallets = Array.from(new Set(
          wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
        ));

        try {
          const statusResponse: WalletStatusResponse = await fetcher('/analyses/wallets/status', {
            method: 'POST',
            body: JSON.stringify({ walletAddresses: allWallets }),
          });

          const stillSyncing = statusResponse?.statuses?.filter((s) => s.status === 'IN_PROGRESS').length || 0;

          if (stillSyncing === 0) {
            setSyncMessage('Sync complete! Running analysis...');
            await runQuickAnalysis(allWallets);
          } else {
            setSyncMessage(`Syncing ${stillSyncing} wallet(s)...`);
            setTimeout(checkSync, 5000);
          }
        } catch (error: any) {
          setError(error.message);
          setJobStatuses({ analysis: 'failed', enrichment: 'idle' });
        }
      };

      setTimeout(checkSync, 2000);

    } catch (error: any) {
      const errorMessage = error?.payload?.message || error.message || "Sync failed.";
      setError(errorMessage);
      setSyncMessage(errorMessage);
      setJobStatuses({ analysis: 'failed', enrichment: 'idle' });
    }
  };

  const runQuickAnalysis = async (walletList: string[]) => {
    setSyncMessage('Running quick analysis...');
    try {
      const data = await fetcher('/analyses/similarity', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: walletList }),
      });

      if (!data || !data.pairwiseSimilarities || data.pairwiseSimilarities.length === 0) {
        throw new Error("No similarity data found.");
      }

      setAnalysisResult(data);
      setSyncMessage('');
    } catch (error: any) {
      console.error('Error running similarity analysis:', error);
      const errorMessage = error?.payload?.message || error.message || 'Analysis failed.';
      setSyncMessage(errorMessage);
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: errorMessage,
      });
    } finally {
      setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
    }
  };

  const runAdvancedAnalysis = async (walletList: string[]) => {
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
        const status = await fetcher(`/jobs/${jobId}`);
        
        if (status.status === 'completed') {
          // Job completed via polling - handle result directly
          try {
            const result = await fetcher(`/jobs/${jobId}/result`);
            
            if (result?.result?.data) {
              setAnalysisResult(result.result.data);
              
              if (result.result.data.walletBalances && analysisMethod === 'advanced') {
                setJobStatuses(prev => ({ ...prev, enrichment: 'running' }));
                // setEnrichedBalances(result.result.data.walletBalances); // This line is removed
              }
              
              if (result.result.enrichmentJobId) {
                setEnrichmentJobId(result.result.enrichmentJobId);
              } else {
                setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
              }
              
              setCurrentJobId(null);
              setSyncMessage('');
              
              toast({
                title: "Analysis Complete",
                description: "Results are ready!",
              });
            }
          } catch (error: any) {
            console.error('Error getting job result:', error);
            setError(error.message);
            setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          }
          return;
        } else if (status.status === 'failed') {
          const errorMessage = status.data?.error || 'Job failed';
          setError(errorMessage);
          setSyncMessage(errorMessage);
          setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          return;
        } else {
          const progress = status.progress || 0;
          setJobProgress(progress);
          setSyncMessage(`Job in progress... ${Math.round(progress)}%`);
        }
        
        setTimeout(poll, 3000);
        
      } catch (error: any) {
        console.error('Polling error:', error);
        setError(error.message);
        setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
      }
    };
    
    setTimeout(poll, 1000);
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
        
        <div className="relative">
          <Textarea
            value={wallets}
            onChange={(e) => setWallets(e.target.value)}
            placeholder="Enter wallet addresses, separated by commas, spaces, or new lines."
            className="min-h-[70px] font-mono pr-24"
          />
          <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center space-x-2">
            {analysisResult && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleEnrichData} variant="outline" size="sm" disabled={jobStatuses.enrichment === 'running'}>
                      {jobStatuses.enrichment === 'running' ? 'Enriching...' : 'Refresh Prices'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Loads the latest token prices and metadata.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button onClick={handleAnalyze} disabled={jobStatuses.analysis === 'running'}>
              {jobStatuses.analysis === 'running' ? 'Analyzing...' : 'Analyze'}
            </Button>
          </div>
        </div>
        
        {syncMessage && <p className="mt-4 text-center text-sm text-muted-foreground">{syncMessage}</p>}
        
        {/* Analysis Method Selection */}
        <div className="mt-4 pt-4 border-t">
          <h3 className="text-sm font-medium mb-3">Analysis Method</h3>
          <RadioGroup value={analysisMethod} onValueChange={(value) => setAnalysisMethod(value as 'quick' | 'advanced')} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <RadioGroupItem value="quick" id="quick" className="peer sr-only" />
              <Label
                htmlFor="quick"
                className="flex items-center space-x-2 rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                <div className="flex-1">
                  <div className="font-medium">Quick Analysis</div>
                  <div className="text-xs text-muted-foreground">Synchronous • ~30s</div>
                </div>
                <Badge variant="secondary">Classic</Badge>
              </Label>
            </div>
            <div>
              <RadioGroupItem value="advanced" id="advanced" className="peer sr-only" />
              <Label
                htmlFor="advanced"
                className="flex items-center space-x-2 rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
              >
                <Settings className="h-4 w-4" />
                <div className="flex-1">
                  <div className="font-medium">Advanced Analysis</div>
                  <div className="text-xs text-muted-foreground">Smart • Job Queue • Real-time Updates</div>
                </div>
                <Badge variant="outline">Smart</Badge>
              </Label>
            </div>
          </RadioGroup>
        </div>
        
        {/* Job Progress (Advanced Method) */}
        {analysisMethod === 'advanced' && jobStatuses.analysis === 'running' && (
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
          <MemoizedSimilarityResultDisplay results={analysisResult} />
        </div>
      )}

      <SyncConfirmationDialog
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
        onConfirm={handleConfirmSync}
        missingWallets={missingWallets}
      />
    </div>
  );
} 