import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult } from './types';
import { shortenAddress } from '@/lib/solana-utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface HistoricalVsLiveComparisonProps {
  results: CombinedSimilarityResult;
}

interface ComparisonPair {
  walletA: string;
  walletB: string;
  historicalSimilarity: number;
  currentSimilarity: number;
  shift: number;
  shiftType: 'convergence' | 'divergence' | 'stable';
  shiftMagnitude: 'high' | 'medium' | 'low';
}

export function HistoricalVsLiveComparison({ results }: HistoricalVsLiveComparisonProps) {
  const comparisonData = useMemo(() => {
    if (!results.jaccardSimilarityMatrix || !results.holdingsPresenceJaccardMatrix) {
      return null;
    }

    const historicalMatrix = results.jaccardSimilarityMatrix;
    const currentMatrix = results.holdingsPresenceJaccardMatrix;
    const pairs: ComparisonPair[] = [];

    // Build comparison pairs
    Object.keys(historicalMatrix).forEach(walletA => {
      Object.keys(historicalMatrix[walletA]).forEach(walletB => {
        if (walletA < walletB) { // Avoid duplicates and self-comparisons
          const historical = historicalMatrix[walletA]?.[walletB] || 0;
          const current = currentMatrix[walletA]?.[walletB] || 0;
          const shift = current - historical;
          
          let shiftType: 'convergence' | 'divergence' | 'stable';
          let shiftMagnitude: 'high' | 'medium' | 'low';
          
          // Determine shift direction
          const absShift = Math.abs(shift);
          if (absShift < 0.01) {
            shiftType = 'stable';
          } else if (shift > 0) {
            shiftType = 'convergence';
          } else {
            shiftType = 'divergence';
          }
          
          // Determine shift magnitude
          if (absShift > 0.05) {
            shiftMagnitude = 'high';
          } else if (absShift > 0.02) {
            shiftMagnitude = 'medium';
          } else {
            shiftMagnitude = 'low';
          }

          pairs.push({
            walletA,
            walletB,
            historicalSimilarity: historical,
            currentSimilarity: current,
            shift,
            shiftType,
            shiftMagnitude
          });
        }
      });
    });

    // Sort by absolute shift magnitude (most interesting changes first)
    pairs.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));

    return pairs;
  }, [results.jaccardSimilarityMatrix, results.holdingsPresenceJaccardMatrix]);

  const insights = useMemo(() => {
    if (!comparisonData) return null;

    const convergences = comparisonData.filter(p => p.shiftType === 'convergence' && p.shiftMagnitude !== 'low');
    const divergences = comparisonData.filter(p => p.shiftType === 'divergence' && p.shiftMagnitude !== 'low');
    const stable = comparisonData.filter(p => p.shiftType === 'stable');

    const avgHistorical = comparisonData.reduce((sum, p) => sum + p.historicalSimilarity, 0) / comparisonData.length;
    const avgCurrent = comparisonData.reduce((sum, p) => sum + p.currentSimilarity, 0) / comparisonData.length;

    return {
      convergences: convergences.length,
      divergences: divergences.length,
      stable: stable.length,
      avgHistorical,
      avgCurrent,
      overallTrend: avgCurrent > avgHistorical ? 'convergence' : 'divergence',
      topConvergences: convergences.slice(0, 3),
      topDivergences: divergences.slice(0, 3)
    };
  }, [comparisonData]);

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  const getShiftIcon = (shiftType: string) => {
    switch (shiftType) {
      case 'convergence': return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'divergence': return <TrendingDown className="h-4 w-4 text-red-500" />;
      default: return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const getShiftBadgeVariant = (shiftType: string) => {
    switch (shiftType) {
      case 'convergence': return 'default';
      case 'divergence': return 'destructive';
      default: return 'secondary';
    }
  };

  if (!comparisonData || !insights) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Historical vs Live Holdings
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Compares historical trading patterns with current holdings to reveal strategic shifts</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <CardDescription>
            Shows how wallet strategies have evolved over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Insufficient data for historical comparison
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Historical vs Live Holdings Analysis
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Reveals strategic shifts by comparing historical trading similarity with current holdings overlap</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <CardDescription>
          Strategic evolution analysis • {comparisonData.length} wallet pairs analyzed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{insights.convergences}</div>
            <div className="text-xs text-muted-foreground">Converging Pairs</div>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{insights.divergences}</div>
            <div className="text-xs text-muted-foreground">Diverging Pairs</div>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{formatPercentage(insights.avgHistorical)}</div>
            <div className="text-xs text-muted-foreground">Avg Historical</div>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{formatPercentage(insights.avgCurrent)}</div>
            <div className="text-xs text-muted-foreground">Avg Current</div>
          </div>
        </div>

        {/* Detailed Comparison Table */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Most Significant Strategic Shifts</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet Pair</TableHead>
                <TableHead className="text-center">Historical</TableHead>
                <TableHead className="text-center">Current</TableHead>
                <TableHead className="text-center">Shift</TableHead>
                <TableHead className="text-center">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonData.slice(0, 8).map((pair, index) => (
                <TableRow key={`${pair.walletA}-${pair.walletB}`}>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="font-mono">{shortenAddress(pair.walletA, 6)}</span>
                      <span className="text-muted-foreground">↔</span>
                      <span className="font-mono">{shortenAddress(pair.walletB, 6)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    {formatPercentage(pair.historicalSimilarity)}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    {formatPercentage(pair.currentSimilarity)}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    <div className="flex items-center justify-center gap-1">
                      {getShiftIcon(pair.shiftType)}
                      <span className={pair.shift > 0 ? 'text-green-600' : 'text-red-600'}>
                        {pair.shift > 0 ? '+' : ''}{formatPercentage(pair.shift)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={getShiftBadgeVariant(pair.shiftType)} className="text-xs">
                      {pair.shiftType}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Key Insights */}
        {(insights.topConvergences.length > 0 || insights.topDivergences.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.topConvergences.length > 0 && (
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <h5 className="text-sm font-medium text-green-800 mb-2 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  Strongest Convergences
                </h5>
                <div className="space-y-1">
                  {insights.topConvergences.map((pair, i) => (
                    <div key={i} className="text-xs text-green-700">
                      {shortenAddress(pair.walletA, 6)} ↔ {shortenAddress(pair.walletB, 6)}: 
                      <span className="font-medium ml-1">+{formatPercentage(pair.shift)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {insights.topDivergences.length > 0 && (
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <h5 className="text-sm font-medium text-red-800 mb-2 flex items-center gap-1">
                  <TrendingDown className="h-4 w-4" />
                  Strongest Divergences
                </h5>
                <div className="space-y-1">
                  {insights.topDivergences.map((pair, i) => (
                    <div key={i} className="text-xs text-red-700">
                      {shortenAddress(pair.walletA, 6)} ↔ {shortenAddress(pair.walletB, 6)}: 
                      <span className="font-medium ml-1">{formatPercentage(pair.shift)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
} 