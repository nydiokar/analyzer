"use client";

import React from 'react';
import { Card, Metric, Text, Flex, Badge } from '@tremor/react';
import { WalletSummaryData } from '@/types/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Info, CalendarDays, Landmark, SearchX, ShieldAlert } from 'lucide-react';
import { format, isValid } from 'date-fns';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from '@/lib/fetcher';
import { useApiKeyStore } from '@/store/api-key-store';
import { useFavorites } from '@/hooks/useFavorites';
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';

interface AccountSummaryCardProps {
  walletAddress: string;
  summaryData: WalletSummaryData | null;
  isLoading: boolean;
  error: any;
  className?: string;
  triggerAnalysis?: () => void;
  isAnalyzingGlobal?: boolean;
}

export default function AccountSummaryCard({ 
  walletAddress, 
  summaryData: data, 
  isLoading, 
  error,
  className, 
  triggerAnalysis, 
  isAnalyzingGlobal 
}: AccountSummaryCardProps) {
  const { isDemo } = useApiKeyStore();
  
  React.useEffect(() => {
    if (data) {
      console.log('AccountSummaryCard data from parent:', data);
    }
  }, [data]);

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
      <Card className={cn("p-4", className)}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-4 pt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    let title = `API Error (Status: ${error.statusCode || 'Unknown'})`;
    let description = error.message || "An unexpected error occurred.";
    let icon = AlertTriangle;
    let emptyStateVariant: 'default' | 'error' | 'info' = 'error';
    
    if (error.statusCode === 404) {
      title = "Not Yet Analyzed";
      description = "No analysis data is available for this wallet yet. You can trigger a new analysis to get started.";
      icon = SearchX;
      emptyStateVariant = 'info';
    } else if (error.statusCode === 403) {
      title = "Access Denied";
      description = "This wallet is not part of the demo, or you do not have permission to view it.";
      icon = ShieldAlert;
      emptyStateVariant = 'error';
    }
    
    return (
      <div className={cn("p-4", className)}>
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          variant={emptyStateVariant}
        />
        {error.statusCode === 404 && (
          <div className="mt-4 text-center">
            <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo}>
              {isAnalyzingGlobal ? 'Analysis in Progress...' : 'Analyze Wallet'}
            </Button>
          </div>
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
       <div className={cn("p-4", className)}>
        <EmptyState
          icon={SearchX}
          title="Not Yet Analyzed"
          description="No analysis data is available for this wallet yet. You can trigger a new analysis to get started."
          variant="info"
        />
        <div className="mt-4 text-center">
            <Button onClick={triggerAnalysis} disabled={isAnalyzingGlobal || isDemo}>
              {isAnalyzingGlobal ? 'Analysis in Progress...' : 'Analyze Wallet'}
            </Button>
        </div>
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
    <Card className={cn("p-3 shadow-sm w-full md:w-auto md:min-w-[280px] lg:min-w-[300px]", className)}>
      <div className="space-y-2">
        <Flex justifyContent="between" alignItems="center" className="gap-2">
          <Text className="text-sm font-medium">PNL</Text>
          <Metric color={(data.latestPnl ?? 0) >= 0 ? 'emerald' : 'red'} className="text-base">
            {formatPnl(data.latestPnl ?? null)}
          </Metric>
        </Flex>

        <Flex justifyContent="between" alignItems="center" className="gap-2">
          <Text className="text-sm font-medium">Win Rate</Text>
          <Text className="text-base font-semibold">{formatWinRate(data.tokenWinRate ?? null)}</Text>
        </Flex>

        {data.currentSolBalance !== undefined && (
          <Flex justifyContent="between" alignItems="center" className="gap-2">
            <Text className="text-sm font-medium">Balance</Text>
            <Text className="text-base font-semibold">{data.currentSolBalance?.toFixed(2) ?? 'N/A'} SOL</Text>
          </Flex>
        )}

        <div className="mt-2 pt-2 border-t border-muted/50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-2 gap-x-4">
            
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between cursor-default">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      <Text className="text-xs text-muted-foreground">Last Active</Text>
                    </div>
                    <Text className="text-xs text-muted-foreground">
                      {data.lastActiveTimestamp 
                        ? format(new Date(data.lastActiveTimestamp * 1000), 'MMM d, yyyy') 
                        : 'N/A'}
                    </Text>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center" sideOffset={6}>
                  <p>{data.lastActiveTimestamp 
                      ? format(new Date(data.lastActiveTimestamp * 1000), 'PPP p') 
                      : 'No data available'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {data.behaviorClassification && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between cursor-default">
                      <div className="flex items-center gap-1.5">
                        <Landmark className="h-4 w-4 text-muted-foreground" />
                        <Text className="text-xs text-muted-foreground">Behavior</Text>
                      </div>
                      <Badge color="sky" size="xs" className="ml-1">
                        {data.behaviorClassification}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center" sideOffset={6}>
                    <p>{data.behaviorClassification}</p>
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