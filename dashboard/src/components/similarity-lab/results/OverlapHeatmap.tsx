import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult } from './types';
import { shortenAddress } from '@/lib/solana-utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import EChartComponent from '@/components/charts/EChartComponent';

interface OverlapHeatmapProps {
  results: CombinedSimilarityResult;
}

export function OverlapHeatmap({ results }: OverlapHeatmapProps) {
  const heatmapData = useMemo(() => {
    if (!results.sharedTokenCountsMatrix) {
      return null;
    }

    const matrix = results.sharedTokenCountsMatrix;
    const walletAddresses = Object.keys(matrix).sort();
    const walletLabels = walletAddresses.map(addr => shortenAddress(addr, 6));

    // Prepare data for ECharts heatmap
    const data: [number, number, number][] = [];
    let maxValue = 0;

    walletAddresses.forEach((walletA, i) => {
      walletAddresses.forEach((walletB, j) => {
        const value = matrix[walletA]?.[walletB] || 0;
        if (i !== j) { // Don't show diagonal (self-comparisons)
          data.push([i, j, value]);
          maxValue = Math.max(maxValue, value);
        }
      });
    });

    const option = {
      tooltip: {
        trigger: 'item' as const,
        formatter: function(params: any) {
          const [xIndex, yIndex, value] = params.data;
          const walletA = walletLabels[xIndex];
          const walletB = walletLabels[yIndex];
          return `${walletA} ↔ ${walletB}<br/>Shared Tokens: <strong>${value}</strong>`;
        }
      },
      grid: {
        left: '15%',
        top: '10%',
        right: '5%',
        bottom: '15%'
      },
      xAxis: {
        type: 'category' as const,
        data: walletLabels,
        axisLabel: {
          rotate: 45,
          fontSize: 10
        }
      },
      yAxis: {
        type: 'category' as const,
        data: walletLabels,
        axisLabel: {
          fontSize: 10
        }
      },
      visualMap: {
        min: 0,
        max: maxValue,
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: '2%',
        inRange: {
          color: ['#f7fafc', '#2563eb']
        },
        text: ['High Overlap', 'Low Overlap'],
        textStyle: {
          fontSize: 10
        }
      },
      series: [{
        type: 'heatmap' as const,
        data: data,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      }]
    };

    return { option, maxValue, totalPairs: data.length };
  }, [results.sharedTokenCountsMatrix]);

  const topOverlapPairs = useMemo(() => {
    if (!results.sharedTokenCountsMatrix) return [];

    const matrix = results.sharedTokenCountsMatrix;
    const pairs: { walletA: string; walletB: string; count: number }[] = [];

    Object.keys(matrix).forEach(walletA => {
      Object.keys(matrix[walletA]).forEach(walletB => {
        if (walletA < walletB) { // Avoid duplicates
          pairs.push({
            walletA,
            walletB,
            count: matrix[walletA][walletB]
          });
        }
      });
    });

    return pairs.sort((a, b) => b.count - a.count).slice(0, 5);
  }, [results.sharedTokenCountsMatrix]);

  if (!results.sharedTokenCountsMatrix || !heatmapData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Token Overlap Heatmap
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Shows the number of tokens shared between each wallet pair, independent of similarity scores</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <CardDescription>
            Matrix showing shared token counts between wallet pairs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No overlap data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Token Overlap Heatmap
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Shows the breadth of token overlap between wallet pairs, independent of similarity scores</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <CardDescription>
          Matrix visualization of shared token counts • Max overlap: {heatmapData.maxValue} tokens
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="h-80">
          <EChartComponent option={heatmapData.option} style={{ height: '100%', width: '100%' }} />
        </div>
        
        {topOverlapPairs.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Top Overlapping Pairs</h4>
            <div className="space-y-2">
              {topOverlapPairs.map((pair, index) => (
                <div key={`${pair.walletA}-${pair.walletB}`} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">#{index + 1}</span>
                    <span className="font-mono">{shortenAddress(pair.walletA, 6)}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-mono">{shortenAddress(pair.walletB, 6)}</span>
                  </div>
                  <span className="font-semibold">{pair.count} tokens</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 