'use client';

import { useMemo, useState, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CombinedSimilarityResult, KeyInsight, InsightType, CombinedPairwiseSimilarity } from "./types";
import { generateKeyInsights } from '@/lib/similarity-report-parser';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Handshake, Scale, Users2, ArrowUpRightFromSquare, TrendingDown, Lightbulb, ChevronDown, ChevronRight, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimilarityWalletBadge } from '@/components/similarity-lab/SimilarityWalletBadge';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { useWalletHudCache } from '@/hooks/useWalletHudCache';
import type { WalletHudDto } from '@/types/api';

interface EnhancedKeyInsightsProps {
  results: CombinedSimilarityResult;
}

type SortKey = 'binaryScore' | 'capitalScore';

// Combined data type for processed pairs
interface ProcessedPair {
  insight: KeyInsight;
  pair: CombinedPairwiseSimilarity;
}

// Updated color system for dark theme integration
const INSIGHT_COLORS: Record<InsightType, string> = {
    [InsightType.HighSimilarity]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    [InsightType.SustainedAlignment]: 'bg-blue-500/10 text-blue-400 border-blue-500/20', 
    [InsightType.SignificantAsymmetry]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    [InsightType.BehavioralMirror]: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    [InsightType.CapitalDivergence]: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    [InsightType.SharedZeroHoldings]: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

// Overall similarity score calculation - matches GlobalMetricsCard.tsx and SimilaritySidebar.tsx
const calculateOverallScore = (binaryScore: number, capitalScore: number): number => {
  // Weighted average: behavioral 60%, capital 40% (behavioral is more indicative of coordination)
  return (binaryScore * 0.6) + (capitalScore * 0.4);
};

// Score level indicators for dark theme
const getScoreLevel = (score: number): { level: string; color: string; bgColor: string } => {
  if (score >= 0.7) return { level: 'Very High', color: 'text-emerald-400', bgColor: 'bg-emerald-500' };
  if (score >= 0.5) return { level: 'High', color: 'text-blue-400', bgColor: 'bg-blue-500' };
  if (score >= 0.3) return { level: 'Moderate', color: 'text-amber-400', bgColor: 'bg-amber-500' };
  if (score >= 0.15) return { level: 'Low', color: 'text-orange-400', bgColor: 'bg-orange-500' };
  return { level: 'Very Low', color: 'text-gray-400', bgColor: 'bg-gray-500' };
};

// Helper function to extract token metadata from enriched balances
const getTokenMetadata = (mint: string, enrichedBalances: EnhancedKeyInsightsProps['results']['walletBalances']) => {
    if (!enrichedBalances) return undefined;
    
    for (const walletAddress in enrichedBalances) {
        const foundToken = enrichedBalances[walletAddress]?.tokenBalances?.find(t => (t as any).mint === mint);
        if (foundToken) {
            return {
                name: foundToken.name || undefined,
                symbol: foundToken.symbol || undefined,
                imageUrl: foundToken.imageUrl || undefined,
                websiteUrl: foundToken.websiteUrl || undefined,
                twitterUrl: foundToken.twitterUrl || undefined,
                telegramUrl: foundToken.telegramUrl || undefined
            };
        }
    }
    return undefined;
};

const getInsightIcon = (type: KeyInsight['type']) => {
  switch (type) {
    case 'Sustained Alignment': return <Handshake className="h-4 w-4" />;
    case 'Significant Asymmetry': return <Scale className="h-4 w-4" />;
    case 'High Similarity': return <Users2 className="h-4 w-4" />;
    case 'Behavioral Mirror': return <Users2 className="h-4 w-4" />;
    case 'Capital Divergence': return <ArrowUpRightFromSquare className="h-4 w-4" />;
    case 'Shared Zero Holdings': return <TrendingDown className="h-4 w-4" />;
    default: return <Lightbulb className="h-4 w-4" />;
  }
};

// Generate pair ID for state management
const generatePairId = (walletA: string, walletB: string): string => {
  return [walletA, walletB].sort().join('-');
};

// New PairCard component for the grid view
interface PairCardProps {
  processedPair: ProcessedPair;
  sortKey: SortKey;
  isSelected: boolean;
  onSelect: () => void;
  walletLabels?: CombinedSimilarityResult['walletLabels'];
  uniqueTokensPerWallet?: Record<string, { binary: number; capital: number }>;
  hudDataA?: WalletHudDto;
  hudDataB?: WalletHudDto;
}

// Fix insight generation for low similarity pairs
const generateRealisticInsight = (pair: CombinedPairwiseSimilarity, overallScore: number): string => {
  if (overallScore < 0.15) {
    return "Minimal overlap detected. These wallets appear to operate independently with different strategies.";
  } else if (overallScore < 0.3) {
    return "Low similarity found. Some shared interests but largely different investment approaches.";
  } else if (overallScore < 0.5) {
    return "Moderate overlap in trading patterns and capital allocation strategies.";
  } else if (overallScore < 0.7) {
    return "High similarity in investment behavior and token preferences.";
  } else {
    return "Very high correlation in trading patterns and capital deployment strategies.";
  }
};

// Simplified PairCard using SimilarityPairRibbon design language
const PairCard = memo(({ processedPair, sortKey, isSelected, onSelect, walletLabels, uniqueTokensPerWallet, hudDataA, hudDataB }: PairCardProps) => {
  const { insight, pair } = processedPair;
  const overallScore = calculateOverallScore(pair.binaryScore, pair.capitalScore);
  const scoreInfo = getScoreLevel(overallScore);
  const labelA = walletLabels?.[pair.walletA];
  const labelB = walletLabels?.[pair.walletB];

  const uniqueTokensA = uniqueTokensPerWallet?.[pair.walletA]?.binary ?? 0;
  const uniqueTokensB = uniqueTokensPerWallet?.[pair.walletB]?.binary ?? 0;

  // Calculate overlap ratios to show significance
  const overlapRatioA = uniqueTokensA > 0 ? (pair.binarySharedTokenCount / uniqueTokensA) * 100 : 0;
  const overlapRatioB = uniqueTokensB > 0 ? (pair.binarySharedTokenCount / uniqueTokensB) * 100 : 0;
  const maxOverlapRatio = Math.max(overlapRatioA, overlapRatioB);
  const minOverlapRatio = Math.min(overlapRatioA, overlapRatioB);

  const overallPercent = overallScore * 100;
  const behavioralPercent = pair.binaryScore * 100;
  const capitalPercent = pair.capitalScore * 100;

  function getScoreGradient(score: number): string {
    if (score >= 0.7) return 'from-emerald-500/15 via-emerald-500/5 to-transparent';
    if (score >= 0.5) return 'from-blue-500/15 via-blue-500/5 to-transparent';
    if (score >= 0.3) return 'from-amber-500/15 via-amber-500/5 to-transparent';
    return 'from-zinc-500/15 via-zinc-500/5 to-transparent';
  }

  function getScoreBarColor(score: number): string {
    if (score >= 0.7) return 'bg-emerald-500';
    if (score >= 0.5) return 'bg-blue-500';
    if (score >= 0.3) return 'bg-amber-500';
    return 'bg-zinc-500';
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        onClick={onSelect}
        className={cn(
          'group relative rounded-lg border overflow-hidden cursor-pointer',
          'bg-gradient-to-r',
          getScoreGradient(overallScore),
          'transition-all duration-200',
          isSelected
            ? 'border-primary/60 ring-1 ring-inset ring-primary/40 shadow-sm'
            : 'border-border/40 hover:border-border/70 hover:shadow-sm'
        )}
      >
        {/* Main content */}
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Header: Insight Type + Overlap Badge + Overall Score */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs min-w-0 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className={cn("text-xs shrink-0 cursor-help", INSIGHT_COLORS[insight.type])}>
                    {insight.type}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  <p>{insight.text || generateRealisticInsight(pair, overallScore)}</p>
                </TooltipContent>
              </Tooltip>

              {/* Overlap significance badge - MOVED TO HEADER */}
              {maxOverlapRatio >= 60 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] shrink-0 cursor-help bg-emerald-500/15 text-emerald-400 border-emerald-500/40">
                      High Overlap
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-xs">
                    <p>Very high portfolio overlap - these wallets trade very similar assets</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {maxOverlapRatio >= 30 && maxOverlapRatio < 60 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] shrink-0 cursor-help bg-blue-500/15 text-blue-400 border-blue-500/40">
                      Moderate
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-xs">
                    <p>Moderate overlap - some shared investment strategy</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('text-lg font-semibold tabular-nums cursor-help shrink-0', scoreInfo.color)}>
                    {overallPercent.toFixed(0)}%
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs max-w-xs">
                  <p className="text-muted-foreground">Higher percentages - more similar investment patterns.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Wallet Pair */}
          <div className="flex items-center gap-1.5 text-xs">
            <SimilarityWalletBadge
              address={pair.walletA}
              size="s"
              knownType={labelA?.knownType}
              knownLabel={labelA?.knownLabel}
              visibleActions={{ copy: false, solscan: false, profile: true }}
              showHud={true}
              hudData={hudDataA}
            />
            <span className="text-foreground/30 shrink-0">↔</span>
            <SimilarityWalletBadge
              address={pair.walletB}
              size="s"
              knownType={labelB?.knownType}
              knownLabel={labelB?.knownLabel}
              visibleActions={{ copy: false, solscan: false, profile: true }}
              showHud={true}
              hudData={hudDataB}
            />
          </div>

          {/* Score bars */}
          <div className="flex gap-2">
            {/* Behavioral */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center text-[10px]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-foreground/50 uppercase tracking-wide font-medium cursor-help w-16">Behavior</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                    <p>Behavioral similarity based on shared tokens (asset overlap)</p>
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto tabular-nums text-foreground/70 font-medium">{behavioralPercent.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', getScoreBarColor(pair.binaryScore))}
                  style={{ width: `${behavioralPercent}%` }}
                />
              </div>
            </div>

            {/* Capital */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center text-[10px]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-foreground/50 uppercase tracking-wide font-medium cursor-help w-16">Capital</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                    <p>Capital similarity based on portfolio allocation weights</p>
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto tabular-nums text-foreground/70 font-medium">{capitalPercent.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', getScoreBarColor(pair.capitalScore))}
                  style={{ width: `${capitalPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* PROMINENT Shared Token Count - matching similarity % importance */}
          <div className="flex items-center justify-center gap-2 pt-1 border-t border-border/30">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-help">
                  <span className={cn('text-base font-bold tabular-nums shrink-0', scoreInfo.color)}>
                    {pair.binarySharedTokenCount}
                  </span>
                  <span className="text-xs text-foreground/60 font-medium">shared</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">{pair.binarySharedTokenCount} tokens held by both wallets</p>
                  <p className="text-muted-foreground">Out of {uniqueTokensA} &amp; {uniqueTokensB} unique tokens total</p>
                  <p className="text-muted-foreground">Represents {overlapRatioA.toFixed(1)}% of Wallet A&apos;s portfolio</p>
                  <p className="text-muted-foreground">Represents {overlapRatioB.toFixed(1)}% of Wallet B&apos;s portfolio</p>
                </div>
              </TooltipContent>
            </Tooltip>
            <span className="text-foreground/30 text-xs">of</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <span className="text-sm font-semibold text-foreground/70 tabular-nums">{uniqueTokensA}</span>
                  <span className="text-foreground/30">&</span>
                  <span className="text-sm font-semibold text-foreground/70 tabular-nums">{uniqueTokensB}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>Wallet A has {uniqueTokensA} unique tokens</p>
                <p>Wallet B has {uniqueTokensB} unique tokens</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-[10px] text-muted-foreground">
              ({overlapRatioA.toFixed(0)}% • {overlapRatioB.toFixed(0)}%)
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
PairCard.displayName = 'PairCard';

// New skeleton components for loading states
const PairCardSkeleton = memo(() => (
  <Card className="p-4">
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-5 w-20 rounded" />
        </div>
        <Skeleton className="h-4 w-12 rounded" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded" />
        <span className="text-muted-foreground">↔</span>
        <Skeleton className="h-5 w-16 rounded" />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </div>
  </Card>
));
PairCardSkeleton.displayName = 'PairCardSkeleton';

const PairGridSkeleton = memo(() => (
  <div className="space-y-2">
    <Skeleton className="h-6 w-32 rounded" />
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <PairCardSkeleton key={i} />
      ))}
    </div>
  </div>
));
PairGridSkeleton.displayName = 'PairGridSkeleton';

const PairDetailSkeleton = memo(() => (
  <div className="space-y-6">
    <div>
      <Skeleton className="h-6 w-32 rounded mb-2" />
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-5 w-24 rounded" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span>Between</span>
        <Skeleton className="h-5 w-16 rounded" />
        <span>and</span>
        <Skeleton className="h-5 w-16 rounded" />
      </div>
      <Skeleton className="h-4 w-3/4 rounded" />
    </div>

    <div className="space-y-4">
      <div>
        <div className="flex justify-between items-center mb-2">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-4 w-12 rounded" />
        </div>
        <Skeleton className="h-3 w-full rounded-full mb-2" />
        <Skeleton className="h-3 w-5/6 rounded" />
      </div>
      <div>
        <div className="flex justify-between items-center mb-2">
          <Skeleton className="h-4 w-20 rounded" />
          <Skeleton className="h-4 w-12 rounded" />
        </div>
        <Skeleton className="h-3 w-full rounded-full mb-2" />
        <Skeleton className="h-3 w-4/5 rounded" />
      </div>
    </div>

    <div>
      <Skeleton className="h-5 w-40 rounded mb-3" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
          </div>
        ))}
      </div>
    </div>
  </div>
));
PairDetailSkeleton.displayName = 'PairDetailSkeleton';

// New PairGrid component for the master view
interface PairGridProps {
  processedPairs: ProcessedPair[];
  sortKey: SortKey;
  selectedPairId: string | null;
  onSelectPair: (pairId: string) => void;
  walletLabels?: CombinedSimilarityResult['walletLabels'];
  uniqueTokensPerWallet?: Record<string, { binary: number; capital: number }>;
}

const PairGrid = memo(({ processedPairs, sortKey, selectedPairId, onSelectPair, walletLabels, uniqueTokensPerWallet, isLoading }: PairGridProps & { isLoading?: boolean }) => {
  const walletAddresses = useMemo(() => {
    const set = new Set<string>();
    processedPairs.forEach(p => {
      set.add(p.pair.walletA);
      set.add(p.pair.walletB);
    });
    return Array.from(set);
  }, [processedPairs]);
  const { data: hudData } = useWalletHudCache(walletAddresses, { proactiveFetch: true });

  if (isLoading) {
    return <PairGridSkeleton />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Wallet Pairs</h3>
        <span className="text-[10px] text-muted-foreground">{processedPairs.length} pairs</span>
      </div>
      <ScrollArea className="h-[600px]">
        <div className="grid gap-2 pr-3">
          {processedPairs.map((processedPair) => {
            const pairId = generatePairId(processedPair.pair.walletA, processedPair.pair.walletB);
            return (
              <PairCard
                key={pairId}
                processedPair={processedPair}
                sortKey={sortKey}
                isSelected={selectedPairId === pairId}
                onSelect={() => onSelectPair(pairId)}
                walletLabels={walletLabels}
                uniqueTokensPerWallet={uniqueTokensPerWallet}
                hudDataA={hudData?.[processedPair.pair.walletA]}
                hudDataB={hudData?.[processedPair.pair.walletB]}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
});
PairGrid.displayName = 'PairGrid';

// New PairDetail component for the detail view
interface PairDetailProps {
  processedPair: ProcessedPair | null;
  results: CombinedSimilarityResult;
}

// Enhanced PairDetail with context and tooltips
const PairDetail = memo(({ processedPair, results, sortKey, setSortKey, isLoading }: PairDetailProps & { sortKey: SortKey; setSortKey: (key: SortKey) => void; isLoading?: boolean }) => {
  // State to track expanded groups - moved before early returns
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['major'])); // Major expanded by default

  // Compute hooks with safe fallback values - moved before early returns
  const pair = processedPair?.pair;
  const sharedTokens = useMemo(() => pair?.sharedTokens || [], [pair?.sharedTokens]);
  const capitalAllocation = pair?.capitalAllocation;
  const walletATotalValue = pair ? (results.walletBalances?.[pair.walletA]?.totalValueUsd ?? 0) : 0;
  const walletBTotalValue = pair ? (results.walletBalances?.[pair.walletB]?.totalValueUsd ?? 0) : 0;

  const { capitalOverlapPctA, capitalOverlapPctB } = useMemo(() => {
    let capitalOverlapA = 0;
    let capitalOverlapB = 0;
    if (capitalAllocation) {
      for (const token of sharedTokens) {
        const allocation = capitalAllocation[token.mint];
        if (allocation) {
          capitalOverlapA += allocation.weightA;
          capitalOverlapB += allocation.weightB;
        }
      }
    }
    return {
      capitalOverlapPctA: Math.min(capitalOverlapA * 100, 100),
      capitalOverlapPctB: Math.min(capitalOverlapB * 100, 100)
    };
  }, [sharedTokens, capitalAllocation]);

  // Process and group tokens by significance
  const { majorHoldings, meaningfulHoldings, minorHoldings } = useMemo(() => {
    const tokensWithData = (sharedTokens || []).map(token => {
      const allocation = capitalAllocation?.[token.mint];
      const weightA = allocation?.weightA ?? 0;
      const weightB = allocation?.weightB ?? 0;
      const valueA = walletATotalValue * weightA;
      const valueB = walletBTotalValue * weightB;
      const maxWeight = Math.max(weightA, weightB);

      return {
        ...token,
        weightA,
        weightB,
        valueA,
        valueB,
        maxWeight,
        totalValue: valueA + valueB,
      };
    });

    // Group by significance based on max allocation in either wallet
    const major = tokensWithData.filter(t => t.maxWeight >= 0.05);
    const meaningful = tokensWithData.filter(t => t.maxWeight >= 0.01 && t.maxWeight < 0.05);
    const minor = tokensWithData.filter(t => t.maxWeight < 0.01);

    // Sort each group by total value (descending)
    const sortByValue = (a: typeof tokensWithData[0], b: typeof tokensWithData[0]) => {
      if (sortKey === 'capitalScore') {
        return b.totalValue - a.totalValue;
      } else {
        // For assets view, sort by symbol
        const symbolA = getTokenMetadata(a.mint, results.walletBalances)?.symbol || a.mint;
        const symbolB = getTokenMetadata(b.mint, results.walletBalances)?.symbol || b.mint;
        return symbolA.localeCompare(symbolB);
      }
    };

    return {
      majorHoldings: major.sort(sortByValue),
      meaningfulHoldings: meaningful.sort(sortByValue),
      minorHoldings: minor.sort(sortByValue),
    };
  }, [sharedTokens, capitalAllocation, sortKey, walletATotalValue, walletBTotalValue, results.walletBalances]);

  // Early returns AFTER all hooks
  if (isLoading) {
    return <PairDetailSkeleton />;
  }

  if (!processedPair) {
    return (
      <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-border rounded-lg">
        <div className="p-4 rounded-full bg-muted mb-4">
          <Users2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Select a Wallet Pair</h3>
        <p className="text-muted-foreground text-center max-w-sm text-sm">
          Choose a wallet pair from the list to view detailed similarity analysis and shared token breakdown.
        </p>
      </div>
    );
  }

  const { insight } = processedPair;
  const { binaryScore, capitalScore, binarySharedTokenCount, capitalSharedTokenCount } = pair!;

  const labelA = results.walletLabels?.[pair!.walletA];
  const labelB = results.walletLabels?.[pair!.walletB];

  const overallScore = calculateOverallScore(binaryScore, capitalScore);
  const overallScoreInfo = getScoreLevel(overallScore);
  const binaryScoreInfo = getScoreLevel(binaryScore);
  const capitalScoreInfo = getScoreLevel(capitalScore);

  // Get total token counts for context
  const totalBinaryTokensA = results.uniqueTokensPerWallet[pair!.walletA]?.binary ?? 0;
  const totalBinaryTokensB = results.uniqueTokensPerWallet[pair!.walletB]?.binary ?? 0;
  const totalCapitalTokensA = results.uniqueTokensPerWallet[pair!.walletA]?.capital ?? 0;
  const totalCapitalTokensB = results.uniqueTokensPerWallet[pair!.walletB]?.capital ?? 0;

  const sharedBehavioralPctA = totalBinaryTokensA > 0 ? (binarySharedTokenCount / totalBinaryTokensA) * 100 : 0;
  const sharedBehavioralPctB = totalBinaryTokensB > 0 ? (binarySharedTokenCount / totalBinaryTokensB) * 100 : 0;

  // Calculate total unique tokens (union) between both wallets
  const totalUniqueBinaryTokens = totalBinaryTokensA + totalBinaryTokensB - binarySharedTokenCount;
  const totalUniqueCapitalTokens = totalCapitalTokensA + totalCapitalTokensB - capitalSharedTokenCount;

  // Generate realistic insight text
  const realisticInsight = generateRealisticInsight(pair!, overallScore);

  // Helper to format USD values
  const formatUSD = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    if (value >= 1) return `$${value.toFixed(0)}`;
    if (value > 0) return `$${value.toFixed(2)}`;
    return null; // Return null for zero values instead of "$0.00"
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  // Render token group section with collapsible ScrollArea for large lists
  const renderTokenGroup = (
    tokens: typeof majorHoldings,
    title: string,
    description: string,
    badgeColor: string,
    groupKey: string,
    maxItems: number = 50 // Default limit for performance
  ) => {
    if (tokens.length === 0) return null;

    const isExpanded = expandedGroups.has(groupKey);
    const displayTokens = tokens.slice(0, maxItems);
    const hasMore = tokens.length > maxItems;

    return (
      <div className="space-y-2">
        <div
          className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
          onClick={() => toggleGroup(groupKey)}
        >
          <div className="shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <h4 className="text-xs font-semibold text-foreground/80">{title}</h4>
          <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium", badgeColor)}>
            {tokens.length}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground cursor-help">ⓘ</span>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs max-w-xs">
              <p>{description}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        {isExpanded && (
          <ScrollArea className={cn("w-full", tokens.length > 10 ? "h-[400px]" : "h-auto")}>
            <div className="space-y-1 pr-3">
              {displayTokens.map((token) => {
                const metadata = getTokenMetadata(token.mint, results.walletBalances);

                return (
                  <div key={token.mint} className="flex items-center gap-2 p-2 rounded-md bg-muted/20 hover:bg-muted/40 transition-colors border border-border/40">
                    <div className="flex-1 min-w-0">
                      <TokenBadge
                        mint={token.mint}
                        metadata={metadata}
                        variant="inline"
                        size="sm"
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono shrink-0">
                      {/* Wallet A */}
                      <div className="flex flex-col items-end gap-0.5 min-w-[60px]">
                        {token.weightA > 0 ? (
                          <>
                            <span className="text-foreground/70 font-semibold">
                              {(token.weightA * 100).toFixed(1)}%
                            </span>
                            <span className="text-muted-foreground text-[10px]">
                              {formatUSD(token.valueA) || (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-orange-400 cursor-help">No data</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    <p>Allocation % exists but no USD value available</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </span>
                          </>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground/40 text-[10px] cursor-help">Exited</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p>Wallet A no longer holds this token</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      <span className="text-muted-foreground/50">•</span>

                      {/* Wallet B */}
                      <div className="flex flex-col items-end gap-0.5 min-w-[60px]">
                        {token.weightB > 0 ? (
                          <>
                            <span className="text-foreground/70 font-semibold">
                              {(token.weightB * 100).toFixed(1)}%
                            </span>
                            <span className="text-muted-foreground text-[10px]">
                              {formatUSD(token.valueB) || (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-orange-400 cursor-help">No data</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    <p>Allocation % exists but no USD value available</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </span>
                          </>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground/40 text-[10px] cursor-help">Exited</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p>Wallet B no longer holds this token</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {hasMore && (
                <div className="text-center py-2">
                  <span className="text-xs text-muted-foreground">
                    Showing {maxItems} of {tokens.length} tokens
                  </span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  };

  const totalSharedTokens = majorHoldings.length + meaningfulHoldings.length + minorHoldings.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
      {totalSharedTokens > 0 ? (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Shared Tokens</h3>
              <span className="text-xs text-muted-foreground">
                {totalSharedTokens} total
              </span>
            </div>
            <Tabs value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)} className="w-auto">
              <TabsList className="h-7 p-0.5 bg-muted/50">
                <TabsTrigger value="binaryScore" className="text-xs px-2 py-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>Assets</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p>Sort alphabetically by token symbol</p>
                    </TooltipContent>
                  </Tooltip>
                </TabsTrigger>
                <TabsTrigger value="capitalScore" className="text-xs px-2 py-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>Capital</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p>Sort by total $ value (combined holdings)</p>
                    </TooltipContent>
                  </Tooltip>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Column headers with wallet labels */}
          <div className="flex items-center justify-between px-2 pb-1 border-b border-border/50">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Token</span>
            <div className="flex items-center gap-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-16 text-right cursor-help">Wallet A</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  <SimilarityWalletBadge
                    address={pair!.walletA}
                    size="s"
                    knownType={labelA?.knownType}
                    knownLabel={labelA?.knownLabel}
                  />
                </TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground/50">•</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-16 text-right cursor-help">Wallet B</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  <SimilarityWalletBadge
                    address={pair!.walletB}
                    size="s"
                    knownType={labelB?.knownType}
                    knownLabel={labelB?.knownLabel}
                  />
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Grouped token lists */}
          <div className="space-y-4">
            {renderTokenGroup(
              majorHoldings,
              "Major Holdings",
              "Tokens representing ≥5% of portfolio value in at least one wallet",
              "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
              "major",
              100 // Show up to 100 major holdings
            )}
            {renderTokenGroup(
              meaningfulHoldings,
              "Meaningful Holdings",
              "Tokens representing 1-5% of portfolio value",
              "bg-blue-500/20 text-blue-400 border border-blue-500/30",
              "meaningful",
              50 // Show up to 50 meaningful holdings
            )}
            {renderTokenGroup(
              minorHoldings,
              "Minor Holdings",
              "Tokens representing <1% of portfolio value",
              "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
              "minor",
              30 // Show only top 30 minor holdings to prevent page elongation
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground">No shared tokens</p>
        </div>
      )}
      </div>
    </TooltipProvider>
  );
});
PairDetail.displayName = 'PairDetail';

// Updated main component to remove global sort controls and pass setSortKey
export const EnhancedKeyInsights = memo(({ results, isLoading }: EnhancedKeyInsightsProps & { isLoading?: boolean }) => {
  const [sortKey, setSortKey] = useState<SortKey>('binaryScore');
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);

  const walletLabels = useMemo(() => {
    const walletKeys = results.uniqueTokensPerWallet ? Object.keys(results.uniqueTokensPerWallet) : [];
    if (walletKeys.length === 0) {
      return {} as Record<string, string>;
    }
    return walletKeys.reduce((acc, address) => {
      acc[address] = `${address.slice(0, 6)}...${address.slice(-4)}`;
      return acc;
    }, {} as Record<string, string>);
  }, [results.uniqueTokensPerWallet]);

  const processedPairs = useMemo(() => {
    const insights = generateKeyInsights(results, walletLabels);
    const insightMap = new Map<string, KeyInsight>();
    insights.forEach(insight => {
        const { walletA, walletB } = insight.data;
        if (walletA && walletB) {
            const pairKey = [walletA, walletB].sort().join('|');
            insightMap.set(pairKey, insight);
        }
    });

    const filteredPairs = results.pairwiseSimilarities
      .filter(p => p.binaryScore > 0.1 || p.capitalScore > 0.1);

    const combinedData = filteredPairs.map(pair => {
      const pairKey = [pair.walletA, pair.walletB].sort().join('|');
      const overallScore = calculateOverallScore(pair.binaryScore, pair.capitalScore);
      
      // Generate more realistic insight based on actual scores
      const insight = insightMap.get(pairKey) || {
          type: overallScore >= 0.5 ? InsightType.HighSimilarity : 
                overallScore >= 0.3 ? InsightType.SustainedAlignment :
                overallScore >= 0.15 ? InsightType.SignificantAsymmetry :
                InsightType.SharedZeroHoldings, 
          wallets: [walletLabels[pair.walletA], walletLabels[pair.walletB]],
          score: overallScore,
          text: generateRealisticInsight(pair, overallScore),
          data: { walletA: pair.walletA, walletB: pair.walletB }
      };
      return { insight, pair };
    });
    
    return combinedData.sort((a, b) => {
      const scoreA = calculateOverallScore(a.pair.binaryScore, a.pair.capitalScore);
      const scoreB = calculateOverallScore(b.pair.binaryScore, b.pair.capitalScore);
      return scoreB - scoreA;
    });
  }, [results, walletLabels]);

  // Set initial selection to first pair
  useMemo(() => {
    if (processedPairs.length > 0 && !selectedPairId) {
      const firstPairId = generatePairId(processedPairs[0].pair.walletA, processedPairs[0].pair.walletB);
      setSelectedPairId(firstPairId);
    }
  }, [processedPairs, selectedPairId]);

  // Find selected pair data
  const selectedPair = useMemo(() => {
    if (!selectedPairId) return null;
    return processedPairs.find(p => 
      generatePairId(p.pair.walletA, p.pair.walletB) === selectedPairId
    ) || null;
  }, [selectedPairId, processedPairs]);

  return (
    <Card className="h-full border" aria-label="Key insights and pairwise analysis">
      <CardHeader>
        <CardTitle>Pair insights</CardTitle>
        <CardDescription>
          Automatically generated insights from the similarity analysis, with a detailed breakdown for each pair.
        </CardDescription>
      </CardHeader>
      <CardContent>        
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5">
              <PairGridSkeleton />
            </div>
            <div className="lg:col-span-7">
              <PairDetailSkeleton />
            </div>
          </div>
        ) : processedPairs.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-muted-foreground">No significant pairs identified based on the current thresholds (score &gt; 0.1).</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
            {/* Master: Compact Pair Grid */}
            <div>
              <PairGrid
                processedPairs={processedPairs}
                sortKey={sortKey}
                selectedPairId={selectedPairId}
                onSelectPair={setSelectedPairId}
                walletLabels={results.walletLabels}
                uniqueTokensPerWallet={results.uniqueTokensPerWallet}
                isLoading={false}
              />
            </div>

            {/* Detail: Selected Pair Analysis */}
            <div className="min-w-0">
              <PairDetail
                processedPair={selectedPair}
                results={results}
                sortKey={sortKey}
                setSortKey={setSortKey}
                isLoading={false}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

EnhancedKeyInsights.displayName = 'EnhancedKeyInsights'; 
