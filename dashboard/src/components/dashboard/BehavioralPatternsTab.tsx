"use client";

import React from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { BehaviorAnalysisResponseDto } from '@/types/api'; // Assuming this type exists
import { Card, Text, Title, Flex } from '@tremor/react';
import { AlertTriangle, Hourglass } from 'lucide-react';

// Basic fetcher for SWR - consider moving to a shared utils file if not already there
const fetcher = async (url: string) => {
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  if (!apiKey) {
    console.warn('API key is not set for fetcher.');
    // Or throw new Error("API Key not configured"); if you want to enforce it
  }
  const res = await fetch(url, {
    headers: {
      ...(apiKey && { 'X-API-Key': apiKey }),
    },
  });
  if (!res.ok) {
    const errorData: { message?: string, statusCode?: number } = await res.json().catch(() => ({
      message: 'Failed to parse error response from API.',
      statusCode: res.status
    }));
    const error = new Error(errorData.message || 'An error occurred while fetching the data.');
    (error as any).statusCode = errorData.statusCode || res.status;
    throw error;
  }
  return res.json();
};

interface BehavioralPatternsTabProps {
  walletAddress: string;
}

export default function BehavioralPatternsTab({ walletAddress }: BehavioralPatternsTabProps) {
  const { startDate, endDate } = useTimeRangeStore();

  const behaviorApiUrlBase = walletAddress ? `/api/v1/wallets/${walletAddress}/behavior-analysis` : null;
  let swrKeyBehavior: string | null = null;

  if (behaviorApiUrlBase) {
    const behaviorParams = new URLSearchParams();
    if (startDate && endDate) {
      behaviorParams.append('startDate', startDate.toISOString());
      behaviorParams.append('endDate', endDate.toISOString());
      swrKeyBehavior = `${behaviorApiUrlBase}?${behaviorParams.toString()}`;
    } else {
      // Fetch all-time data if no specific range is selected in the UI
      // The backend /behavior-analysis endpoint should handle no date params as all-time
      swrKeyBehavior = behaviorApiUrlBase; 
    }
  }
  
  const { data: behaviorData, error: behaviorError, isLoading: behaviorIsLoading } = useSWR<BehaviorAnalysisResponseDto, Error>(
    swrKeyBehavior,
    fetcher,
    {
      revalidateOnFocus: false,
      // Add other SWR options like onErrorRetry if desired, similar to AccountSummaryCard
    }
  );

  if (!walletAddress) {
    // This case should ideally be handled by the parent component, 
    // but good for robustness if this component were used elsewhere.
    return (
      <Card>
        <Flex alignItems="center" justifyContent="center" className="h-full">
          <Text>No wallet address provided.</Text>
        </Flex>
      </Card>
    );
  }

  if (behaviorIsLoading) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <Hourglass className="h-5 w-5 animate-spin text-tremor-content-subtle" />
          <Text>Loading behavioral patterns...</Text>
        </Flex>
      </Card>
    );
  }

  if (behaviorError) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <Text color="red">
            Error loading behavioral patterns: {behaviorError.message}
            {(behaviorError as any).statusCode && ` (Status: ${(behaviorError as any).statusCode})`}
          </Text>
        </Flex>
      </Card>
    );
  }

  if (!behaviorData) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="center" className="h-full p-6">
          <Text>No behavioral data available for this wallet or period.</Text>
        </Flex>
      </Card>
    );
  }

  // Render the actual behavioral data
  // This is a simple placeholder - you'll want to make this much richer
  return (
    <Card className="p-6">
      <Title>Behavioral Patterns</Title>
      
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Text className="font-medium">Trading Style</Text>
          <Text>{behaviorData.tradingStyle || 'N/A'}</Text>
        </div>
        <div>
          <Text className="font-medium">Confidence</Text>
          <Text>
            {typeof behaviorData.confidenceScore === 'number' 
              ? `${(behaviorData.confidenceScore * 100).toFixed(1)}%` 
              : 'N/A'}
          </Text>
        </div>
        {/* Primary Behavior commented out as it may not always be present 
        <div>
          <Text className="font-medium">Primary Behavior</Text>
          <Text>{behaviorData.primaryBehavior || 'N/A'}</Text>
        </div>
        */}
      </div>

      <hr className="my-6" />

      <Title>Key Metrics</Title>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
        <div><Text className="font-medium">Buy/Sell Ratio:</Text><Text>{behaviorData.buySellRatio?.toFixed(2) ?? 'N/A'}</Text></div>
        <div><Text className="font-medium">Flipper Score:</Text><Text>{behaviorData.flipperScore?.toFixed(3) ?? 'N/A'}</Text></div>
        <div><Text className="font-medium">Avg. Flip Duration (Hrs):</Text><Text>{behaviorData.averageFlipDurationHours?.toFixed(1) ?? 'N/A'}</Text></div>
        <div><Text className="font-medium">Median Hold Time (Hrs):</Text><Text>{behaviorData.medianHoldTime?.toFixed(2) ?? 'N/A'}</Text></div> 
        {/* Assuming medianHoldTime is in hours. If minutes, label and formatting might need adjustment */}
        <div><Text className="font-medium">Unique Tokens Traded:</Text><Text>{behaviorData.uniqueTokensTraded ?? 'N/A'}</Text></div>
        <div><Text className="font-medium">Total Trades:</Text><Text>{behaviorData.totalTradeCount ?? 'N/A'}</Text></div>
        <div>
          <Text className="font-medium">% Trades &lt; 1 Hr:</Text>
          <Text>
            {typeof behaviorData.percentTradesUnder1Hour === 'number' 
              ? `${(behaviorData.percentTradesUnder1Hour * 100).toFixed(1)}%` 
              : 'N/A'}
          </Text>
        </div>
        <div>
          <Text className="font-medium">% Trades &lt; 4 Hrs:</Text>
          <Text>
            {typeof behaviorData.percentTradesUnder4Hours === 'number' 
              ? `${(behaviorData.percentTradesUnder4Hours * 100).toFixed(1)}%` 
              : 'N/A'}
          </Text>
        </div>
      </div>

      <hr className="my-6" />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Title>Trading Frequency</Title>
          <div className="mt-2 space-y-1">
            <div><Text className="font-medium">Trades Per Day:</Text><Text>{behaviorData.tradingFrequency?.tradesPerDay?.toFixed(1) ?? 'N/A'}</Text></div>
            <div><Text className="font-medium">Trades Per Week:</Text><Text>{behaviorData.tradingFrequency?.tradesPerWeek?.toFixed(1) ?? 'N/A'}</Text></div>
            <div><Text className="font-medium">Trades Per Month:</Text><Text>{behaviorData.tradingFrequency?.tradesPerMonth?.toFixed(1) ?? 'N/A'}</Text></div>
          </div>
        </div>

        <div>
          <Title>Risk Metrics</Title>
          <div className="mt-2 space-y-1">
            <div><Text className="font-medium">Avg. Tx Value (SOL):</Text><Text>{behaviorData.riskMetrics?.averageTransactionValueSol?.toFixed(2) ?? 'N/A'}</Text></div>
            <div><Text className="font-medium">Largest Tx Value (SOL):</Text><Text>{behaviorData.riskMetrics?.largestTransactionValueSol?.toFixed(2) ?? 'N/A'}</Text></div>
          </div>
        </div>
      </div>
      
      {/* Keep Raw Data for Debugging */}
      <hr className="my-6" />
      <div className="mt-4">
        <Title>Raw Data (for debugging):</Title>
        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-96">
          {JSON.stringify(behaviorData, null, 2)}
        </pre>
      </div>
    </Card>
  );
} 