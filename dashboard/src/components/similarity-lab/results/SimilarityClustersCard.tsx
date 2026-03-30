'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SimilarityWalletBadge } from '@/components/similarity-lab/SimilarityWalletBadge';
import type { CombinedSimilarityResult } from './types';
import {
  type WalletCluster,
  SIMILARITY_LAB_CLUSTER_CONFIG,
  analyzeSimilarityGraph,
  getClusterBgColor,
  getClusterStrengthColor,
  getClusterStrengthLabel,
} from '@/lib/similarity-clusters';
import { Network, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SimilarityClustersCardProps {
  results: CombinedSimilarityResult;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSharedTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k shared`;
  }

  return `${value} shared`;
}

function getClusterSignal(cluster: WalletCluster): { label: string; tone: string } {
  if (cluster.maxSharedTokens >= 1000 || cluster.totalSharedTokens >= 2500) {
    return { label: 'High-Volume Cohort', tone: 'text-amber-300' };
  }

  if (cluster.avgCohesionScore >= 0.9 && cluster.density >= 0.9) {
    return { label: 'Tight Sync', tone: 'text-emerald-300' };
  }

  if (cluster.avgOverlapRatio >= 0.7) {
    return { label: 'Shared Book', tone: 'text-sky-300' };
  }

  return { label: 'Emerging Cluster', tone: 'text-zinc-200' };
}

export function SimilarityClustersCard({ results }: SimilarityClustersCardProps) {
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null);

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
            No multi-wallet signal met the current cluster rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Try widening the wallet set or lowering similarity thresholds upstream.
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
                Wallet-group signals from hybrid cohesion, overlap, and shared-token volume.
              </CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>
                  Groups of 3+ wallets qualify when enough pairwise links look coordinated by similarity, by overlap, or by unusually large shared-token volume.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {clusters.map((cluster) => {
            const strengthLabel = getClusterStrengthLabel(cluster.avgCohesionScore);
            const strengthColor = getClusterStrengthColor(cluster.avgCohesionScore);
            const bgColor = getClusterBgColor(cluster.avgCohesionScore);
            const signal = getClusterSignal(cluster);
            const isExpanded = expandedClusterId === cluster.id;
            const anchorPair = cluster.strongestPairs[0] ?? null;

            return (
              <button
                key={cluster.id}
                type="button"
                onClick={() => setExpandedClusterId(isExpanded ? null : cluster.id)}
                className={cn(
                  'w-full rounded-xl border border-border/40 p-4 text-left transition-colors',
                  'hover:border-border/70',
                  bgColor
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={cn('text-sm font-semibold', signal.tone)}>{signal.label}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Cluster {cluster.id + 1}
                      </Badge>
                      <Badge variant="outline" className={cn('text-xs', strengthColor)}>
                        {strengthLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {cluster.wallets.length} wallets
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatSharedTokens(cluster.totalSharedTokens)}</span>
                      <span>•</span>
                      <span>{formatPercent(cluster.avgCohesionScore)} cohesion</span>
                      <span>•</span>
                      <span>{formatPercent(cluster.density)} density</span>
                      {cluster.maxSharedTokens > 0 && (
                        <>
                          <span>•</span>
                          <span>{cluster.maxSharedTokens.toLocaleString()} max pair</span>
                        </>
                      )}
                    </div>

                    {anchorPair && (
                      <div className="text-xs text-foreground/70">
                        Anchor: {anchorPair.walletA.slice(0, 4)}...{anchorPair.walletA.slice(-4)} ↔ {anchorPair.walletB.slice(0, 4)}...{anchorPair.walletB.slice(-4)}
                        {' '}({formatSharedTokens(anchorPair.sharedTokensCount ?? 0)}, {formatPercent(anchorPair.cohesionScore)})
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {cluster.wallets.map((wallet) => {
                      const walletLabel = results.walletLabels?.[wallet];
                      return (
                        <div key={wallet} onClick={(event) => event.stopPropagation()}>
                          <SimilarityWalletBadge
                            address={wallet}
                            size="s"
                            knownType={walletLabel?.knownType}
                            knownLabel={walletLabel?.knownLabel}
                            visibleActions={{ copy: true, solscan: false, profile: true }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {isExpanded && cluster.strongestPairs.length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {cluster.strongestPairs.map((pair) => (
                      <div
                        key={`${pair.walletA}-${pair.walletB}`}
                        className="rounded-lg border border-border/40 bg-background/40 p-3 text-xs"
                      >
                        <div className="font-mono text-foreground/80">
                          {pair.walletA.slice(0, 4)}...{pair.walletA.slice(-4)} ↔ {pair.walletB.slice(0, 4)}...{pair.walletB.slice(-4)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
                          <span>{formatPercent(pair.cohesionScore)} cohesion</span>
                          <span>•</span>
                          <span>{formatPercent(pair.overallScore)} overall</span>
                          <span>•</span>
                          <span>{formatPercent(pair.smallerWalletOverlap)} overlap</span>
                          <span>•</span>
                          <span>{formatSharedTokens(pair.sharedTokensCount ?? 0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
