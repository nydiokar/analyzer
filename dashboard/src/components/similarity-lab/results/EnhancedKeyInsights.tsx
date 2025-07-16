'use client';

import { useMemo, useState, memo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CombinedSimilarityResult, KeyInsight, InsightType, CombinedPairwiseSimilarity } from "./types";
import { generateKeyInsights } from '@/lib/similarity-report-parser';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info, LinkIcon, Handshake, Scale, Users2, ArrowUpRightFromSquare, TrendingDown, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from "@/components/ui/button";
import { WalletBadge } from '@/components/shared/WalletBadge';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

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

// Overall similarity score calculation
const calculateOverallScore = (binaryScore: number, capitalScore: number): number => {
  // Weighted average: behavioral 40%, capital 60% (capital is often more meaningful)
  return (binaryScore * 0.4) + (capitalScore * 0.6);
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

// Simplified PairCard focusing on overall assessment
const PairCard = memo(({ processedPair, sortKey, isSelected, onSelect }: PairCardProps) => {
  const { insight, pair } = processedPair;
  const overallScore = calculateOverallScore(pair.binaryScore, pair.capitalScore);
  const scoreInfo = getScoreLevel(overallScore);

  return (
    <Card 
      className={cn(
        "p-4 cursor-pointer transition-all duration-200 hover:bg-muted/30 border",
        isSelected ? "ring-2 ring-blue-500 border-blue-500/50 bg-blue-500/5" : "border-border hover:border-border/70"
      )}
      onClick={onSelect}
    >
      <div className="space-y-3">
        {/* Header: Insight Type & Overall Assessment */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded bg-muted/50">
              {getInsightIcon(insight.type)}
            </div>
            <div>
              <Badge variant="outline" className={cn("text-xs", INSIGHT_COLORS[insight.type])}>
                {insight.type}
              </Badge>
              <div className={cn("text-xs mt-0.5 font-medium", scoreInfo.color)}>
                {scoreInfo.level} Similarity
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{(overallScore * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Overall</div>
          </div>
        </div>

        {/* Wallet Pair */}
        <div className="flex items-center justify-center gap-2 py-2 px-3 bg-muted/30 rounded">
          <WalletBadge address={pair.walletA} className="text-xs" />
          <div className="text-muted-foreground">↔</div>
          <WalletBadge address={pair.walletB} className="text-xs" />
        </div>

        {/* Overall Score Indicator */}
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-500", scoreInfo.bgColor)}
              style={{ width: `${Math.min(overallScore * 100, 100)}%` }}
            />
          </div>
          <div className="text-xs text-center text-muted-foreground">
            {pair.sharedTokens.length} shared tokens
          </div>
        </div>
      </div>
    </Card>
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
}

const PairGrid = memo(({ processedPairs, sortKey, selectedPairId, onSelectPair, isLoading }: PairGridProps & { isLoading?: boolean }) => {
  if (isLoading) {
    return <PairGridSkeleton />;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Wallet Pairs</h3>
      <ScrollArea className="h-[60vh] lg:h-[600px]">
        <div className="grid gap-3 pr-4">
          {processedPairs.map((processedPair) => {
            const pairId = generatePairId(processedPair.pair.walletA, processedPair.pair.walletB);
            return (
              <PairCard
                key={pairId}
                processedPair={processedPair}
                sortKey={sortKey}
                isSelected={selectedPairId === pairId}
                onSelect={() => onSelectPair(pairId)}
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

  const { insight, pair } = processedPair;
  const { binaryScore, capitalScore, sharedTokens, capitalAllocation, binarySharedTokenCount, capitalSharedTokenCount } = pair;
  
  const overallScore = calculateOverallScore(binaryScore, capitalScore);
  const overallScoreInfo = getScoreLevel(overallScore);
  const binaryScoreInfo = getScoreLevel(binaryScore);
  const capitalScoreInfo = getScoreLevel(capitalScore);

  // Get total token counts for context
  const totalBinaryTokensA = results.uniqueTokensPerWallet[pair.walletA]?.binary ?? 0;
  const totalBinaryTokensB = results.uniqueTokensPerWallet[pair.walletB]?.binary ?? 0;
  const totalCapitalTokensA = results.uniqueTokensPerWallet[pair.walletA]?.capital ?? 0;
  const totalCapitalTokensB = results.uniqueTokensPerWallet[pair.walletB]?.capital ?? 0;

  const sharedBehavioralPctA = totalBinaryTokensA > 0 ? (binarySharedTokenCount / totalBinaryTokensA) * 100 : 0;
  const sharedBehavioralPctB = totalBinaryTokensB > 0 ? (binarySharedTokenCount / totalBinaryTokensB) * 100 : 0;
  
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
  }, [sharedTokens.length, capitalAllocation]);

  // Generate realistic insight text
  const realisticInsight = generateRealisticInsight(pair, overallScore);

  // Filter and sort tokens based on sortKey for the table - show only tokens with meaningful allocations
  const sortedSharedTokens = useMemo(() => {
    const filtered = (sharedTokens || []).filter(token => {
      const allocation = capitalAllocation?.[token.mint];
      if (sortKey === 'capitalScore') {
        // For capital sort, show only tokens with actual capital allocation
        return allocation && (allocation.weightA > 0.001 || allocation.weightB > 0.001);
      } else {
        // For asset sort, show all shared tokens
        return true;
      }
    });

    const sorted = [...filtered];
    if (sortKey === 'capitalScore' && capitalAllocation) {
      // Sort by total capital allocation (combined weight)
      sorted.sort((a, b) => {
        const allocA = capitalAllocation[a.mint];
        const allocB = capitalAllocation[b.mint];
        const scoreA = allocA ? allocA.weightA + allocA.weightB : 0;
        const scoreB = allocB ? allocB.weightA + allocB.weightB : 0;
        return scoreB - scoreA;
      });
    } else {
      // Sort by alphabetical order for assets (consistent ordering)
      sorted.sort((a, b) => {
        const nameA = getTokenMetadata(a.mint, results.walletBalances)?.symbol || a.mint;
        const nameB = getTokenMetadata(b.mint, results.walletBalances)?.symbol || b.mint;
        return nameA.localeCompare(nameB);
      });
    }
    return sorted.slice(0, 10);
  }, [sharedTokens, capitalAllocation, sortKey]);

  return (
    <div className="space-y-4">
      {/* Compact Header Section */}
      <Card className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold mb-2">Pair Analysis</h2>
            <Badge variant="outline" className={cn("text-xs", INSIGHT_COLORS[insight.type])}>
              {insight.type}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{(overallScore * 100).toFixed(0)}%</div>
            <div className={cn("text-sm", overallScoreInfo.color)}>{overallScoreInfo.level}</div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-xs text-muted-foreground mt-1 cursor-help border-b border-dotted">
                    Overall Similarity
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Weighted combination of assets (40%) and capital (60%) similarity scores. Higher percentages indicate more similar investment patterns.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        {/* Compact Wallet Pair */}
        <div className="flex items-center gap-2 mb-3 text-sm">
          <WalletBadge address={pair.walletA} className="text-xs" />
          <div className="text-muted-foreground">↔</div>
          <WalletBadge address={pair.walletB} className="text-xs" />
        </div>
        
        {/* Clean prominent insight */}
        <div className="bg-muted/30 border border-border rounded-lg p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-emerald-500 rounded-l-lg"></div>
          <p className="text-base text-foreground font-semibold leading-relaxed pl-3">
            {realisticInsight}
          </p>
        </div>
      </Card>

      {/* Enhanced Similarity Breakdown with Capital Color Coding */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-6">Similarity Breakdown</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Behavioral Score */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-base font-semibold">Behavioral</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-400">{(binaryScore * 100).toFixed(0)}%</div>
                <div className={cn("text-sm font-medium", binaryScoreInfo.color)}>{binaryScoreInfo.level}</div>
              </div>
            </div>
            
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.min(binaryScore * 100, 100)}%` }}
              />
            </div>
            
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <div className="text-muted-foreground">
                <strong>{binarySharedTokenCount}/{totalBinaryTokensA + totalBinaryTokensB}</strong> shared tokens
                <br />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dotted">
                        Portfolio overlap: <span className={cn(
                          "font-mono",
                          sharedBehavioralPctA >= 60 ? "text-blue-300 font-bold" : ""
                        )}>{sharedBehavioralPctA.toFixed(1)}%</span> & <span className={cn(
                          "font-mono",
                          sharedBehavioralPctB >= 60 ? "text-blue-300 font-bold" : ""
                        )}>{sharedBehavioralPctB.toFixed(1)}%</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <p>
                        Out of <strong>{totalBinaryTokensA}</strong> and <strong>{totalBinaryTokensB}</strong> total tokens respectively. 
                        Shows what percentage of each wallet's portfolio consists of shared tokens.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>

          {/* Enhanced Capital Score with Color Coding */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
                <span className="text-base font-semibold">Capital</span>
              </div>
              <div className="text-right">
                <div className={cn(
                  "text-2xl font-bold",
                  capitalScore >= 0.6 ? "text-emerald-300" : "text-emerald-400"
                )}>{(capitalScore * 100).toFixed(0)}%</div>
                <div className={cn("text-sm font-medium", capitalScoreInfo.color)}>{capitalScoreInfo.level}</div>
              </div>
            </div>
            
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className={cn(
                  "h-full transition-all duration-300",
                  capitalScore >= 0.6 ? "bg-emerald-400" : "bg-emerald-500"
                )}
                style={{ width: `${Math.min(capitalScore * 100, 100)}%` }}
              />
            </div>
            
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <div className="text-muted-foreground">
                <strong>{capitalSharedTokenCount}/{totalCapitalTokensA + totalCapitalTokensB}</strong> shared positions
                <br />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dotted">
                        Capital overlap: <span className={cn(
                          "font-mono",
                          capitalOverlapPctA >= 60 ? "text-emerald-200 font-bold" : ""
                        )}>{capitalOverlapPctA.toFixed(1)}%</span> & <span className={cn(
                          "font-mono", 
                          capitalOverlapPctB >= 60 ? "text-emerald-200 font-bold" : ""
                        )}>{capitalOverlapPctB.toFixed(1)}%</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <p>
                        Out of <strong>{totalCapitalTokensA}</strong> and <strong>{totalCapitalTokensB}</strong> tokens with capital allocation respectively. 
                        Shows what percentage of each wallet's invested capital is in shared tokens.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Shared Tokens Table with Local Sort Controls */}
      {sortedSharedTokens.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-xl font-semibold">Top 10 Shared Tokens</h3>
              {/* Local Sort Controls */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Sort by:</span>
                <Tabs value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)} className="w-auto">
                  <TabsList className="h-8 p-1 bg-muted/50">
                    <TabsTrigger value="binaryScore" className="text-xs px-3 py-1">Assets</TabsTrigger>
                    <TabsTrigger value="capitalScore" className="text-xs px-3 py-1">Capital</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {sharedTokens.length}/{Math.max(totalBinaryTokensA + totalBinaryTokensB, totalCapitalTokensA + totalCapitalTokensB)} tokens analyzed
            </div>
          </div>
          
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-sm font-semibold">Token</TableHead>
                  <TableHead className="text-right text-sm font-semibold">
                    <WalletBadge address={pair.walletA} />
                  </TableHead>
                  <TableHead className="text-right text-sm font-semibold">
                    <WalletBadge address={pair.walletB} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSharedTokens.map((token, index) => {
                  const allocation = capitalAllocation?.[token.mint];
                  return (
                    <TableRow key={token.mint} className="border-border">
                      <TableCell className="font-medium">
                        <TokenBadge 
                          mint={token.mint} 
                          metadata={getTokenMetadata(token.mint, results.walletBalances)} 
                          size="sm" 
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {allocation?.weightA !== undefined ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="font-mono text-xs text-emerald-400 cursor-help border-b border-dotted border-emerald-400/30">
                                  {(allocation.weightA * 100).toFixed(2)}%
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Percentage of wallet's total capital allocated to this token</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-blue-400 text-xs px-2 py-1 bg-blue-500/10 rounded">
                            Held
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {allocation?.weightB !== undefined ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="font-mono text-xs text-emerald-400 cursor-help border-b border-dotted border-emerald-400/30">
                                  {(allocation.weightB * 100).toFixed(2)}%
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Percentage of wallet's total capital allocated to this token</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-blue-400 text-xs px-2 py-1 bg-blue-500/10 rounded">
                            Held
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
});
PairDetail.displayName = 'PairDetail';

// Updated main component to remove global sort controls and pass setSortKey
export const EnhancedKeyInsights = memo(({ results, isLoading }: EnhancedKeyInsightsProps & { isLoading?: boolean }) => {
  const [sortKey, setSortKey] = useState<SortKey>('binaryScore');
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  
  const walletLabels = useMemo(() => {
    if (!results.walletVectorsUsed) {
      return {} as Record<string, string>;
    }
    return Object.keys(results.walletVectorsUsed).reduce((acc, address) => {
      acc[address] = `${address.slice(0, 6)}...${address.slice(-4)}`;
      return acc;
    }, {} as Record<string, string>);
  }, [results.walletVectorsUsed]);

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
  }, [processedPairs.length, selectedPairId]);

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
        <CardTitle>Key Insights & Pairwise Deep Dive</CardTitle>
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Master: Pair Grid */}
            <div className="lg:col-span-5">
              <PairGrid
                processedPairs={processedPairs}
                sortKey={sortKey}
                selectedPairId={selectedPairId}
                onSelectPair={setSelectedPairId}
                isLoading={false}
              />
            </div>
            
            {/* Detail: Selected Pair Analysis */}
            <div className="lg:col-span-7">
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