"use client";

import React from 'react';
import { Card, Metric, Text, Flex, Badge } from '@tremor/react';
import { WalletSummaryData } from '@/types/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarDays, Landmark, SearchX, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";
import { useApiKeyStore } from '@/store/api-key-store';
import { Button } from '@/components/ui/button';

// REMOVED: useSWR import and fetcher import - no longer needed
// REMOVED: createCacheKey import - no longer needed

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

export default function AccountSummaryCard({ 
  walletAddress, 
  className, 
  triggerAnalysis, 
  isAnalyzingGlobal,
  // NEW: Destructure the data props
  walletSummary: data,
  summaryError: error,
  summaryIsLoading: isLoading
}: AccountSummaryCardProps) {
  const { isDemo } = useApiKeyStore();
  


  if (!walletAddress) {
    return (
      <Card className={cn("w-full md:w-auto md:min-w-[300px]", className)}>
        <Flex alignItems="center" justifyContent="center" className="h-full">
            <Text>Please select a wallet.</Text>
        </Flex>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={cn("p-3 shadow-sm w-full md:w-auto md:min-w-[280px] lg:min-w-[320px]", className)}>
        <div className="space-y-3">
          {/* Main metrics skeleton - match the actual layout */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col items-center text-center">
              <Skeleton className="h-3 w-8 mb-1" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="flex flex-col items-center text-center">
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-5 w-12" />
            </div>
            <div className="flex flex-col items-center text-center">
              <Skeleton className="h-3 w-10 mb-1" />
              <Skeleton className="h-5 w-12" />
            </div>
          </div>
          
          {/* Additional info skeleton */}
          <div className="pt-2 border-t border-muted/50">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
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
      <div className={cn("flex items-center justify-between p-4 border bg-card rounded-lg shadow-sm w-full", className)}>
        <div className="flex items-center gap-4">
          <Icon className="h-8 w-8 text-blue-500" strokeWidth={1.5} />
          <div>
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {error.statusCode === 404 && (
          <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm">
            {isAnalyzingGlobal ? 'Analysis in Progress...' : 'Analyze Wallet'}
          </Button>
        )}
      </div>
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
      <div className={cn("flex items-center justify-between p-4 border bg-card rounded-lg shadow-sm w-full", className)}>
        <div className="flex items-center gap-4">
          <SearchX className="h-8 w-8 text-blue-500" strokeWidth={1.5} />
          <div>
            <h3 className="font-semibold text-foreground">Not Yet Analyzed</h3>
            <p className="text-sm text-muted-foreground">Trigger an analysis to get started.</p>
          </div>
        </div>
        <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo} size="sm">
          {isAnalyzingGlobal ? 'Analysis in Progress...' : 'Analyze Wallet'}
        </Button>
      </div>
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
    return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} SOL`;
  };
  
   const formatWinRate = (rate: number | null) => {
    if (rate === null || rate === undefined) return 'N/A';
    return `${rate.toFixed(1)}%`;
  };

  return (
    <Card className={cn("p-3 shadow-sm w-full md:w-auto md:min-w-[280px] lg:min-w-[320px]", className)}>
      <div className="space-y-3">
        {/* Main metrics in a horizontal layout */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center text-center">
            <Text className="text-xs text-muted-foreground">PNL</Text>
            <Metric color={(data.latestPnl ?? 0) >= 0 ? 'emerald' : 'red'} className="text-sm">
              {formatPnl(data.latestPnl ?? null)}
            </Metric>
            {data.latestPnlUsd !== null && data.latestPnlUsd !== undefined && (
              <Text className="text-xs text-muted-foreground">
                {data.latestPnlUsd >= 0 ? '+' : ''}${data.latestPnlUsd.toLocaleString()}
              </Text>
            )}
          </div>

          <div className="flex flex-col items-center text-center">
            <Text className="text-xs text-muted-foreground">Win Rate</Text>
            <Text className="text-sm font-semibold">{formatWinRate(data.tokenWinRate ?? null)}</Text>
                        {data.profitableTradesCount !== null && data.profitableTradesCount !== undefined &&
             data.totalTradesCount !== null && data.totalTradesCount !== undefined && data.totalTradesCount > 0 && (
              <Text className="text-xs text-muted-foreground">
                {data.profitableTradesCount}/{data.totalTradesCount} trades
              </Text>
            )}
          </div>

          {data.currentSolBalance !== undefined && (
            <div className="flex flex-col items-center text-center">
              <Text className="text-xs text-muted-foreground">Balance</Text>
              <Text className="text-sm font-semibold">
                {data.currentSolBalance?.toFixed(2) ?? 'N/A'} SOL
              </Text>
              {data.currentSolBalanceUsd !== null && data.currentSolBalanceUsd !== undefined && (
                <Text className="text-xs text-muted-foreground">
                  ${data.currentSolBalanceUsd.toLocaleString()}
                </Text>
              )}
            </div>
          )}
        </div>

        {/* Additional info with proper spacing */}
        <div className="pt-2 border-t border-muted/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>
                {data.lastActiveTimestamp 
                  ? format(new Date(data.lastActiveTimestamp * 1000), 'MMM d, yyyy') 
                  : 'N/A'}
              </span>
            </div>
            
            {data.behaviorClassification && (
              <Badge color="sky" size="xs">
                {data.behaviorClassification}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
} 