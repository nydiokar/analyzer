import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCollectionColor, getCollectionColorFilled } from "@/lib/color-utils";

export type CollectionStat = {
  collection: string;
  walletCount: number;
  totalPnl: number;
  avgPnl: number;
  totalBalance: number;
  avgBalance: number;
};

type CollectionAnalyticsProps = {
  stats: CollectionStat[];
  activeCollections: string[];
  onSelectCollection: (collection: string) => void;
  onClearFilters: () => void;
};

const formatSol = (value: number): string => {
  const sign = value >= 0 ? "+" : "-";
  const absValue = Math.abs(value);
  if (absValue >= 1000) return `${sign}${(absValue / 1000).toFixed(1)}k`;
  if (absValue >= 100) return `${sign}${absValue.toFixed(0)}`;
  return `${sign}${absValue.toFixed(2)}`;
};

export const CollectionAnalytics: React.FC<CollectionAnalyticsProps> = ({
  stats,
  activeCollections,
  onSelectCollection,
  onClearFilters,
}) => {
  const topCollections = stats.slice(0, 5);
  const isFiltering = activeCollections.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Collections Performance</CardTitle>
        {isFiltering && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearFilters}>
            Clear
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {topCollections.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No collections yet. Add a collection when tracking wallets to see performance.
          </div>
        ) : (
          topCollections.map((stat) => {
            const isActive = activeCollections.includes(stat.collection);
            const pnlClass =
              stat.totalPnl > 0
                ? "text-green-600 dark:text-green-500"
                : stat.totalPnl < 0
                  ? "text-red-600 dark:text-red-500"
                  : "text-muted-foreground";

            return (
              <button
                key={stat.collection}
                type="button"
                onClick={() => onSelectCollection(stat.collection)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition hover:bg-accent/50",
                  isActive ? getCollectionColor(stat.collection) : "border-transparent",
                  "text-foreground"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-xs font-semibold", getCollectionColorFilled(stat.collection))}>
                      {stat.collection}
                    </Badge>
                    {isActive && (
                      <span className="text-[10px] font-medium text-muted-foreground">Active filter</span>
                    )}
                  </div>
                  <span className={cn("text-sm font-semibold tabular-nums", pnlClass)}>
                    {formatSol(stat.totalPnl)} SOL
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {stat.walletCount} wallet{stat.walletCount === 1 ? "" : "s"} · {formatSol(stat.avgPnl)} SOL avg
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Avg balance {stat.avgBalance.toFixed(2)} SOL
                </div>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};
