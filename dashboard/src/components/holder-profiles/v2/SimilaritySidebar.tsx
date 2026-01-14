import { useMemo, useEffect } from 'react';
import { Loader2, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SimilarityPairRibbon, type SimilarityPairData } from './SimilarityPairRibbon';
import { ClusterIndicator } from './ClusterIndicator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { analyzeSimilarityGraph, type SimilarityGraphAnalysis } from './utils/similarity-clusters';

export type SimilarityStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

/** Threshold for considering wallets "connected" (0-1) */
export const CONNECTION_THRESHOLD = 0.7;

interface Props {
  similarityResult?: CombinedSimilarityResult | null;
  status: SimilarityStatus;
  profileCount?: number;
  minProfilesForAnalysis?: number;
  /** Whether this is a re-analysis with all wallets (final run) */
  isFinalAnalysis?: boolean;
  /** Currently selected pair (for persistent highlight) */
  selectedPair?: [string, string] | null;
  /** Callback when a wallet pair is clicked */
  onPairSelect?: (wallets: [string, string] | null) => void;
  /** Currently selected cluster ID */
  selectedClusterId?: number | null;
  /** Callback when a cluster is clicked */
  onClusterSelect?: (clusterId: number | null, wallets: string[]) => void;
  /** Map of wallet address to rank in the table */
  walletRanks?: Map<string, number>;
  /** Callback to share graph analysis (connection counts, clusters) with parent */
  onGraphAnalysisChange?: (analysis: SimilarityGraphAnalysis | null) => void;
  /** Callback to retry similarity analysis */
  onRetry?: () => void;
}

// Re-export for parent components
export type { SimilarityGraphAnalysis } from './utils/similarity-clusters';

// Calculate overall score: 60% behavioral + 40% capital (behavioral is more indicative of coordination)
function calculateOverallScore(binaryScore: number, capitalScore: number): number {
  return binaryScore * 0.6 + capitalScore * 0.4;
}

/** Minimum behavioral score to display a pair (filters out wallets with few shared tokens) */
const MIN_BEHAVIORAL_SCORE = 0.3;

