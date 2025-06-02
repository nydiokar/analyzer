"use client";

import React, { useEffect, useState } from 'react';
import { useTimeRangeStore } from '@/store/time-range-store';
import { PnlOverviewResponse, PnlOverviewResponseData } from '@/types/api'; 
import { Card, Metric, Text, Flex, Grid, Title, Subtitle, TabGroup, TabList, Tab, Button } from '@tremor/react'; // Added Button
import { useToast } from "@/hooks/use-toast";
import { fetcher } from '@/lib/fetcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, DollarSign, TrendingUp, ShieldAlert, Zap, Hourglass, AlertTriangle, Info, RefreshCw } from "lucide-react"; // Added icons
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
// Removed useSWRConfig as it's not directly used in this file for mutation like in AccountSummaryCard
// If global SWR mutation is needed, it would be invoked differently or via a shared service/context.

interface AccountStatsPnlTabProps {
  walletAddress: string;
}

const AccountStatsPnlDisplay: React.FC<{ data: PnlOverviewResponseData | null, title: string }> = ({ data, title }) => {
  if (!data) {
    return (
      <Card>
        <Title>{title}</Title>
        <Text>No data available for this period.</Text>
      </Card>
    );
  }

  const formatMetric = (value: number | undefined | null, unit: string = '', decimals: number = 2) => {
    if (value === undefined || value === null) return 'N/A';
    const sign = Math.sign(value);
    const textColor = sign === 1 ? 'text-green-500' : sign === -1 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
    const arrowChar = sign === 1 ? '▲' : sign === -1 ? '▼' : '';
    const arrowElement = arrowChar ? <span className="text-xs mr-1 align-middle">{arrowChar}</span> : null;
    return <span className={textColor}>{arrowElement}{value.toFixed(decimals)} {unit}</span>;
  };

  const formatPercentage = (value: number | undefined | null) => {
    if (value === undefined || value === null) return 'N/A';
    const sign = Math.sign(value);
    const textColor = sign === 1 ? 'text-green-500' : sign === -1 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
    return <span className={textColor}>{value.toFixed(1)}%</span>;
  };
  
  return (
    <Card>
      <Title>{title}</Title>
      {data?.dataFrom ? (
        <Subtitle className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-1 mb-2">
          Data from: {data.dataFrom.replace(" UTC", "")}
        </Subtitle>
      ) : (
        <div className="mt-1 mb-2 h-[1.25rem]" />
      )}
      
      {/* Section 1: Core Trading Metrics */}
      <div className="mt-4 pt-3 mb-4">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Core Trading Metrics</Text>
        <Card className="p-3 shadow-sm">
          <Grid numItemsSm={2} numItemsMd={3} className="gap-x-4 gap-y-4">
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Realized PNL</Text>
              <Metric className="text-base">{formatMetric(data.realizedPnl, 'SOL')}</Metric>
            </Flex>
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Avg. P/L per Trade</Text>
              <Metric className="text-base">{formatMetric(data.avgPLTrade, 'SOL')}</Metric>
            </Flex>
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Token Win Rate</Text>
              <Metric className="text-base">{formatPercentage(data.tokenWinRate)}</Metric>
            </Flex>
          </Grid>
        </Card>
      </div>

      {/* Section 2: Volume & Capital Flow */}
      <div className="mt-4 pt-3 mb-4">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Volume & Capital Flow</Text>
        <Card className="p-3 shadow-sm">
          <Grid numItemsSm={2} numItemsMd={3} className="gap-x-4 gap-y-4">
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Total Volume Traded</Text>
              <Metric className="text-base text-blue-500">{data.totalVolume?.toFixed(2) ?? 'N/A'} SOL</Metric>
            </Flex>
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Total SOL Spent</Text>
              <Metric className="text-base text-blue-500">{data.totalSolSpent?.toFixed(2) ?? 'N/A'} SOL</Metric>
            </Flex>
            <Flex flexDirection="col" alignItems="start" justifyContent="start">
              <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Total SOL Received</Text>
              <Metric className="text-base text-blue-500">{data.totalSolReceived?.toFixed(2) ?? 'N/A'} SOL</Metric>
            </Flex>
          </Grid>
        </Card>
      </div>

      {/* Section 3: Advanced Token Analytics */}
      <div className="mt-4 pt-3 mb-4 p-3 rounded-md bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong flex items-center mb-3">
          Advanced Token Analytics
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 ml-1.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm">Key statistical measures focusing on token-level profit, loss, and risk characteristics, excluding stablecoins.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Text>
        
        <Accordion type="single" collapsible className="w-full" defaultValue="item-advanced-metrics">
          <AccordionItem value="item-advanced-metrics" className="border-none rounded-md data-[state=open]:bg-tremor-background-muted dark:data-[state=open]:bg-dark-tremor-background-muted px-2">
            <AccordionTrigger className="py-2 hover:no-underline">
              <Flex alignItems="center">
                <TrendingUp className="w-4 h-4 mr-2 text-blue-500" />
                <Text className="text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">Detailed Token Metrics</Text>
              </Flex>
            </AccordionTrigger>
            <AccordionContent className="pt-1 pb-2">
              <Grid numItemsSm={2} numItemsMd={2} numItemsLg={2} className="gap-3 mt-1">
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    Median P/L per Token
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">The median (middle value) of profit or loss across all individual tokens traded.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.medianPLToken, 'SOL')}</Metric>
                </Card>
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    PNL Standard Deviation
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">Measures the dispersion or variability of PNL values across different tokens. Higher values indicate greater PNL volatility.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.standardDeviationPnl, 'SOL')}</Metric>
                </Card>
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    Trimmed Mean PNL (Token)
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">The average PNL per token after removing extreme outliers (e.g., top/bottom 5-10% of PNL values).</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.trimmedMeanPnlPerToken, 'SOL')}</Metric>
                </Card>
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    Median PNL/Volatility Ratio
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">Median token PNL divided by PNL standard deviation. A measure of risk-adjusted return.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.medianPnlToVolatilityRatio, '', 2)}</Metric>
                </Card>
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    Avg. PNL/Day Active (Approx)
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">Total realized PNL divided by the approximate number of days the wallet was active in trading.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.averagePnlPerDayActiveApprox, 'SOL')}</Metric>
                </Card>
                <Card className="p-2.5 text-left">
                  <Text className="text-xs font-medium mb-0.5 text-tremor-content dark:text-dark-tremor-content flex items-center">
                    Weighted Efficiency Score
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">A composite score reflecting PNL relative to volume, trade frequency, and consistency. (Details may vary by specific formula used)</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-base">{formatMetric(data.weightedEfficiencyScore, '', 2)}</Metric>
                </Card>
              </Grid>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </Card>
  );
};

