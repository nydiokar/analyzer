"use client";

import React from 'react';
import useSWR from 'swr';
import { Card, Metric, Text, Flex, Badge, Title } from '@tremor/react';
import { WalletSummaryData, WalletSummaryError } from '@/types/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Hourglass } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { useTimeRangeStore } from '@/store/time-range-store';

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
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred' }));
    const error: Error & { info?: WalletSummaryError, status?: number } = new Error(
      errorData.message || 'Failed to fetch summary data'
    );
    error.info = errorData;
    error.status = res.status;
    throw error;
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

  const { data, error, isLoading } = useSWR<WalletSummaryData, Error & { info?: WalletSummaryError, status?: number }>(
    walletAddress ? apiUrlWithTime : null, // SWR key now includes time range query params
    fetcher,
    {
      // Optional SWR config: revalidateOnFocus: false, etc.
    }
  );

  // Temporary log for verification
  React.useEffect(() => {
    if (data && (data.receivedStartDate || data.receivedEndDate)) {
      console.log('AccountSummaryCard received dates from API:', {
        startDate: data.receivedStartDate,
        endDate: data.receivedEndDate,
      });
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
            <Text color="red">Error: {error.message}</Text>
        </Flex>
        {error.info?.message && error.info.message !== error.message && <Text color="red" className="mt-1 text-xs">Details: {error.info.message}</Text>}
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
    return `${(rate * 100).toFixed(1)}%`;
  };

  // Display received dates for verification (temporary)
  const receivedDatesString = data?.receivedStartDate || data?.receivedEndDate 
    ? ` (${data.receivedStartDate ? format(new Date(data.receivedStartDate), 'MMM d, yyyy') : 'N/A'} - ${data.receivedEndDate ? format(new Date(data.receivedEndDate), 'MMM d, yyyy') : 'N/A'})`
    : '';

  return (
    <Card className={cn("w-full md:w-auto md:min-w-[300px]", className)}>
      <Title>Summary {receivedDatesString}</Title>
      <Flex justifyContent="between" alignItems="start" className="mt-4">
        <Text>Last Active</Text>
        <Text>{data.lastActiveTimestamp ? format(new Date(data.lastActiveTimestamp), 'MMM dd, yyyy') : 'N/A'}</Text>
      </Flex>
      <Flex justifyContent="between" alignItems="start" className="mt-1">
        <Text>Days Active</Text>
        <Text>{data.daysActive ?? 'N/A'}</Text>
      </Flex>
      <Flex justifyContent="between" alignItems="start" className="mt-1">
        <Text>Latest PNL</Text>
        <Metric color={ (data.keyPerformanceIndicators?.latestPnl ?? 0) >= 0 ? 'emerald' : 'red' }>
            {formatPnl(data.keyPerformanceIndicators?.latestPnl)}
        </Metric>
      </Flex>
      <Flex justifyContent="between" alignItems="start" className="mt-1">
        <Text>Token Win Rate</Text>
        <Text>{formatWinRate(data.keyPerformanceIndicators?.tokenWinRate)}</Text>
      </Flex>
      {data.behaviorClassification && (
        <Flex justifyContent="between" alignItems="start" className="mt-1">
          <Text>Behavior Tag</Text>
          <Badge color="sky">{data.behaviorClassification}</Badge>
        </Flex>
      )}
    </Card>
  );
} 