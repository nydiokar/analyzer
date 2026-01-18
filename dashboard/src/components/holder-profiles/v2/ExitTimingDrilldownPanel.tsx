import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';

type TimeBucket = 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';

interface Props {
  walletAddress: string;
  timeBucket: TimeBucket;
  bucketLabel: string;
  anchor?: { x: number; y: number };
  isOpen: boolean;
  onClose: () => void;
}

interface ExitTimingTokensResponse {
  walletAddress: string;
  timeBucket: string;
  tokens: string[];
  count: number;
}

/**
 * Exit Timing Drilldown Panel
 *
 * Simple modal wrapper around TokenPerformanceTab that shows tokens from a specific
 * exit timing bucket (e.g., "momentum" = 5-30 min holds).
 *
 * Architecture:
 *   1. Fetches token address list for the bucket from /exit-timing-tokens/:timeBucket
 *   2. Passes token list to TokenPerformanceTab as a filter
 *   3. TokenPerformanceTab handles pagination, sorting, SWR caching, everything
 *
 * This is intentionally simple - all complexity is delegated to the battle-tested
 * TokenPerformanceTab component. We just provide the modal UI and token list.
 */
export function ExitTimingDrilldownPanel({
  walletAddress,
  timeBucket,
  bucketLabel,
  isOpen,
  onClose,
}: Props) {
  const [tokenAddresses, setTokenAddresses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ==================================================================================
  // STEP 1: Fetch token addresses for this exit timing bucket
  // ==================================================================================
  // Example: "momentum" bucket might return 150 token addresses
  // Data comes from cached WalletBehaviorProfile.holdTimeTokenMap in database
  // ==================================================================================
  const fetchTokenList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response: ExitTimingTokensResponse = await fetcher(
        `/wallets/${walletAddress}/exit-timing-tokens/${timeBucket}`
      );
      setTokenAddresses(response.tokens);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load tokens';
      setError(errorMessage);
      console.error('Error fetching exit timing tokens:', err);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, timeBucket]);

  useEffect(() => {
    if (isOpen && walletAddress && timeBucket) {
      fetchTokenList();
    } else {
      // Reset when closed to free memory
      setTokenAddresses([]);
      setError(null);
    }
  }, [isOpen, walletAddress, timeBucket, fetchTokenList]);

  if (!isOpen) return null;

  const panel = (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={cn(
          "relative w-full max-w-7xl max-h-[90vh] rounded-lg shadow-2xl border border-border bg-card",
          "flex flex-col overflow-hidden"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-semibold">Exit Timing: {bucketLabel}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? 'Loading...' : `${tokenAddresses.length} tokens in this bucket`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-md border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-500">Error: {error}</p>
            </div>
          )}

          {!loading && !error && tokenAddresses.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No tokens found in this time range</p>
            </div>
          )}

          {!loading && !error && tokenAddresses.length > 0 && (
            <div className="h-full">
              {/* ==================================================================================
                  STEP 2: Delegate to TokenPerformanceTab with token filter
                  ==================================================================================
                  We pass tokenAddresses as an array. TokenPerformanceTab will:
                    - If ≤150 tokens: Add to URL params, backend filters efficiently
                    - If >150 tokens: Skip URL params (too long), fetch all wallet tokens,
                                     filter client-side in effectiveResponse memoization

                  This handles all pagination, sorting, caching, virtual scrolling automatically.
                  No custom table logic needed!
                  ================================================================================== */}
              <TokenPerformanceTab
                walletAddress={walletAddress}
                isAnalyzingGlobal={false}
                triggerAnalysisGlobal={() => {}}
                tokenAddressesFilter={tokenAddresses} // Pass as array (not string)
                defaultSortBy="lastTransferTimestamp" // Sort by most recent exit first
                defaultSortOrder="DESC"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : null;
}
