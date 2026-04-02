"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CalendarDays, RefreshCcw, SearchX, ShieldAlert } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

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

  // Get strategy type description - cleaner and more concise
  const getStrategyDescription = (strategy: string): string => {
    const descriptions: Record<string, string> = {
      'FAST_TRADER': 'Exits positions quickly (under 30 minutes). Includes snipers, scalpers, and momentum traders.',
      'DAY_TRADER': 'Intraday trader (30min to 24hr holds). Opens and closes within the same day.',
      'SWING_TRADER': 'Holds for multiple days (1-7 days). Capitalizes on medium-term price movements.',
      'POSITION_TRADER': 'Long-term conviction (7-30+ days). Patient position trader.',
      'PURE_HOLDER': 'Only buys, never sells. Accumulates positions without exiting.',
      'ACCUMULATOR': 'Strong buy bias (2x+ more buys than sells). Actively building positions.',
      'DISTRIBUTOR': 'Strong sell bias (2x+ more sells than buys). Actively liquidating positions.',
      'BALANCED_TRADER': 'Even buy/sell ratio across all timeframes. Balanced trading activity.',
      'LOW_ACTIVITY': 'Insufficient data to classify. Minimal trading history or incomplete cycles.',
      // Legacy fallbacks
      'swing_trader': 'Medium-term holds (days to weeks)',
      'day_trader': 'Intraday positions (same-day exits)',
      'scalper': 'Quick flips for small profits',
      'holder': 'Long-term accumulation',
    };
    return descriptions[strategy] || 'Trading pattern identified';
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
    let title = `Error`;
    let description = error.message || "An unexpected error occurred.";
    let Icon = AlertTriangle;
    let showAction = false;

    if (error.statusCode === 404) {
      title = "No Data Yet";
      description = "Run analysis to populate metrics";
      Icon = SearchX;
      showAction = true;
    } else if (error.statusCode === 403) {
      title = "Access Denied";
      description = "Not available in demo";
      Icon = ShieldAlert;
    }

    return (
      <Card className={cn("p-4 rounded-xl shadow-base flex flex-col items-center justify-center text-center min-h-[140px]", className)}>
        <Icon className="h-8 w-8 text-muted-foreground/60 mb-2" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground mb-3">{description}</p>
        {showAction && (
          <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm" variant="outline">
            {isAnalyzingGlobal ? (
              <>
                <RefreshCcw className="mr-2 h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                Analyze Wallet
              </>
            )}
          </Button>
        )}
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
      <Card className={cn("p-4 rounded-xl shadow-base flex flex-col items-center justify-center text-center min-h-[140px]", className)}>
        <SearchX className="h-8 w-8 text-muted-foreground/60 mb-2" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-foreground mb-1">No Data Yet</h3>
        <p className="text-xs text-muted-foreground mb-3">Run analysis to populate metrics</p>
        <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm" variant="outline">
          {isAnalyzingGlobal ? (
            <>
              <RefreshCcw className="mr-2 h-3.5 w-3.5 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              Analyze Wallet
            </>
          )}
        </Button>
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
    <Card className={cn("px-4 py-3 rounded-xl border bg-card h-full flex flex-col divide-y divide-border", className)}>
      {/* PNL */}
      <div className="pb-3">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">PNL</p>
        <div className="flex items-baseline gap-1.5">
          <span className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            pnlVariant === "success" ? "text-green-500 dark:text-green-400" :
            pnlVariant === "error" ? "text-red-500 dark:text-red-400" :
            "text-foreground"
          )}>
            {formatPnl(data.latestPnl ?? null)}
          </span>
          <span className="text-xs text-muted-foreground">SOL</span>
        </div>
        {data.latestPnlUsd !== null && data.latestPnlUsd !== undefined && (
          <p className="text-xs text-muted-foreground mt-0.5">{formatUsdValue(data.latestPnlUsd)}</p>
        )}
      </div>

      {/* Balance */}
      {data.currentSolBalance !== undefined && (
        <div className="py-3">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Balance</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold tabular-nums leading-none">{data.currentSolBalance?.toFixed(1) ?? "N/A"}</span>
            <span className="text-xs text-muted-foreground">SOL</span>
          </div>
          {data.currentSolBalanceUsd !== null && (
            <p className="text-xs text-muted-foreground mt-0.5">{formatUsdValue(data.currentSolBalanceUsd)}</p>
          )}
        </div>
      )}

      {/* Last Active */}
      {data.lastActiveTimestamp && (
        <div className="pt-3">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Last Active</p>
          <p className="text-sm font-semibold leading-tight">
            {format(new Date(data.lastActiveTimestamp * 1000), "MMM d, yyyy")}
          </p>
        </div>
      )}
    </Card>
  );
}
