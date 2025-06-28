'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SyncConfirmationDialog } from '@/components/analysis-lab/SyncConfirmationDialog';
import { SimilarityResultDisplay } from '@/components/analysis-lab/results/SimilarityResultDisplay';
import { CombinedSimilarityResult } from '@/components/analysis-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { useToast } from '@/hooks/use-toast';
import { isValidSolanaAddress } from "@/lib/solana-utils";
import { useApiKeyStore } from '@/store/api-key-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type WalletAnalysisStatus = 'READY' | 'STALE' | 'MISSING' | 'IN_PROGRESS';

interface WalletStatus {
  walletAddress: string;
  status: WalletAnalysisStatus;
}

interface WalletStatusResponse {
  statuses: WalletStatus[];
}

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
  const { toast } = useToast();
  const apiKey = useApiKeyStore((state) => state.apiKey);

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

  useEffect(() => {
    if (analysisResult) {
      localStorage.setItem('analysisResult', JSON.stringify(analysisResult));
      if (analysisResult?.walletBalances) {
        // Start with raw balances, clear old enriched data on new analysis
        setEnrichedBalances(analysisResult.walletBalances);
      }
    } else {
      localStorage.removeItem('analysisResult');
      setEnrichedBalances(null);
    }
  }, [analysisResult]);

  const handleEnrichData = async () => {
    if (!analysisResult?.walletBalances) return;
    setIsEnriching(true);
    try {
      const enrichedData = await fetcher('/analyses/similarity/enrich-balances', {
        method: 'POST',
        body: JSON.stringify({ walletBalances: analysisResult.walletBalances }),
      });
      setEnrichedBalances(enrichedData);
      toast({
        title: "Data Enriched",
        description: "Token prices and metadata have been updated.",
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: "Enrichment Failed",
        description: "Could not fetch token prices and metadata.",
      });
    } finally {
      setIsEnriching(false);
    }
  };

  const handleAnalyze = async () => {
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');

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
            setSyncMessage('All wallets are synced. Running final analysis...');
            toast({ title: "Sync Complete!", description: "All wallets are now ready." });
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
    setIsLoading(true);
    setSyncMessage('Running analysis...');
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
                    <p>Populates the Contextual Holdings card with the latest token prices and metadata.</p>
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
      </div>

      {analysisResult && (
        <div className="mt-6">
          <SimilarityResultDisplay results={analysisResult} enrichedBalances={enrichedBalances} />
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