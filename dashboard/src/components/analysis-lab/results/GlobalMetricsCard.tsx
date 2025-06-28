import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlobalMetrics, CombinedPairwiseSimilarity } from './types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Users, ArrowRight, Wallet, Sigma, TrendingUp } from 'lucide-react';
import EChartComponent from '@/components/charts/EChartComponent';
import { formatToMillion } from '@/lib/utils';

interface GlobalMetricsCardProps {
  metrics: GlobalMetrics;
  pairwiseSimilarities: CombinedPairwiseSimilarity[];
  walletBalances?: Record<string, any> | null;
  walletVectorsUsed?: Record<string, Record<string, number>>;
}

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const StatCard = ({ title, value, icon, tooltipContent }: { title: string, value: string | number, icon: React.ReactNode, tooltipContent?: string }) => {
    const cardContent = (
        <div className="flex items-center p-4 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg h-full">
            <div className="mr-4 text-primary">{icon}</div>
            <div>
                <p className="text-sm font-medium text-muted-foreground">{title}</p>
                <p className="text-2xl font-bold">{value}</p>
            </div>
        </div>
    );

    if (tooltipContent) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger className="w-full h-full text-left">{cardContent}</TooltipTrigger>
                    <TooltipContent>
                        <p>{tooltipContent}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    return cardContent;
};


export function GlobalMetricsCard({ metrics, pairwiseSimilarities, walletBalances, walletVectorsUsed }: GlobalMetricsCardProps) {
  if (!metrics) {
    return null;
  }

  const { averageSimilarity } = metrics;
  
  const totalPairs = pairwiseSimilarities.length;
  // n(n-1)/2 = totalPairs => n^2 - n - 2*totalPairs = 0
  // using quadratic formula: n = (1 + sqrt(1 + 8*totalPairs)) / 2
  const numWallets = walletVectorsUsed ? Object.keys(walletVectorsUsed).length : 0;

  const topPairs = [...pairwiseSimilarities]
    .sort((a, b) => b.capitalScore - a.capitalScore)
    .slice(0, 5);

  const highSimilarityPairs = pairwiseSimilarities.filter(p => p.capitalScore > 0.75).length;
  const mediumSimilarityPairs = pairwiseSimilarities.filter(p => p.capitalScore > 0.50 && p.capitalScore <= 0.75).length;

  // --- New Global Metric Calculations ---
  let totalValueAnalyzed = 0;
  const allTokens = new Set<string>();
  const tokenValues: Record<string, number> = {};

  if (walletBalances) {
    Object.values(walletBalances).forEach((wallet: any) => {
      if (wallet && Array.isArray(wallet.tokenBalances)) {
        wallet.tokenBalances.forEach((token: any) => {
          const value = token.valueUsd || 0;
          totalValueAnalyzed += value;
          if (value > 0 && token.mint) {
            tokenValues[token.mint] = (tokenValues[token.mint] || 0) + value;
          }
        });
      }
    });
  }

  if (walletVectorsUsed) {
      Object.values(walletVectorsUsed).forEach(walletVector => {
          Object.keys(walletVector).forEach(mint => allTokens.add(mint));
      });
  }
  const totalUniqueTokens = allTokens.size;
  
  let topTokenDominance = 0;
  let topTokenSymbol = 'N/A';
  if (totalValueAnalyzed > 0) {
    const sortedTokens = Object.entries(tokenValues).sort((a, b) => b[1] - a[1]);
    if (sortedTokens.length > 0) {
      const [mint, value] = sortedTokens[0];
      topTokenDominance = (value / totalValueAnalyzed) * 100;
      // This is a simplification; a real implementation would look up the symbol.
      topTokenSymbol = truncateAddress(mint);
    }
  }

  const scoreDistribution = {
    '0-20%': pairwiseSimilarities.filter(p => p.capitalScore <= 0.2).length,
    '21-40%': pairwiseSimilarities.filter(p => p.capitalScore > 0.2 && p.capitalScore <= 0.4).length,
    '41-60%': pairwiseSimilarities.filter(p => p.capitalScore > 0.4 && p.capitalScore <= 0.6).length,
    '61-80%': pairwiseSimilarities.filter(p => p.capitalScore > 0.6 && p.capitalScore <= 0.8).length,
    '81-100%': pairwiseSimilarities.filter(p => p.capitalScore > 0.8).length,
  };

  const chartOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: {
        type: 'shadow' as const,
      }
    },
    grid: {
      top: 0,
      bottom: 170,
      left: 15,
      right: 20,
      containLabel: true
    },
    xAxis: {
      type: 'value' as const,
      boundaryGap: [0, 0.01],
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      data: Object.keys(scoreDistribution),
      axisTick: {
        show: false,
      },
      axisLine: {
        show: false,
      },
    },
    series: [
      {
        name: 'Pairs Count',
        type: 'bar' as const,
        data: Object.values(scoreDistribution),
        barWidth: '60%',
        itemStyle: {
          color: '#4f46e5',
          borderRadius: 5,
        },
      }
    ]
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Global Analysis Metrics</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
              </TooltipTrigger>
              <TooltipContent>
                <p>A high-level overview of similarity and composition for the entire wallet set.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard 
              title="Avg. Similarity" 
              value={`${(averageSimilarity * 100).toFixed(1)}%`} 
              icon={<Users size={24} />} 
              tooltipContent="Average capital similarity score across all pairs."
            />
            <StatCard 
              title="Total Value Analyzed" 
              value={`$${formatToMillion(totalValueAnalyzed)}`}
              icon={<Wallet size={24} />} 
              tooltipContent="Combined USD value of all tokens held by the analyzed wallets."
            />
            <StatCard 
              title="Portfolio Diversity" 
              value={totalUniqueTokens} 
              icon={<Sigma size={24} />} 
              tooltipContent="Total number of unique tokens held across the entire wallet set."
            />
            <StatCard 
              title="Top Token Dominance" 
              value={`${topTokenDominance.toFixed(1)}%`} 
              icon={<TrendingUp size={24} />} 
              tooltipContent={`The token ${topTokenSymbol} makes up this much of the group's total capital.`}
            />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 flex flex-col h-64">
                <h3 className="font-semibold mb-2 text-lg flex items-center">
                    <span>Top 5 Most Similar Pairs</span>
                </h3>
                <div className="flex-grow space-y-2 overflow-y-auto pr-2">
                    {topPairs.map((pair, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50 px-2 py-1.5 rounded-md">
                            <div className="flex items-center space-x-2">
                                <Badge variant="secondary">{truncateAddress(pair.walletA)}</Badge>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="secondary">{truncateAddress(pair.walletB)}</Badge>
                            </div>
                            <Badge variant="outline" className="font-semibold">
                                {(pair.capitalScore * 100).toFixed(1)}%
                            </Badge>
                        </div>
                    ))}
                </div>
            </div>
            <div className="lg:col-span-3 flex flex-col h-64">
                 <h3 className="font-semibold mb-2 text-lg flex items-center">
                    Similarity Score Distribution
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-4 w-4 text-muted-foreground cursor-pointer ml-2" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Shows how many wallet pairs fall into each similarity score bracket.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </h3>
                <div className="flex-grow">
                    <EChartComponent option={chartOption} style={{ height: '100%', width: '100%' }} />
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
} 