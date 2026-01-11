import { useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SimilarityPairRibbon, type SimilarityPairData } from './SimilarityPairRibbon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';

export type SimilarityStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

interface Props {
  similarityResult?: CombinedSimilarityResult | null;
  status: SimilarityStatus;
  profileCount?: number;
  minProfilesForAnalysis?: number;
  /** Whether this is a re-analysis with all wallets (final run) */
  isFinalAnalysis?: boolean;
  /** Callback when a wallet pair is hovered */
  onPairHover?: (wallets: [string, string] | null) => void;
  /** Callback when a wallet pair is clicked */
  onPairClick?: (wallets: [string, string]) => void;
  /** Map of wallet address to rank in the table */
  walletRanks?: Map<string, number>;
}

// Calculate overall score same way as similarity lab (40% behavioral + 60% capital)
function calculateOverallScore(binaryScore: number, capitalScore: number): number {
  return binaryScore * 0.4 + capitalScore * 0.6;
}

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
    .sort((a, b) => b.overallScore - a.overallScore);
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function getAvgColor(score: number): string {
  if (score >= 0.7) return 'text-emerald-400';
  if (score >= 0.5) return 'text-blue-400';
  if (score >= 0.3) return 'text-amber-400';
  return 'text-zinc-400';
}

export function SimilaritySidebar({
  similarityResult,
  status,
  profileCount = 0,
  minProfilesForAnalysis = 5,
  isFinalAnalysis = false,
  onPairHover,
  onPairClick,
  walletRanks,
}: Props) {
  const pairs = useMemo(() => {
    if (!similarityResult) return [];
    return transformToPairs(similarityResult);
  }, [similarityResult]);

  // Calculate global stats
  const globalStats = useMemo(() => {
    if (pairs.length === 0) return null;
    const avgOverall = pairs.reduce((sum, p) => sum + p.overallScore, 0) / pairs.length;
    const avgBehavioral = pairs.reduce((sum, p) => sum + p.behavioralScore, 0) / pairs.length;
    const avgCapital = pairs.reduce((sum, p) => sum + p.capitalScore, 0) / pairs.length;
    return { avgOverall, avgBehavioral, avgCapital, totalPairs: pairs.length };
  }, [pairs]);

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
    // No profiles yet - don't show anything
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
          {/* Pulsing skeleton placeholders */}
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
            Will retry with next batch
          </p>
        </div>
      </aside>
    );
  }

  // No meaningful results (all pairs have very low similarity)
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
      <aside className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {pairs.length === 1 ? 'Similar Pair' : 'Similar Pairs'}
          </p>
          {globalStats && (
            <span className="text-[10px] text-foreground/50">
              {globalStats.totalPairs} {pluralize(globalStats.totalPairs, 'pair', 'pairs')}
            </span>
          )}
        </div>

        {/* Global average indicator with tooltips */}
        {globalStats && pairs.length > 1 && (
          <div className="flex items-center gap-3 px-2.5 py-2 rounded-md bg-muted/40 text-[11px] transition-all duration-300">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <span className="text-foreground/60">Avg:</span>
                  <span className={cn('font-semibold', getAvgColor(globalStats.avgOverall))}>
                    {(globalStats.avgOverall * 100).toFixed(0)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                <p className="font-medium">Average Overall Similarity</p>
                <p className="text-muted-foreground mt-1">
                  Mean similarity across all {globalStats.totalPairs} wallet pairs.
                  Combines behavioral (40%) and capital (60%) scores.
                </p>
              </TooltipContent>
            </Tooltip>

            <div className="h-3.5 w-px bg-border/60" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <span className="text-foreground/60">Behavior:</span>
                  <span className="text-foreground/80 font-medium">{(globalStats.avgBehavioral * 100).toFixed(0)}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                <p className="font-medium">Average Behavioral Similarity</p>
                <p className="text-muted-foreground mt-1">
                  How similar wallets are in which tokens they hold,
                  regardless of position sizes.
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <span className="text-foreground/60">Capital:</span>
                  <span className="text-foreground/80 font-medium">{(globalStats.avgCapital * 100).toFixed(0)}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                <p className="font-medium">Average Capital Similarity</p>
                <p className="text-muted-foreground mt-1">
                  How similar wallets are in capital allocation
                  across holdings (weighted by value).
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Pairs list - expands naturally, no scroll constraint */}
        <div className="space-y-2">
          {pairs.map((pair, index) => (
            <div
              key={`${pair.walletA}-${pair.walletB}`}
              className="animate-in fade-in slide-in-from-right-1 duration-200 cursor-pointer"
              style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
              onMouseEnter={() => onPairHover?.([pair.walletA, pair.walletB])}
              onMouseLeave={() => onPairHover?.(null)}
              onClick={() => onPairClick?.([pair.walletA, pair.walletB])}
            >
              <SimilarityPairRibbon
                pair={pair}
                rank={index + 1}
                walletRanks={walletRanks}
              />
            </div>
          ))}
        </div>
      </aside>
    </TooltipProvider>
  );
}
