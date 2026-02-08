import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Users, Link2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type WalletCluster,
  getClusterStrengthLabel,
  getClusterStrengthColor,
  getClusterBgColor,
} from './utils/similarity-clusters';

interface Props {
  clusters: WalletCluster[];
  /** Currently selected cluster ID */
  selectedClusterId?: number | null;
  /** Callback when a cluster is clicked */
  onClusterSelect?: (clusterId: number | null) => void;
}

export function ClusterIndicator({
  clusters,
  selectedClusterId,
  onClusterSelect,
}: Props) {
  // Only show if there are clusters
  if (clusters.length === 0) return null;

  const totalWalletsInClusters = useMemo(
    () => clusters.reduce((sum, c) => sum + c.wallets.length, 0),
    [clusters]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Clusters
            </span>
          </div>
          {selectedClusterId !== null && selectedClusterId !== undefined && (
            <button
              onClick={() => onClusterSelect?.(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="text-[10px] text-foreground/50">
          {clusters.length} {clusters.length === 1 ? 'cluster' : 'clusters'} ({totalWalletsInClusters} wallets)
        </div>

        {/* Cluster chips */}
        <div className="flex flex-wrap gap-1.5">
          {clusters.map((cluster) => {
            const isSelected = selectedClusterId === cluster.id;
            const strengthLabel = getClusterStrengthLabel(cluster.avgSimilarity);
            const strengthColor = getClusterStrengthColor(cluster.avgSimilarity);
            const bgColor = getClusterBgColor(cluster.avgSimilarity);

            return (
              <Tooltip key={cluster.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onClusterSelect?.(isSelected ? null : cluster.id)}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs',
                      'border transition-all duration-200',
                      bgColor,
                      isSelected
                        ? 'border-primary/60 ring-1 ring-inset ring-primary/40'
                        : 'border-border/40 hover:border-border/60'
                    )}
                  >
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{cluster.wallets.length}</span>
                    <span className={cn('font-semibold tabular-nums', strengthColor)}>
                      {Math.round(cluster.avgSimilarity * 100)}%
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-xs">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium">Cluster: {cluster.wallets.length} wallets</span>
                      <span className={cn('font-semibold', strengthColor)}>{strengthLabel}</span>
                    </div>
                    <div className="text-muted-foreground">
                      <p>Avg similarity: {Math.round(cluster.avgSimilarity * 100)}%</p>
                      <p>Min edge: {Math.round(cluster.minSimilarity * 100)}%</p>
                      <p>{cluster.edgeCount} connections</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
