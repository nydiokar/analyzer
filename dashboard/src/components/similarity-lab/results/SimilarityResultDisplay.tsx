import { MostCommonTokens } from './MostCommonTokens';
import { EnhancedKeyInsights } from './EnhancedKeyInsights';
import { CombinedSimilarityResult } from './types';
import { GlobalMetricsCard } from './GlobalMetricsCard';
import { ContextualHoldingsCard } from './ContextualHoldingsCard';
import { HistoricalVsLiveComparison } from './HistoricalVsLiveComparison';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles } from 'lucide-react';

interface SimilarityResultDisplayProps {
  results: CombinedSimilarityResult;
  onRefreshPrices: () => void;
  isRefreshing: boolean;
}

const EMPTY_BALANCES = {}; // Define a constant empty object

export function SimilarityResultDisplay({ results, onRefreshPrices, isRefreshing }: SimilarityResultDisplayProps) {
  const hasAdvancedMatrices = results.sharedTokenCountsMatrix || results.jaccardSimilarityMatrix;
  const enrichedBalances = results.walletBalances || EMPTY_BALANCES; // Use the constant

  return (
    <div className="space-y-6">
      {results.globalMetrics && (
        <GlobalMetricsCard
          metrics={results.globalMetrics}
          pairwiseSimilarities={results.pairwiseSimilarities}
          walletBalances={results.walletBalances}
          walletVectorsUsed={results.walletVectorsUsed}
        />
      )}
      
      {/* Key Insights - Full Width */}
      <EnhancedKeyInsights results={results} />

      {/* Enhanced Analytics Banner */}
      {hasAdvancedMatrices && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            <strong>Enhanced Analytics Unlocked:</strong> The analysis below reveals previously hidden patterns 
            including token overlap breadth and strategic evolution over time.
          </AlertDescription>
        </Alert>
      )}

      {/* Most Common Tokens and Historical vs Live - Side by Side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MostCommonTokens results={results} enrichedBalances={enrichedBalances} />
        <HistoricalVsLiveComparison results={results} />
      </div>

      <ContextualHoldingsCard 
        results={results} 
        enrichedBalances={enrichedBalances} 
        onRefreshPrices={onRefreshPrices}
        isRefreshing={isRefreshing}
      />
    </div>
  );
} 