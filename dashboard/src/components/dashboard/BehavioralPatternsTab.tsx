"use client";

import React, { useState } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { BehaviorAnalysisResponseDto } from '@/types/api'; // Assuming this type exists
import { Card, Text, Title, Flex } from '@tremor/react';
import { AlertTriangle, Hourglass, LineChart, Users, Clock, ShieldCheck, HelpCircle } from 'lucide-react';
import EChartComponent, { ECOption } from '../charts/EChartComponent'; // Import the new chart component
import { VisualMapComponent, CalendarComponent } from 'echarts/components'; // Import VisualMap and Calendar
import * as echarts from 'echarts/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Import Tabs from shadcn
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"; // Import Accordion
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Import Tooltip
import { Switch } from "@/components/ui/switch"; // Added Switch
import { Label } from "@/components/ui/label";   // Added Label

// Register VisualMap and Calendar components
echarts.use([VisualMapComponent, CalendarComponent]);

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
  const [useLogScaleDuration, setUseLogScaleDuration] = useState<boolean>(false); // State for log scale

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

  const rawDataForDebugging = behaviorData.rawMetrics; // Assuming this is where it is

  return (
    <Card className="p-4 md:p-6 space-y-6">
      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4 border-b border-border">
          <TabsTrigger value="summary">Summary & Metrics</TabsTrigger>
          <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Title className="mb-4 text-lg font-semibold">Behavioral Summary & Metrics</Title>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
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
            {behaviorData.primaryBehavior && (
              <div>
                <Text className="font-medium">Primary Tag</Text>
                <Text>{behaviorData.primaryBehavior}</Text>
              </div>
            )}
          </div>
          
          <hr className="my-6 border-muted" />
          <Title className="text-lg font-semibold mt-6 mb-4">Detailed Behavioral Metrics</Title>
          
          <Accordion type="multiple" className="w-full space-y-3" defaultValue={["item-performance", "item-session", "item-risk"]}>
            {/* Accordion Item 1: Performance & Holding Patterns */}
            <AccordionItem value="item-performance" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <LineChart className="w-5 h-5 mr-2 text-blue-500" />
                  <Text className="text-base font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">Performance & Holding Patterns</Text>
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Buy/Sell Ratio:</Text><Text className="font-mono">{behaviorData.buySellRatio?.toFixed(2) ?? 'N/A'}</Text></div>
                  <div>
                    <TooltipProvider><Tooltip><TooltipTrigger asChild><Flex alignItems="center" className="inline-flex"><Text className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Flipper Score:</Text></Flex></TooltipTrigger><TooltipContent className="max-w-xs"><p>Indicates how quickly a user buys and sells tokens. Higher scores suggest more flipping activity.</p></TooltipContent></Tooltip></TooltipProvider>
                    <Text className="font-mono">{behaviorData.flipperScore?.toFixed(3) ?? 'N/A'}</Text>
                  </div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg. Flip Duration (Hrs):</Text><Text className="font-mono">{behaviorData.averageFlipDurationHours?.toFixed(1) ?? 'N/A'} Hrs</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Median Hold Time (Hrs):</Text><Text className="font-mono">{behaviorData.medianHoldTime?.toFixed(2) ?? 'N/A'} Hrs</Text></div>
                  <div>
                    <Text className="text-xs uppercase tracking-wide text-muted-foreground">% Trades &lt; 1 Hr:</Text>
                    <Text className="font-mono">
                      {typeof behaviorData.percentTradesUnder1Hour === 'number'
                        ? `${(behaviorData.percentTradesUnder1Hour * 100).toFixed(1)}%`
                        : 'N/A'}
                    </Text>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Accordion Item 2: Session & Frequency */}
            <AccordionItem value="item-session" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <Users className="w-5 h-5 mr-2 text-purple-500" />
                  <Text className="text-base font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">Session & Trading Frequency</Text>
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg Session Duration (Mins):</Text><Text className="font-mono">{behaviorData.averageSessionDurationMinutes?.toFixed(1) ?? 'N/A'} Mins</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg Trades Per Session:</Text><Text className="font-mono">{behaviorData.avgTradesPerSession?.toFixed(1) ?? 'N/A'}</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Unique Tokens Traded:</Text><Text className="font-mono">{behaviorData.uniqueTokensTraded ?? 'N/A'}</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Total Trades:</Text><Text className="font-mono">{behaviorData.totalTradeCount ?? 'N/A'}</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades/Day (Avg):</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerDay?.toFixed(1) ?? 'N/A'}</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades/Week (Avg):</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerWeek?.toFixed(1) ?? 'N/A'}</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades/Month (Avg):</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerMonth?.toFixed(1) ?? 'N/A'}</Text></div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Accordion Item 3: Risk & Value Profile */}
            <AccordionItem value="item-risk" className="border border-border rounded-md px-3 data-[state=open]:bg-muted/20">
              <AccordionTrigger className="py-3 hover:no-underline">
                <Flex alignItems="center">
                  <ShieldCheck className="w-5 h-5 mr-2 text-red-500" />
                  <Text className="text-base font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">Risk & Value Profile</Text>
                </Flex>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm pl-1">
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg. Tx Value (SOL):</Text><Text className="font-mono">{behaviorData.riskMetrics?.averageTransactionValueSol?.toFixed(2) ?? 'N/A'} SOL</Text></div>
                  <div><Text className="text-xs uppercase tracking-wide text-muted-foreground">Largest Tx Value (SOL):</Text><Text className="font-mono">{behaviorData.riskMetrics?.largestTransactionValueSol?.toFixed(2) ?? 'N/A'} SOL</Text></div>
                  <div>
                    <Text className="text-xs uppercase tracking-wide text-muted-foreground">Re-entry Rate:</Text>
                    <Text className="font-mono">
                      {typeof behaviorData.reentryRate === 'number' 
                        ? `${(behaviorData.reentryRate).toFixed(1)}%` 
                        : 'N/A'}
                    </Text>
                  </div>
                  <div>
                    <Text className="text-xs uppercase tracking-wide text-muted-foreground">% Unpaired Tokens:</Text>
                     <Text className="font-mono">
                      {typeof behaviorData.percentageOfUnpairedTokens === 'number'
                        ? `${(behaviorData.percentageOfUnpairedTokens).toFixed(1)}%`
                        : 'N/A'}
                    </Text>
                  </div>
                   {/* Add more relevant risk metrics here if available in behaviorData */}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="visualizations">
          {/* Visualizations Section (Heatmap, Duration, Windows) */}
          <div className="rounded-lg bg-muted/10 dark:bg-muted/5 px-4 py-2 mb-6">
            <Tabs defaultValue="heatmap" className="w-full mt-2">
              <div className="sticky top-0 z-10 bg-card dark:bg-card p-2 -mx-4 md:-mx-6 border-b border-border mb-4"> {/* Sticky Wrapper */}
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                  <TabsTrigger
                    value="heatmap"
                    className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2"
                  >
                    Activity Heatmap
                  </TabsTrigger>
                  <TabsTrigger
                    value="duration"
                    className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2"
                  >
                    Hold Duration Distribution
                  </TabsTrigger>
                  <TabsTrigger
                    value="windows"
                    className="data-[state=active]:bg-tremor-background-muted data-[state=active]:text-tremor-content-strong dark:data-[state=active]:bg-dark-tremor-background-muted dark:data-[state=active]:text-dark-tremor-content-strong data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 text-sm font-semibold pb-2"
                  >
                    Trading Windows
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="heatmap">
                <Title className="mb-2 text-base font-medium">Activity Heatmap (Trades by Hour of Day - UTC)</Title>
                {behaviorData.activeTradingPeriods?.hourlyTradeCounts && Object.keys(behaviorData.activeTradingPeriods.hourlyTradeCounts).length > 0 ? (
                  <EChartComponent option={getHeatmapOption(behaviorData.activeTradingPeriods.hourlyTradeCounts)} style={{ height: '200px', width: '100%' }} />
                ) : (
                  <Flex flexDirection="col" alignItems="center" justifyContent="center" className="h-[200px] text-tremor-content dark:text-dark-tremor-content">
                    <AlertTriangle className="w-8 h-8 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
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
                          <p>Displays the Y-axis on a logarithmic scale (base 10). This can be useful for visualizing data with a very wide range of values or to better see relative changes for smaller values.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </Flex>
                {behaviorData.tradingTimeDistribution && Object.keys(behaviorData.tradingTimeDistribution).length > 0 ? (
                  <EChartComponent option={getTradingDurationOption(behaviorData.tradingTimeDistribution, useLogScaleDuration)} style={{ height: '300px', width: '100%' }} />
                ) : (
                  <Flex flexDirection="col" alignItems="center" justifyContent="center" className="h-[300px] text-tremor-content dark:text-dark-tremor-content">
                    <AlertTriangle className="w-10 h-10 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
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
                    <AlertTriangle className="w-10 h-10 mb-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
                    <Text>No identified trading windows available.</Text>
                  </Flex>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>

      </Tabs>

      {/* Raw Data (for debugging) Section - Moved to the end */}
      {rawDataForDebugging && Object.keys(rawDataForDebugging).length > 0 && (
        <Accordion type="single" collapsible className="w-full mt-8">
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
        color: ['#d6e4ff', '#3a5fcd']
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
        // params is an array, take the first element for this single-series chart
        const param = Array.isArray(params) ? params[0] : params;
        const categoryName = param.name; // e.g., "Ultra Fast"
        const proportion = param.value; // e.g., 0.46153
        
        const timeRange = timeRanges[categoryName];
        
        let tooltipString = `${categoryName}`;
        if (timeRange) {
          tooltipString += ` (${timeRange})`;
        }
        if (typeof proportion === 'number'){
            tooltipString += `<br/>${param.marker}${param.seriesName}: ${(proportion * 100).toFixed(1)}%`;
        } else {
            tooltipString += `<br/>${param.marker}${param.seriesName}: ${proportion}`;
        }
        
        return tooltipString;
      }
      // valueFormatter removed as formatter takes precedence
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '20%', // Increased bottom margin for horizontal labels
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        rotate: 0, // Horizontal labels
        interval: 0,
        fontSize: 12, // Increased font size
        color: '#E0E0E0' // Lighter color for labels
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
              color: '#5470C6' // Changed to blue spectrum - top
            },
            {
              offset: 1,
              color: '#91CC75' // Changed to blue spectrum - bottom (example, might need adjustment for good gradient)
              // A better blue gradient might be e.g., '#3a5fcd' (darker) and '#73C0DE' (lighter)
              // Let's try: color: '#6ea8fe' (lighter blue) and color: '#255ab5' (darker blue)
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
          color: '#FFFFFF', // White color for bar labels
          fontSize: 12
        }
      }
    ]
  };
};

