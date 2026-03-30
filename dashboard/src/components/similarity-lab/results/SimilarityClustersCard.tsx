'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SimilarityWalletBadge } from '@/components/similarity-lab/SimilarityWalletBadge';
import type { CombinedSimilarityResult } from './types';
import {
  SIMILARITY_LAB_CLUSTER_CONFIG,
  analyzeSimilarityGraph,
  getClusterBgColor,
  getClusterStrengthColor,
  getClusterStrengthLabel,
} from '@/lib/similarity-clusters';
import { Network, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SimilarityClustersCardProps {
  results: CombinedSimilarityResult;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SimilarityClustersCard({ results }: SimilarityClustersCardProps) {
  const graphAnalysis = useMemo(() => {
    const pairs = results.pairwiseSimilarities.map((pair) => ({
      walletA: pair.walletA,
      walletB: pair.walletB,
      overallScore: pair.binaryScore * 0.6 + pair.capitalScore * 0.4,
      behavioralScore: pair.binaryScore,
      capitalScore: pair.capitalScore,
      sharedTokensCount: pair.binarySharedTokenCount,
      uniqueTokensA: pair.binaryUniqueTokenCountA,
      uniqueTokensB: pair.binaryUniqueTokenCountB,
    }));

    return analyzeSimilarityGraph(pairs, SIMILARITY_LAB_CLUSTER_CONFIG);
  }, [results.pairwiseSimilarities]);

  const clusters = graphAnalysis.clusters;

  if (clusters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            Cluster Finder
          </CardTitle>
          <CardDescription>
            Groups of 3+ wallets with strong internal overlap or similarity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No wallet groups met the current cohesion rules.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-4 w-4 text-muted-foreground" />
                Cluster Finder
              </CardTitle>
              <CardDescription>
                Surfacing wallet groups using hybrid cohesion: similarity score, overlap ratio, and shared-token volume.
              </CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>
                  A cluster qualifies when multiple wallet pairs show high overall similarity, strong overlap relative to the smaller wallet, or unusually large shared-token volume.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {clusters.map((cluster) => {
            const strengthLabel = getClusterStrengthLabel(cluster.avgCohesionScore);
            const strengthColor = getClusterStrengthColor(cluster.avgCohesionScore);
            const bgColor = getClusterBgColor(cluster.avgCohesionScore);

            return (
              <div
                key={cluster.id}
                className={cn('rounded-xl border border-border/40 p-4', bgColor)}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Cluster {cluster.id + 1}
                    </Badge>
                    <Badge variant="outline" className={cn('text-xs', strengthColor)}>
                      {strengthLabel}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{cluster.wallets.length} wallets</span>
                    <span>•</span>
                    <span>{formatPercent(cluster.avgCohesionScore)} cohesion</span>
                    <span>•</span>
                    <span>{formatPercent(cluster.density)} density</span>
                    <span>•</span>
                    <span>{cluster.totalSharedTokens.toLocaleString()} shared tokens</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {cluster.wallets.map((wallet) => {
                    const walletLabel = results.walletLabels?.[wallet];
                    return (
                      <SimilarityWalletBadge
                        key={wallet}
                        address={wallet}
                        size="s"
                        knownType={walletLabel?.knownType}
                        knownLabel={walletLabel?.knownLabel}
                        visibleActions={{ copy: true, solscan: false, profile: true }}
                      />
                    );
                  })}
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {cluster.strongestPairs.map((pair) => (
                    <div
                      key={`${pair.walletA}-${pair.walletB}`}
                      className="rounded-lg border border-border/40 bg-background/40 p-3 text-xs"
                    >
                      <div className="font-mono text-foreground/80">
                        {pair.walletA.slice(0, 4)}...{pair.walletA.slice(-4)} ↔ {pair.walletB.slice(0, 4)}...{pair.walletB.slice(-4)}
                      </div>
                      <div className="mt-2 space-y-1 text-muted-foreground">
                        <p>{formatPercent(pair.cohesionScore)} cohesion</p>
                        <p>{formatPercent(pair.overallScore)} overall</p>
                        <p>{formatPercent(pair.smallerWalletOverlap)} smaller-wallet overlap</p>
                        <p>{(pair.sharedTokensCount ?? 0).toLocaleString()} shared tokens</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
