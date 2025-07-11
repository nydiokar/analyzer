import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlobalMetrics, CombinedPairwiseSimilarity } from './types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Users, ArrowRight, Wallet, Sigma, TrendingUp, HelpCircle } from 'lucide-react';
import EChartComponent from '@/components/charts/EChartComponent';
import { formatToMillion } from '@/lib/utils';
import { WalletBadge } from "@/components/shared/WalletBadge";

interface GlobalMetricsCardProps {
  metrics: GlobalMetrics;
  pairwiseSimilarities: CombinedPairwiseSimilarity[];
  walletBalances?: Record<string, any> | null;
  walletVectorsUsed?: Record<string, Record<string, number>>;
}

const StatCard = ({ title, value, icon, details, tooltipContent }: { title: string, value: string | number, icon: React.ReactNode, details?: React.ReactNode, tooltipContent?: string }) => {
    const cardContent = (
        <div className="card h-full flex flex-col p-3 gap-1">
            <div className="flex items-center gap-3">
                <div className="text-primary">{icon}</div>
                <div>
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>
                    <p className="text-2xl font-bold">{value}</p>
                </div>
            </div>
            {details && <div className="text-xs text-muted-foreground mt-auto pt-1">{details}</div>}
        </div>
    );

    if (tooltipContent) {
        return (
            <TooltipProvider>
                <Tooltip delayDuration={200}>
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

const GlobalMetricsCardComponent = ({ metrics, pairwiseSimilarities, walletBalances, walletVectorsUsed }: GlobalMetricsCardProps) => {

  const content = useMemo(() => {
    if (!metrics) return null;

    const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1 });

    // --- Calculations ---
    const walletsAnalyzed = walletVectorsUsed ? Object.keys(walletVectorsUsed).length : 0;
    
    const avgSim = metrics.averageSimilarity > 1 ? metrics.averageSimilarity / 100 : metrics.averageSimilarity;

    const capitalScores = pairwiseSimilarities.map(p => p.capitalScore);
    const sortedCapitalScores = [...capitalScores].sort((a, b) => a - b);
    const minScore = sortedCapitalScores[0] ?? 0;
    const maxScore = sortedCapitalScores[sortedCapitalScores.length - 1] ?? 0;
    const mid = Math.floor(sortedCapitalScores.length / 2);
    const medianScore = sortedCapitalScores.length % 2 === 0 ? (sortedCapitalScores[mid - 1] + sortedCapitalScores[mid]) / 2 : sortedCapitalScores[mid] ?? 0;
    
    const variance = capitalScores.reduce((acc, score) => acc + Math.pow(score - avgSim, 2), 0) / capitalScores.length;

    const topPairs = [...pairwiseSimilarities]
      .sort((a, b) => ((b.capitalScore + b.binaryScore) / 2) - ((a.capitalScore + a.binaryScore) / 2))
      .slice(0, 5);

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
        topTokenDominance = value / totalValueAnalyzed;
        topTokenSymbol = `${mint.slice(0,4)}...${mint.slice(-4)}`;
      }
    }

    const scoreDistributionBins = Array.from({ length: 10 }, (_, i) => `${i * 10}-${(i + 1) * 10}%`);
    
    const capitalDist = scoreDistributionBins.map((_, i) => {
        const lower = i * 0.1;
        const upper = (i + 1) * 0.1;
        return pairwiseSimilarities.filter(p => p.capitalScore >= lower && (i === 9 ? p.capitalScore <= upper : p.capitalScore < upper)).length;
    });
    const binaryDist = scoreDistributionBins.map((_, i) => {
        const lower = i * 0.1;
        const upper = (i + 1) * 0.1;
        return pairwiseSimilarities.filter(p => p.binaryScore >= lower && (i === 9 ? p.binaryScore <= upper : p.binaryScore < upper)).length;
    });
    
    const totalPairs = pairwiseSimilarities.length;
    const cumulativeCounts = capitalDist.map((sum => value => sum += value)(0));
    const cumulativeLine = totalPairs > 0 ? cumulativeCounts.map(c => (c / totalPairs)) : [];

    const chartOption = {
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['Capital', 'Behavioural', 'Cumulative'], top: 0, textStyle: { color: 'hsl(var(--muted-foreground))' } },
      grid: { top: 40, bottom: 30, left: 50, right: 60 },
      xAxis: { type: 'category' as const, data: scoreDistributionBins },
      yAxis: [
        { type: 'value' as const, name: 'Pair Count', nameTextStyle: { padding: [0, 30, 0, 0] }, axisLabel: { color: 'hsl(var(--muted-foreground))' } },
        { type: 'value' as const, name: 'Cumulative', min: 0, max: 1, axisLabel: { formatter: (v: number) => percentFormatter.format(v), color: 'hsl(var(--muted-foreground))' } }
      ],
      series: [
        { name: 'Capital', type: 'bar' as const, data: capitalDist, emphasis: { focus: 'series' as const }, itemStyle: { color: '#4f46e5' } },
        { name: 'Behavioural', type: 'bar' as const, data: binaryDist, emphasis: { focus: 'series' as const }, itemStyle: { color: '#14b8a6' } },
        { name: 'Cumulative', type: 'line' as const, yAxisIndex: 1, data: cumulativeLine, symbol: 'none', lineStyle: { color: '#f59e0b' } }
      ]
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Global Analysis Metrics</span>
             <TooltipProvider>
              <Tooltip delayDuration={200}>
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
        <CardContent className="space-y-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard 
                title="Wallets Analyzed" 
                value={walletsAnalyzed} 
                icon={<HelpCircle size={24} />} 
                tooltipContent="The total number of unique wallets included in this analysis."
              />
              <StatCard 
                title="Mean Capital Similarity" 
                value={percentFormatter.format(avgSim)}
                icon={<Users size={24} />} 
                details={<>Median: {percentFormatter.format(medianScore)}<br/>Min: {percentFormatter.format(minScore)}, Max: {percentFormatter.format(maxScore)}</>}
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
                value={percentFormatter.format(topTokenDominance)}
                icon={<TrendingUp size={24} />} 
                tooltipContent={`The token ${topTokenSymbol} makes up this much of the group's total capital.`}
              />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 flex flex-col">
                  <h3 className="font-semibold mb-2 text-lg flex items-center flex-shrink-0">
                      <span>Top 5 Most Similar Pairs</span>
                  </h3>
                  <div className="flex-grow space-y-2 overflow-y-auto pr-2">
                      {topPairs.map((pair, index) => (
                          <div key={index} className="card flex items-center justify-between px-2 py-1.5">
                              <div className="flex items-center space-x-2">
                                  <WalletBadge address={pair.walletA} />
                                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                  <WalletBadge address={pair.walletB} />
                              </div>
                              <Badge variant="outline" className="font-semibold">
                                  {percentFormatter.format((pair.capitalScore + pair.binaryScore) / 2)}
                              </Badge>
                          </div>
                      ))}
                  </div>
              </div>
              <div className="lg:col-span-2 flex flex-col">
                   <h3 className="font-semibold mb-2 text-lg flex items-center flex-shrink-0">
                      Similarity Score Distribution
                      <TooltipProvider>
                          <Tooltip delayDuration={200}>
                              <TooltipTrigger asChild>
                                  <Info className="h-4 w-4 text-muted-foreground cursor-pointer ml-2" />
                              </TooltipTrigger>
                              <TooltipContent>
                                  <p>Shows how many wallet pairs fall into each similarity score bracket.</p>
                              </TooltipContent>
                          </Tooltip>
                      </TooltipProvider>
                  </h3>
                  <div className="flex-grow h-72">
                      <EChartComponent option={chartOption} style={{ height: '100%', width: '100%' }} />
                  </div>
              </div>
          </div>
        </CardContent>
      </Card>
    );
  }, [metrics, pairwiseSimilarities, walletBalances, walletVectorsUsed]);
  
  return content;
};

export const GlobalMetricsCard = React.memo(GlobalMetricsCardComponent); 