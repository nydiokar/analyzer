'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CombinedSimilarityResult, KeyInsight, InsightType, CombinedPairwiseSimilarity } from "./types";
import { generateKeyInsights } from '@/lib/similarity-report-parser';
import { shortenAddress } from '@/lib/solana-utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HelpCircle, Info, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface EnhancedKeyInsightsProps {
  results: CombinedSimilarityResult;
}

type SortKey = 'binaryScore' | 'capitalScore';

const INSIGHT_COLORS: Record<InsightType, string> = {
    [InsightType.HighSimilarity]: 'bg-red-500/20 text-red-700 border-red-500/30 hover:bg-red-500/30',
    [InsightType.SustainedAlignment]: 'bg-emerald-500/20 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/30',
    [InsightType.SignificantAsymmetry]: 'bg-purple-500/20 text-purple-700 border-purple-500/30 hover:bg-purple-500/30',
    [InsightType.BehavioralMirror]: 'bg-indigo-500/20 text-indigo-700 border-indigo-500/30 hover:bg-indigo-500/30',
    [InsightType.CapitalDivergence]: 'bg-orange-500/20 text-orange-700 border-orange-500/30 hover:bg-orange-500/30',
    [InsightType.SharedZeroHoldings]: 'bg-gray-500/20 text-gray-700 border-gray-500/30 hover:bg-gray-500/30',
};

const getInsightIcon = (type: KeyInsight['type']) => {
  switch (type) {
    case 'Sustained Alignment': return '🤝';
    case 'Significant Asymmetry': return '⚖️';
    case 'High Similarity': return '🔗';
    case 'Behavioral Mirror': return '👯';
    case 'Capital Divergence': return '💰';
    case 'Shared Zero Holdings': return '🚫';
    default: return '💡';
  }
};

const ScoreBar = ({ score, label, textColor, bgColor }: { score: number, label: string, textColor: string, bgColor: string }) => (
    <div>
        <div className="flex justify-between items-center mb-1">
            <span className={`text-xs font-medium ${textColor}`}>{label}</span>
            <span className={`text-xs font-semibold ${textColor}`}>{score.toFixed(3)}</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5">
            <div className={`${bgColor} h-2.5 rounded-full`} style={{ width: `${score * 100}%` }}></div>
        </div>
    </div>
);

