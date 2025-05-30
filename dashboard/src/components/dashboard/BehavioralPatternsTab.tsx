"use client";

import React from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { BehaviorAnalysisResponseDto } from '@/types/api'; // Assuming this type exists
import { Card, Text, Title, Flex } from '@tremor/react';
import { AlertTriangle, Hourglass, LineChart, Users, Clock, ShieldCheck } from 'lucide-react';
import EChartComponent, { ECOption } from '../charts/EChartComponent'; // Import the new chart component
import { VisualMapComponent, CalendarComponent } from 'echarts/components'; // Import VisualMap and Calendar
import * as echarts from 'echarts/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Import Tabs from shadcn
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"; // Import Accordion
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Import Tooltip

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
    <Card className="p-4 md:p-6">
      <div className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
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
      </div>
      
      {/* Visualizations Section */}
      <div className="rounded-lg bg-muted/10 dark:bg-muted/5 px-4 py-2 mb-6">
        <Tabs defaultValue="heatmap" className="w-full mt-2">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 mb-4 border-b border-border">
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
            <Title className="mb-2 text-base font-medium">Hold Duration Distribution</Title>
            {behaviorData.tradingTimeDistribution && Object.keys(behaviorData.tradingTimeDistribution).length > 0 ? (
              <EChartComponent option={getTradingDurationOption(behaviorData.tradingTimeDistribution)} style={{ height: '300px', width: '100%' }} />
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
      
      <hr className="my-6 border-muted" />

      {/* Aggregated Metrics Section */}
      <Title>Detailed Metrics</Title>
      <div className="mt-4 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6">
           <div className="p-4 border border-border rounded-md">
            <Flex alignItems="center" className="mb-3">
              <LineChart className="w-5 h-5 mr-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
              <Text className="text-lg font-semibold tracking-tight text-tremor-content-strong dark:text-dark-tremor-content-strong">Key Performance Indicators</Text>
            </Flex>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-2">
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Buy/Sell Ratio:</Text><Text className="font-mono">{behaviorData.buySellRatio?.toFixed(2) ?? 'N/A'}</Text></div>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Flipper Score:</Text><Text className="font-mono">{behaviorData.flipperScore?.toFixed(3) ?? 'N/A'}</Text></div>
                  </TooltipTrigger>
                  <TooltipContent className="bg-background/95 dark:bg-background/90 backdrop-blur-sm">
                    <p>Indicates how quickly a user buys and sells tokens. Higher scores suggest more flipping activity.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg. Flip Duration (Hrs):</Text><Text className="font-mono">{behaviorData.averageFlipDurationHours?.toFixed(1) ?? 'N/A'} Hrs</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Median Hold Time (Hrs):</Text><Text className="font-mono">{behaviorData.medianHoldTime?.toFixed(2) ?? 'N/A'} Hrs</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Unique Tokens Traded:</Text><Text className="font-mono">{behaviorData.uniqueTokensTraded ?? 'N/A'}</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Total Trades:</Text><Text className="font-mono">{behaviorData.totalTradeCount ?? 'N/A'}</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1">
                <Text className="text-xs uppercase tracking-wide text-muted-foreground">% Trades &lt; 1 Hr:</Text>
                <Text className="font-mono">
                  {typeof behaviorData.percentTradesUnder1Hour === 'number' 
                    ? `${(behaviorData.percentTradesUnder1Hour * 100).toFixed(1)}%` 
                    : 'N/A'}
                </Text>
              </div>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1">
                      <Text className="text-xs uppercase tracking-wide text-muted-foreground">% Trades &lt; 4 Hrs:</Text>
                      <Text className="font-mono">
                        {typeof behaviorData.percentTradesUnder4Hours === 'number' 
                          ? `${(behaviorData.percentTradesUnder4Hours * 100).toFixed(1)}%` 
                          : 'N/A'}
                      </Text>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="bg-background/95 dark:bg-background/90 backdrop-blur-sm">
                    <p>Percentage of trades held for less than 4 hours.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

            </div>
          </div>

          <div className="p-4 border border-border rounded-md">
            <Flex alignItems="center" className="mb-3">
              <Users className="w-5 h-5 mr-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
              <Text className="text-lg font-semibold tracking-tight text-tremor-content-strong dark:text-dark-tremor-content-strong">Session Analysis</Text>
            </Flex>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-2">
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1">
                <Text className="text-xs uppercase tracking-wide text-muted-foreground">Total Sessions</Text>
                <Text className="font-mono">{behaviorData.sessionCount ?? 'N/A'}</Text>
              </div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1">
                <Text className="text-xs uppercase tracking-wide text-muted-foreground">Average Session Duration (Minutes)</Text>
                <Text className="font-mono">{behaviorData.averageSessionDurationMinutes?.toFixed(1) ?? 'N/A'} Minutes</Text>
              </div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1">
                <Text className="text-xs uppercase tracking-wide text-muted-foreground">Average Trades Per Session</Text>
                <Text className="font-mono">{behaviorData.avgTradesPerSession?.toFixed(1) ?? 'N/A'}</Text>
              </div>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6 mt-6">
           <div className="p-4 border border-border rounded-md">
            <Flex alignItems="center" className="mb-3">
              <Clock className="w-5 h-5 mr-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
              <Text className="text-lg font-semibold tracking-tight text-tremor-content-strong dark:text-dark-tremor-content-strong">Trading Frequency</Text>
            </Flex>
            <div className="space-y-1">
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades Per Day:</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerDay?.toFixed(1) ?? 'N/A'}</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades Per Week:</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerWeek?.toFixed(1) ?? 'N/A'}</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Trades Per Month:</Text><Text className="font-mono">{behaviorData.tradingFrequency?.tradesPerMonth?.toFixed(1) ?? 'N/A'}</Text></div>
            </div>
          </div>

          <div className="p-4 border border-border rounded-md">
            <Flex alignItems="center" className="mb-3">
              <ShieldCheck className="w-5 h-5 mr-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" />
              <Text className="text-lg font-semibold tracking-tight text-tremor-content-strong dark:text-dark-tremor-content-strong">Risk Metrics</Text>
            </Flex>
            <div className="space-y-1">
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Avg. Tx Value (SOL):</Text><Text className="font-mono">{behaviorData.riskMetrics?.averageTransactionValueSol?.toFixed(2) ?? 'N/A'} SOL</Text></div>
              <div className="hover:bg-muted/10 dark:hover:bg-muted/5 rounded p-1"><Text className="text-xs uppercase tracking-wide text-muted-foreground">Largest Tx Value (SOL):</Text><Text className="font-mono">{behaviorData.riskMetrics?.largestTransactionValueSol?.toFixed(2) ?? 'N/A'} SOL</Text></div>
            </div>
          </div>
        </div>
      </div>
      
      <hr className="my-6 border-muted" />
      
      <Accordion type="single" collapsible className="w-full mt-6">
        <AccordionItem value="rawData">
          <AccordionTrigger className="text-tremor-content hover:text-tremor-content-strong dark:text-dark-tremor-content dark:hover:text-dark-tremor-content-strong">Show Raw JSON Data</AccordionTrigger>
          <AccordionContent>
            <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(behaviorData, null, 2)}
            </pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {/* Fallback for raw data display until Accordion is fixed */}
      {/* <div className="mt-4">
        <Title>Raw Data (for debugging):</Title>
        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-96">
          {JSON.stringify(behaviorData, null, 2)}
        </pre>
      </div> */}
    </Card>
  );
}

