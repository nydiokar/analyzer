"use client";

import React, { useState } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { BehaviorAnalysisResponseDto } from '@/types/api'; // Assuming this type exists
import { Card, Text, Title, Flex } from '@tremor/react';
import { AlertTriangle, Hourglass, LineChart, Users, ShieldCheck, HelpCircle, Info } from 'lucide-react';
import EChartComponent, { ECOption } from '../charts/EChartComponent'; // Import the new chart component
import { VisualMapComponent, CalendarComponent } from 'echarts/components'; // Import VisualMap and Calendar
import * as echarts from 'echarts/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Import Tabs from shadcn
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"; // Import Accordion
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Import Tooltip
import { Switch } from "@/components/ui/switch"; // Added Switch
import { Label } from "@/components/ui/label";   // Added Label
import { fetcher } from '@/lib/fetcher'; // Ensure global fetcher is used
import EmptyState from '@/components/shared/EmptyState'; // Added EmptyState
import { Skeleton } from "@/components/ui/skeleton";
import { useApiKeyStore } from '@/store/api-key-store'; // Import the key store

// Register VisualMap and Calendar components
echarts.use([VisualMapComponent, CalendarComponent]);

export interface BehavioralPatternsTabProps {
  walletAddress: string;
  isAnalyzingGlobal?: boolean;
  triggerAnalysisGlobal?: () => void;
}

// Helper component for displaying a metric with an optional tooltip
const MetricDisplay: React.FC<{
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  tooltipText?: string;
  valueClassName?: string;
  labelClassName?: string; // Added for more control over label style if needed
}> = ({ label, value, unit, tooltipText, valueClassName, labelClassName }) => {
  const labelContent = (
    <Text className={`text-xs uppercase tracking-wide text-muted-foreground ${labelClassName || ''}`}>
      {label}:
    </Text>
  );

  return (
    <div>
      {tooltipText ? (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrap label in a span to ensure it can be a trigger */} 
              <span className="inline-flex items-center cursor-help">{labelContent}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{tooltipText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        labelContent
      )}
      <Text className={`font-mono ${valueClassName || ''}`}>
        {value ?? 'N/A'}{value && unit ? ` ${unit}` : ''}
      </Text>
    </div>
  );
};

