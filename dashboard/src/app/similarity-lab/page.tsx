'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SyncConfirmationDialog } from '@/components/similarity-lab/SyncConfirmationDialog';
import { SimilarityResultDisplay } from '@/components/similarity-lab/results/SimilarityResultDisplay';
import { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { useToast } from '@/hooks/use-toast';
import { useJobProgress } from '@/hooks/useJobProgress';
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
  const [isPolling, setIsPolling] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true);
  
  const { toast } = useToast();
  const apiKey = useApiKeyStore((state) => state.apiKey);

  // WebSocket job progress hook - STANDARD AUTO-CONNECTION
  const {
    isConnected: wsConnected,
    error: wsError,
    subscribeToJob,
    unsubscribeFromJob,
    cleanup: cleanupWebSocket
  } = useJobProgress({
    onJobProgress: (data) => {
      if (data.jobId === currentJobId) {
        setJobProgress(data.progress);
        setSyncMessage(`Job in progress... ${data.status} (${Math.round(data.progress)}%)`);
      }
    },
    onEnrichmentComplete: (data) => {
      // Handle enrichment completion for progressive enhancement
      if (data.requestId && analysisResult && data.enrichedBalances) {
        console.log('🎨 Enrichment completed for request:', data.requestId);
        setEnrichedBalances(data.enrichedBalances);
        setIsEnriching(false);
        
        toast({
          title: "Enrichment Complete",
          description: "Token metadata and prices have been loaded!",
          variant: "default",
        });
      }
    },
    onEnrichmentError: (data) => {
      // Handle enrichment errors gracefully
      if (data.requestId && analysisResult) {
        console.error('❌ Enrichment failed for request:', data.requestId, data.error);
        setIsEnriching(false);
        
        toast({
          title: "Enrichment Failed",
          description: "Unable to load token metadata. Raw results are still available.",
          variant: "destructive",
        });
      }
    },
            onJobCompleted: async (data) => {
      // Handle similarity job completion
      if (data.jobId === currentJobId) {
        setJobProgress(100);
        setSyncMessage('Similarity analysis completed! Processing results...');
        
        try {
          // Get the similarity result
          const result = await fetcher(`/jobs/${data.jobId}/result`);
          
          if (!result || !result.result || !result.result.data) {
            throw new Error("Job completed but returned no data. The analysis may have failed silently.");
          }
          
          if (!result.result.data.pairwiseSimilarities || result.result.data.pairwiseSimilarities.length === 0) {
            throw new Error("Analysis completed but returned no similarity data. The wallets may have no overlapping activity.");
          }
          
          setAnalysisResult(result.result.data);
          
          // Set enrichment loading state and subscribe to enrichment job
          if (result.result.data.walletBalances && analysisMethod === 'advanced') {
            setIsEnriching(true);
            setEnrichedBalances(result.result.data.walletBalances);
            
            // Subscribe to enrichment job if it was queued
            if (result.result.enrichmentJobId) {
              setEnrichmentJobId(result.result.enrichmentJobId);
              subscribeToJob(result.result.enrichmentJobId);
              
              toast({
                title: "Analysis Complete",
                description: "Results loaded! Enriching with token metadata...",
                variant: "default",
              });
            } else {
              // No enrichment job was queued (error case)
              setIsEnriching(false);
              toast({
                title: "Analysis Complete",
                description: "Results loaded! Token enrichment unavailable.",
                variant: "default",
              });
            }
          }
          
          // Clean up similarity job subscription but keep enrichment subscription active
          unsubscribeFromJob(data.jobId);
          setCurrentJobId(null);
          setJobProgress(0);
          setSyncMessage('');
          setIsLoading(false);
          setIsPolling(false);
          
        } catch (error: any) {
          console.error('Error processing similarity job result:', error);
          const errorMessage = error?.payload?.message || error.message || 'Failed to process job result.';
          setSyncMessage(errorMessage);
          toast({
            variant: "destructive",
            title: "Result Processing Failed",
            description: errorMessage,
          });
          
          setCurrentJobId(null);
          setJobProgress(0);
          setIsLoading(false);
          setIsPolling(false);
        }
      }
      
      // Handle enrichment job completion
      if (data.jobId === enrichmentJobId) {
        try {
          const result = await fetcher(`/jobs/${data.jobId}/result`);
          
          if (result?.result?.enrichedBalances) {
            setEnrichedBalances(result.result.enrichedBalances);
            setIsEnriching(false);
            
            toast({
              title: "Enrichment Complete",
              description: "Token metadata and prices have been loaded!",
              variant: "default",
            });
          }
          
          // Clean up enrichment job subscription
          unsubscribeFromJob(data.jobId);
          setEnrichmentJobId(null);
          
        } catch (error: any) {
          console.error('Error processing enrichment job result:', error);
          setIsEnriching(false);
          
          toast({
            title: "Enrichment Failed",
            description: "Unable to load token metadata. Raw results are still available.",
            variant: "destructive",
          });
        }
      }
    },
        onJobFailed: (data) => {
      // Handle similarity job failure
      if (data.jobId === currentJobId) {
        const errorMessage = data.error || `Job failed: ${data.failedReason || 'Unknown error'}`;
        setSyncMessage(errorMessage);
        
        toast({
          variant: "destructive", 
          title: "Analysis Failed",
          description: errorMessage,
        });
        
        // Cleanup WebSocket subscription and clear all job state
        unsubscribeFromJob(data.jobId);
        setCurrentJobId(null);
        setJobProgress(0);
        setIsLoading(false);
        setIsPolling(false);
      }
      
      // Handle enrichment job failure  
      if (data.jobId === enrichmentJobId) {
        console.error('Enrichment job failed:', data);
        setIsEnriching(false);
        
        toast({
          variant: "destructive",
          title: "Enrichment Failed", 
          description: data.error || "Token enrichment failed. Raw results are still available.",
        });
        
        // Cleanup enrichment job subscription
        unsubscribeFromJob(data.jobId);
        setEnrichmentJobId(null);
      }
    },
    onConnectionChange: (connected) => {
      if (connected && currentJobId && useWebSocket && !isPolling) {
        // WebSocket connected during a job - subscribe immediately
        console.log('🔌 WebSocket connected during job - subscribing immediately');
        subscribeToJob(currentJobId);
      } else if (!connected && currentJobId && useWebSocket) {
        // WebSocket disconnected during a job - fallback to polling
        toast({
          title: "Connection Lost",
          description: "Falling back to polling for job updates.",
        });
        setUseWebSocket(false);
        pollJobStatus(currentJobId);
      }
    }
  });

  useEffect(() => {
    try {
      const savedResult = localStorage.getItem('analysisResult');
      if (savedResult) {
        const parsedResult = JSON.parse(savedResult);
        
        // Validate the data structure before setting state.
        // If the first pair is missing the `capitalAllocation` property,
        // assume the data is stale and discard it.
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

  // Cleanup WebSocket on unmount and job completion
  useEffect(() => {
    return () => {
      if (currentJobId) {
        unsubscribeFromJob(currentJobId);
      }
      if (enrichmentJobId) {
        unsubscribeFromJob(enrichmentJobId);
      }
      cleanupWebSocket();
    };
  }, [currentJobId, enrichmentJobId, unsubscribeFromJob, cleanupWebSocket]);

  useEffect(() => {
    if (analysisResult) {
      // localStorage.setItem('analysisResult', JSON.stringify(analysisResult)); // This line causes storage quota errors
      if (analysisResult?.walletBalances) {
        // Start with raw balances, clear old enriched data on new analysis
        setEnrichedBalances(analysisResult.walletBalances);
      }
    } else {
      // localStorage.removeItem('analysisResult');
      setEnrichedBalances(null);
    }
  }, [analysisResult]);

  const handleEnrichData = async () => {
    if (!analysisResult?.walletBalances) return;
    setIsEnriching(true);
    
    try {
      // Queue enrichment job (returns job ID)
      const enrichmentJob = await fetcher('/analyses/similarity/enrich-balances', {
        method: 'POST',
        body: JSON.stringify({ walletBalances: analysisResult.walletBalances }),
      });
      
      // Subscribe to enrichment job completion
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
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');
    
    // Reset job state
    setCurrentJobId(null);
    setJobProgress(0);
    setIsPolling(false);
    setUseWebSocket(true);

    const rawWalletList = wallets
      .replace(/[,|\n\r]+/g, ' ') // Robustly handle different separators
      .split(' ')
      .map(w => w.trim())
      .filter(Boolean);

    // Gracefully handle duplicates by using a Set
    const walletList = Array.from(new Set(rawWalletList));
    
    if (rawWalletList.length !== walletList.length) {
      toast({
        title: "Duplicate wallets removed",
        description: `We've automatically filtered out ${rawWalletList.length - walletList.length} duplicate addresses.`,
      });
    }

    if (walletList.length === 0) {
      setIsLoading(false);
      return;
    }

    const invalidWallets = walletList.filter(w => !isValidSolanaAddress(w.trim()));
    if (invalidWallets.length > 0) {
      toast({
        variant: "destructive",
        title: "Invalid Wallet Addresses",
        description: `Please correct the following: ${invalidWallets.join(', ')}`,
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
        setIsLoading(false); // Stop loading while dialog is open
      } else {
        // All wallets exist, proceed directly to analysis
        await runSimilarityAnalysis(walletList);
      }
    } catch (error: any) {
      console.error('Error checking wallet status:', error);
      const errorMessage = error?.payload?.message || error.message || 'Error checking wallet status. Please try again.';
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: errorMessage,
      })
      setSyncMessage(errorMessage);
      setIsLoading(false);
    }
  };

  const handleConfirmSync = async () => {
    setIsSyncDialogOpen(false);
    setIsLoading(true);
    setSyncMessage(`Triggering sync for ${missingWallets.length} wallet(s)...`);

    try {
      // Step 1: Trigger the analysis for the missing wallets. This returns immediately.
      await fetcher('/analyses/wallets/trigger-analysis', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: missingWallets }),
      });

      toast({
        title: "Sync Triggered",
        description: "The backend is now syncing the missing wallets. Waiting for completion...",
      });

      // Step 2: Poll for completion.
      const pollInterval = setInterval(async () => {
        const allWallets = Array.from(new Set(
          wallets.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
        ));

        try {
          const statusResponse: WalletStatusResponse = await fetcher('/analyses/wallets/status', {
            method: 'POST',
            body: JSON.stringify({ walletAddresses: allWallets }),
          });

          const walletsStillSyncing = statusResponse?.statuses?.filter((s) => s.status === 'IN_PROGRESS').map((s) => s.walletAddress) ?? [];

          if (walletsStillSyncing.length === 0) {
            clearInterval(pollInterval);
            setSyncMessage('All wallets are synced. Running similarity analysis...');
            toast({ title: "Sync Complete!", description: "All wallets are now ready." });
            
            // Note: We now run similarity analysis which will leverage the fresh wallet data
            // The similarity analysis will detect recently analyzed wallets and won't duplicate work
            await runSimilarityAnalysis(allWallets);
          } else {
            setSyncMessage(`Waiting for ${walletsStillSyncing.length} wallet(s) to sync... Checking again in 10 seconds.`);
          }
        } catch (error: any) {
          clearInterval(pollInterval);
          const errorMessage = error?.payload?.message || error.message || 'Error during polling.';
          setSyncMessage(`Error checking wallet status: ${errorMessage}. Polling stopped.`);
          toast({
              variant: "destructive",
              title: "Polling Failed",
              description: errorMessage,
          });
          setIsLoading(false);
        }
      }, 10000); // Poll every 10 seconds

    } catch (error: any) {
      const errorMessage = error?.payload?.message || error.message || "An unexpected error occurred.";
      setError(errorMessage);
      setSyncMessage(errorMessage);
      toast({
        title: "Error Triggering Sync",
        description: errorMessage,
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const runSimilarityAnalysis = async (walletList: string[]) => {
    if (analysisMethod === 'quick') {
      await runQuickAnalysis(walletList);
    } else {
      await runAdvancedAnalysis(walletList);
    }
  };

  // Quick analysis (existing synchronous method)
  const runQuickAnalysis = async (walletList: string[]) => {
    setIsLoading(true);
    setSyncMessage('Running quick analysis...');
    try {
      const data = await fetcher('/analyses/similarity', {
        method: 'POST',
        body: JSON.stringify({
          walletAddresses: walletList,
        }),
      });

      if (!data || !data.pairwiseSimilarities || data.pairwiseSimilarities.length === 0) {
        throw new Error("Analysis completed but returned no data. The wallets may have no overlapping activity.");
      }

      setAnalysisResult(data);
      setSyncMessage('');
    } catch (error: any) {
      console.error('Error running similarity analysis:', error);
      const errorMessage = error?.payload?.message || error.message || 'An error occurred during similarity analysis.';
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

  // Advanced analysis (new job-based method)
  const runAdvancedAnalysis = async (walletList: string[]) => {
    setIsLoading(true);
    setSyncMessage('Submitting job to queue...');
    setJobProgress(0);
    
    try {
      // Submit job
      const jobResponse = await fetcher('/analyses/similarity/queue', {
        method: 'POST',
        body: JSON.stringify({
          walletAddresses: walletList,
          vectorType: 'capital',
          failureThreshold: 0.8,
          timeoutMinutes: 30,
        }),
      });

      setCurrentJobId(jobResponse.jobId);
      setSyncMessage(`Job submitted! ID: ${jobResponse.jobId.slice(0, 8)}...`);
      
      // 🔑 IMMEDIATE SUBSCRIPTION: Subscribe right away, don't wait
      if (useWebSocket && wsConnected) {
        console.log('✅ WebSocket connected - subscribing to job immediately');
        subscribeToJob(jobResponse.jobId);
        setIsPolling(false);
        
        // Safety fallback: If no progress after 5 seconds, switch to polling
        setTimeout(() => {
          if (jobProgress === 0 && isLoading) {
            console.log('⚠️ No WebSocket progress after 5s - switching to polling');
            setUseWebSocket(false);
            pollJobStatus(jobResponse.jobId);
          }
        }, 5000);
      } else {
        console.log('📊 WebSocket not ready - using polling for job status');
        setUseWebSocket(false);
        await pollJobStatus(jobResponse.jobId);
      }
      
    } catch (error: any) {
      console.error('Error submitting job:', error);
      const errorMessage = error?.payload?.message || error.message || 'Failed to submit analysis job.';
      setSyncMessage(errorMessage);
      toast({
        variant: "destructive",
        title: "Job Submission Failed",
        description: errorMessage,
      });
      setIsLoading(false);
    }
  };

  // Poll job status
  const pollJobStatus = async (jobId: string) => {
    setIsPolling(true);
    
    const poll = async () => {
      try {
        const status = await fetcher(`/jobs/${jobId}`);  // Fixed: removed /status
        
        if (status.status === 'completed') {
          setJobProgress(100);
          setSyncMessage('Job completed! Processing results...');
          
          // Get the result - use the correct job result endpoint
          const result = await fetcher(`/jobs/${jobId}/result`);
          
          // Add null checks to prevent "Cannot convert undefined or null to object" error
          if (!result || !result.result || !result.result.data) {
            throw new Error("Job completed but returned no data. The analysis may have failed silently.");
          }
          
          // Validate the result has the expected structure (data is nested under result.data)
          if (!result.result.data.pairwiseSimilarities || result.result.data.pairwiseSimilarities.length === 0) {
            throw new Error("Analysis completed but returned no similarity data. The wallets may have no overlapping activity.");
          }
          
          setAnalysisResult(result.result.data);  // Extract the actual data object
          
          // Clear all job-related state
          setCurrentJobId(null);
          setJobProgress(0);
          setSyncMessage('');
          setIsLoading(false);
          setIsPolling(false);
          
          toast({
            title: "Analysis Complete",
            description: "Advanced similarity analysis finished successfully!",
          });
          
          return; // Exit polling
        } else if (status.status === 'failed') {
          const errorMessage = status.data?.error || `Job failed: ${status.data?.failedReason || 'Unknown error'}`;
          setSyncMessage(errorMessage);
          
          toast({
            variant: "destructive", 
            title: "Analysis Failed",
            description: errorMessage,
          });
          
          // Clear all job-related state
          setCurrentJobId(null);
          setJobProgress(0);
          setIsLoading(false);
          setIsPolling(false);
          
          return; // Exit polling
        } else {
          // Job still in progress
          setJobProgress(status.progress || 0);
          setSyncMessage(`Job in progress... ${status.status} (${Math.round(status.progress || 0)}%)`);
        }
        
        // Continue polling
        setTimeout(poll, 3000);
        
      } catch (error: any) {
        console.error('Error polling job status:', error);
        const errorMessage = error?.payload?.message || error.message || 'Job monitoring failed.';
        setSyncMessage(errorMessage);
        toast({
          variant: "destructive",
          title: "Job Failed",
          description: errorMessage,
        });
        
        // Clear all job-related state on error
        setCurrentJobId(null);
        setJobProgress(0);
        setIsLoading(false);
        setIsPolling(false);
      }
    };
    
    setTimeout(poll, 1000); // Start polling after 1 second
  };

  return (
    <div className="container mx-auto p-4 md:p-5">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Similarity LAB <span className="text-muted-foreground">- discover hidden connections</span></h1>
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
            className="min-h-[70px] font-mono pr-24" // Add padding to avoid text overlapping button
          />
          <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center space-x-2">
            {analysisResult && !isEnriching && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleEnrichData} variant="outline" size="sm">
                      Refresh Prices
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Populates the Contextual Holdings with the latest token prices and metadata.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isEnriching && <span className="text-sm text-muted-foreground">Loading...</span>}
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