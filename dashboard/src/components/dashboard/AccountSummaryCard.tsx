"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CalendarDays, RefreshCcw, SearchX, ShieldAlert } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

import { Metric } from "@/components/ui/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WalletSummaryData } from "@/types/api";
import { useApiKeyStore } from "@/store/api-key-store";
import { formatStrategyType } from "@/lib/format-classification";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AccountSummaryCardProps {
  walletAddress: string;
  className?: string;
  triggerAnalysis?: () => void;
  isAnalyzingGlobal?: boolean;
  // NEW: Add data props from parent
  walletSummary?: WalletSummaryData;
  summaryError?: any;
  summaryIsLoading?: boolean;
}

// Utility function to format USD values with K/B notation
const formatUsdValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return 'N/A';
  
  const absValue = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  
  if (absValue >= 1_000_000_000) {
    // Billions
    return `${sign}$${(absValue / 1_000_000_000).toFixed(1)}B`;
  } else if (absValue >= 1_000_000) {
    // Millions
    return `${sign}$${(absValue / 1_000_000).toFixed(1)}M`;
  } else if (absValue >= 1_000) {
    // Thousands
    return `${sign}$${(absValue / 1_000).toFixed(1)}K`;
  } else {
    // Less than 1K
    return `${sign}$${absValue.toFixed(0)}`;
  }
};