// Values from API are ratios (0-1), so multiply by 100 for display.
const formatRatioAsPercentage = (value: number | undefined | null): string => {
  if (value === undefined || value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
};

// Values from API are already percentages (0-100), so just format them.
const formatValueAsPercentage = (value: number | undefined | null): string => {
  if (value === undefined || value === null) return 'N/A';
  return `${value.toFixed(1)}%`;
};

// Helper to format a number to a fixed decimal place or return N/A
const formatNumber = (value: number | undefined | null, decimalPlaces: number = 2): string => {
  if (value === undefined || value === null) return 'N/A';
  return value.toFixed(decimalPlaces);
};

// Helper to format a fractional hour into HH:MM UTC format
const formatHour = (hour: number | undefined | null): string => {
  if (hour === undefined || hour === null) return 'N/A';
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const formattedH = String(h).padStart(2, '0');
  const formattedM = String(m).padStart(2, '0');
  return `${formattedH}:${formattedM} UTC`;
};

export default function BehavioralPatternsTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal }: BehavioralPatternsTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore(); // Get key and init status
  const [useLogScaleDuration, setUseLogScaleDuration] = useState<boolean>(false);

  const behaviorApiUrlBase = walletAddress ? `/wallets/${walletAddress}/behavior-analysis` : null;
  let swrKeyBehavior: (string | null)[] | null = null;

  if (behaviorApiUrlBase && isInitialized && apiKey) { // Check for key and init status
    const behaviorParams = new URLSearchParams();
    if (startDate && endDate) {
      behaviorParams.append('startDate', startDate.toISOString());
      behaviorParams.append('endDate', endDate.toISOString());
      const url = `${behaviorApiUrlBase}?${behaviorParams.toString()}`;
      swrKeyBehavior = [url, apiKey];
    } else {
      const url = behaviorApiUrlBase; 
      swrKeyBehavior = [url, apiKey];
    }
  }
  
  const { data: behaviorData, error: behaviorError, isLoading: behaviorIsLoading } = useSWR<BehaviorAnalysisResponseDto, Error & { status?: number; payload?: { message?: string } }>(
    swrKeyBehavior,
    ([url]) => fetcher(url), // Pass only URL to fetcher
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        if (error.status === 404 || error.payload?.message?.includes("No behavior analysis data found")) {
          return;
        }
        if (retryCount >= 2) {
          return;
        }
        setTimeout(() => revalidate({ retryCount }), 5000);
      }
    }
  );

  // Remove duplicate analyzing state - progress is shown in main layout
  // if (isAnalyzingGlobal) {
  //   return (
  //     <EmptyState
  //       variant="default"
  //       icon={Loader2}
  //       title="Analyzing Wallet..."
  //       description="Please wait while the wallet analysis is in progress. Behavioral patterns will update shortly."
  //       className="mt-4 md:mt-6 lg:mt-8"
  //     />
  //   );
  // }

  if (behaviorIsLoading && !isAnalyzingGlobal) {
    return (
      <Card className="h-full p-4 md:p-6 space-y-6 flex flex-col">
        <Tabs defaultValue="summary" className="w-full flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mb-4 border-b border-border">
            <TabsTrigger value="summary">Summary & Metrics</TabsTrigger>
            <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="flex-1 overflow-auto">
            <Title className="mb-4 text-lg font-semibold">Behavioral Summary & Metrics</Title>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {[...Array(5)].map((_, i) => ( // Increased skeleton items for more potential summary metrics
                <div key={`summary-metric-skel-${i}`}>
                  <Skeleton className="h-4 w-1/3 mb-1" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              ))}
            </div>
            
            <hr className="my-6 border-muted" />
            <Title className="text-lg font-semibold mt-6 mb-4">Detailed Behavioral Metrics</Title>
            
            <Accordion type="multiple" className="w-full space-y-3" defaultValue={["skel-item-performance", "skel-item-session", "skel-item-risk"]}>
              {/* Accordion Item 1: Performance & Holding Patterns Skeleton */}
              <AccordionItem value="skel-item-performance" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <Flex alignItems="center">
                    <Skeleton className="h-5 w-5 mr-2 rounded-full" />
                    <Skeleton className="h-5 w-1/2" />
                  </Flex>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                    {[...Array(7)].map((_, i) => ( // Increased skeleton items
                      <div key={`perf-metric-skel-${i}`}>
                        <Skeleton className="h-3 w-3/4 mb-1" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Accordion Item 2: Session & Frequency Skeleton */}
              <AccordionItem value="skel-item-session" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <Flex alignItems="center">
                    <Skeleton className="h-5 w-5 mr-2 rounded-full" />
                    <Skeleton className="h-5 w-1/2" />
                  </Flex>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                    {[...Array(9)].map((_, i) => ( // Increased skeleton items
                      <div key={`session-metric-skel-${i}`}>
                        <Skeleton className="h-3 w-3/4 mb-1" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Accordion Item 3: Risk & Value Profile Skeleton */}
              <AccordionItem value="skel-item-risk" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <Flex alignItems="center">
                    <Skeleton className="h-5 w-5 mr-2 rounded-full" />
                    <Skeleton className="h-5 w-1/2" />
                  </Flex>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                    {[...Array(4)].map((_, i) => (
                      <div key={`risk-metric-skel-${i}`}>
                        <Skeleton className="h-3 w-3/4 mb-1" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>

          <TabsContent value="visualizations" className="flex-1 overflow-auto">
            <div className="rounded-lg bg-muted/10 dark:bg-muted/5 px-4 py-2 mb-6">
              <Tabs defaultValue="heatmap" className="w-full mt-2">
                <div className="sticky top-0 z-10 bg-card dark:bg-card p-2 -mx-4 md:-mx-6 border-b border-border mb-4">
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                    <TabsTrigger value="heatmap" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Activity Heatmap</TabsTrigger>
                    <TabsTrigger value="duration" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Hold Duration Distribution</TabsTrigger>
                    <TabsTrigger value="windows" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Trading Windows</TabsTrigger>
                  </TabsList>
                </div>

                {['heatmap', 'duration', 'windows'].map((tabValue) => (
                  <TabsContent key={`skel-viz-${tabValue}`} value={tabValue}>
                    <Skeleton className="h-5 w-1/3 mb-2" />
                    <Skeleton className="h-[200px] w-full" />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    );
  }

  if (behaviorError) {
    const isNotFoundError = behaviorError.status === 404 || 
                            behaviorError.payload?.message?.toLowerCase().includes("no behavior analysis data found") || 
                            behaviorError.message?.toLowerCase().includes("no behavior analysis data found");

    if (isNotFoundError) {
      return (
        <EmptyState
          variant="info"
          icon={Users} 
          title="Behavioral Profile Not Generated"
          description="We couldn't generate a behavioral profile for this wallet with the current data or time range. Try analyzing the wallet or adjusting filters."
          actionText={isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet"}
          onActionClick={triggerAnalysisGlobal}
          isActionLoading={!!isAnalyzingGlobal}
          className="mt-4 md:mt-6 lg:mt-8"
        />
      );
    }

    return (
      <EmptyState
        variant="error"
        icon={AlertTriangle}
        title="Error Loading Behavioral Data"
        description={behaviorError.message || "Failed to load behavioral patterns. Please try analyzing again."}
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Retry Analysis"} 
        onActionClick={triggerAnalysisGlobal} 
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  if (!behaviorData && !behaviorIsLoading && !isAnalyzingGlobal && !behaviorError) {
    return (
      <EmptyState
        variant="info"
        icon={Users}
        title="No Behavioral Data Found"
        description="We couldn't generate behavioral insights for this wallet yet. Try analyzing again or adjust the time range."
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet"}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  // Final check to ensure behaviorData is defined before rendering the main content.
  // This satisfies TypeScript's strict null checks, as the preceding conditions
  // should have already handled loading, error, and initial empty states.
  if (!behaviorData) {
    return (
      <EmptyState
        variant="info"
        icon={Users} 
        title="Data Preparation Error"
        description="Could not prepare behavioral data for display. If issue persists, contact support or re-analyze."
        actionText={isAnalyzingGlobal ? "Analyzing..." : (triggerAnalysisGlobal ? "Re-analyze Wallet" : undefined)}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  const rawDataForDebugging = behaviorData.rawMetrics;

  const tradingTimeDistributionData = behaviorData?.tradingTimeDistribution;
  const activeTradingPeriodsData = behaviorData?.activeTradingPeriods;

  return (
    <Card className="h-full max-h-full p-4 md:p-6 space-y-6 flex flex-col overflow-hidden">
      <Tabs defaultValue="summary" className="w-full flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-2 mb-4 border-b border-border">
          <TabsTrigger value="summary">Summary & Metrics</TabsTrigger>
          <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="flex-1 overflow-auto min-h-0">
          <Title className="mb-4 text-lg font-semibold">Behavioral Summary & Metrics</Title>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 mb-6 text-sm">
            <MetricDisplay
              label="Trading Style"
              value={behaviorData.tradingStyle}
              tooltipText="Overall trading approach identified (e.g., Flipper, HODLer). Based on typical holding durations and activity frequency."
            />
            <MetricDisplay
              label="Confidence"
              value={typeof behaviorData.confidenceScore === 'number' ? `${(behaviorData.confidenceScore * 100).toFixed(1)}` : undefined}
              unit="%"
              tooltipText="Likelihood (0-100%) that the assigned Trading Style accurately reflects the wallet's dominant behavior."
            />
          </div>

          <hr className="my-6 border-muted" />
          <Title className="text-lg font-semibold mt-6 mb-4">Detailed Behavioral Metrics</Title>

          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <Accordion type="multiple" className="w-full space-y-3" defaultValue={["item-overall", "item-performance", "item-session", "item-risk"]}>
            {/* Accordion Item 1: Behavioral Profile & Consistency */}
            <AccordionItem value="item-performance" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <Users className="h-5 w-5 mr-2 text-emerald-500" />
                  Behavioral Profile & Consistency
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3 space-y-3 pl-1">
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-2">Trader Profile</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                  <MetricDisplay label="Flipper Score" value={formatNumber(behaviorData.flipperScore, 3)} tooltipText="Indicates how quickly tokens are bought and sold. Higher scores suggest more frequent flipping activity." />
                </div>
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mt-3 mb-2">Trading Consistency</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                  <MetricDisplay label="Buy/Sell Ratio" value={formatNumber(behaviorData.buySellRatio, 2)} tooltipText="Ratio of buy transactions to sell transactions by count. >1 means more buys, <1 means more sells." />
                  <MetricDisplay label="Buy/Sell Symmetry" value={formatNumber(behaviorData.buySellSymmetry, 2)} tooltipText="Compares total value/volume of buys to sells. ~1 indicates balanced capital flow." />
                  <MetricDisplay label="Sequence Consistency" value={formatNumber(behaviorData.sequenceConsistency, 3)} tooltipText="Measures consistency of buy-then-sell patterns. Higher scores indicate more orderly trading." />
                </div>
              </AccordionContent>
            </AccordionItem>
            
            {/* Accordion Item 2: Session & Holding Patterns */}
            <AccordionItem value="item-session" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <Hourglass className="h-5 w-5 mr-2 text-amber-500" />
                  Session & Holding Patterns
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3 space-y-3 pl-1">
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-2">Holding Durations</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                  <MetricDisplay label="Average Trade Duration" value={formatNumber(behaviorData.averageFlipDurationHours)} unit="hours" tooltipText="Average time a token position is held from buy to sell. Calculated only for tokens both bought and sold ('flipped') during the analyzed period." />
                  <MetricDisplay label="Median Hold Time" value={formatNumber(behaviorData.medianHoldTime)} unit="hours" tooltipText="Median time a token position is held across all sold assets. Less affected by outliers than average duration." />
                  <MetricDisplay label="% Trades < 1 Hour" value={formatRatioAsPercentage(behaviorData.percentTradesUnder1Hour)} tooltipText="Percentage of completed trades held for less than 1 hour, indicating very short-term activity." />
                  <MetricDisplay label="% Trades < 4 Hours" value={formatRatioAsPercentage(behaviorData.percentTradesUnder4Hours)} tooltipText="Percentage of completed trades held for less than 4 hours." />
                </div>
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mt-3 mb-2">Current Holdings Analysis</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                  <MetricDisplay 
                    label="Avg Current Hold Duration" 
                    value={formatNumber(behaviorData.averageCurrentHoldingDurationHours)} 
                    unit="hours" 
                    tooltipText="Average duration of currently held positions (tokens bought but not sold). Shows how long current investments have been held." 
                  />
                  <MetricDisplay 
                    label="Median Current Hold Time" 
                    value={formatNumber(behaviorData.medianCurrentHoldingDurationHours)} 
                    unit="hours" 
                    tooltipText="Median duration of currently held positions. Less affected by outliers than average." 
                  />
                  <MetricDisplay 
                    label="Weighted Avg Hold Time" 
                    value={formatNumber(behaviorData.weightedAverageHoldingDurationHours)} 
                    unit="hours" 
                    tooltipText="Combined average hold time weighted by value between completed trades and current holdings." 
                  />
                  <MetricDisplay 
                    label="% Value Still Held" 
                    value={formatValueAsPercentage(behaviorData.percentOfValueInCurrentHoldings)} 
                    tooltipText="Percentage of total traded value that remains in current positions (not yet sold)." 
                  />
                </div>
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mt-3 mb-2">Session Characteristics</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                  <MetricDisplay label="Session Count" value={behaviorData.sessionCount} tooltipText="Total number of distinct active trading sessions identified." />
                  <MetricDisplay label="Avg Session Duration" value={formatNumber(behaviorData.averageSessionDurationMinutes, 1)} unit="Mins" tooltipText="Typical length of a concentrated trading activity period before a break." />
                  <MetricDisplay label="Avg Trades/Session" value={formatNumber(behaviorData.avgTradesPerSession, 1)} tooltipText="Average number of trades (buys or sells) executed within a single active trading session." />
                  <MetricDisplay 
                    label="Avg Session Start Hour" 
                    value={
                      behaviorData.averageSessionStartHour !== null && behaviorData.averageSessionStartHour !== undefined 
                        ? formatHour(behaviorData.averageSessionStartHour) 
                        : 'N/A'
                    } 
                    tooltipText="Average UTC hour when active trading sessions typically begin. Calculated using a circular mean to correctly average time-of-day data." 
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Accordion Item 3: Risk & Value Profile */}
            <AccordionItem value="item-risk" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <ShieldCheck className="h-5 w-5 mr-2 text-red-500" />
                  Risk & Value Profile
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3 space-y-3 pl-1">
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                  <MetricDisplay label="Avg. Tx Value" value={formatNumber(behaviorData.riskMetrics?.averageTransactionValueSol, 2)} unit="SOL" tooltipText="Average SOL value of individual transactions. Reflects typical capital allocation per trade." />
                  <MetricDisplay label="Largest Tx Value" value={formatNumber(behaviorData.riskMetrics?.largestTransactionValueSol, 2)} unit="SOL" tooltipText="SOL value of the largest single transaction. Highlights maximum capital deployed in one trade." />
                  <MetricDisplay label="Re-entry Rate" value={formatValueAsPercentage(behaviorData.reentryRate)} tooltipText="Of all unique tokens that were fully traded (bought and sold), this is the percentage that were re-entered for another trade cycle. A low rate suggests the wallet rarely revisits the same investment after selling." />
                  <MetricDisplay label="Unpaired Tokens (%)" value={formatValueAsPercentage(behaviorData.percentageOfUnpairedTokens)} tooltipText="Percentage of unique tokens that have either no buy or sell counterparty. Indicates high spam activity or holding dust." />                </div>
              </AccordionContent>
            </AccordionItem>
            
            {/* Accordion Item 4: Overall Trading Activity */}
            <AccordionItem value="item-overall" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <LineChart className="h-5 w-5 mr-2 text-blue-500" />
                  Overall Trading Activity
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3 space-y-3 pl-1">
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-2">Key Volume Metrics</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                  <MetricDisplay label="Total Trades" value={behaviorData.totalTradeCount} tooltipText="Total number of buy or sell transactions." />
                  <MetricDisplay label="Unique Tokens Traded" value={behaviorData.uniqueTokensTraded} tooltipText="Number of distinct tokens involved in trades." />
                  <MetricDisplay label="Average Trades Per Token" value={formatNumber(behaviorData.averageTradesPerToken)} tooltipText="Average number of trades made for each unique token." />
                </div>
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mt-3 mb-2">Token Trading Breakdown</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                  <MetricDisplay label="Tokens w/ Both Buys & Sells" value={behaviorData.tokensWithBothBuyAndSell} tooltipText="Number of tokens that were both bought and sold (complete trading cycles)." />
                  <MetricDisplay label="Buy-Only Tokens" value={behaviorData.tokensWithOnlyBuys} tooltipText="Number of tokens that were only bought (no sells), indicating accumulation or holding positions." />
                  <MetricDisplay label="Sell-Only Tokens" value={behaviorData.tokensWithOnlySells} tooltipText="Number of tokens that were only sold (no buys), often from airdrops or external transfers." />
                  <MetricDisplay label="Complete Pairs" value={behaviorData.completePairsCount} tooltipText="Total number of completed buy-then-sell trading pairs across all tokens." />
                </div>
                <Text className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mt-3 mb-2">Trading Frequency</Text>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                  <MetricDisplay label="Trades per Day" value={formatNumber(behaviorData.tradingFrequency?.tradesPerDay)} tooltipText="Average number of trades executed per day (based on active days)." />
                  <MetricDisplay label="Trades per Week" value={formatNumber(behaviorData.tradingFrequency?.tradesPerWeek)} tooltipText="Average number of trades executed per week (based on active weeks)." />
                  <MetricDisplay label="Trades per Month" value={formatNumber(behaviorData.tradingFrequency?.tradesPerMonth)} tooltipText="Average number of trades executed per month (based on active months)." />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          </div>
        </TabsContent>

        <TabsContent value="visualizations" className="flex-1 overflow-auto min-h-0">
          <div className="rounded-lg bg-muted/10 dark:bg-muted/5 px-4 py-2 mb-6">
            <Tabs defaultValue="heatmap" className="w-full mt-2">
              <div className="sticky top-0 z-10 bg-card dark:bg-card p-2 -mx-4 md:-mx-6 border-b border-border mb-4">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                  <TabsTrigger value="heatmap" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Activity Heatmap</TabsTrigger>
                  <TabsTrigger value="duration" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Hold Duration Distribution</TabsTrigger>
                  <TabsTrigger value="windows" className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2">Trading Windows</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="heatmap">
                <Title className="mb-2 text-base font-medium">Activity Heatmap (Trades by Hour of Day - UTC)</Title>
                {behaviorData.activeTradingPeriods?.hourlyTradeCounts && Object.keys(behaviorData.activeTradingPeriods.hourlyTradeCounts).length > 0 ? (
                  <EChartComponent option={getHeatmapOption(behaviorData.activeTradingPeriods.hourlyTradeCounts)} style={{ height: '200px', width: '100%' }} />
                ) : (
                  <Flex flexDirection="col" alignItems="center" justifyContent="center" className="h-[200px] text-tremor-content dark:text-dark-tremor-content">
                    <Info className="w-8 h-8 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
                    <Text>No hourly trade data available for heatmap.</Text>
                  </Flex>
                )}
              </TabsContent>

              <TabsContent value="duration">
                <Flex alignItems="center" justifyContent="between" className="mb-2">
                  <Title className="text-base font-medium">Hold Duration Distribution</Title>
                  <TooltipProvider>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="log-scale-duration"
                        checked={useLogScaleDuration}
                        onCheckedChange={setUseLogScaleDuration}
                      />
                      <Label htmlFor="log-scale-duration" className="text-xs">Log Scale</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p>Displays the Y-axis on a logarithmic scale (base 10). Useful for wide data ranges or seeing relative changes for smaller values.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </Flex>
                {behaviorData.tradingTimeDistribution && Object.keys(behaviorData.tradingTimeDistribution).length > 0 ? (
                  <EChartComponent option={getTradingDurationOption(behaviorData.tradingTimeDistribution, useLogScaleDuration)} style={{ height: '300px', width: '100%' }} />
                ) : (
                  <Flex flexDirection="col" alignItems="center" justifyContent="center" className="h-[300px] text-tremor-content dark:text-dark-tremor-content">
                    <Info className="w-10 h-10 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
                    <Text>No trading duration distribution data available.</Text>
                  </Flex>
                )}
              </TabsContent>

              <TabsContent value="windows">
                <Title className="mb-2 text-base font-medium">Identified Trading Windows (UTC)</Title>
                {behaviorData.activeTradingPeriods?.identifiedWindows && behaviorData.activeTradingPeriods.identifiedWindows.length > 0 ? (
                  <EChartComponent option={getTradingWindowsOption(behaviorData.activeTradingPeriods.identifiedWindows)} style={{ height: '300px', width: '100%' }} />
                ) : (
                  <Flex flexDirection="col" alignItems="center" justifyContent="center" className="h-[300px] text-tremor-content dark:text-dark-tremor-content">
                    <Info className="w-10 h-10 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
                    <Text>No identified trading windows available.</Text>
                  </Flex>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>
      </Tabs>

      {/* Raw Data (for debugging) Section */}
      {rawDataForDebugging && Object.keys(rawDataForDebugging).length > 0 && (
        <div className="mt-8">
          <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <Flex alignItems="center">
                    <ShieldCheck className="w-4 h-4 mr-2 text-muted-foreground" /> Raw Data (for debugging)
                </Flex>
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              <Text className="mb-2 text-xs text-muted-foreground">
                This data is for debugging and development purposes.
              </Text>
              <pre className="p-3 bg-muted/50 dark:bg-muted/20 rounded-md text-xs overflow-x-auto">
                {JSON.stringify(rawDataForDebugging, null, 2)}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        </div>
      )}
    </Card>
  );
}

// Helper function to generate heatmap option
const getHeatmapOption = (hourlyTradeCounts: Record<number, number>): ECOption => {
  const data = [];
  let minTrades = Infinity;
  let maxTrades = 0;
  let totalTradesInHeatmap = 0; // Calculate total for percentage
  for (let hour = 0; hour < 24; hour++) {
    const tradeCount = hourlyTradeCounts[hour] || 0;
    data.push([hour, 0, tradeCount]); // [hour, y-axis (single category), value]
    if (tradeCount < minTrades) minTrades = tradeCount;
    if (tradeCount > maxTrades) maxTrades = tradeCount;
    totalTradesInHeatmap += tradeCount;
  }

  const visualMapMax = maxTrades < 10 ? 10 : maxTrades * 1.1;
  const visualMapMin = 0;

  return {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const tradeCount = params.value[2];
        const percentage = totalTradesInHeatmap > 0 ? ((tradeCount / totalTradesInHeatmap) * 100).toFixed(1) : 0;
        return `Hour: ${params.value[0]}:00 - ${params.value[0] + 1}:00<br/>Trades: ${tradeCount}<br/>Activity: ${percentage}%`;
      }
    },
    grid: {
      height: '50%',  // Adjusted for new total chart height
      top: '10%',
      bottom: '30%' // Adjusted to make space for xAxis name and visualMap
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => i.toString()), // Hours 0-23
      splitArea: {
        show: true
      },
      name: 'Hour of Day (UTC)',
      nameLocation: 'middle',
      nameGap: 25, // Adjusted gap
      axisLabel: {
        color: '#B0B0B0'
      },
      nameTextStyle: {
        color: '#B0B0B0'
      }
    },
    yAxis: {
      type: 'category',
      data: ['Activity'], // Single category for the y-axis
      splitArea: {
        show: true
      }
    },
    visualMap: {
      min: visualMapMin,
      max: visualMapMax,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '6%', // Positioned at the bottom of the chart area
      inRange: {
        color: ['#e0f3ff', '#3a5fcd'] // Lighter start for blue heatmap
      }
    },
    series: [{
      name: 'Hourly Trades',
      type: 'heatmap',
      data: data,
      label: {
        show: true,
        formatter: (params: any) => params.value[2] > 0 ? params.value[2].toString() : ''
      },
      itemStyle: {
        borderColor: '#999',
        borderWidth: 1
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  };
};

// Helper function to generate trading duration distribution bar chart option
const getTradingDurationOption = (
  distribution: BehaviorAnalysisResponseDto['tradingTimeDistribution'], 
  useLogScale: boolean = false
): ECOption => {
  const categoryMap: Record<string, string> = {
    ultrafast: 'Ultra Fast',
    veryfast: 'Very Fast',
    fast: 'Fast',
    moderate: 'Moderate',
    daytrader: 'Day Trader',
    swing: 'Swing',
    position: 'Position'
  };

  const timeRanges: Record<string, string> = {
    'Ultra Fast': '< 30 min',
    'Very Fast': '30-60 min',
    'Fast': '1-4h',
    'Moderate': '4-8h',
    'Day Trader': '8-24h',
    'Swing': '1-7d',
    'Position': '> 7d'
  };

  const rawCategories = distribution ? Object.keys(distribution) : [];
  const categories = rawCategories.map(cat => categoryMap[cat.toLowerCase()] || cat);
  const data = distribution ? rawCategories.map(cat => distribution[cat as keyof typeof distribution] || 0) : [];

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: (params: any) => {
        const param = Array.isArray(params) ? params[0] : params;
        const categoryName = param.name;
        const proportion = param.value;
        const timeRange = timeRanges[categoryName];
        let tooltipString = `${categoryName}`;
        if (timeRange) tooltipString += ` (${timeRange})`;
        if (typeof proportion === 'number'){
            tooltipString += `<br/>${param.marker}${param.seriesName}: ${(proportion * 100).toFixed(1)}%`;
        } else {
            tooltipString += `<br/>${param.marker}${param.seriesName}: ${proportion}`;
        }
        return tooltipString;
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '20%', 
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        rotate: 0, 
        interval: 0,
        fontSize: 11, // Slightly smaller to fit more labels if needed
        color: '#E0E0E0'
      },
      name: 'Trading Style Duration',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: {
        fontSize: 13,
        color: '#B0B0B0'
      }
    },
    yAxis: {
      name: 'Proportion / Count',
      axisLabel: {
        formatter: (value: number) => {
            if (value === 0) return '0';
            if (value < 1 && value > 0 && !useLogScale) return (value * 100).toFixed(0) + '%';
            if (value < 1 && value > 0 && useLogScale) return (value * 100).toFixed(1) + '%';
            return value.toString(); 
        },
        color: '#B0B0B0'
      },
      nameTextStyle: {
        fontSize: 13,
        color: '#B0B0B0'
      },
      type: useLogScale ? 'log' : 'value',
      logBase: 10,
      min: useLogScale ? 0.001 : undefined, 
    },
    series: [
      {
        name: 'Distribution',
        type: 'bar',
        data: data,
        emphasis: {
          focus: 'series'
        },
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            {
              offset: 0,
              color: '#6ea8fe' // Lighter blue
            },
            {
              offset: 1,
              color: '#255ab5' // Darker blue
            }
          ])
        },
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => {
            if (typeof params.value === 'number' && params.value > 0) {
              return (params.value * 100).toFixed(1) + '%';
            }
            return '';
          },
          color: '#FFFFFF',
          fontSize: 12
        }
      }
    ]
  };
};

// Helper function to generate trading windows timeline option
const getTradingWindowsOption = (windows: NonNullable<BehaviorAnalysisResponseDto['activeTradingPeriods']>['identifiedWindows']): ECOption => {
  const windowColors = [
    '#255ab5', '#3a7cde', '#6ea8fe', '#3ab8d7', '#29a0b1', '#4FB9AF', '#66C3B9'
  ];
  
  let totalWeightedMidpoint = 0;
  let totalTradeCountInWindows = 0;

  const data = windows.map((win: NonNullable<BehaviorAnalysisResponseDto['activeTradingPeriods']>['identifiedWindows'][number], index: number) => {
    const midpoint = (win.startTimeUTC + win.endTimeUTC) / 2;
    totalWeightedMidpoint += midpoint * win.tradeCountInWindow;
    totalTradeCountInWindows += win.tradeCountInWindow;

    return {
      name: `Window ${index + 1}`,
      value: [
        index,
        win.startTimeUTC,
        win.endTimeUTC + 1, 
        win.tradeCountInWindow,
        `Trades: ${win.tradeCountInWindow}\nDuration: ${win.durationHours}h\nAvg Trades/hr: ${win.avgTradesPerHourInWindow.toFixed(1)}`
      ],
      itemStyle: {
          color: windowColors[index % windowColors.length]
      }
    };
  }); 
  
  const meanActiveTime = totalTradeCountInWindows > 0 ? totalWeightedMidpoint / totalTradeCountInWindows : null;

  const gridHeight = windows.length < 4 && windows.length > 0 ? '120px' : (windows.length === 0 ? '120px' : '250px');

  let minHour = 23;
  let maxHour = 0;
  windows.forEach((win: NonNullable<BehaviorAnalysisResponseDto['activeTradingPeriods']>['identifiedWindows'][number]) => {
    if (win.startTimeUTC < minHour) minHour = win.startTimeUTC;
    if (win.endTimeUTC > maxHour) maxHour = win.endTimeUTC;
  });

  minHour = Math.max(0, minHour -1); // Ensure minHour is not less than 0
  maxHour = Math.min(23, maxHour + 1); // Ensure maxHour is not more than 23 (or 24 if end is exclusive)

  return {
    tooltip: {
        formatter: function (params: any) {
            return params.marker + params.name + ': ' + params.value[4].replace(/\n/g, '<br/>');
        }
    },
    grid: {
        height: gridHeight,
        left: '15%',
        right: '10%',
        top: '10%', // Added top margin for better spacing
        bottom: '25%' // Adjusted bottom for xAxis name
    },
    xAxis: {
        type: 'value',
        min: minHour,
        max: maxHour,
        name: 'Hour of Day (UTC)',
        nameLocation: 'middle',
        nameGap: 30, // Increased gap for better readability
        interval: Math.ceil((maxHour - minHour) / 12) || 1, // Dynamic interval, at least 1
        axisLabel: { color: '#B0B0B0' },
        nameTextStyle: { color: '#B0B0B0' }
    },
    yAxis: {
        type: 'category',
        data: data.map((item: {name: string}) => item.name),
        axisLabel: {
            show: true,
            color: '#B0B0B0'
        }
    },
    series: [
        {
            type: 'custom',
            renderItem: function (params: any, api: any) {
                const categoryIndex = api.value(0);
                const start = api.coord([api.value(1), categoryIndex]);
                const end = api.coord([api.value(2), categoryIndex]);
                const height = api.size([0, 1])[1] * 0.6;

                const rectShape = echarts.graphic.clipRectByRect(
                    {
                        x: start[0],
                        y: start[1] - height / 2,
                        width: end[0] - start[0],
                        height: height
                    },
                    {
                        x: params.coordSys.x,
                        y: params.coordSys.y,
                        width: params.coordSys.width,
                        height: params.coordSys.height
                    }
                );
                return (
                    rectShape && {
                        type: 'rect',
                        shape: rectShape,
                        style: api.style()
                    }
                );
            },
            encode: {
                x: [1, 2],
                y: 0
            },
            data: data,
            markLine: meanActiveTime !== null ? {
              silent: true, 
              symbol: ['none', 'none'], 
              lineStyle: {
                type: 'dashed',
                color: '#A0A0A0',
                width: 1.5
              },
              data: [
                {
                  xAxis: meanActiveTime,
                  label: {
                    show: true,
                    formatter: 'Mean Active Time',
                    position: 'insideEndTop',
                    color: '#A0A0A0',
                    fontSize: 10
                  }
                }
              ]
            } : undefined
        }
    ]
  };
}; 
