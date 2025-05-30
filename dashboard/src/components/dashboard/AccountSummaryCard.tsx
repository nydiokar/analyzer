"use client";

import React from 'react';
import useSWR from 'swr';
import { Card, Metric, Text, Flex, Badge } from '@tremor/react';
import { WalletSummaryData, WalletSummaryError } from '@/types/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Hourglass, Info, TrendingUp, Percent, CalendarDays, Landmark } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { useTimeRangeStore } from '@/store/time-range-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface AccountSummaryCardProps {
  walletAddress: string;
  className?: string;
}

// Basic fetcher function for SWR - in a real app, this would be more robust
// and likely live in a dedicated API utility file.
const fetcher = async (url: string) => {
  // In a real scenario, you might have a base URL configured
  // For now, we assume the Next.js dev server might proxy /api calls if set up,
  // or this would fail gracefully until the API is live.
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  if (!apiKey) {
    console.warn('API key is not set. Please set NEXT_PUBLIC_API_KEY environment variable.');
    // Potentially throw an error or handle this case as per your app's needs
  }

  const res = await fetch(url, {
    headers: {
      // Only add the X-API-Key header if the apiKey is available
      ...(apiKey && { 'X-API-Key': apiKey }),
    },
  });
  if (!res.ok) {
    // Try to parse the error response from the API
    const errorData: WalletSummaryError = await res.json().catch(() => ({
      message: 'Failed to parse error response from API.',
      statusCode: res.status
    }));
    // Ensure message and statusCode are part of the thrown error, matching WalletSummaryError
    const errToThrow = new Error(errorData.message) as WalletSummaryError;
    errToThrow.statusCode = errorData.statusCode || res.status;
    throw errToThrow; // Throw an object that conforms to WalletSummaryError
  }
  return res.json();
};

export default function AccountSummaryCard({ walletAddress, className }: AccountSummaryCardProps) {
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
    // Construct the URL only if walletAddress and the time range are fully available
    (walletAddress && startDate && endDate) 
      ? `/api/v1/wallets/${walletAddress}/summary?${queryString}` 
      : null, // Pass null if not ready, SWR won't fetch
    fetcher,
    {
      revalidateOnFocus: false, // Prevent re-fetching when the window gains focus
      revalidateOnReconnect: true, // Default, good for resilience
      // Optional: Add sophisticated error retry logic
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        // Don't retry for client-side errors that are unlikely to resolve on their own
        if (error.statusCode && (error.statusCode >= 400 && error.statusCode < 500)) {
          return;
        }
        // Only retry up to 2 times for other errors (e.g., 500s, network issues)
        if (retryCount >= 2) { // retryCount is 0-indexed, so 0, 1 are the retries
          return;
        }
        // Wait 5 seconds before retrying. Adjust timing as needed.
        setTimeout(() => revalidate({ retryCount }), 5000);
      }
    }
  );

  // Temporary log for verification
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
      <Card className={cn("w-full md:w-auto md:min-w-[300px]", className)}>
        <Flex alignItems="center" justifyContent="start" className="space-x-2">
            <Hourglass className="h-5 w-5 animate-spin text-tremor-content-subtle" />
            <Text>Loading summary...</Text>
        </Flex>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("w-full md:w-auto md:min-w-[300px]", className)}>
         <Flex alignItems="center" justifyContent="start" className="space-x-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <Text color="red">
              Error: {error.message}
              {error.statusCode && ` (Status: ${error.statusCode})`}
            </Text>
        </Flex>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className={cn("w-full md:w-auto md:min-w-[300px]", className)}>
         <Flex alignItems="center" justifyContent="center" className="h-full">
            <Text>No summary data available.</Text>
        </Flex>
      </Card>
    );
  }

  // Helper to format PNL
  const formatPnl = (pnl: number | null) => {
    if (pnl === null || pnl === undefined) return 'N/A';
    return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} SOL`;
  };
  
  // Helper to format win rate
   const formatWinRate = (rate: number | null) => {
    if (rate === null || rate === undefined) return 'N/A';
    // Assuming rate is already a percentage, e.g., 51.47 for 51.47%
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