export default function AccountStatsPnlTab({ walletAddress }: AccountStatsPnlTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [pnlData, setPnlData] = useState<PnlOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true); // This will now be primary data loading
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<number>(2); 
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false); // New state for analysis process

  // Original fetchData function - will be reused
  const fetchData = async () => {
    if (!walletAddress) return;
    setIsLoading(true); // Indicate data loading, distinct from analysis loading
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
      setIsLoading(false); // Data loading finished
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletAddress, startDate, endDate]); // Removed toast from dependencies of this useEffect

  const handleTriggerAnalysis = async () => {
    if (!walletAddress) {
      toast({
        title: "Wallet Address Missing",
        description: "Cannot trigger analysis without a wallet address.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true); // Indicate analysis process has started
    setError(null); // Clear previous errors before starting analysis
    setPnlData(null); // Clear previous data before starting analysis
    setIsLoading(true); // Use main loader for analysis process as well

    toast({
      title: "Analysis Started",
      description: `Fetching and analyzing data for ${walletAddress}. This may take a moment.`,
    });

    try {
      await fetcher(`/api/v1/analyses/wallets/${walletAddress}/trigger-analysis`, {
        method: 'POST',
      });
      toast({
        title: "Analysis Complete",
        description: `Data for ${walletAddress} has been refreshed.`,
      });
      // After analysis, re-fetch the PNL data for this tab
      await fetchData(); 
    } catch (err: any) {
      console.error("Error triggering analysis:", err);
      setError(err.message || "An unexpected error occurred during analysis."); // Set error state for this tab
      toast({
        title: "Analysis Failed",
        description: err.message || "An unexpected error occurred during analysis.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false); // Analysis process finished
      // setIsLoading(false); // setIsLoading is handled by fetchData
    }
  };
  
  // Combined loading state check
  const effectiveIsLoading = isLoading || isAnalyzing;

  if (effectiveIsLoading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center">
        <Hourglass className="h-8 w-8 animate-spin text-tremor-content-subtle mb-2" />
        <Text>{isAnalyzing ? 'Analyzing wallet data, please wait...' : 'Loading PNL data...'}</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <Text color="red">Error: {error}</Text>
        <Button 
          icon={RefreshCw} 
          onClick={handleTriggerAnalysis} 
          variant="secondary"
          className="mt-4"
          disabled={isAnalyzing} // Keep disabled during analysis itself
        >
          {isAnalyzing ? 'Analyzing...' : 'Retry Analysis'}
        </Button>
      </div>
    );
  }

  if (!pnlData) {
    return (
      <div className="p-6 text-center">
        <Info className="h-8 w-8 text-tremor-content-subtle mx-auto mb-2" />
        <Text>No PNL data available for this wallet or period.</Text>
        <Button 
          icon={RefreshCw} 
          onClick={handleTriggerAnalysis} 
          variant="secondary"
          className="mt-4"
          disabled={isAnalyzing}
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze Wallet Now'}
        </Button>
      </div>
    );
  }

  const periodCard = pnlData.periodData ? (
    <AccountStatsPnlDisplay data={pnlData.periodData} title="Period Specific PNL & Stats" />
  ) : (
    <Card className="flex items-center justify-center h-full">
      <Title>Period Specific PNL & Stats</Title>
      <Text className="mt-2">No period data available.</Text>
    </Card>
  );

  const allTimeCard = pnlData.allTimeData ? (
    <AccountStatsPnlDisplay data={pnlData.allTimeData} title="All-Time PNL & Stats" />
  ) : (
    <Card className="flex items-center justify-center h-full">
      <Title>All-Time PNL & Stats</Title>
      <Text className="mt-2">No all-time data available.</Text>
    </Card>
  );

  return (
    <div className="p-1">
      <Card className="space-y-6 p-3">
        <Flex justifyContent="center">
          <TabGroup index={displayMode} onIndexChange={setDisplayMode} className="max-w-xs">
            <TabList variant="line">
              <Tab>Period</Tab>
              <Tab>All-Time</Tab>
              <Tab>Both</Tab>
            </TabList>
          </TabGroup>
        </Flex>

        {displayMode === 0 && (
          <Grid numItems={1} className="gap-6">
            {periodCard}
          </Grid>
        )}
        {displayMode === 1 && (
          <Grid numItems={1} className="gap-6">
            {allTimeCard}
          </Grid>
        )}
        {displayMode === 2 && (
          <Grid numItems={2} className="gap-6">
            {periodCard}
            {allTimeCard}
          </Grid>
        )}
      </Card>
    </div>
  );
} 