// Helper function to generate trading windows timeline option
const getTradingWindowsOption = (windows: NonNullable<BehaviorAnalysisResponseDto['activeTradingPeriods']>['identifiedWindows']): ECOption => {
  const windowColors = [
    '#5470C6', '#73C0DE', '#91CC75', // Blue, Light Blue, Greenish-Blue (example)
    // Adjusted to a more blue/teal/green focused palette for consistency
    // E.g., shades of blue and teal:
    '#255ab5', // Dark Blue
    '#3a7cde', // Medium Blue
    '#6ea8fe', // Light Blue
    '#3ab8d7', // Tealish Blue
    '#29a0b1', // Darker Teal
    // Add more shades if needed, or use a generator for a sequential blue palette
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
        win.endTimeUTC + 1, // endTime is exclusive in ECharts custom series, add 1 if it represents the end of the hour
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

  return {
    tooltip: {
        formatter: function (params: any) {
            return params.marker + params.name + ': ' + params.value[4];
        }
    },
    grid: {
        height: gridHeight,
        left: '15%',
        right: '10%'
    },
    xAxis: {
        type: 'value',
        min: minHour -1,
        max: maxHour + 2,
        name: 'Hour of Day (UTC)',
        nameLocation: 'middle',
        nameGap: 25,
        interval: 1
    },
    yAxis: {
        type: 'category',
        data: data.map((item: {name: string}) => item.name),
        axisLabel: {
            show: true
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
              silent: true, // Non-interactive
              symbol: ['none', 'none'], // No start/end symbols
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