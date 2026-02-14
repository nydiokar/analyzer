'use client';

import { useState, useEffect, useMemo, memo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowUp, FlaskConical, X } from 'lucide-react';

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
import { TokenBadge } from '@/components/shared/TokenBadge';
import { PageTitle } from '@/components/shared/PageTitle';
import { useFavorites } from '@/hooks/useFavorites';
import { BulkTrackModal } from '@/components/shared/BulkTrackModal';
import { useSimilarityLabTrackersFlow } from '@/hooks/similarity-lab/useSimilarityLabTrackersFlow';


// Removed TopProgressBar - progress now handled inline

// Memoize the heavy SimilarityResultDisplay component to prevent unnecessary re-renders
const MemoizedSimilarityResultDisplay = memo(SimilarityResultDisplay);

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export default function AnalysisLabPage() {
  const PERSIST_KEY = 'similarityLab:lastJob';
  // Core state management - textarea + selected holders are source of truth
  const [inputText, setInputText] = useState<string>('');
  const [tokenInput, setTokenInput] = useState<string>('');
  const [selectedHolderAddresses, setSelectedHolderAddresses] = useState<string[]>([]);
  const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);
  const { favorites: favoriteWallets, mutate: mutateFavorites } = useFavorites();

  // SINGLE SOURCE OF TRUTH: Parse wallets from textarea once, reuse everywhere
  const parsedTextareaWallets = useMemo(() => {
    return inputText
      .split(/[\n,\s]+/) // Split by newlines, commas, or spaces
      .map(l => l.trim())
      .filter(Boolean)
      .filter(w => isValidSolanaAddress(w));
  }, [inputText]);

  const normalizedTokenInput = useMemo(() => tokenInput.trim(), [tokenInput]);

  const tokenMint = useMemo(() => {
    if (!normalizedTokenInput) return null;
    return isValidSolanaAddress(normalizedTokenInput) ? normalizedTokenInput : null;
  }, [normalizedTokenInput]);

  const [activeTokenMint, setActiveTokenMint] = useState<string | null>(null);
  const previousTokenMintRef = useRef<string | null>(null);

  useEffect(() => {
    if (tokenMint) {
      setActiveTokenMint(tokenMint);
    } else if (!normalizedTokenInput) {
      setActiveTokenMint(null);
    }
  }, [tokenMint, normalizedTokenInput]);

  useEffect(() => {
    if (activeTokenMint !== previousTokenMintRef.current) {
      previousTokenMintRef.current = activeTokenMint;
      setSelectedHolderAddresses([]);
    }
  }, [activeTokenMint]);

  const tokenStatusMessage = useMemo(() => {
    if (!normalizedTokenInput) return '';
    if (!tokenMint) return 'Invalid token mint address';
    return '';
  }, [normalizedTokenInput, tokenMint]);

  const tokenStatusColor = useMemo(() => {
    if (!normalizedTokenInput) return 'text-muted-foreground';
    if (!tokenMint) return 'text-red-600 dark:text-red-500';
    return 'text-green-600 dark:text-green-500';
  }, [normalizedTokenInput, tokenMint]);

  const {
    selectedHolderDetails,
    defaultCollectionName,
    defaultNicknamePrefix,
    bulkTrack,
  } = useSimilarityLabTrackersFlow({
    tokenMint: activeTokenMint,
    selectedAddresses: selectedHolderAddresses,
    favorites: favoriteWallets,
    onSaved: mutateFavorites,
  });

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
  const subscribedEnrichmentJobsRef = useRef<Set<string>>(new Set());

  const persistJobPointer = useCallback((jobId: string, walletCount: number) => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({
        jobId,
        walletCount,
        vectorType: 'capital',
        createdAt: Date.now(),
      }));
    } catch (error) {
      console.warn('Failed to persist similarity job pointer', error);
    }
  }, []);

  const clearJobPointer = useCallback(() => {
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Back to top button state
  const [showBackToTop, setShowBackToTop] = useState(false);

  // toast is now imported directly from sonner
  const jobSocketDebug = process.env.NEXT_PUBLIC_JOB_SOCKET_DEBUG === 'true';

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
        //  console.log('📊 Main analysis progress:', data.jobId, data.progress);
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
    }, [currentJobId, jobSocketDebug]),
    
    onJobFailed: useCallback((data: JobFailedData) => {
      console.error('❌ Job failed (WebSocket):', data.jobId, data.error);
      if (data.jobId === currentJobId) {
        setJobStatuses(prev => ({ ...prev, analysis: 'failed' }));
        setJobProgress(0);
        setSyncMessage('');
        setCurrentJobId(null);
        clearJobPointer();
        
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
        setEnrichmentJobId(null);
        // Don't show toast for enrichment failures, they're non-critical
      }
      setError(data.error);
    }, [currentJobId, enrichmentJobId, clearJobPointer]),
    
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
        setEnrichmentJobId(null);
        toast.success("Token Data Loaded", { description: "Prices and metadata have been updated." });
      } catch (error: any) {
        console.error('❌ Error processing enrichment data:', error);
        // Non-critical error, just toast it.
        toast.error("Enrichment Failed", { description: error.message });
        setJobStatuses(prev => ({ ...prev, enrichment: 'failed' }));
        setIsRefreshing(false);
      }
    }, [jobSocketDebug]),
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
    if (!enrichmentJobId) {
      subscribedEnrichmentJobsRef.current.clear();
    }
  }, [enrichmentJobId]);

  useEffect(() => {
    const hydrateFromLastJob = async () => {
      try {
        const saved = localStorage.getItem(PERSIST_KEY);
        if (!saved) return;

        const parsed = JSON.parse(saved) as { jobId?: string; createdAt?: number };
        if (!parsed?.jobId) {
          clearJobPointer();
          return;
        }

        // Clear job pointers older than 24 hours (jobs may have expired from queue)
        const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
        if (parsed.createdAt && Date.now() - parsed.createdAt > MAX_AGE_MS) {
          clearJobPointer();
          return;
        }

        const jobStatus = await fetcher(`/jobs/${parsed.jobId}`);
        if (jobStatus?.status === 'completed') {
          const result = await fetcher(`/jobs/${parsed.jobId}/result`);
          const resultData = result?.result;
          const analysisData = resultData?.data ?? resultData;
          if (analysisData?.pairwiseSimilarities?.length) {
            setAnalysisResult(analysisData);
          }
        } else if (jobStatus?.status === 'failed' || jobStatus?.status === 'not_found') {
          clearJobPointer();
        }
      } catch (error: any) {
        // If the job is not found (404) or any other error, clear the stale pointer
        // to prevent repeated errors on every page load
        if (error?.status === 404 || error?.message?.includes('not found')) {
          clearJobPointer();
        }
        // Silently ignore hydration errors - they're non-critical
      }
    };

    hydrateFromLastJob();
  }, [clearJobPointer]);



  // Subscribe to enrichment job when ID is set
  useEffect(() => {
    if (enrichmentJobId && wsConnected) {
      if (jobSocketDebug) {
        console.log('🔔 Subscribing to enrichment job:', enrichmentJobId);
      }
      if (!subscribedEnrichmentJobsRef.current.has(enrichmentJobId)) {
        subscribedEnrichmentJobsRef.current.add(enrichmentJobId);
        subscribeToJob(enrichmentJobId);
      }
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
      } else {
        throw new Error("Failed to queue enrichment job.");
      }

    } catch (error: any) {
      setIsRefreshing(false);
      toast.error('Refresh Failed', {
        description: error.message || "Could not start the price refresh job.",
      });
    }
  }, [analysisResult, setEnrichmentJobId]);

  const handleAnalyze = async () => {
    // Prevent multiple simultaneous analyses
    if (jobStatuses.analysis === 'running') {
      if (jobSocketDebug) {
        console.log('⚠️ Analysis already running, ignoring duplicate request');
      }
      return;
    }

    // Merge parsed textarea wallets with selected holders (single source of truth)
    const allWallets = [...new Set([...parsedTextareaWallets, ...selectedHolderAddresses])];

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
          includeBalances: true, // CRITICAL: Include wallet balances for USD value calculations
        }),
      });

      setCurrentJobId(jobResponse.jobId);
      persistJobPointer(jobResponse.jobId, walletList.length);
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

  const tokenPanel = (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="tokenInput" className="text-sm font-medium">
            Token Mint
          </label>
          {tokenInput && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTokenInput('')}
              disabled={jobStatuses.analysis === 'running'}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
        <Input
          id="tokenInput"
          placeholder="Token mint address"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          disabled={jobStatuses.analysis === 'running'}
          className="font-mono text-sm w-full max-w-[360px] bg-muted/30 border-foreground/20 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {tokenMint && (
          <TokenBadge
            mint={tokenMint}
            variant="inline"
            size="m"
            className="max-w-[360px]"
          />
        )}
        {tokenStatusMessage && (
          <p className={`text-xs ${tokenStatusColor}`}>{tokenStatusMessage}</p>
        )}
      </div>

      {activeTokenMint ? (
        <TokenHolderPicker
          tokenMint={activeTokenMint}
          selectedAddresses={selectedHolderAddresses}
          onSelectionChange={setSelectedHolderAddresses}
          onTrackSelected={() => {
            const eligibleCount = selectedHolderDetails.filter(holder =>
              holder.knownType ? !bulkTrack.excludedKnownTypes.has(holder.knownType) : true
            ).length;
            if (eligibleCount === 0) {
              toast.info('No eligible wallets', {
                description: 'All selected holders are system or LP wallets and will be skipped.',
              });
              return;
            }
            bulkTrack.open();
          }}
        />
      ) : null}
    </div>
  );

  return (
    <AppShell>
      <div className="w-full px-[10%] lg:px-[15%] space-y-6 pb-8">
        {/* Header */}
        <PageTitle
          title="Similarity Lab"
          subtitle="Discover hidden connections between wallets through trading behavior and capital allocation patterns."
          icon={FlaskConical}
        />

        {/* Main Input Card - 2-column layout with controlled widths */}
        <Card className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[460px_minmax(0,1fr)] gap-6">
            {/* Left: Wallet Input - Fixed width */}
            <div className="flex-shrink-0">
              <SmartWalletInput
                value={inputText}
                onChange={setInputText}
                onAnalyze={handleAnalyze}
                isAnalyzing={jobStatuses.analysis === 'running'}
                selectedHolderCount={selectedHolderAddresses.length}
              />
            </div>

            {/* Right: Token Panel - Fills remaining space */}
            <div className="border-l pl-8 hidden lg:block min-w-0">
              {tokenPanel}
            </div>
          </div>

          {/* Mobile: Show holder picker below on small screens */}
          <div className="mt-4 pt-4 border-t lg:hidden">
            {tokenPanel}
          </div>
        </Card>

        {/* Bulk Track Confirmation */}
        <BulkTrackModal
          bulkTrack={bulkTrack}
          defaultCollectionName={defaultCollectionName}
          defaultNicknamePrefix={defaultNicknamePrefix}
        />

        {/* Analysis Progress Indicator - Modern Pulsing Animation */}
        {jobStatuses.analysis === 'running' && (
          <Card className="relative p-6 overflow-hidden">
            {/* Animated pulsing border effect */}
            <div className="absolute inset-0 rounded-lg">
              <div className="absolute inset-0 rounded-lg border-2 border-primary/30 animate-pulse" />
              <div className="absolute inset-0 rounded-lg border-2 border-primary/50 animate-[pulse_2s_ease-in-out_infinite]" style={{ animationDelay: '0.5s' }} />
            </div>

            {/* Content */}
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {/* Pulsing dot indicator */}
                    <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-primary/40 animate-ping" />
                  </div>
                  <h3 className="text-sm font-semibold">Analyzing Similarities</h3>
                </div>
                <span className="text-sm font-mono text-muted-foreground tabular-nums">{jobProgress.toFixed(0)}%</span>
              </div>

              {/* Progress bar with gradient */}
              <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden backdrop-blur-sm">
                <div
                  className="h-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-all duration-500 ease-out relative"
                  style={{ width: `${jobProgress}%` }}
                >
                  {/* Shimmer effect on progress bar */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
                </div>
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
          <div className="p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
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
