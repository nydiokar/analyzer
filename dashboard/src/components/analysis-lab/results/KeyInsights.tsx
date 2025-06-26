import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ComprehensiveSimilarityResult } from "./types";
import { generateKeyInsights, KeyInsight, InsightType } from '@/lib/similarity-report-parser';
import { shortenAddress } from '@/lib/solana-utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface KeyInsightsProps {
  results: ComprehensiveSimilarityResult;
}

const INSIGHT_COLORS: Record<InsightType, string> = {
    [InsightType.VeryHighSimilarity]: 'bg-red-500/20 text-red-700 border-red-500/30 hover:bg-red-500/30',
    [InsightType.SustainedAlignment]: 'bg-emerald-500/20 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/30',
    [InsightType.RecentDivergence]: 'bg-amber-500/20 text-amber-700 border-amber-500/30 hover:bg-amber-500/30',
    [InsightType.RecentConvergence]: 'bg-sky-500/20 text-sky-700 border-sky-500/30 hover:bg-sky-500/30',
    [InsightType.SignificantAsymmetry]: 'bg-purple-500/20 text-purple-700 border-purple-500/30 hover:bg-purple-500/30',
    [InsightType.SharedZeroHoldings]: 'bg-gray-500/20 text-gray-700 border-gray-500/30 hover:bg-gray-500/30',
};

const getInsightIcon = (type: KeyInsight['type']) => {
  switch (type) {
    case 'Sustained Alignment':
      return '🤝';
    case 'Recent Divergence':
      return '📉';
    case 'Recent Convergence':
      return '📈';
    case 'Significant Asymmetry':
      return '⚖️';
    case 'Very High Similarity':
        return '🔗';
    case 'Shared Zero Holdings':
        return '🚫';
    default:
      return '💡';
  }
};

export function KeyInsights({ results }: KeyInsightsProps) {
  const insights = useMemo(() => {
    // We can create a simple label mapping here for now
    const walletLabels = Object.keys(results.walletVectorsUsed).reduce((acc, address) => {
        acc[address] = shortenAddress(address, 6);
        return acc;
    }, {} as Record<string, string>);

    return generateKeyInsights(results, walletLabels);
  }, [results]);

  return (
    <Card className="h-full border">
      <CardHeader>
        <CardTitle>Key Insights & Summary</CardTitle>
        <CardDescription>
          Automatically generated insights from the similarity analysis.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-muted-foreground">No specific key insights identified.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <ul className="space-y-4">
              {insights.map((insight, index) => (
                <li key={index} className="flex items-start p-3 bg-muted/50 rounded-lg">
                  <span className="text-xl mr-4 mt-1">{getInsightIcon(insight.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <Badge variant="outline" className={cn("text-xs", INSIGHT_COLORS[insight.type])}>{insight.type}</Badge>
                         <div className="flex items-center gap-1">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p className="max-w-xs">This score represents the primary historical similarity between the wallets.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span className="font-semibold text-sm">Score: {insight.score.toFixed(3)}</span>
                        </div>
                    </div>
                    <div className="text-sm mt-2">
                        Between <Badge variant="secondary">{insight.wallets[0]}</Badge> and <Badge variant="secondary">{insight.wallets[1]}</Badge>
                    </div>
                    <p className="text-sm">{insight.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
} 