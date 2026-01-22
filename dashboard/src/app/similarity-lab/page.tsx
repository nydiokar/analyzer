'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowUp } from 'lucide-react';

import { SmartWalletInput } from '@/components/similarity-lab/SmartWalletInput';
import { TokenHolderPicker } from '@/components/similarity-lab/TokenHolderPicker';
import { SimilarityResultDisplay } from '@/components/similarity-lab/results/SimilarityResultDisplay';
import { CombinedSimilarityResult, TokenInfo } from '@/components/similarity-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { toast } from 'sonner';
import { useJobProgress } from '@/hooks/useJobProgress';
import { JobProgressData, JobFailedData, EnrichmentCompletionData } from '@/types/websockets';
import { isValidSolanaAddress } from "@/lib/solana-utils";
import { AppShell } from '@/components/layout/AppShell';


// Removed TopProgressBar - progress now handled inline

// Memoize the heavy SimilarityResultDisplay component to prevent unnecessary re-renders
const MemoizedSimilarityResultDisplay = memo(SimilarityResultDisplay);

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export default function AnalysisLabPage() {
  // Core state management - textarea + selected holders are source of truth
  const [inputText, setInputText] = useState<string>('');
  const [detectedToken, setDetectedToken] = useState<string | null>(null);
  const [selectedHolderAddresses, setSelectedHolderAddresses] = useState<string[]>([]);
  const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);

  // Job status
  const [jobStatuses, setJobStatuses] = useState<{ analysis: JobStatus, enrichment: JobStatus }>({
    analysis: 'idle',
    enrichment: 'idle',
  });
  const [syncMessage, setSyncMessage] = useState('');
  const [, setError] = useState<string | null>(null);

  // Job tracking for analysis
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Back to top button state
  const [showBackToTop, setShowBackToTop] = useState(false);

  // toast is now imported directly from sonner
  const jobSocketDebug = process.env.NEXT_PUBLIC_JOB_SOCKET_DEBUG === 'true';

  // Handle token detection from textarea
  const handleTokenDetected = useCallback((token: string) => {
    // Only set if it's a new token (not already set) OR no token set yet
    setDetectedToken(prev => {
      // If we already have a token, only change if it's explicitly removed and a new one appears
      if (prev && prev !== token) {
        // Don't switch tokens - user needs to explicitly remove the old one first
        return prev;
      }
      return token;
    });
  }, []);

  // When textarea changes, check if token line was removed
  useEffect(() => {
    if (!detectedToken) return;

    const lines = inputText.split(/[\n,\s]+/).map(l => l.trim()).filter(Boolean);
    const hasToken = lines.some(l => l === detectedToken);

    if (!hasToken) {
      // Token was removed from textarea, clear holder selection
      setDetectedToken(null);
      setSelectedHolderAddresses([]);
    }
  }, [inputText, detectedToken]);

  // Simple WebSocket callbacks that DON'T depend on changing state
  const {
    isConnected: wsConnected,
    subscribeToJob,
    // unsubscribeFromJob,
    // cleanup: cleanupWebSocket
  } = useJobProgress({
    onJobProgress: useCallback((data: JobProgressData) => {
      // Only update the main progress bar for the main analysis job (not enrichment)
      if (data.jobId === currentJobId && jobStatuses.analysis === 'running') {
        if (jobSocketDebug) {
          console.log('📊 Main analysis progress:', data.jobId, data.progress);
        }
        setJobProgress(data.progress);
        setSyncMessage(`Analyzing similarities... ${data.status || 'processing'}`);
      } else {
        if (jobSocketDebug) {
          console.log('🎨 Ignoring progress for job:', data.jobId, '(enrichment or completed analysis)');
        }
      }
    }, [currentJobId, jobStatuses.analysis, jobSocketDebug]),
    
    onJobCompleted: useCallback(async (data: any) => {
      if (jobSocketDebug) {
        console.log('✅ Job completed hook fired. Job ID:', data.jobId);
      }

      // Case 1: The main analysis job has completed.
      if (data.jobId === currentJobId) {
        if (jobSocketDebug) {
          console.log('✅ Processing completion for MAIN job:', data.jobId);
        }
        setJobProgress(100);
        setSyncMessage('Analysis complete! Processing results...');
        try {
          // WebSocket should contain the full analysis result (either directly or hydrated by useJobProgress)
          if (!data.result) {
            throw new Error("WebSocket completion event missing result payload");
          }

          const resultData =
            data.result && 'data' in data.result && data.result.data
              ? data.result
              : { data: data.result };
          const walletCount =
            resultData.data?.summary?.walletCount ??
            Object.keys(resultData.data?.uniqueTokensPerWallet ?? {}).length ??
            Object.keys(resultData.data?.walletBalances ?? {}).length;
          if (jobSocketDebug) {
            console.log('✅ Using similarity result data from WebSocket:', {
              pairs: resultData.data?.pairwiseSimilarities?.length,
              wallets: walletCount,
              hasEnrichmentJob: !!resultData.enrichmentJobId
            });
          }
          
          // The correct data structure is: resultData.data (the actual analysis data)
          // resultData is the SimilarityFlowResult wrapper, resultData.data is the analysis data
          const analysisData = resultData.data ?? resultData;
          
          if (analysisData?.pairwiseSimilarities?.length > 0) {
            setAnalysisResult(analysisData);
          } else {
          }
          setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
          
          // Show user feedback about invalid wallets if any were filtered out
          if (resultData.metadata?.invalidWallets && resultData.metadata.invalidWallets.length > 0) {
            const invalidCount = resultData.metadata.invalidWallets.length;
            const totalCount = resultData.metadata.requestedWallets;
            const invalidWalletsList = resultData.metadata.invalidWallets
              .map((addr: string) => `${addr.slice(0, 8)}...${addr.slice(-4)}`)
              .join(', ');
            
            toast.success(`Analysis Complete (${invalidCount} Invalid Wallet${invalidCount > 1 ? 's' : ''} Skipped)`, {
              description: `Successfully analyzed ${resultData.metadata.processedWallets}/${totalCount} wallets. Invalid: ${invalidWalletsList}`,
            });
          } else {
            toast.success("Analysis Complete", { description: "Results are ready to view. Token data is loading in the background." });
          }
          
          // CRITICAL: Set the enrichmentJobId from the result payload
          if (resultData.enrichmentJobId) {
            setEnrichmentJobId(resultData.enrichmentJobId);
          }
          
          // Clear main analysis tracking
          setCurrentJobId(null);
          setJobProgress(0);
          setSyncMessage('');
        } catch (error: any) {
          console.error('❌ Error processing main job result:', error);
          setError(error.message || 'Failed to process job results.');
          setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          setCurrentJobId(null);
        }
      } 
      // All enrichment logic is now in onEnrichmentComplete
      else {
        if (jobSocketDebug) {
          console.log('Ignoring completion for unrelated job:', data.jobId);
        }
      }
    }, [toast, currentJobId, jobSocketDebug]),
    
    onJobFailed: useCallback((data: JobFailedData) => {
      console.error('❌ Job failed (WebSocket):', data.jobId, data.error);
      if (data.jobId === currentJobId) {
        setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
        setJobProgress(0);
        setSyncMessage('');
        setCurrentJobId(null);
        
        // Check if this is the "insufficient valid wallets" error
        const errorMessage = data.error;
        if (errorMessage.includes('Insufficient valid wallets for similarity analysis')) {
          toast.error("Analysis Failed: Invalid Wallets Detected", {
            description: "One or more wallet addresses are invalid or have no transaction data. Please check the wallet addresses and try again.",
          });
        } else if (errorMessage.includes('wallet(s) were found to be invalid') && errorMessage.includes('Invalid wallets:')) {
          // Extract invalid wallets from error message
          const invalidWalletsMatch = errorMessage.match(/Invalid wallets: ([^.]+)/);
          if (invalidWalletsMatch) {
            const invalidWalletsList = invalidWalletsMatch[1];
            const invalidCount = invalidWalletsList.split(', ').length;
            
            toast.error(`Analysis Failed - ${invalidCount} Invalid Wallet${invalidCount > 1 ? 's' : ''} Found`, {
              description: `The following wallet address${invalidCount > 1 ? 'es are' : ' is'} invalid: ${invalidWalletsList}`,
            });
          } else {
            toast.error("Analysis Failed - Invalid Wallets Found", {
              description: errorMessage,
            });
          }
        } else {
          toast.error("Analysis Failed", {
            description: errorMessage,
          });
        }
      }
      if (data.jobId === enrichmentJobId) {
        setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
        // Don't show toast for enrichment failures, they're non-critical
      }
      setError(data.error);
    }, [toast, currentJobId, enrichmentJobId]),
    
    onEnrichmentComplete: useCallback(async (data: EnrichmentCompletionData) => {
      if (jobSocketDebug) {
        console.log('🎨 Processing completion for ENRICHMENT job:', data);
      }
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
            walletBalances: data.enrichedBalances as Record<string, { 
              totalValueUsd: number;
              tokenBalances: (TokenInfo & { uiBalance: number; valueUsd: number | null })[];
            }>,
          };
        });

        setJobStatuses(prev => ({ ...prev, enrichment: 'completed' }));
        toast.success("Token Data Loaded", { description: "Prices and metadata have been updated." });
      } catch (error: any) {
        console.error('❌ Error processing enrichment data:', error);
        // Non-critical error, just toast it.
        toast.error("Enrichment Failed", { description: error.message });
        setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
        setIsRefreshing(false);
      }
    }, [toast, jobSocketDebug]),
  });

  const isRunning = useMemo(() => {
    return jobStatuses.analysis === 'running';
  }, [jobStatuses.analysis]);

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



  // Subscribe to enrichment job when ID is set
  useEffect(() => {
    if (enrichmentJobId && wsConnected) {
      if (jobSocketDebug) {
        console.log('🔔 Subscribing to enrichment job:', enrichmentJobId);
      }
      subscribeToJob(enrichmentJobId);
      setJobStatuses(prev => ({ ...prev, enrichment: 'running' }));
    }
  }, [enrichmentJobId, wsConnected, subscribeToJob, jobSocketDebug]);


  // Back to top functionality - listen to the main container scroll
  useEffect(() => {
    const handleScroll = () => {
      // Find the main scrollable container
      const mainElement = document.querySelector('main');
      if (mainElement) {
        setShowBackToTop(mainElement.scrollTop > 100);
      }
    };

    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll);
      return () => mainElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const scrollToTop = () => {
    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleRefreshPrices = useCallback(async () => {
    if (!analysisResult?.walletBalances) {
      toast.error('Cannot Refresh', {
        description: 'There are no balances to refresh.',
      });
      return;
    }
    setIsRefreshing(true);
    toast.info("Refreshing Prices...", { description: "Fetching the latest token market data." });
    
    try {
      // Queue an enrichment job
      const job = await fetcher('/analyses/similarity/enrich-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      toast.error('Refresh Failed', {
        description: error.message || "Could not start the price refresh job.",
      });
    }
  }, [analysisResult, subscribeToJob, toast, setEnrichmentJobId]);

  const handleAnalyze = async () => {
    // Prevent multiple simultaneous analyses
    if (jobStatuses.analysis === 'running') {
      if (jobSocketDebug) {
        console.log('⚠️ Analysis already running, ignoring duplicate request');
      }
      return;
    }

    // Combine wallets from textarea + selected holders
    const textareaLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
    const textareaWallets = textareaLines.filter(w => isValidSolanaAddress(w) && w !== detectedToken);

    // Merge with holder selections
    const allWallets = [...new Set([...textareaWallets, ...selectedHolderAddresses])];

    if (allWallets.length === 0) {
      toast.error("No Valid Wallets", {
        description: "Please enter at least two valid wallet addresses or select holders.",
      });
      return;
    }

    if (allWallets.length < 2) {
      toast.error("Insufficient Wallets", {
        description: "Please enter at least two wallet addresses for comparison.",
      });
      return;
    }

    setJobStatuses({ analysis: 'running', enrichment: 'idle' });
    // Only clear result if we're starting a new analysis (not if one just completed)
    if (jobStatuses.analysis !== 'completed') {
      setAnalysisResult(null);
    }
    setSyncMessage('');
    setCurrentJobId(null);
    setJobProgress(0);

    // Skip status checking - let the similarity processor handle sync intelligently
    await runAnalysis(allWallets);
  };



  const runAnalysis = async (walletList: string[]) => {
    setSyncMessage('Submitting job to queue...');
    setJobProgress(0);
    
    try {
      // NOTE: Similarity jobs currently perform their own balance fetch + system-wallet detection.
      // TODO: Allow cache-only runs once BalanceCacheService exposes a cache-only helper.
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
        if (jobSocketDebug) {
          console.log('🔌 Using WebSocket for job updates');
        }
        subscribeToJob(jobResponse.jobId);
      } else {
        if (jobSocketDebug) {
          console.log('📊 WebSocket not connected - using polling');
        }
        await pollJobStatus(jobResponse.jobId);
      }
      
    } catch (error: any) {
      console.error('Error submitting job:', error);
      const errorMessage = error?.payload?.message || error.message || 'Failed to submit job.';
      setSyncMessage(errorMessage);
      setError(errorMessage);
      toast.error("Job Submission Failed", {
        description: errorMessage,
      });
      setJobStatuses({ analysis: 'failed', enrichment: 'idle' });
    }
  };

  const pollJobStatus = async (jobId: string) => {
    if (jobSocketDebug) {
      console.log('📊 Starting polling for job:', jobId);
    }
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
          const resultData = result.result;
          const analysisData = resultData?.data ?? resultData;
          setAnalysisResult(analysisData);
          setJobStatuses(prev => ({ ...prev, analysis: 'completed' }));
          setCurrentJobId(null);
          setSyncMessage('');
          
          // Show user feedback about invalid wallets if any were filtered out 
          if (resultData?.metadata?.invalidWallets && resultData.metadata.invalidWallets.length > 0) {
            const invalidCount = resultData.metadata.invalidWallets.length;
            const totalCount = resultData.metadata.requestedWallets;
            const invalidWalletsList = resultData.metadata.invalidWallets
              .map((addr: string) => `${addr.slice(0, 8)}...${addr.slice(-4)}`)
              .join(', ');
            
            toast.success(`Analysis Complete (${invalidCount} Invalid Wallet${invalidCount > 1 ? 's' : ''} Skipped)`, {
              description: `Successfully analyzed ${resultData.metadata.processedWallets}/${totalCount} wallets. Invalid: ${invalidWalletsList}`,
            });
          } else {
            toast.success("Analysis Complete", {
              description: "Results are ready to view.",
            });
          }
        } else if (jobStatus.status === 'failed') {
          console.error('❌ Job failed (Polling):', jobId, jobStatus.error);
          const errorMessage = jobStatus.error || 'Job failed';
          setError(errorMessage);
          setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
          setCurrentJobId(null);
          
          // Only show toast if WebSocket is not connected (to avoid duplicate messages)
          if (!wsConnected) {
            // Check if the error message contains invalid wallet information
            if (errorMessage.includes('wallet(s) were found to be invalid') && errorMessage.includes('Invalid wallets:')) {
              // Extract invalid wallets from error message
              const invalidWalletsMatch = errorMessage.match(/Invalid wallets: ([^.]+)/);
              if (invalidWalletsMatch) {
                const invalidWalletsList = invalidWalletsMatch[1];
                const invalidCount = invalidWalletsList.split(', ').length;
                
                toast.error(`Analysis Failed - ${invalidCount} Invalid Wallet${invalidCount > 1 ? 's' : ''} Found`, {
                  description: `The following wallet address${invalidCount > 1 ? 'es are' : ' is'} invalid: ${invalidWalletsList}`,
                });
              } else {
                toast.error("Analysis Failed - Invalid Wallets Found", {
                  description: errorMessage,
                });
              }
            } else {
              toast.error("Analysis Failed", {
                description: errorMessage,
              });
            }
          }
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

  return (
    <AppShell>
      <div className="w-full px-4 md:px-6 lg:px-10 space-y-8 pb-8">
        {/* Header */}
        <div className="max-w-6xl mx-auto space-y-1">
          <h1 className="text-2xl font-semibold">Similarity Lab</h1>
          <p className="text-sm text-muted-foreground">
            Discover hidden connections between wallets through trading behavior and capital allocation patterns.
          </p>
        </div>

        {/* Main Input Card - Side by Side Layout */}
        <Card className="max-w-6xl mx-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_380px] gap-4">
            {/* Left: Wallet Input */}
            <SmartWalletInput
              value={inputText}
              onChange={setInputText}
              onAnalyze={handleAnalyze}
              isAnalyzing={jobStatuses.analysis === 'running'}
              onTokenDetected={handleTokenDetected}
              selectedHolderCount={selectedHolderAddresses.length}
            />

            {/* Right: Token Holder Picker (when token detected) */}
            {detectedToken && (
              <div className="border-l pl-4 hidden lg:block">
                <TokenHolderPicker
                  tokenMint={detectedToken}
                  selectedAddresses={selectedHolderAddresses}
                  onSelectionChange={setSelectedHolderAddresses}
                />
              </div>
            )}
          </div>

          {/* Mobile: Show holder picker below on small screens */}
          {detectedToken && (
            <div className="mt-4 pt-4 border-t lg:hidden">
              <TokenHolderPicker
                tokenMint={detectedToken}
                selectedAddresses={selectedHolderAddresses}
                onSelectionChange={setSelectedHolderAddresses}
              />
            </div>
          )}
        </Card>

        {/* Analysis Progress Indicator */}
        {jobStatuses.analysis === 'running' && (
          <Card className="max-w-6xl mx-auto p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Analyzing Similarities...</h3>
                <span className="text-sm font-mono text-muted-foreground">{jobProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${jobProgress}%` }}
                />
              </div>
              {syncMessage && (
                <p className="text-xs text-muted-foreground">{syncMessage}</p>
              )}
            </div>
          </Card>
        )}

        {/* Results Display */}
        {analysisResult && (
          <MemoizedSimilarityResultDisplay
            results={analysisResult}
            onRefreshPrices={handleRefreshPrices}
            isRefreshing={isRefreshing}
          />
        )}

        {!analysisResult && jobStatuses.analysis === 'completed' && (
          <div className="max-w-6xl mx-auto p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
            <p>⚠️ Analysis completed but no results to display. This might be a data issue.</p>
            <p>Debug info: analysisResult is {analysisResult ? 'truthy' : 'falsy'}</p>
            <p>Job status: {jobStatuses.analysis}</p>
            <p>Current job ID: {currentJobId || 'none'}</p>
          </div>
        )}

        {/* Back to Top Button */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-[100] bg-blue-600 hover:bg-blue-700 border-2 border-white/20 backdrop-blur-sm"
            size="icon"
          >
            <ArrowUp className="h-5 w-5 text-white" />
          </Button>
        )}
      </div>
    </AppShell>
  );
} 
