import { MostCommonTokens } from './MostCommonTokens';
import { EnhancedKeyInsights } from './EnhancedKeyInsights';
import { CombinedSimilarityResult } from './types';
import { GlobalMetricsCard } from './GlobalMetricsCard';
import { ContextualHoldingsCard } from './ContextualHoldingsCard';
import { HistoricalVsLiveComparison } from './HistoricalVsLiveComparison';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowUp } from 'lucide-react';
import { useState, useEffect } from 'react';

interface SimilarityResultDisplayProps {
  results: CombinedSimilarityResult;
  onRefreshPrices: () => void;
  isRefreshing: boolean;
}

const EMPTY_BALANCES = {}; // Define a constant empty object

export function SimilarityResultDisplay({ results, onRefreshPrices, isRefreshing }: SimilarityResultDisplayProps) {
  const hasAdvancedMatrices = results.sharedTokenCountsMatrix || results.jaccardSimilarityMatrix;
  const enrichedBalances = results.walletBalances || EMPTY_BALANCES; // Use the constant
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Show back-to-top button when user scrolls down
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 200); // Lower threshold
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

      {/* Back to Top Button */}
      {showBackToTop && (
        <Button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50"
          size="icon"
          variant="default"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
} 