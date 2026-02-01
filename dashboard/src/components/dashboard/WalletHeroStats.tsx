"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WalletSummaryData } from "@/types/api";
import { formatStrategyType } from "@/lib/format-classification";
import { TrendingUp, TrendingDown, Minus, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface WalletHeroStatsProps {
  walletSummary?: WalletSummaryData;
  className?: string;
}

// Utility function to format USD values with K/M/B notation
const formatUsdValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return 'N/A';

  const absValue = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '' : '';

  if (absValue >= 1_000_000_000) {
    return `${sign}$${(absValue / 1_000_000_000).toFixed(1)}B`;
  } else if (absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(1)}M`;
  } else if (absValue >= 1_000) {
    return `${sign}$${(absValue / 1_000).toFixed(1)}K`;
  } else {
    return `${sign}$${absValue.toFixed(0)}`;
  }
};

// Utility to format SOL values
const formatSolValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return 'N/A';

  const absValue = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '' : '';

  if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K`;
  } else {
    return `${sign}${absValue.toFixed(2)}`;
  }
};

// Get trend indicator for PNL
const getTrendIndicator = (pnl: number | null | undefined) => {
  if (pnl === null || pnl === undefined) return null;

  if (pnl > 0) {
    return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
  } else if (pnl < 0) {
    return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  } else {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

// Get trend label
const getTrendLabel = (pnl: number | null | undefined) => {
  if (pnl === null || pnl === undefined) return 'No data';

  const percentChange = pnl; // This would need to be calculated from historical data in production

  if (pnl > 500) return 'Strong gain';
  if (pnl > 100) return 'Moderate gain';
  if (pnl > 0) return 'Slight gain';
  if (pnl > -100) return 'Slight loss';
  if (pnl > -500) return 'Moderate loss';
  return 'Heavy loss';
};

export function WalletHeroStats({ walletSummary, className }: WalletHeroStatsProps) {
  if (!walletSummary || walletSummary.status !== 'ok') {
    return null;
  }

  const data = walletSummary;

  // Calculate PNL percentage (relative to total traded value)
  const pnlPercentage = data.latestPnl && data.latestPnlUsd
    ? ((data.latestPnl / Math.abs(data.latestPnlUsd)) * 100).toFixed(1)
    : null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* 4 Core Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Realized PNL Card */}
        <Card className="p-4 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Realized PNL
          </div>
          <div className="space-y-1">
            <div className={cn(
              "text-2xl font-bold tabular-nums",
              data.latestPnl !== null && data.latestPnl !== undefined
                ? data.latestPnl >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
                : "text-foreground"
            )}>
              {formatSolValue(data.latestPnl)}
              <span className="text-sm ml-1 text-muted-foreground font-normal">SOL</span>
            </div>
            {data.latestPnlUsd !== null && data.latestPnlUsd !== undefined && (
              <div className="text-sm text-muted-foreground tabular-nums">
                {formatUsdValue(data.latestPnlUsd)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {getTrendIndicator(data.latestPnl)}
            <span>{getTrendLabel(data.latestPnl)}</span>
          </div>
        </Card>

        {/* Win Rate Card */}
        <Card className="p-4 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Win Rate
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold tabular-nums">
              {data.tokenWinRate !== null && data.tokenWinRate !== undefined
                ? `${data.tokenWinRate.toFixed(1)}%`
                : 'N/A'}
            </div>
            {/* Mini performance indicator */}
            <div className="flex items-center gap-0.5 h-3">
              {data.tokenWinRate !== null && data.tokenWinRate !== undefined && (
                <>
                  {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((threshold) => (
                    <div
                      key={threshold}
                      className={cn(
                        "h-full flex-1 rounded-[1px]",
                        data.tokenWinRate! >= threshold
                          ? data.tokenWinRate! >= 50
                            ? "bg-green-500/70"
                            : "bg-yellow-500/70"
                          : "bg-muted"
                      )}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
          {data.profitableTradesCount !== null &&
           data.profitableTradesCount !== undefined &&
           data.totalTradesCount !== null &&
           data.totalTradesCount !== undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-xs text-muted-foreground cursor-help">
                    {data.profitableTradesCount}/{data.totalTradesCount} wins
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Profitable trades out of total trades</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </Card>

        {/* Balance Card */}
        <Card className="p-4 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Balance
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold tabular-nums">
              {data.currentSolBalance !== null && data.currentSolBalance !== undefined
                ? formatSolValue(data.currentSolBalance)
                : 'N/A'}
              {data.currentSolBalance !== null && data.currentSolBalance !== undefined && (
                <span className="text-sm ml-1 text-muted-foreground font-normal">SOL</span>
              )}
            </div>
            {data.currentSolBalanceUsd !== null && data.currentSolBalanceUsd !== undefined && (
              <div className="text-sm text-muted-foreground tabular-nums">
                {formatUsdValue(data.currentSolBalanceUsd)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
            <span>Current holdings</span>
          </div>
        </Card>

        {/* Activity Card */}
        <Card className="p-4 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Activity
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold tabular-nums">
              {data.totalTradesCount ?? 'N/A'}
            </div>
            <div className="text-sm text-muted-foreground">
              total trades
            </div>
          </div>
          {data.lastActiveTimestamp && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-xs text-muted-foreground cursor-help">
                    Last: {format(new Date(data.lastActiveTimestamp * 1000), "MMM d")}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Last active: {format(new Date(data.lastActiveTimestamp * 1000), "MMM d, yyyy")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </Card>
      </div>

      {/* Profile Bar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {/* Strategy Badge */}
          {(data.strategyType || data.behaviorClassification) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="px-3 py-1 text-xs font-semibold cursor-help">
                    {formatStrategyType(data.strategyType || data.behaviorClassification)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Primary trading strategy classification based on hold times and trading patterns
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Analysis Period */}
          {data.firstTradeTimestamp && data.lastActiveTimestamp && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                    <CalendarRange className="h-3.5 w-3.5" />
                    <span className="text-xs">
                      {format(new Date(data.firstTradeTimestamp * 1000), "MMM d, yyyy")}
                      {' '}&rarr;{' '}
                      {format(new Date(data.lastActiveTimestamp * 1000), "MMM d, yyyy")}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Analysis period: First trade to last trade</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Days Active */}
          {data.daysActive && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{data.daysActive}</span> days active
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
