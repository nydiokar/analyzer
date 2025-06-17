import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlobalMetrics } from './types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from 'lucide-react';

interface GlobalMetricsCardProps {
  metrics: GlobalMetrics;
}

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

export function GlobalMetricsCard({ metrics }: GlobalMetricsCardProps) {
  if (!metrics) {
    return null;
  }

  const { averageSimilarity, mostSimilarPairs } = metrics;
  const topPair = mostSimilarPairs && mostSimilarPairs.length > 0 ? mostSimilarPairs[0] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Analysis Summary</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
              </TooltipTrigger>
              <TooltipContent>
                <p>A high-level overview of the similarity analysis for the entire wallet set.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col space-y-1">
          <span className="text-sm text-muted-foreground">Average Similarity Score</span>
          <span className="text-2xl font-bold">
            {(averageSimilarity * 100).toFixed(2)}%
          </span>
        </div>
        
        {topPair && (
          <div className="flex flex-col space-y-1">
            <span className="text-sm text-muted-foreground">Most Similar Pair</span>
            <div className="flex items-center space-x-2">
              <Badge variant="secondary">{truncateAddress(topPair.walletA)}</Badge>
              <span className="text-sm">&</span>
              <Badge variant="secondary">{truncateAddress(topPair.walletB)}</Badge>
              <Badge variant="outline" className="font-semibold">
                Score: {topPair.similarityScore.toFixed(3)}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 