export default function AccountSummaryCard({
  walletAddress,
  className,
  triggerAnalysis,
  isAnalyzingGlobal,
  walletSummary: data,
  summaryError: error,
  summaryIsLoading: isLoading,
}: AccountSummaryCardProps) {
  const { isDemo } = useApiKeyStore();
  const pnlVariant = useMemo(() => {
    if (data?.latestPnl === null || data?.latestPnl === undefined) return "default" as const;
    return data.latestPnl >= 0 ? "success" : "error";
  }, [data?.latestPnl]);

  // Get strategy type description
  const getStrategyDescription = (strategy: string): string => {
    const descriptions: Record<string, string> = {
      'FAST_TRADER': 'High-speed trading: sniper, scalper, or momentum trader (exits within 30 minutes)',
      'DAY_TRADER': 'Intraday positions: opens and closes within 30 minutes to 24 hours',
      'SWING_TRADER': 'Medium-term holds: capitalizes on 1-7 day price movements',
      'POSITION_TRADER': 'Long-term positions: holds for 7-30+ days with conviction',
      'PURE_HOLDER': 'Buy-only strategy: accumulates without selling (30+ day holds)',
      'ACCUMULATOR': 'Heavy buy bias: buys 2x+ more than sells, building positions',
      'DISTRIBUTOR': 'Heavy sell bias: sells 2x+ more than buys, liquidating positions',
      'BALANCED_TRADER': 'Symmetric activity: balanced buy/sell ratio across timeframes',
      'LOW_ACTIVITY': 'Insufficient data: minimal trading or incomplete cycles',
      // Legacy fallbacks
      'swing_trader': 'Holds positions for days to weeks, capitalizing on medium-term price movements',
      'day_trader': 'Opens and closes positions within the same day, avoiding overnight exposure',
      'scalper': 'Makes numerous quick trades for small profits, holding positions for minutes',
      'holder': 'Long-term investor who holds positions for extended periods',
    };
    return descriptions[strategy] || 'Trading behavior pattern identified by analysis';
  };

  if (!walletAddress) {
    return (
      <Card className={cn("w-full md:w-auto p-4 rounded-xl shadow-base", className)}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Please select a wallet.
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full md:w-auto", className)}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="space-y-1 text-center">
                <Skeleton className="h-3 w-16 mx-auto" />
                <Skeleton className="h-5 w-20 mx-auto" />
                <Skeleton className="h-3 w-14 mx-auto" />
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-muted/50">
            <Skeleton className="h-3.5 w-32" />
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    let title = `API Error (Status: ${error.statusCode || 'Unknown'})`;
    let description = error.message || "An unexpected error occurred.";
    let Icon = AlertTriangle;
    
    if (error.statusCode === 404) {
      title = "Not Yet Analyzed";
      description = "No analysis data is available for this wallet yet. You can trigger a new analysis to get started.";
      Icon = SearchX;
    } else if (error.statusCode === 403) {
      title = "Access Denied";
      description = "This wallet is not part of the demo, or you do not have permission to view it.";
      Icon = ShieldAlert;
    }
    
    return (
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full md:w-auto", className)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <Icon className="h-10 w-10 text-blue-500" strokeWidth={1.5} />
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          {error.statusCode === 404 && (
            <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm">
              {isAnalyzingGlobal ? "Analysis in Progress..." : "Analyze Wallet"}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (data?.status === 'restricted') {
    return (
      <div className={cn("p-4", className)}>
        <EmptyState
          icon={ShieldAlert}
          title="Access Restricted"
          description="This wallet is not available in the demo account's accessible list."
          variant="info"
        />
      </div>
    );
  }

  if (data?.status === 'unanalyzed' || !data) {
    return (
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full md:w-auto", className)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <SearchX className="h-10 w-10 text-blue-500" strokeWidth={1.5} />
            <div>
              <h3 className="text-lg font-semibold text-foreground">Not Yet Analyzed</h3>
              <p className="text-sm text-muted-foreground">Trigger an analysis to get started.</p>
            </div>
          </div>
          <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm">
            {isAnalyzingGlobal ? "Analysis in Progress..." : "Analyze Wallet"}
          </Button>
        </div>
      </Card>
    );
  }

  // This is a fallback, but with the checks above, data should be valid here.
  if (data.latestPnl === null || data.latestPnl === undefined) {
    const lastActive = data.lastActiveTimestamp
      ? formatDistanceToNow(new Date(data.lastActiveTimestamp * 1000), { addSuffix: true })
      : "No activity yet";
    const lastAnalyzed = data.lastAnalyzedAt
      ? formatDistanceToNow(new Date(data.lastAnalyzedAt), { addSuffix: true })
      : null;

    return (
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full md:w-auto", className)}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Run an analysis to unlock this summary
          </div>
          <p className="text-sm text-muted-foreground">
            We haven&apos;t generated PnL and win rate yet. Kick off one run to populate the summary cards.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-4 w-4" />
              {lastActive}
            </span>
            {lastAnalyzed && (
              <span className="inline-flex items-center gap-1">
                <RefreshCcw className="h-4 w-4" />
                Last analyzed {lastAnalyzed}
              </span>
            )}
          </div>
          {triggerAnalysis && (
            <div className="flex justify-end">
              <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm">
                {isAnalyzingGlobal ? "Analysis in Progress..." : "Analyze Wallet"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  const formatPnl = (pnl: number | null) => {
    if (pnl === null || pnl === undefined) return 'N/A';
    return `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
  };
  
  const formatWinRate = (rate: number | null) => {
    if (rate === null || rate === undefined) return 'N/A';
    return `${rate.toFixed(1)}%`;
  };

  const hasBalance = data.currentSolBalance !== undefined;

  return (
    <Card
      className={cn(
        "p-2 sm:p-3 rounded-xl shadow-base hover:shadow-hover transition-shadow w-full md:w-auto",
        className
      )}
    >
      <div className="space-y-2.5">
        <div
          className={cn(
            "grid gap-2 items-center",
            hasBalance ? "grid-cols-3" : "grid-cols-2"
          )}
        >
          <div className="text-center space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Total PNL
            </p>
            <div className="text-sm font-bold">
              <span className={cn(
                pnlVariant === "success" ? "text-green-600 dark:text-green-400" :
                pnlVariant === "error" ? "text-red-600 dark:text-red-400" :
                "text-foreground"
              )}>
                {formatPnl(data.latestPnl ?? null)}
              </span>
              <span className="text-[10px] text-muted-foreground ml-1 font-normal">SOL</span>
            </div>
            {data.latestPnlUsd !== null && data.latestPnlUsd !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                {formatUsdValue(data.latestPnlUsd)}
              </p>
            )}
          </div>

          <div className="text-center space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Win Rate
            </p>
            <p className="text-sm font-bold">
              {formatWinRate(data.tokenWinRate ?? null)}
            </p>
            {data.profitableTradesCount !== null &&
              data.profitableTradesCount !== undefined &&
              data.totalTradesCount !== null &&
              data.totalTradesCount !== undefined &&
              data.totalTradesCount > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-[10px] text-muted-foreground cursor-help">
                        {data.profitableTradesCount}/{data.totalTradesCount} trades
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Profitable trades / Total trades</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
          </div>

          {data.currentSolBalance !== undefined && (
            <div className="text-center space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                Balance
              </p>
              <p className="text-sm font-bold">
                {data.currentSolBalance?.toFixed(2) ?? "N/A"} <span className="text-[10px] text-muted-foreground font-normal">SOL</span>
              </p>
              {data.currentSolBalanceUsd !== null && data.currentSolBalanceUsd !== undefined && (
                <p className="text-[10px] text-muted-foreground">
                  {formatUsdValue(data.currentSolBalanceUsd)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-muted/50">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>
                      {data.lastActiveTimestamp
                        ? format(new Date(data.lastActiveTimestamp * 1000), "MMM d, yyyy")
                        : "N/A"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Latest Activity Date</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {(data.strategyType || data.behaviorClassification) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="uppercase tracking-wide text-[10px] py-0.5 px-2 cursor-help">
                      {formatStrategyType(data.strategyType || data.behaviorClassification)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-md">
                    <div className="space-y-2">
                      <p className="font-semibold">{formatStrategyType(data.strategyType || data.behaviorClassification)}</p>
                      <p className="text-xs text-muted-foreground">{getStrategyDescription(data.strategyType || data.behaviorClassification || '')}</p>
                      <div className="border-t border-border pt-2 mt-2">
                        <p className="font-medium text-xs mb-1">Strategy Types Explained:</p>
                        <ul className="space-y-0.5 text-[10px] text-muted-foreground">
                          <li><span className="font-medium">FAST_TRADER:</span> Sniper/scalper/momentum (&lt;30min exits)</li>
                          <li><span className="font-medium">DAY_TRADER:</span> Intraday positions (30min-24h)</li>
                          <li><span className="font-medium">SWING_TRADER:</span> Multi-day swings (1-7 days)</li>
                          <li><span className="font-medium">POSITION_TRADER:</span> Long-term holds (7-30+ days)</li>
                          <li><span className="font-medium">PURE_HOLDER:</span> Only buys, never sells</li>
                          <li><span className="font-medium">ACCUMULATOR:</span> Buys 2x+ more than sells</li>
                          <li><span className="font-medium">DISTRIBUTOR:</span> Sells 2x+ more than buys</li>
                          <li><span className="font-medium">BALANCED_TRADER:</span> Even buy/sell activity</li>
                          <li><span className="font-medium">LOW_ACTIVITY:</span> Insufficient data to classify</li>
                        </ul>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
