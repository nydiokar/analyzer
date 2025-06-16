'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SyncConfirmationDialog } from '@/components/analysis-lab/SyncConfirmationDialog';

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
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [missingWallets, setMissingWallets] = useState<string[]>([]);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const handleAnalyze = async () => {
    setIsLoading(true);
    setAnalysisResult(null);
    setSyncMessage('');
    const walletList = wallets.split(/[,\s\n]+/).filter(Boolean);

    if (walletList.length === 0) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/v1/analyses/wallets/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddresses: walletList }),
      });
      const data: WalletStatusResponse = await response.json();
      const missing = data.statuses.filter((s) => !s.exists).map((s) => s.walletAddress);

      if (missing.length > 0) {
        setMissingWallets(missing);
        setIsSyncDialogOpen(true);
        // The process will continue from handleConfirmSync
        return; // Stop here, let the dialog handle the next step
      }

      // If no wallets are missing, proceed directly to analysis
      await runSimilarityAnalysis(walletList);
    } catch (error) {
      console.error('Error checking wallet status:', error);
      setSyncMessage('Error checking wallet status. Please try again.');
      setIsLoading(false);
    }
  };

  const handleConfirmSync = async () => {
    setIsSyncDialogOpen(false);
    setIsLoading(true);
    setSyncMessage(`Syncing ${missingWallets.length} missing wallet(s)... This may take a few minutes.`);

    try {
      // Trigger sync for missing wallets
      for (const wallet of missingWallets) {
        // NOTE: This is a fire-and-forget call
        fetch(`/api/v1/analyses/trigger-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: wallet }),
        });
      }

      // Start polling for wallet statuses
      const pollInterval = setInterval(async () => {
        const walletList = wallets.split(/[,\s\n]+/).filter(Boolean);
        const response = await fetch('/api/v1/analyses/wallets/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddresses: walletList }),
        });
        
        if (!response.ok) {
          setSyncMessage('Error checking wallet status. Polling stopped.');
          clearInterval(pollInterval);
          setIsLoading(false);
          return;
        }
        
        const data: WalletStatusResponse = await response.json();

        const stillMissing = data.statuses.filter((s) => !s.exists).map((s) => s.walletAddress);

        if (stillMissing.length === 0) {
          clearInterval(pollInterval);
          setSyncMessage('All wallets are synced. Running similarity analysis...');
          await runSimilarityAnalysis(walletList);
        } else {
          setMissingWallets(stillMissing);
          setSyncMessage(`Waiting for ${stillMissing.length} wallet(s) to sync... Polling again in 10 seconds.`);
        }
      }, 10000); // Poll every 10 seconds
    } catch (error) {
      console.error('Error during sync trigger:', error);
      setSyncMessage('Failed to start wallet sync. Please check the console and try again.');
      setIsLoading(false);
    }
  };

  const runSimilarityAnalysis = async (walletList: string[]) => {
    try {
      const response = await fetch('/api/v1/analyses/similarity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddresses: walletList,
          vectorType: 'capital',
        }),
      });
      const data = await response.json();
      setAnalysisResult(data);
      setSyncMessage('');
    } catch (error) {
      console.error('Error running similarity analysis:', error);
      setSyncMessage('An error occurred during similarity analysis.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AI Expert Analysis Interpreter</h1>
      <div className="bg-card p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-semibold mb-2">Wallet Group Similarity</h2>
        <p className="text-muted-foreground mb-4">
          Enter a list of wallet addresses to analyze their similarity based on trading behavior.
        </p>
        <Textarea
          value={wallets}
          onChange={(e) => setWallets(e.target.value)}
          placeholder="Enter wallet addresses, separated by commas, spaces, or new lines."
          className="min-h-[150px] font-mono"
        />
        <Button onClick={handleAnalyze} disabled={isLoading} className="mt-4">
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </Button>
        {syncMessage && <p className="mt-4 text-center text-sm text-muted-foreground">{syncMessage}</p>}
      </div>

      {analysisResult && (
        <div className="mt-6 bg-card p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-2">Analysis Results</h2>
          <pre className="mt-2 w-full rounded-md bg-slate-950 p-4 overflow-auto max-h-[600px]">
            <code className="text-white">{JSON.stringify(analysisResult, null, 2)}</code>
          </pre>
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