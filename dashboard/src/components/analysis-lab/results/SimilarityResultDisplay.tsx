import { MostCommonTokens } from './MostCommonTokens';
import { EnhancedKeyInsights } from './EnhancedKeyInsights';
import { CombinedSimilarityResult } from './types';
import { GlobalMetricsCard } from './GlobalMetricsCard';
import { ContextualHoldingsCard } from './ContextualHoldingsCard';

interface SimilarityResultDisplayProps {
  results: CombinedSimilarityResult;
}

export function SimilarityResultDisplay({ results }: SimilarityResultDisplayProps) {
  return (
    <div className="space-y-6">
      {results.globalMetrics && <GlobalMetricsCard metrics={results.globalMetrics} />}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <EnhancedKeyInsights results={results} />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <MostCommonTokens results={results} />
        </div>
      </div>

      <ContextualHoldingsCard results={results} />
    </div>
  );
} 