// Helper function to generate heatmap option
const getHeatmapOption = (hourlyTradeCounts: Record<number, number>): ECOption => {
  const data = [];
  let minTrades = Infinity;
  let maxTrades = 0;
  for (let hour = 0; hour < 24; hour++) {
    const tradeCount = hourlyTradeCounts[hour] || 0;
    data.push([hour, 0, tradeCount]); // [hour, y-axis (single category), value]
    if (tradeCount < minTrades) minTrades = tradeCount;
    if (tradeCount > maxTrades) maxTrades = tradeCount;
  }

  // Adjust visualMap range for better contrast if maxTrades is low
  const visualMapMax = maxTrades < 10 ? 10 : maxTrades * 1.1;
  const visualMapMin = 0; // Keep min at 0 for trade counts

  return {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        return `Hour: ${params.value[0]}:00<br/>Trades: ${params.value[2]}`;
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
const getTradingDurationOption = (distribution: BehaviorAnalysisResponseDto['tradingTimeDistribution']): ECOption => {
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
      type: 'value',
      name: 'Proportion / Count',
      axisLabel: {
        formatter: (value: number) => {
            if (value === 0) return '0';
            if (value < 1 && value > 0) return (value * 100).toFixed(0) + '%';
            return value.toString(); 
        },
        color: '#B0B0B0'
      },
      nameTextStyle: {
        fontSize: 13,
        color: '#B0B0B0'
      }
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
              color: '#7022b9' // Muted greyish-blue top
            },
            {
              offset: 1,
              color: '#6e5d7e' // Muted greyish-blue bottom
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
    '#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', 
    '#3BA272', '#FC8452', '#9A60B4', '#EA7CCC'
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