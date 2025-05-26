"use client";

import React, { useEffect, useState } from 'react';
import { useTimeRangeStore } from '@/store/time-range-store';
import { PnlOverviewResponse, PnlOverviewResponseData } from '@/types/api'; // Assuming API types are defined here
import { Card, Metric, Text, Flex, Grid, Title, Subtitle } from '@tremor/react';
import { useToast } from "@/hooks/use-toast";
import { fetcher } from '@/lib/fetcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

interface AccountStatsPnlTabProps {
  walletAddress: string;
}

const AccountStatsPnlDisplay: React.FC<{ data: PnlOverviewResponseData | null, title: string }> = ({ data, title }) => {
  if (!data) {
    return (
      <Card className="flex-1">
        <Title>{title}</Title>
        <Text>No data available for this period.</Text>
      </Card>
    );
  }

  const formatMetric = (value: number | undefined | null, unit: string = '', decimals: number = 2) => {
    if (value === undefined || value === null) return 'N/A';
    const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-inherit';
    return <span className={textColor}>{value.toFixed(decimals)} {unit}</span>;
  };

  const formatPercentage = (value: number | undefined | null) => {
    if (value === undefined || value === null) return 'N/A';
    const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-inherit';
    return <span className={textColor}>{value.toFixed(1)}%</span>;
  };
  
  // const formatInteger = (value: number | undefined | null) => {
  //   if (value === undefined || value === null) return 'N/A';
  //   const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-inherit';
  //   return <span className={textColor}>{value}</span>;
  // };

  return (
    <Card className="flex-1">
      <Title>{title}</Title>
      {data.dataFrom && <Subtitle>Data from: {data.dataFrom}</Subtitle>}
      
      <div className="mt-6 border-t border-tremor-border dark:border-dark-tremor-border pt-4 mb-6">
        <Text className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-base">Overall Performance</Text>
        <Grid numItemsSm={2} numItemsLg={3} className="gap-x-4 gap-y-2 mt-2">
          <Flex flexDirection="col">
            <Text className="text-xs">Realized PNL</Text>
            <Metric className="text-xl">{formatMetric(data.realizedPnl, 'SOL')}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs">Avg. P/L per Trade</Text>
            <Metric className="text-xl">{formatMetric(data.avgPLTrade, 'SOL')}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs">Token Win Rate</Text>
            <Metric className="text-xl">{formatPercentage(data.tokenWinRate)}</Metric>
          </Flex>
        </Grid>
      </div>

      <div className="mt-6 border-t border-tremor-border dark:border-dark-tremor-border pt-4 mb-6">
        <Text className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-base">Volume & Activity</Text>
        <Grid numItemsSm={2} numItemsLg={3} className="gap-x-4 gap-y-2 mt-2">
          <Flex flexDirection="col">
            <Text className="text-xs">Total Volume Traded</Text>
            <Metric className="text-xl text-blue-500">{data.totalVolume?.toFixed(2) ?? 'N/A'} SOL</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs">Total SOL Spent</Text>
            <Metric className="text-xl text-blue-500">{data.totalSolSpent?.toFixed(2) ?? 'N/A'} SOL</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs">Total SOL Received</Text>
            <Metric className="text-xl text-blue-500">{data.totalSolReceived?.toFixed(2) ?? 'N/A'} SOL</Metric>
          </Flex>
        </Grid>
      </div>

      <div className="mt-6 border-t border-tremor-border dark:border-dark-tremor-border pt-4 p-3 rounded-md bg-tremor-background-muted dark:bg-dark-tremor-background-muted">
        <Text className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-base flex items-center">
          Advanced Token Stats
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 ml-1.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm">Key statistical measures focusing on token-level profit and loss characteristics, excluding stablecoins.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Text>
        <Grid numItemsSm={2} numItemsLg={3} className="gap-x-4 gap-y-2 mt-2">
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              Median P/L per Token
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">The median (middle value) of profit or loss across all individual tokens traded.</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.medianPLToken, 'SOL')}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              Trimmed Mean PNL (Token)
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">The average PNL per token after removing extreme outliers (e.g., top/bottom 5-10% of PNL values).</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.trimmedMeanPnlPerToken, 'SOL')}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              PNL Standard Deviation
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">Measures the dispersion or variability of PNL values across different tokens. Higher values indicate greater PNL volatility.</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.standardDeviationPnl, 'SOL')}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              Median PNL/Volatility Ratio
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">Median token PNL divided by PNL standard deviation. A measure of risk-adjusted return.</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.medianPnlToVolatilityRatio, '', 2)}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              Weighted Efficiency Score
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">A composite score reflecting PNL relative to volume, trade frequency, and consistency. (Details may vary by specific formula used)</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.weightedEfficiencyScore, '', 2)}</Metric>
          </Flex>
          <Flex flexDirection="col">
            <Text className="text-xs flex items-center">
              Avg. PNL/Day Active (Approx)
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p className="text-sm">Total realized PNL divided by the approximate number of days the wallet was active in trading.</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Text>
            <Metric className="text-xl">{formatMetric(data.averagePnlPerDayActiveApprox, 'SOL')}</Metric>
          </Flex>
        </Grid>
      </div>
    </Card>
  );
};

export default function AccountStatsPnlTab({ walletAddress }: AccountStatsPnlTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [pnlData, setPnlData] = useState<PnlOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!walletAddress) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let url = `/api/v1/wallets/${walletAddress}/pnl-overview`;
        const queryParams = new URLSearchParams();
        if (startDate) {
          queryParams.append('startDate', startDate.toISOString());
        }
        if (endDate) {
          queryParams.append('endDate', endDate.toISOString());
        }
        if (queryParams.toString()) {
          url += `?${queryParams.toString()}`;
        }

        const data: PnlOverviewResponse = await fetcher(url);
        setPnlData(data);
      } catch (err: any) {
        console.error("Error fetching PNL overview:", err);
        setError(err.message || 'An unexpected error occurred.');
        toast({
          title: "Error fetching PNL Data",
          description: err.message || "Could not load PNL overview data.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [walletAddress, startDate, endDate, toast]);

  if (isLoading) {
    return <div className="p-6"><Text>Loading PNL data...</Text></div>;
  }

  if (error) {
    return <div className="p-6 text-red-500"><Text>Error: {error}</Text></div>;
  }

  if (!pnlData) {
    return <div className="p-6"><Text>No PNL data available for this wallet.</Text></div>;
  }

  return (
    <div className="p-0">
      <Grid numItemsMd={2} className="gap-6">
        <AccountStatsPnlDisplay data={pnlData.periodData} title="Period Specific PNL & Stats" />
        <AccountStatsPnlDisplay data={pnlData.allTimeData} title="All-Time PNL & Stats" />
      </Grid>
    </div>
  );
} 