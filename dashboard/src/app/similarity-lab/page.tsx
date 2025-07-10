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

export default function AnalysisLabPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [wallets, setWallets] = useState('');
  const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);
  const [enrichedBalances, setEnrichedBalances] = useState<Record<string, any> | null>(null);
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
      console.log('📊 Job progress:', data.jobId, data.progress);
      setJobProgress(data.progress);
      setSyncMessage(`Job in progress... ${data.status || 'processing'} (${Math.round(data.progress)}%)`);
    }, []),
    
    onJobCompleted: useCallback(async (data: any) => {
      console.log('✅ Job completed - Raw data:', data);
      
      if (data.jobId !== currentJobId) {
        console.log('✅ Ignoring completion for different job:', data.jobId, 'vs current:', currentJobId);
        return;
      }
      
      console.log('✅ Processing completion for our job:', data.jobId);
      setJobProgress(100);
      setSyncMessage('Job completed! Fetching results...');
      
      try {
        const result = await fetcher(`/jobs/${data.jobId}/result`);
        
        if (!result || !result.result || !result.result.data) {
          throw new Error("Job completed but returned no data.");
        }
        
        const resultData = result.result;
        
        if (resultData?.data) {
          console.log('✅ Setting analysis result from fetched data');
          setAnalysisResult(resultData.data);
          
          if (resultData.data.walletBalances && analysisMethod === 'advanced') {
            setIsEnriching(true);
            setEnrichedBalances(resultData.data.walletBalances);
          }
          
          if (resultData.enrichmentJobId) {
            setEnrichmentJobId(resultData.enrichmentJobId);
          } else {
            setIsLoading(false);
          }
          
          setCurrentJobId(null);
          setSyncMessage('');
          
          toast({
            title: "Analysis Complete",
            description: "Results are ready!",
          });
        } else {
          console.error('❌ No result data found in fetched job result');
          setError('Job completed but no result data found');
          setIsLoading(false);
        }
      } catch (error: any) {
        console.error('❌ Error fetching job result:', error);
        setError(error.message);
        setIsLoading(false);
      }
    }, [analysisMethod, toast, currentJobId]),
    
    onJobFailed: useCallback((data: JobFailedData) => {
      console.error('❌ Job failed:', data.jobId, data.error);
      setError(data.error);
      setSyncMessage(data.error);
      setIsLoading(false);
      setJobProgress(0);
      setCurrentJobId(null);
      toast({
        variant: "destructive",
        title: "Job Failed",
        description: data.error,
      });
    }, [toast]),
    
    onEnrichmentComplete: useCallback((data: EnrichmentCompletionData) => {
      console.log('🎨 Enrichment completed');
      if (data.enrichedBalances) {
        setEnrichedBalances(data.enrichedBalances);
        setIsEnriching(false);
        toast({
          title: "Enrichment Complete",
          description: "Token metadata loaded!",
        });
      }
    }, [toast]),
  });



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
    if (analysisResult?.walletBalances) {
      setEnrichedBalances(analysisResult.walletBalances);
    } else {
      setEnrichedBalances(null);
    }
  }, [analysisResult]);

  // Subscribe to enrichment job when ID is set
  useEffect(() => {
    if (enrichmentJobId && wsConnected) {
      console.log('🔔 Subscribing to enrichment job:', enrichmentJobId);
      subscribeToJob(enrichmentJobId);
    }
  }, [enrichmentJobId, wsConnected, subscribeToJob]);

  const handleEnrichData = async () => {
    if (!analysisResult?.walletBalances) return;
    setIsEnriching(true);
    
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
      setIsEnriching(false);
      
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
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');

    const walletList = Array.from(new Set(
      wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));

    if (walletList.length === 0) {
      setIsLoading(false);
      return;
    }

    const invalidWallets = walletList.filter(w => !isValidSolanaAddress(w.trim()));
    if (invalidWallets.length > 0) {
      toast({
        variant: "destructive",
        title: "Invalid Wallet Addresses",
        description: `Please correct: ${invalidWallets.join(', ')}`,
      });
      setIsLoading(false);
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
        setIsLoading(false);
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
      setIsLoading(false);
    }
  };

  const handleAdvancedAnalyze = async () => {
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');
    setCurrentJobId(null);
    setJobProgress(0);

    const walletList = Array.from(new Set(
      wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));

    if (walletList.length === 0) {
      setIsLoading(false);
      return;
    }

    const invalidWallets = walletList.filter(w => !isValidSolanaAddress(w.trim()));
    if (invalidWallets.length > 0) {
      toast({
        variant: "destructive",
        title: "Invalid Wallet Addresses",
        description: `Please correct: ${invalidWallets.join(', ')}`,
      });
      setIsLoading(false);
      return;
    }

    await runAdvancedAnalysis(walletList);
  };

  const handleConfirmSync = async () => {
    setIsSyncDialogOpen(false);
    setIsLoading(true);
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
          setIsLoading(false);
        }
      };

      setTimeout(checkSync, 2000);

    } catch (error: any) {
      const errorMessage = error?.payload?.message || error.message || "Sync failed.";
      setError(errorMessage);
      setSyncMessage(errorMessage);
      setIsLoading(false);
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
      setIsLoading(false);
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
          if (jobProgress === 0 && isLoading) {
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
      setIsLoading(false);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    console.log('📊 Starting polling for job:', jobId);
    let attempts = 0;
    const maxAttempts = 60;
    
    const poll = async () => {
      if (attempts >= maxAttempts || !isLoading) return;
      
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
                setIsEnriching(true);
                setEnrichedBalances(result.result.data.walletBalances);
              }
              
              if (result.result.enrichmentJobId) {
                setEnrichmentJobId(result.result.enrichmentJobId);
              } else {
                setIsLoading(false);
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
            setIsLoading(false);
          }
          return;
        } else if (status.status === 'failed') {
          const errorMessage = status.data?.error || 'Job failed';
          setError(errorMessage);
          setSyncMessage(errorMessage);
          setIsLoading(false);
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
        setIsLoading(false);
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
                    <Button onClick={handleEnrichData} variant="outline" size="sm" disabled={isEnriching}>
                      {isEnriching ? 'Enriching...' : 'Refresh Prices'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Loads the latest token prices and metadata.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button onClick={handleAnalyze} disabled={isLoading}>
              {isLoading ? 'Analyzing...' : 'Analyze'}
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
        {analysisMethod === 'advanced' && currentJobId && (
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
          <MemoizedSimilarityResultDisplay results={analysisResult} enrichedBalances={enrichedBalances} />
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