"use client";

import React from 'react';
import useSWR from 'swr';
import { Card, Metric, Text, Flex, Badge } from '@tremor/react';
import { WalletSummaryData, WalletSummaryError } from '@/types/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Hourglass, Info, CalendarDays, Landmark, PlayCircle, RefreshCw, SearchX, Loader2 } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { useTimeRangeStore } from '@/store/time-range-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";

interface AccountSummaryCardProps {
  walletAddress: string;
  className?: string;
  triggerAnalysis?: () => void;
  isAnalyzingGlobal?: boolean;
}

// Basic fetcher function for SWR - in a real app, this would be more robust
// and likely live in a dedicated API utility file.
const fetcher = async (url: string, options?: RequestInit) => {
  // In a real scenario, you might have a base URL configured
  // For now, we assume the Next.js dev server might proxy /api calls if set up,
  // or this would fail gracefully until the API is live.
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  let baseHeaders: HeadersInit = {};

  if (apiKey) {
    baseHeaders['X-API-Key'] = apiKey;
  } else {
    console.warn(
      'API key (NEXT_PUBLIC_API_KEY) is not set. API requests might fail if authentication is required.'
    );
  }
  const mergedHeaders = {
    ...baseHeaders,
    ...(options?.headers || {}),
  };
  const res = await fetch(url, {
    ...options, 
    headers: mergedHeaders,
  });
  if (!res.ok) {
    // Try to parse the error response from the API
    const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(errorPayload.message || 'An error occurred while fetching the data.') as any;
    error.statusCode = res.status;
    error.payload = errorPayload;
    throw error;
  }
  if (res.status === 204) {
    return null; 
  }
  return res.json();
};

export default function AccountSummaryCard({ walletAddress, className, triggerAnalysis, isAnalyzingGlobal }: AccountSummaryCardProps) {
  const { startDate, endDate } = useTimeRangeStore();

  const queryParams = new URLSearchParams();
  if (startDate && isValid(startDate)) {
    queryParams.append('startDate', startDate.toISOString());
  }
  if (endDate && isValid(endDate)) {
    queryParams.append('endDate', endDate.toISOString());
  }

  const queryString = queryParams.toString();
  const baseApiUrl = `/api/v1/wallets/${walletAddress}/summary`;
  const apiUrlWithTime = queryString ? `${baseApiUrl}?${queryString}` : baseApiUrl;

  const { data, error, isLoading } = useSWR<WalletSummaryData, WalletSummaryError>(
    (walletAddress && startDate && endDate) 
      ? apiUrlWithTime 
      : null,
    (url: string) => fetcher(url, { method: 'GET' }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        if (error.statusCode && (error.statusCode >= 400 && error.statusCode < 500)) {
          return;
        }
        if (retryCount >= 2) {
          return;
        }
        setTimeout(() => revalidate({ retryCount }), 5000);
      }
    }
  );

  React.useEffect(() => {
    if (data) {
      console.log('AccountSummaryCard data from API:', data);
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
      <Card className={cn("p-3 shadow-sm w-full md:w-auto md:min-w-[280px] lg:min-w-[300px]", className)}>
        <div className="space-y-2">
          <Flex justifyContent="between" alignItems="center" className="gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </Flex>
          <Flex justifyContent="between" alignItems="center" className="gap-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-5 w-1/3" />
          </Flex>
          <Flex justifyContent="between" alignItems="center" className="gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </Flex>
          
          <div className="mt-2 pt-2 border-t border-muted/50">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-2 gap-x-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-3 w-10" />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-muted/50">
             <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    const err = error as any; // Cast error to any to access dynamic properties
    let title = "Wallet Data Error";
    let description = err.message || "An unexpected error occurred.";
    let icon = AlertTriangle;
    let emptyStateVariant: 'info' | 'error' = 'info'; // Default to info

    if (err.isNetworkError) {
      title = "API Unreachable";
      description = "Cannot connect to the backend server. Please ensure it's running and check your network connection.";
      emptyStateVariant = 'error'; 
      // icon could be ServerCrash or WifiOff from lucide-react if desired
    } else if (err.statusCode === 404) {
      title = "Wallet Not Yet Analyzed";
      description = "No comprehensive data is available for this wallet yet. It may need to be analyzed.";
      icon = SearchX; 
      emptyStateVariant = 'info'; // 404 is more of an informational "not found/analyzed"
    } else {
      // General API error (e.g., 500, other 4xx)
      title = `API Error (Status: ${err.statusCode || 'Unknown'})`;
      if (err.statusCode === 500) {
        description = "The server encountered an unexpected issue while trying to load the summary. Please try again shortly. If the problem persists, please check the server logs.";
      } else {
        description = `We couldn't load the summary: ${err.message || 'Please try again later.'}`;
      }
      emptyStateVariant = 'error';
    }

    // Determine if the action button should be shown and what its state is
    const showAction = triggerAnalysis && !err.isNetworkError && err.statusCode !== 503; // Example: Don't show for 503 Service Unavailable either
    const currentActionText = isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet";

    return (
      <EmptyState
        className={cn(
          "w-full md:w-auto md:min-w-[300px] p-3",
          "md:flex-row md:items-center md:justify-start md:text-left md:gap-4 md:p-4 md:min-h-0",
          className
        )}
        variant={emptyStateVariant}
        icon={icon}
        title={title}
        description={description}
        actionText={showAction ? currentActionText : undefined}
        onActionClick={showAction ? triggerAnalysis : undefined}
        isActionLoading={showAction && !!isAnalyzingGlobal}
      />
    );
  }

  if (!data && !isLoading) {
    return (
      <EmptyState
        className={cn(
          "w-full md:w-auto md:min-w-[300px]",
          "md:flex-row md:items-center md:justify-start md:text-left md:gap-4 md:p-4 md:min-h-0",
          className
        )}
        variant="info"
        icon={Info}
        title="No Summary Data Available"
        description="It looks like this wallet hasn't been summarized, or there's no data for the selected period. Try analyzing the wallet or adjusting the time range."
        actionText={triggerAnalysis ? (isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet") : undefined}
        onActionClick={triggerAnalysis}
        isActionLoading={!!isAnalyzingGlobal}
      />
    );
  }
  
  if (!data) {
    return (
      <EmptyState
        className={cn(
          "w-full md:w-auto md:min-w-[300px]",
          "md:flex-row md:items-center md:justify-start md:text-left md:gap-4 md:p-4 md:min-h-0",
          className
        )}
        variant="info"
        icon={Info}
        title="Summary Unavailable"
        description="Summary data could not be displayed at this time."
        actionText={triggerAnalysis ? (isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet") : undefined}
        onActionClick={triggerAnalysis}
        isActionLoading={!!isAnalyzingGlobal}
      />
    );
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