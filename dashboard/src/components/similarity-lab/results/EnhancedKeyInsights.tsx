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
import { Info, LinkIcon, Handshake, Scale, Users2, ArrowUpRightFromSquare, Ban, Lightbulb } from "lucide-react";
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

const INSIGHT_COLORS: Record<InsightType, string> = {
    [InsightType.HighSimilarity]: 'bg-red-100 text-red-800 border-red-200',
    [InsightType.SustainedAlignment]: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    [InsightType.SignificantAsymmetry]: 'bg-purple-100 text-purple-800 border-purple-200',
    [InsightType.BehavioralMirror]: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    [InsightType.CapitalDivergence]: 'bg-orange-100 text-orange-800 border-orange-200',
    [InsightType.SharedZeroHoldings]: 'bg-gray-100 text-gray-800 border-gray-200',
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
    case 'High Similarity': return <LinkIcon className="h-4 w-4" />;
    case 'Behavioral Mirror': return <Users2 className="h-4 w-4" />;
    case 'Capital Divergence': return <ArrowUpRightFromSquare className="h-4 w-4" />;
    case 'Shared Zero Holdings': return <Ban className="h-4 w-4" />;
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

const PairCard = memo(({ processedPair, sortKey, isSelected, onSelect }: PairCardProps) => {
  const { insight, pair } = processedPair;
  const primaryScore = sortKey === 'binaryScore' ? pair.binaryScore : pair.capitalScore;
  const scoreLabel = sortKey === 'binaryScore' ? 'Behavioral' : 'Capital';

  return (
    <Card 
      className={cn(
        "p-4 cursor-pointer transition-all hover:shadow-md",
        isSelected ? "ring-2 ring-primary border-primary" : "border-muted"
      )}
      onClick={onSelect}
    >
      <div className="space-y-3">
        {/* Header with insight type */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getInsightIcon(insight.type)}
            <Badge variant="outline" className={cn("text-xs", INSIGHT_COLORS[insight.type])}>
              {insight.type}
            </Badge>
          </div>
          <span className="text-sm font-semibold">{primaryScore.toFixed(3)}</span>
        </div>

        {/* Wallet pair */}
        <div className="text-sm">
          <WalletBadge address={pair.walletA} /> ↔ <WalletBadge address={pair.walletB} />
        </div>

        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{scoreLabel}</span>
            <span>{(primaryScore * 100).toFixed(1)}%</span>
          </div>
          <Progress value={Math.min(primaryScore * 100, 100)} className="h-2" />
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

const PairDetail = memo(({ processedPair, results, isLoading }: PairDetailProps & { isLoading?: boolean }) => {
  if (isLoading) {
    return <PairDetailSkeleton />;
  }

  if (!processedPair) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">Select a wallet pair to view detailed analysis</p>
      </div>
    );
  }

  const { insight, pair } = processedPair;
  const { binaryScore, capitalScore, sharedTokens, capitalAllocation, binarySharedTokenCount, capitalSharedTokenCount } = pair;

  const totalBinaryTokensA = results.uniqueTokensPerWallet[pair.walletA]?.binary ?? 0;
  const totalBinaryTokensB = results.uniqueTokensPerWallet[pair.walletB]?.binary ?? 0;
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

  const topSharedTokens = useMemo(() => {
    const sorted = [...(sharedTokens || [])];
    if (capitalAllocation) {
      sorted.sort((a, b) => {
        const allocA = capitalAllocation[a.mint];
        const allocB = capitalAllocation[b.mint];
        const scoreA = allocA ? allocA.weightA + allocA.weightB : 0;
        const scoreB = allocB ? allocB.weightA + allocB.weightB : 0;
        return scoreB - scoreA;
      });
    }
    return sorted.slice(0, 10);
  }, [sharedTokens, capitalAllocation]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Pair Analysis</h3>
        <div className="flex items-center gap-2 mb-3">
          {getInsightIcon(insight.type)}
          <Badge variant="outline" className={cn("text-sm", INSIGHT_COLORS[insight.type])}>
            {insight.type}
          </Badge>
        </div>
        <div className="text-sm mb-2">
          Between <WalletBadge address={pair.walletA} /> and <WalletBadge address={pair.walletB} />
        </div>
        <p className="text-sm text-muted-foreground">{insight.text}</p>
      </div>

      {/* Score breakdowns */}
      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-blue-600">Behavioral Score</span>
            <span className="text-sm font-semibold">{binaryScore.toFixed(3)}</span>
          </div>
          <Progress value={Math.min(binaryScore * 100, 100)} className="h-3 mb-2" />
          <div className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{binarySharedTokenCount}</span> common token(s). 
            Allocation across tokens for Wallet <WalletBadge address={pair.walletA} />: <span className="font-bold text-foreground">{sharedBehavioralPctA.toFixed(1)}%</span>. 
            and Wallet <WalletBadge address={pair.walletB} />: <span className="font-bold text-foreground">{sharedBehavioralPctB.toFixed(1)}%</span>.
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-emerald-600">Capital Score</span>
            <span className="text-sm font-semibold">{capitalScore.toFixed(3)}</span>
          </div>
          <Progress value={Math.min(capitalScore * 100, 100)} className="h-3 mb-2" />
          <div className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{capitalSharedTokenCount}</span> common token(s). 
            Allocation across capital for Wallet <WalletBadge address={pair.walletA} />: <span className="font-bold text-foreground">{capitalOverlapPctA.toFixed(1)}%</span>. 
            and Wallet <WalletBadge address={pair.walletB} />: <span className="font-bold text-foreground">{capitalOverlapPctB.toFixed(1)}%</span>.
          </div>
        </div>
      </div>

      {/* Shared tokens table - always visible */}
      {topSharedTokens.length > 0 && (
        <div>
          <h4 className="text-md font-semibold mb-3">Top 10 Shared Tokens</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead className="text-right"><WalletBadge address={pair.walletA} /></TableHead>
                <TableHead className="text-right"><WalletBadge address={pair.walletB} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topSharedTokens.map(token => {
                const allocation = capitalAllocation?.[token.mint];
                return (
                  <TableRow key={token.mint}>
                    <TableCell className="font-medium font-mono">
                      <TokenBadge 
                        mint={token.mint} 
                        metadata={getTokenMetadata(token.mint, results.walletBalances)} 
                        size="sm" 
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {allocation?.weightA !== undefined ? `${(allocation.weightA * 100).toFixed(2)}%` : <span className="text-emerald-500">Interaction</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {allocation?.weightB !== undefined ? `${(allocation.weightB * 100).toFixed(2)}%` : <span className="text-emerald-500">Interaction</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
});
PairDetail.displayName = 'PairDetail';

// Main component with Grid + Detail layout
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
      const insight = insightMap.get(pairKey) || {
          type: InsightType.HighSimilarity, 
          wallets: [walletLabels[pair.walletA], walletLabels[pair.walletB]],
          score: Math.max(pair.binaryScore, pair.capitalScore),
          text: `Significant overlap found in trading patterns or capital deployment.`,
          data: { walletA: pair.walletA, walletB: pair.walletB }
      };
      return { insight, pair };
    });
    
    return combinedData.sort((a, b) => b.pair[sortKey] - a.pair[sortKey]);
  }, [results, walletLabels, sortKey]);

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
        <Tabs value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)} className="w-full mb-4" aria-label="Sort similarity results">
          <TabsList className="grid w-full grid-cols-2" aria-label="Sorting options">
            <TabsTrigger value="binaryScore" aria-label="Sort by behavioral similarity score">Sort by Behavioral</TabsTrigger>
            <TabsTrigger value="capitalScore" aria-label="Sort by capital similarity score">Sort by Capital</TabsTrigger>
          </TabsList>
        </Tabs>
        
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