// New component for interactive wallet badges
const WalletBadge = ({ label, fullAddress }: { label: string, fullAddress: string }) => {
    const { toast } = useToast();

    const handleCopy = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(fullAddress);
            toast({
                title: "Copied!",
                description: `Address ${label} copied to clipboard.`,
            });
        } catch (err) {
            console.error("Failed to copy address:", err);
            toast({
                title: "Copy Failed",
                description: "Could not copy address to clipboard.",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs font-semibold group transition-all">
            <Link
                href={`/wallets/${fullAddress}`}
                target="_blank"
                className="hover:underline flex items-center gap-1"
                title={`View details for ${fullAddress}`}
            >
                {label}
                <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
            </Link>
            <button onClick={handleCopy} className="opacity-60 group-hover:opacity-100 transition-opacity" title={`Copy ${fullAddress}`}>
                <Copy className="h-3 w-3" />
            </button>
        </div>
    );
};

interface InsightCardProps {
    insight: KeyInsight;
    pair: CombinedPairwiseSimilarity;
    walletLabels: Record<string, string>;
    sortKey: SortKey;
    results: CombinedSimilarityResult;
}

const InsightCard = ({ insight, pair, walletLabels, sortKey, results }: InsightCardProps) => {
    const { binaryScore, capitalScore, sharedTokens, capitalAllocation, binarySharedTokenCount, capitalSharedTokenCount } = pair;

    const totalBinaryTokensA = results.uniqueTokensPerWallet[pair.walletA]?.binary ?? 0;
    const totalBinaryTokensB = results.uniqueTokensPerWallet[pair.walletB]?.binary ?? 0;
    const sharedBehavioralPctA = totalBinaryTokensA > 0 ? (binarySharedTokenCount / totalBinaryTokensA) * 100 : 0;
    const sharedBehavioralPctB = totalBinaryTokensB > 0 ? (binarySharedTokenCount / totalBinaryTokensB) * 100 : 0;
    
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
    const capitalOverlapPctA = capitalOverlapA * 100;
    const capitalOverlapPctB = capitalOverlapB * 100;

    const isCapitalSort = sortKey === 'capitalScore';

    const topSharedTokens = useMemo(() => {
        const sorted = [...(sharedTokens || [])];
        if (isCapitalSort && capitalAllocation) {
            sorted.sort((a, b) => {
                const allocA = capitalAllocation[a.mint];
                const allocB = capitalAllocation[b.mint];
                const scoreA = allocA ? allocA.weightA + allocA.weightB : 0;
                const scoreB = allocB ? allocB.weightA + allocB.weightB : 0;
                return scoreB - scoreA;
            });
        }
        return sorted.slice(0, 10);
    }, [sharedTokens, capitalAllocation, isCapitalSort]);
    
    const walletA = walletLabels[pair.walletA];
    const walletB = walletLabels[pair.walletB];

    return (
        <li className="p-4 bg-muted/50 rounded-lg space-y-4">
            <div className="flex items-start w-full">
                <span className="text-xl mr-4 mt-1">{getInsightIcon(insight.type)}</span>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <Badge variant="outline" className={cn("text-xs", INSIGHT_COLORS[insight.type])}>{insight.type}</Badge>
                         <div className="flex items-center gap-1">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                                    <TooltipContent><p>Approximate similarity score between wallets, based of capital allocation or token overlap across their portfolio.</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span className="font-semibold text-sm">Score: {insight.score.toFixed(3)}</span>
                        </div>
                    </div>
                    <div className="text-sm mt-2">
                        Between <WalletBadge label={walletA} fullAddress={pair.walletA} /> and <WalletBadge label={walletB} fullAddress={pair.walletB} />
                    </div>
                    <div className="text-sm mt-1">{insight.text}</div>
                </div>
            </div>

            <div className="space-y-2">
                <ScoreBar score={binaryScore} label="Behavioral" textColor="text-blue-500" bgColor="bg-blue-500" />
                <div className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">{binarySharedTokenCount}</span> common token(s). 
                    Allocation across tokens for Wallet <WalletBadge label={walletA} fullAddress={pair.walletA} />: <span className="font-bold text-foreground">{sharedBehavioralPctA.toFixed(1)}%</span>. 
                    and Wallet <WalletBadge label={walletB} fullAddress={pair.walletB} />: <span className="font-bold text-foreground">{sharedBehavioralPctB.toFixed(1)}%</span>.
                </div>
            </div>

            <div className="space-y-2">
                <ScoreBar score={capitalScore} label="Capital" textColor="text-emerald-500" bgColor="bg-emerald-500" />
                <div className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">{capitalSharedTokenCount}</span> common token(s). 
                    Allocation across capital for Wallet <WalletBadge label={walletA} fullAddress={pair.walletA} />: <span className="font-bold text-foreground">{capitalOverlapPctA.toFixed(1)}%</span>. 
                    and Wallet <WalletBadge label={walletB} fullAddress={pair.walletB} />: <span className="font-bold text-foreground">{capitalOverlapPctB.toFixed(1)}%</span>.
                </div>
            </div>

            {topSharedTokens.length > 0 && (
                 <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="item-1" className="border-none">
                        <AccordionTrigger className="text-sm font-semibold hover:no-underline p-0">
                            Top 10 Shared Tokens {isCapitalSort ? '(by Capital)' : '(by Interaction)'}
                        </AccordionTrigger>
                        <AccordionContent className="pt-2">
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Token</TableHead>
                                        <TableHead className="text-right">{walletA} Allocation</TableHead>
                                        <TableHead className="text-right">{walletB} Allocation</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topSharedTokens.map(token => (
                                        <TableRow key={token.mint}>
                                            <TableCell className="font-mono text-xs truncate" title={token.mint}>{shortenAddress(token.mint, 10)}</TableCell>
                                            <TableCell className="text-right">
                                                {capitalAllocation?.[token.mint] ? `${(capitalAllocation[token.mint].weightA * 100).toFixed(2)}%` : <span className="text-emerald-500">Interaction</span>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {capitalAllocation?.[token.mint] ? `${(capitalAllocation[token.mint].weightB * 100).toFixed(2)}%` : <span className="text-emerald-500">Interaction</span>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}
        </li>
    );
};

export function EnhancedKeyInsights({ results }: EnhancedKeyInsightsProps) {
  const [sortKey, setSortKey] = useState<SortKey>('binaryScore');
  
  const walletLabels = useMemo(() => Object.keys(results.walletVectorsUsed).reduce((acc, address) => {
      acc[address] = shortenAddress(address, 6);
      return acc;
  }, {} as Record<string, string>), [results.walletVectorsUsed]);

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


  return (
    <Card className="h-full border">
      <CardHeader>
        <CardTitle>Key Insights & Pairwise Deep Dive</CardTitle>
        <CardDescription>
          Automatically generated insights from the similarity analysis, with a detailed breakdown for each pair.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)} className="w-full mb-4">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="binaryScore">Sort by Behavioral</TabsTrigger>
                <TabsTrigger value="capitalScore">Sort by Capital</TabsTrigger>
            </TabsList>
        </Tabs>
        {processedPairs.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-muted-foreground">No significant pairs identified based on the current thresholds (score &gt; 0.1).</p>
          </div>
        ) : (
          <ScrollArea className="h-[700px] -mx-3">
             <ul className="space-y-4 px-3">
                {processedPairs.map(({ insight, pair }) => (
                    <InsightCard key={pair.walletA + '-' + pair.walletB} insight={insight} pair={pair} walletLabels={walletLabels} sortKey={sortKey} results={results} />
                ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
} 