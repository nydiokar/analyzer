import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ComprehensiveSimilarityResult } from "./types";
import { generateKeyInsights, KeyInsight } from '@/lib/similarity-report-parser';
import { shortenAddress } from '@/lib/solana-utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface KeyInsightsProps {
  results: ComprehensiveSimilarityResult;
}

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
    case 'Focused Investment Pattern':
        return '🎯';
    case 'Very High Similarity':
        return '🔗';
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
                        <h4 className="font-semibold">{insight.type}</h4>
                        <Badge variant="secondary">Score: {insight.score.toFixed(3)}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mb-1">
                      Between <Badge variant="outline">{insight.wallets[0]}</Badge> and <Badge variant="outline">{insight.wallets[1]}</Badge>
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