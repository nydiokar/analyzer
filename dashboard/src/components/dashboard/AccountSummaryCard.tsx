"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CalendarDays, SearchX, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

import { Metric } from "@/components/ui/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WalletSummaryData } from "@/types/api";
import { useApiKeyStore } from "@/store/api-key-store";

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
  const sign = value >= 0 ? '+' : '';
  
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

  if (!walletAddress) {
    return (
      <Card className={cn("w-full md:w-auto md:min-w-[300px] p-4 rounded-xl shadow-base", className)}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Please select a wallet.
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full", className)}>
        <div className="space-y-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="space-y-1.5 text-center">
                <Skeleton className="h-3 w-16 mx-auto" />
                <Skeleton className="h-5 w-20 mx-auto" />
                <Skeleton className="h-3 w-14 mx-auto" />
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-muted/50">
            <Skeleton className="h-3.5 w-28" />
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
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full", className)}>
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
      <Card className={cn("p-3 sm:p-4 rounded-xl shadow-base w-full", className)}>
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
  if (!data.latestPnl) {
    return (
       <div className={cn("p-4", className)}>
        <EmptyState
          icon={AlertTriangle}
          title="No Summary Data"
          description="Could not display wallet summary details."
          variant="error"
        />
      </div>
    )
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
        "p-3 sm:p-4 rounded-xl shadow-base hover:shadow-hover transition-shadow w-full",
        className
      )}
    >
      <div className="space-y-3">
        <div
          className={cn(
            "grid gap-2 items-center",
            hasBalance ? "grid-cols-3" : "grid-cols-2"
          )}
        >
          <div className="text-center space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Total PNL
            </p>
            <Metric variant={pnlVariant} size="sm" suffix="SOL" className="leading-tight">
              {formatPnl(data.latestPnl ?? null)}
            </Metric>
            {data.latestPnlUsd !== null && data.latestPnlUsd !== undefined && (
              <p className="text-[11px] text-muted-foreground">
                {formatUsdValue(data.latestPnlUsd)}
              </p>
            )}
          </div>

          <div className="text-center space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Win Rate
            </p>
            <p className="text-sm font-semibold">
              {formatWinRate(data.tokenWinRate ?? null)}
            </p>
            {data.profitableTradesCount !== null &&
              data.profitableTradesCount !== undefined &&
              data.totalTradesCount !== null &&
              data.totalTradesCount !== undefined &&
              data.totalTradesCount > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {data.profitableTradesCount}/{data.totalTradesCount} trades
                </p>
              )}
          </div>

          {data.currentSolBalance !== undefined && (
            <div className="text-center space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                Balance
              </p>
              <p className="text-sm font-semibold">
                {data.currentSolBalance?.toFixed(2) ?? "N/A"} SOL
              </p>
              {data.currentSolBalanceUsd !== null && data.currentSolBalanceUsd !== undefined && (
                <p className="text-[11px] text-muted-foreground">
                  {formatUsdValue(data.currentSolBalanceUsd)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-muted/50">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              <span>
                {data.lastActiveTimestamp
                  ? format(new Date(data.lastActiveTimestamp * 1000), "MMM d, yyyy")
                  : "N/A"}
              </span>
            </div>

            {data.behaviorClassification && (
              <Badge variant="outline" className="uppercase tracking-wide">
                {data.behaviorClassification}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
