import { MostCommonTokens } from './MostCommonTokens';
import { EnhancedKeyInsights } from './EnhancedKeyInsights';
import { CombinedSimilarityResult } from './types';
import { GlobalMetricsCard } from './GlobalMetricsCard';
import { ContextualHoldingsCard } from './ContextualHoldingsCard';
import { OverlapHeatmap } from './OverlapHeatmap';
import { HistoricalVsLiveComparison } from './HistoricalVsLiveComparison';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles } from 'lucide-react';

interface SimilarityResultDisplayProps {
  results: CombinedSimilarityResult;
  enrichedBalances: Record<string, any> | null;
}

export function SimilarityResultDisplay({ results, enrichedBalances }: SimilarityResultDisplayProps) {
  const hasAdvancedMatrices = results.sharedTokenCountsMatrix || results.jaccardSimilarityMatrix;

  return (
    <div className="space-y-6">
      {results.globalMetrics && (
        <GlobalMetricsCard
          metrics={results.globalMetrics}
          pairwiseSimilarities={results.pairwiseSimilarities}
          walletBalances={enrichedBalances}
          walletVectorsUsed={results.walletVectorsUsed}
        />
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <EnhancedKeyInsights results={results} />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <MostCommonTokens results={results} enrichedBalances={enrichedBalances} />
        </div>
      </div>

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

      {/* New high-value matrix visualizations */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OverlapHeatmap results={results} />
        <HistoricalVsLiveComparison results={results} />
      </div>

      <ContextualHoldingsCard results={results} enrichedBalances={enrichedBalances} />
    </div>
  );
} 