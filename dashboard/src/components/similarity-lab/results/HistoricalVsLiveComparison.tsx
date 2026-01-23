import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult } from './types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WalletBadge } from '@/components/shared/WalletBadge';

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
  const getWalletLabel = (address: string) => results.walletLabels?.[address];
  
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
        <CardTitle className="flex items-center gap-2 text-sm">
          Historical vs Live Holdings
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Compares historical trading patterns with current holdings (filtered to exclude spam/airdrops)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <CardDescription className="text-xs">
          Strategic evolution • {comparisonData.length} pairs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compact Summary Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-xl font-bold text-emerald-400">{insights.convergences}</div>
            <div className="text-[10px] text-muted-foreground">Converging</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="text-xl font-bold text-red-400">{insights.divergences}</div>
            <div className="text-[10px] text-muted-foreground">Diverging</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-xl font-bold">{formatPercentage(insights.avgHistorical)}</div>
            <div className="text-[10px] text-muted-foreground">Avg Historical</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-xl font-bold">{formatPercentage(insights.avgCurrent)}</div>
            <div className="text-[10px] text-muted-foreground">Avg Current</div>
          </div>
        </div>

        {/* Compact Comparison Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Strategic Shifts</h4>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-xs">Pair</TableHead>
                  <TableHead className="text-center text-xs">Historical</TableHead>
                  <TableHead className="text-center text-xs">Current</TableHead>
                  <TableHead className="text-center text-xs">Shift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonData.slice(0, 6).map((pair, index) => (
                  <TableRow key={`${pair.walletA}-${pair.walletB}`} className="border-border">
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1 text-xs">
                        <WalletBadge address={pair.walletA} size="s" knownType={getWalletLabel(pair.walletA)?.knownType} knownLabel={getWalletLabel(pair.walletA)?.knownLabel} visibleActions={{ copy: false, solscan: false, profile: true }} />
                        <span className="text-muted-foreground">↔</span>
                        <WalletBadge address={pair.walletB} size="s" knownType={getWalletLabel(pair.walletB)?.knownType} knownLabel={getWalletLabel(pair.walletB)?.knownLabel} visibleActions={{ copy: false, solscan: false, profile: true }} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-xs py-2">
                      {formatPercentage(pair.historicalSimilarity)}
                    </TableCell>
                    <TableCell className="text-center text-xs py-2">
                      {formatPercentage(pair.currentSimilarity)}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <div className="flex items-center justify-center gap-1">
                        {getShiftIcon(pair.shiftType)}
                        <span className={`text-xs font-semibold ${pair.shift > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pair.shift > 0 ? '+' : ''}{formatPercentage(pair.shift)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 