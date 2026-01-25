import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlobalMetrics, CombinedPairwiseSimilarity } from './types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Users, ArrowRight, Wallet, Sigma, TrendingUp, User } from 'lucide-react';
import EChartComponent from '@/components/charts/EChartComponent';
import { formatToMillion } from '@/lib/utils';
import { WalletBadge } from "@/components/shared/WalletBadge";
import type { KnownWalletType } from '@/types/api';

interface GlobalMetricsCardProps {
  metrics: GlobalMetrics;
  pairwiseSimilarities: CombinedPairwiseSimilarity[];
  walletBalances?: Record<string, any> | null;
  uniqueTokensPerWallet?: Record<string, { binary: number; capital: number }>;
  walletLabels?: Record<string, { knownType?: KnownWalletType; knownLabel?: string }>;
  summary?: {
    walletCount: number;
    uniqueTokensTotal: number;
  };
}

const StatCard = ({ title, value, icon, details, tooltipContent }: { title: string, value: string | number | React.ReactNode, icon: React.ReactNode, details?: React.ReactNode, tooltipContent?: string }) => {
    const cardContent = (
        <div className="card h-full flex flex-col p-2.5 gap-0.5">
            <div className="flex items-center gap-2">
                <div className="text-primary shrink-0">{icon}</div>
                <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
                    <div className="text-xl font-bold leading-tight">{value}</div>
                </div>
            </div>
            {details && <div className="text-xs text-muted-foreground mt-1">{details}</div>}
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

// Overall similarity score calculation - matches EnhancedKeyInsights.tsx
const calculateOverallScore = (binaryScore: number, capitalScore: number): number => {
  // Weighted average: behavioral 40%, capital 60% (capital is often more meaningful)
  return (binaryScore * 0.4) + (capitalScore * 0.6);
};

// Helper function to get similarity status badge
const getSimilarityStatus = (avgSim: number) => {
  if (avgSim >= 0.6) {
    return { label: 'High', variant: 'default', className: 'bg-green-100 text-green-800 border-green-300' };
  } else if (avgSim >= 0.2) {
    return { label: 'Moderate', variant: 'secondary', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
  } else {
    return { label: 'Low', variant: 'outline', className: 'bg-red-100 text-red-800 border-red-300' };
  }
};

const GlobalMetricsCardComponent = ({ metrics, pairwiseSimilarities, walletBalances, uniqueTokensPerWallet, walletLabels, summary }: GlobalMetricsCardProps) => {
  const getWalletLabel = (address: string) => walletLabels?.[address];

  const content = useMemo(() => {
    if (!metrics) return null;

    const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1 });

    // --- Calculations ---
    const walletsAnalyzed =
      summary?.walletCount ??
      (uniqueTokensPerWallet ? Object.keys(uniqueTokensPerWallet).length : 0);
    
    const avgSim = metrics.averageSimilarity > 1 ? metrics.averageSimilarity / 100 : metrics.averageSimilarity;
    const similarityStatus = getSimilarityStatus(avgSim);

    // Use binaryScore (behavioral) for statistics since globalMetrics is now based on binary
    const binaryScores = pairwiseSimilarities.map(p => p.binaryScore);
    const sortedBinaryScores = [...binaryScores].sort((a, b) => b - a); // Sort descending for top pairs
    const mid = Math.floor(sortedBinaryScores.length / 2);
    const medianScore = sortedBinaryScores.length % 2 === 0 ? (sortedBinaryScores[mid - 1] + sortedBinaryScores[mid]) / 2 : sortedBinaryScores[mid] ?? 0;

    // Calculate percentage of pairs in top 25 (top ~25 pairs out of total)
    const topPairsCount = Math.min(25, Math.ceil(pairwiseSimilarities.length * 0.25));
    const topPairsScores = sortedBinaryScores.slice(0, topPairsCount);
    const avgTopPairs = topPairsScores.length > 0
      ? topPairsScores.reduce((sum, score) => sum + score, 0) / topPairsScores.length
      : 0;
    const topPairsStatus = getSimilarityStatus(avgTopPairs);

    const variance = binaryScores.reduce((acc, score) => acc + Math.pow(score - avgSim, 2), 0) / binaryScores.length;

    const topPairs = [...pairwiseSimilarities]
      .sort((a, b) => calculateOverallScore(b.binaryScore, b.capitalScore) - calculateOverallScore(a.binaryScore, a.capitalScore))
      .slice(0, 5);

    let totalValueAnalyzed = 0;
    const tokenValues: Record<string, number> = {};
    const walletValues: number[] = [];

    if (walletBalances) {
      Object.values(walletBalances).forEach((wallet: any) => {
        let walletTotal = 0;
        if (wallet && Array.isArray(wallet.tokenBalances)) {
          wallet.tokenBalances.forEach((token: any) => {
            const value = token.valueUsd || 0;
            totalValueAnalyzed += value;
            walletTotal += value;
            if (value > 0 && token.mint) {
              tokenValues[token.mint] = (tokenValues[token.mint] || 0) + value;
            }
          });
        }
        walletValues.push(walletTotal);
      });
    }

    // Calculate median and range
    const sortedWalletValues = [...walletValues].sort((a, b) => a - b);
    const medianWalletValue = sortedWalletValues.length > 0
      ? sortedWalletValues.length % 2 === 0
        ? (sortedWalletValues[sortedWalletValues.length / 2 - 1] + sortedWalletValues[sortedWalletValues.length / 2]) / 2
        : sortedWalletValues[Math.floor(sortedWalletValues.length / 2)]
      : 0;
    const minWalletValue = sortedWalletValues.length > 0 ? sortedWalletValues[0] : 0;
    const maxWalletValue = sortedWalletValues.length > 0 ? sortedWalletValues[sortedWalletValues.length - 1] : 0;

    const totalUniqueTokens = summary?.uniqueTokensTotal ?? 0;
    const totalCurrentlyHeldTokens = Object.keys(tokenValues).length; // Unique tokens currently held
    
    let topTokenDominance = 0;
    let topTokenDisplay = 'N/A';
    let topTokenName = '';
    if (totalValueAnalyzed > 0) {
      const sortedTokens = Object.entries(tokenValues).sort((a, b) => b[1] - a[1]);
      if (sortedTokens.length > 0) {
        const [mint, value] = sortedTokens[0];
        topTokenDominance = value / totalValueAnalyzed;
        
        // Try to find token metadata from wallet balances
        let tokenSymbol = null;
        let tokenName = null;
        if (walletBalances) {
          for (const wallet of Object.values(walletBalances)) {
            if (wallet && Array.isArray(wallet.tokenBalances)) {
              const foundToken = wallet.tokenBalances.find((token: any) => token.mint === mint);
              if (foundToken) {
                tokenSymbol = foundToken.symbol;
                tokenName = foundToken.name;
                break;
              }
            }
          }
        }
        
        if (tokenSymbol) {
          topTokenDisplay = tokenSymbol;
          topTokenName = tokenName || tokenSymbol;
        } else {
          topTokenDisplay = `${mint.slice(0,6)}...${mint.slice(-4)}`;
          topTokenName = `Token ${mint.slice(0,6)}...${mint.slice(-4)}`;
        }
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
    // Use behavioral (binary) for cumulative since that's what the mean is based on
    const cumulativeCounts = binaryDist.map((sum => value => sum += value)(0));
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
        <CardContent className="space-y-4">
          {/* Stats Grid with proper visual hierarchy */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-help">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-xs text-muted-foreground font-medium">Wallets Analyzed</p>
                      </div>
                      <div className="text-2xl font-bold">{walletsAnalyzed}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent><p>Total wallets in this analysis set</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-help">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-xs text-muted-foreground font-medium">Top Pairs Similarity</p>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <div className="text-2xl font-bold">{percentFormatter.format(avgTopPairs)}</div>
                        <Badge className={`text-[10px] ${topPairsStatus.className}`}>{topPairsStatus.label}</Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Top {topPairsCount} pairs • Overall avg: {percentFormatter.format(avgSim)}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent><p>Avg of top {topPairsCount} pairs (overall: {percentFormatter.format(avgSim)})</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-help">
                      <div className="flex items-center gap-2 mb-2">
                        <Sigma className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-xs text-muted-foreground font-medium">Tokens Analyzed</p>
                      </div>
                      <div className="text-2xl font-bold">{totalUniqueTokens}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">actively traded</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Tokens where fees were paid (excludes airdrops, dust, SOL/USDC/stablecoins)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-help">
                      <div className="flex items-center gap-2 mb-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-xs text-muted-foreground font-medium">Current Holdings Value</p>
                      </div>
                      <div className="text-2xl font-bold">${formatToMillion(totalValueAnalyzed)}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">{totalCurrentlyHeldTokens} tokens • median: ${formatToMillion(medianWalletValue)}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Live holdings across all wallets. Median = typical wallet, range: ${formatToMillion(minWalletValue)}-${formatToMillion(maxWalletValue)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-help">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-xs text-muted-foreground font-medium">Largest Holding</p>
                      </div>
                      <div className="text-2xl font-bold">{percentFormatter.format(topTokenDominance)}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 truncate">{topTokenDisplay} (1 of {totalCurrentlyHeldTokens})</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{topTokenName}: {percentFormatter.format(topTokenDominance)} of ${formatToMillion(totalValueAnalyzed)} combined holdings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
          </div>

          {/* Two sections side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-[0.6fr_1.4fr] gap-4">
              {/* Top 5 Pairs */}
              <div className="border border-border rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-sm">Top 5 Most Similar Pairs</h3>
                  <div className="space-y-2">
                      {topPairs.map((pair, index) => {
                          const avgScore = calculateOverallScore(pair.binaryScore, pair.capitalScore);
                          const status = getSimilarityStatus(avgScore);
                          const labelA = getWalletLabel(pair.walletA);
                          const labelB = getWalletLabel(pair.walletB);

                          return (
                              <div key={index} className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/20 hover:bg-muted/40 transition-colors">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                      <WalletBadge
                                          address={pair.walletA}
                                          variant="compact"
                                          knownType={labelA?.knownType}
                                          knownLabel={labelA?.knownLabel}
                                          visibleActions={{ copy: true, solscan: true, profile: true }}
                                      />
                                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                      <WalletBadge
                                          address={pair.walletB}
                                          variant="compact"
                                          knownType={labelB?.knownType}
                                          knownLabel={labelB?.knownLabel}
                                          visibleActions={{ copy: true, solscan: true, profile: true }}
                                      />
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                      <TooltipProvider>
                                          <Tooltip delayDuration={200}>
                                              <TooltipTrigger asChild>
                                                  <Badge className={`text-[9px] cursor-help px-1.5 py-0 ${status.className}`}>{status.label}</Badge>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                  <p>Similarity level: {status.label} ({avgScore >= 0.6 ? '≥60%' : avgScore >= 0.2 ? '20-60%' : '<20%'})</p>
                                              </TooltipContent>
                                          </Tooltip>
                                      </TooltipProvider>
                                      <TooltipProvider>
                                          <Tooltip delayDuration={200}>
                                              <TooltipTrigger asChild>
                                                  <Badge variant="outline" className="font-semibold text-[10px] cursor-help px-1.5 py-0">{percentFormatter.format(avgScore)}</Badge>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                  <p>Combined: {percentFormatter.format(avgScore)} (capital: {percentFormatter.format(pair.capitalScore)}, behavioral: {percentFormatter.format(pair.binaryScore)})</p>
                                              </TooltipContent>
                                          </Tooltip>
                                      </TooltipProvider>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </div>

              {/* Score Distribution Chart */}
              <div className="border border-border rounded-lg p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                      <h3 className="font-semibold text-sm">Score Distribution</h3>
                      <TooltipProvider>
                          <Tooltip delayDuration={200}>
                              <TooltipTrigger asChild>
                                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent><p>Distribution of similarity scores</p></TooltipContent>
                          </Tooltip>
                      </TooltipProvider>
                  </div>
                  <div className="h-64">
                      <EChartComponent option={chartOption} style={{ height: '100%', width: '100%' }} />
                  </div>
              </div>
          </div>
        </CardContent>
      </Card>
    );
  }, [metrics, pairwiseSimilarities, walletBalances, uniqueTokensPerWallet, summary]);
  
  return content;
};

export const GlobalMetricsCard = React.memo(GlobalMetricsCardComponent); 