// Transform CombinedSimilarityResult into displayable pairs
function transformToPairs(result: CombinedSimilarityResult): SimilarityPairData[] {
  if (!result.pairwiseSimilarities?.length) return [];

  return result.pairwiseSimilarities
    .map((pair) => ({
      walletA: pair.walletA,
      walletB: pair.walletB,
      overallScore: calculateOverallScore(pair.binaryScore, pair.capitalScore),
      behavioralScore: pair.binaryScore,
      capitalScore: pair.capitalScore,
      sharedTokensCount: pair.sharedTokens?.length ?? pair.binarySharedTokenCount ?? 0,
      uniqueTokensA: pair.binaryUniqueTokenCountA ?? 0,
      uniqueTokensB: pair.binaryUniqueTokenCountB ?? 0,
    }))
    // Filter out pairs with 0% overall or low behavioral score (few shared tokens)
    .filter((pair) => pair.overallScore > 0 && pair.behavioralScore >= MIN_BEHAVIORAL_SCORE)
    .sort((a, b) => b.overallScore - a.overallScore);
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function SimilaritySidebar({
  similarityResult,
  status,
  profileCount = 0,
  minProfilesForAnalysis = 5,
  isFinalAnalysis = false,
  selectedPair,
  onPairSelect,
  selectedClusterId,
  onClusterSelect,
  walletRanks,
  onGraphAnalysisChange,
  onRetry,
}: Props) {
  const pairs = useMemo(() => {
    if (!similarityResult) return [];
    return transformToPairs(similarityResult);
  }, [similarityResult]);

  // Analyze similarity graph for clusters and connection counts
  const graphAnalysis = useMemo<SimilarityGraphAnalysis | null>(() => {
    if (pairs.length === 0) return null;
    return analyzeSimilarityGraph(pairs, CONNECTION_THRESHOLD);
  }, [pairs]);

  // Calculate stats - high similarity pairs (>= 80%)
  const stats = useMemo(() => {
    if (pairs.length === 0) return null;
    const highSimilarityCount = pairs.filter((p) => p.overallScore >= 0.8).length;
    const moderateCount = pairs.filter((p) => p.overallScore >= 0.5 && p.overallScore < 0.8).length;
    const uniqueWallets = new Set(pairs.flatMap((p) => [p.walletA, p.walletB])).size;
    return { highSimilarityCount, moderateCount, totalPairs: pairs.length, uniqueWallets };
  }, [pairs]);

  // Notify parent of graph analysis changes (for connection counts in table)
  useEffect(() => {
    onGraphAnalysisChange?.(graphAnalysis);
  }, [graphAnalysis, onGraphAnalysisChange]);

  // Handle cluster selection
  const handleClusterSelect = (clusterId: number | null) => {
    if (!onClusterSelect || !graphAnalysis) return;
    if (clusterId === null) {
      onClusterSelect(null, []);
    } else {
      const cluster = graphAnalysis.clusters.find((c) => c.id === clusterId);
      onClusterSelect(clusterId, cluster?.wallets ?? []);
    }
  };

  // Handle pair click - toggle selection
  const handlePairClick = (pair: SimilarityPairData) => {
    if (!onPairSelect) return;

    // Check if this pair is currently selected
    const isSelected = selectedPair &&
      ((selectedPair[0] === pair.walletA && selectedPair[1] === pair.walletB) ||
       (selectedPair[0] === pair.walletB && selectedPair[1] === pair.walletA));

    if (isSelected) {
      // Deselect
      onPairSelect(null);
    } else {
      // Select this pair
      onPairSelect([pair.walletA, pair.walletB]);
    }
  };

  // Check if a pair is selected
  const isPairSelected = (pair: SimilarityPairData) => {
    if (!selectedPair) return false;
    return (selectedPair[0] === pair.walletA && selectedPair[1] === pair.walletB) ||
           (selectedPair[0] === pair.walletB && selectedPair[1] === pair.walletA);
  };

  // Idle state - not enough profiles yet
  if (status === 'idle') {
    const remaining = minProfilesForAnalysis - profileCount;
    if (remaining > 0 && profileCount > 0) {
      return (
        <aside className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Similarity Analysis
          </p>
          <div className="rounded-lg border border-dashed border-border/50 p-4 text-center transition-all duration-300">
            <p className="text-xs text-muted-foreground">
              {remaining} more {pluralize(remaining, 'profile', 'profiles')} needed
            </p>
            <div className="mt-2 h-1 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full bg-muted-foreground/30 transition-all duration-500 ease-out"
                style={{ width: `${(profileCount / minProfilesForAnalysis) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-foreground/40 mt-1.5">
              {profileCount}/{minProfilesForAnalysis} profiles
            </p>
          </div>
        </aside>
      );
    }
    if (profileCount === 0) return null;
    return null;
  }

  // Pending/Running state
  if (status === 'pending' || status === 'running') {
    return (
      <aside className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Similarity Analysis
        </p>
        <div className="rounded-lg border border-border/50 p-4 transition-all duration-300 animate-in fade-in">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isFinalAnalysis ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <span>
              {status === 'pending'
                ? 'Queuing analysis...'
                : isFinalAnalysis
                  ? 'Finalizing with all wallets...'
                  : 'Analyzing similarities...'}
            </span>
          </div>
          <p className="text-[10px] text-foreground/40 mt-2">
            Comparing {profileCount} {pluralize(profileCount, 'wallet', 'wallets')}
          </p>
          <div className="mt-3 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-lg bg-muted/30 animate-pulse"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      </aside>
    );
  }

  // Failed state
  if (status === 'failed') {
    return (
      <aside className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Similarity Analysis
        </p>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center transition-all duration-300 animate-in fade-in">
          <p className="text-xs text-destructive">Analysis failed</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Retry the similarity analysis with the current wallet set.
          </p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 text-[10px]"
              onClick={onRetry}
            >
              Retry analysis
            </Button>
          )}
        </div>
      </aside>
    );
  }

  // No meaningful results
  if (!similarityResult || pairs.length === 0) {
    return (
      <aside className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Similarity Analysis
        </p>
        <div className="rounded-lg border border-dashed border-border/50 p-4 text-center transition-all duration-300 animate-in fade-in">
          <p className="text-xs text-muted-foreground">No similar pairs found</p>
          <p className="text-[10px] text-foreground/40 mt-1">
            Holders appear to have independent portfolios
          </p>
        </div>
      </aside>
    );
  }

  // Completed state with results
  return (
    <TooltipProvider delayDuration={200}>
      <aside className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300 min-w-0 overflow-hidden">
        {/* Clusters section - only show if clusters exist */}
        {graphAnalysis && graphAnalysis.clusters.length > 0 && (
          <ClusterIndicator
            clusters={graphAnalysis.clusters}
            selectedClusterId={selectedClusterId}
            onClusterSelect={handleClusterSelect}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Similar Pairs
          </p>
          {selectedPair && (
            <button
              onClick={() => onPairSelect?.(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear selection
            </button>
          )}
        </div>

        {/* Stats summary */}
        {stats && (
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
            {/* Wallets count */}
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-foreground/70">
                <span className="font-semibold text-foreground">{stats.uniqueWallets}</span> wallets analyzed
              </span>
            </div>

            {/* High similarity indicator */}
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-xs">
                      <span className="font-semibold text-emerald-400">{stats.highSimilarityCount}</span>
                      <span className="text-foreground/50"> pairs &gt;= 80%</span>
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-xs">
                                    <p className="text-muted-foreground mt-1">
                    Overall similarity &gt;= 80% (0.6 behavior, 0.4 capital).
                  </p>
                </TooltipContent>
              </Tooltip>

              {stats.moderateCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 cursor-help">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-xs">
                        <span className="font-semibold text-blue-400">{stats.moderateCount}</span>
                        <span className="text-foreground/50"> moderate</span>
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                                        <p className="text-muted-foreground mt-1">
                      Overall similarity 50-79%.
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <p className="text-[10px] text-foreground/40">
              {stats.totalPairs} total {pluralize(stats.totalPairs, 'pair', 'pairs')}. Click to highlight in table
            </p>
          </div>
        )}

        {/* Pairs list - grows naturally with content */}
        <div className="space-y-2">
            {pairs.map((pair, index) => (
              <div
                key={`${pair.walletA}-${pair.walletB}`}
                className="animate-in fade-in slide-in-from-right-1 duration-200"
                style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
              >
                <SimilarityPairRibbon
                  pair={pair}
                  rank={index + 1}
                  walletRanks={walletRanks}
                  isSelected={isPairSelected(pair)}
                  onClick={() => handlePairClick(pair)}
                />
              </div>
            ))}
        </div>
      </aside>
    </TooltipProvider>
  );
}
