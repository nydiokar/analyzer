'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SyncConfirmationDialog } from '@/components/analysis-lab/SyncConfirmationDialog';
import { SimilarityResultDisplay } from '@/components/analysis-lab/results/SimilarityResultDisplay';
import { ComprehensiveSimilarityResult } from '@/components/analysis-lab/results/types';
import { fetcher } from '@/lib/fetcher';
import { useToast } from '@/hooks/use-toast';
import { shortenAddress, isValidSolanaAddress } from "@/lib/solana-utils";

interface WalletStatus {
  walletAddress: string;
  exists: boolean;
}

interface WalletStatusResponse {
  statuses: WalletStatus[];
}

export default function AnalysisLabPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [wallets, setWallets] = useState('');
  const [analysisResult, setAnalysisResult] = useState<ComprehensiveSimilarityResult | null>(null);
  const [missingWallets, setMissingWallets] = useState<string[]>([]);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    try {
      const savedResult = localStorage.getItem('analysisResult');
      if (savedResult) {
        setAnalysisResult(JSON.parse(savedResult));
      }
    } catch (error) {
        console.error("Failed to parse analysis result from localStorage", error);
        localStorage.removeItem('analysisResult');
    }
  }, []);

  useEffect(() => {
    if (analysisResult) {
      localStorage.setItem('analysisResult', JSON.stringify(analysisResult));
    } else {
      localStorage.removeItem('analysisResult');
    }
  }, [analysisResult]);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');
    const walletList = wallets.split(/[,\s\n]+/).filter(Boolean);

    if (walletList.length === 0) {
      setIsLoading(false);
      return;
    }

    const invalidWallets = walletList.filter(w => !isValidSolanaAddress(w.trim()));

    if (invalidWallets.length > 0) {
      toast({
        variant: "destructive",
        title: "Invalid Wallet Addresses",
        description: `Please correct the following addresses: ${invalidWallets.join(', ')}`,
      });
      setIsLoading(false);
      return;
    }

    try {
      const data: WalletStatusResponse = await fetcher('/analyses/wallets/status', {
        method: 'POST',
        body: JSON.stringify({ walletAddresses: walletList }),
      });
      
      const missing = data?.statuses?.filter((s) => !s.exists).map((s) => s.walletAddress) ?? [];

      if (missing.length > 0) {
        setMissingWallets(missing);
        setIsSyncDialogOpen(true);
        return;
      }

      await runSimilarityAnalysis(walletList);
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
    setSyncMessage(`Syncing ${missingWallets.length} missing wallet(s)... This may take a few minutes.`);

    try {
      const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

      for (const wallet of missingWallets) {
        try {
          await fetcher(`/analyses/wallets/${wallet}/trigger-analysis`, {
            method: 'POST',
          });
          toast({
            description: `Sync triggered for ${shortenAddress(wallet, 6)}...`,
          });
          await delay(500); // Wait 500ms before the next request
        } catch (err: any) {
          console.error(`Failed to trigger sync for ${wallet}`, err);
          toast({
            variant: "destructive",
            title: `Sync Failed for ${shortenAddress(wallet, 6)}`,
            description: err.message || "An unknown error occurred.",
          });
        }
      }

      // Start polling for wallet statuses
      setSyncMessage(`Sync triggered for all wallets. Now waiting for completion...`);
      const pollInterval = setInterval(async () => {
        try {
          const walletList = wallets.split(/[,\s\n]+/).filter(Boolean);
          const data: WalletStatusResponse = await fetcher('/analyses/wallets/status', {
             method: 'POST',
             body: JSON.stringify({ walletAddresses: walletList }),
          });

          const stillMissing = data?.statuses?.filter((s) => !s.exists).map((s) => s.walletAddress) ?? [];

          if (stillMissing.length === 0) {
            clearInterval(pollInterval);
            setSyncMessage('All wallets are synced. Running similarity analysis...');
            await runSimilarityAnalysis(walletList);
          } else {
            setMissingWallets(stillMissing);
            setSyncMessage(`Waiting for ${stillMissing.length} wallet(s) to sync... Polling again in 10 seconds.`);
          }
        } catch (error: any) {
            const errorMessage = error?.payload?.message || error.message || 'Error during polling.';
            setSyncMessage(`Error checking wallet status: ${errorMessage} Polling stopped.`);
            toast({
                variant: "destructive",
                title: "Sync Failed",
                description: errorMessage,
            });
            clearInterval(pollInterval);
            setIsLoading(false);
        }
      }, 10000); 
    } catch (error: any) {
      console.error('Error during sync trigger:', error);
      const errorMessage = error?.payload?.message || error.message || 'Failed to start wallet sync.';
      setSyncMessage(`${errorMessage} Please check the console and try again.`);
      toast({
        variant: "destructive",
        title: "Sync Error",
        description: errorMessage,
      });
      setIsLoading(false);
    }
  };

  const runSimilarityAnalysis = async (walletList: string[]) => {
    try {
      const data = await fetcher('/analyses/similarity', {
        method: 'POST',
        body: JSON.stringify({
          walletAddresses: walletList,
          vectorType: 'capital',
        }),
      });
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
    <div className="container mx-auto p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Similarity LAB <span className="text-muted-foreground">- discover hidden connections</span></h1>
      </header>
      <div className="bg-card p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-semibold mb-2">Wallet Group Similarity</h2>
        <p className="text-muted-foreground mb-4">
          Enter a list of wallet addresses to analyze their similarity based on trading behavior.
        </p>
        <Textarea
          value={wallets}
          onChange={(e) => setWallets(e.target.value)}
          placeholder="Enter wallet addresses, separated by commas, spaces, or new lines."
          className="min-h-[120px] font-mono"
        />
        <Button onClick={handleAnalyze} disabled={isLoading} className="mt-4">
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </Button>
        {syncMessage && <p className="mt-4 text-center text-sm text-muted-foreground">{syncMessage}</p>}
      </div>

      {analysisResult && (
        <div className="mt-6">
           <SimilarityResultDisplay results={analysisResult} />
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