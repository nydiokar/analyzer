"use client";

import React, { useEffect, useState } from 'react';
import { useTimeRangeStore } from '@/store/time-range-store';
import { PnlOverviewResponse, PnlOverviewResponseData } from '@/types/api'; 
import { Card, Metric, Text, Flex, Grid, Title, Subtitle, TabGroup, TabList, Tab, Button } from '@tremor/react'; // Added Button
import { useToast } from "@/hooks/use-toast";
import { fetcher } from '@/lib/fetcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, DollarSign, TrendingUp, ShieldAlert, Zap, Hourglass, AlertTriangle, Info, RefreshCw, Loader2, SearchX } from "lucide-react"; // Added Loader2 and SearchX
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import EmptyState from '@/components/shared/EmptyState'; // Added EmptyState
import { format, isValid } from 'date-fns'; // Import isValid
// Removed useSWRConfig as it's not directly used in this file for mutation like in AccountSummaryCard
// If global SWR mutation is needed, it would be invoked differently or via a shared service/context.

interface AccountStatsPnlTabProps {
  walletAddress: string;
  isAnalyzingGlobal?: boolean;
  triggerAnalysisGlobal?: () => void;
  lastAnalysisTimestamp?: Date | null;
}

const AccountStatsPnlDisplay: React.FC<{ data: PnlOverviewResponseData | null, title: string }> = ({ data, title }) => {
  if (!data) {
    return (
      <Card className="w-full h-full">
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
    <Card className="w-full h-full">
      <Title>{title}</Title>
      {data?.dataFrom ? (
        <Subtitle className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-1 mb-2">
          Data from: {data.dataFrom.replace(" UTC", "")}
        </Subtitle>
      ) : (
        <div className="mt-1 mb-2 h-[1.25rem]" />
      )}
      
      {/* Section 1: Core Trading Metrics with bottom border */}
      <div className="mt-4 pt-3 mb-4">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Core Trading Metrics</Text>
        <Card className="p-0">
          <div className="px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border pb-4">
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
          </div>
        </Card>
      </div>

      {/* Section 2: Volume & Capital Flow with bottom border */}
      <div className="mt-4 pt-3 mb-4">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Volume & Capital Flow</Text>
        <Card className="p-0">
          <div className="px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border pb-4">
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
          </div>
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

export default function AccountStatsPnlTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal, lastAnalysisTimestamp }: AccountStatsPnlTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [pnlData, setPnlData] = useState<PnlOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error & { payload?: any; statusCode?: number } | null>(null);
  const [displayMode, setDisplayMode] = useState<number>(2);
  const { toast } = useToast();

  const fetchData = async () => {
    if (!walletAddress) return;
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/v1/wallets/${walletAddress}/pnl-overview`;
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('startDate', startDate.toISOString());
      if (endDate) queryParams.append('endDate', endDate.toISOString());
      if (queryParams.toString()) url += `?${queryParams.toString()}`;
      const data: PnlOverviewResponse = await fetcher(url);
      setPnlData(data);
    } catch (err: any) {
      console.error("Error fetching PNL overview:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletAddress, startDate, endDate, isAnalyzingGlobal]);

  if (isAnalyzingGlobal) {
    return (
      <EmptyState
        variant="default"
        icon={Loader2}
        title="Analyzing Wallet..."
        description="Please wait while the wallet analysis is in progress. PNL data will update shortly."
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }
  
  if (isLoading) {
    return (
      <EmptyState
        variant="default"
        icon={Loader2}
        title="Loading PNL Data..."
        description="Please wait while we fetch the PNL overview data."
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  if (error) {
    if (error.statusCode === 404) {
      return (
        <EmptyState
          variant="info"
          icon={SearchX}
          title="PNL Data Not Yet Available"
          description="Comprehensive PNL data is not available for this wallet yet. It may need to be analyzed to generate these insights."
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
        title="Error Fetching PNL Data"
        description={error.message || "An unexpected error occurred. The analysis might have failed or encountered an issue. Please try analyzing the wallet again."}
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Retry Analysis"}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }
  
  if (!pnlData && !isLoading && !isAnalyzingGlobal && !error) {
    return (
      <EmptyState
        variant="info"
        icon={SearchX}
        title="PNL Data Not Generated"
        description="PNL data has not been generated for this wallet, or no activity falls within the selected period. Please analyze the wallet."
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet"}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }
  
  if (!pnlData) {
    return (
      <EmptyState
        variant="info"
        icon={Info}
        title="PNL Data Unavailable"
        description="PNL data could not be displayed at this time. This might be a temporary issue. Try analyzing the wallet."
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet"}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  let periodCardContent;
  if (pnlData.periodData && Object.keys(pnlData.periodData).length > 0) {
    periodCardContent = <AccountStatsPnlDisplay data={pnlData.periodData} title="Period Specific PNL & Stats" />;
  } else {
    let description = "No PNL data available for the selected period.";
    let actionButtonText: string | undefined = isAnalyzingGlobal ? "Analyzing..." : undefined;
    let showActionButton = false;

    if (lastAnalysisTimestamp && startDate && isValid(lastAnalysisTimestamp) && isValid(startDate) && startDate > lastAnalysisTimestamp) {
      description = `Data for the selected period might be unavailable because the last analysis was on ${format(lastAnalysisTimestamp, 'MMM d, yyyy, p')}. Please refresh the wallet data for the latest insights.`;
      actionButtonText = isAnalyzingGlobal ? "Analyzing..." : "Refresh Wallet Data";
      showActionButton = true;
    } else if (!lastAnalysisTimestamp) {
      description = "This wallet has not been analyzed yet. Analyze it to see period-specific PNL data.";
      actionButtonText = isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet";
      showActionButton = true;
    } else if (lastAnalysisTimestamp) {
      const threeHoursAgo = new Date(new Date().getTime() - 3 * 60 * 60 * 1000);
      if (lastAnalysisTimestamp < threeHoursAgo) {
        description = `No PNL data for the selected period. The last analysis was on ${format(lastAnalysisTimestamp, 'MMM d, yyyy, p')}. You can try refreshing.`;
        actionButtonText = isAnalyzingGlobal ? "Analyzing..." : "Refresh Wallet Data";
        showActionButton = true;
      } else {
        description = `No PNL data was found for the selected period. The wallet was last analyzed on ${format(lastAnalysisTimestamp, 'MMM d, yyyy, p')}.`;
        showActionButton = false;
      }
    }

    if (triggerAnalysisGlobal && actionButtonText === undefined && showActionButton === undefined) {
        actionButtonText = isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet";
        showActionButton = true;
    }

    periodCardContent = (
      <EmptyState
        variant="info"
        icon={SearchX}
        title="Period Data Unavailable"
        description={description}
        actionText={showActionButton && triggerAnalysisGlobal ? actionButtonText : undefined}
        onActionClick={showActionButton && triggerAnalysisGlobal ? triggerAnalysisGlobal : undefined}
        isActionLoading={!!isAnalyzingGlobal && showActionButton}
        className="h-full"
      />
    );
  }

  let allTimeCardContent;
  if (pnlData.allTimeData && Object.keys(pnlData.allTimeData).length > 0) {
    allTimeCardContent = <AccountStatsPnlDisplay data={pnlData.allTimeData} title="All-Time PNL & Stats" />;
  } else {
    allTimeCardContent = (
      <EmptyState
        variant="info"
        icon={SearchX}
        title="All-Time Data Unavailable"
        description={!lastAnalysisTimestamp ? "This wallet has not been analyzed yet. Analyze it to see all-time PNL data." : "No all-time PNL data could be calculated. This might be due to no relevant trading activity or an issue during analysis."}
        actionText={triggerAnalysisGlobal && !lastAnalysisTimestamp ? (isAnalyzingGlobal ? "Analyzing..." : "Analyze Wallet") : (triggerAnalysisGlobal ? (isAnalyzingGlobal ? "Analyzing..." : "Refresh Wallet Data") : undefined)}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="h-full"
      />
    );
  }

  return (
    <div className="space-y-6 p-1 md:p-0">
      <Card className="space-y-2 p-3 w-full">
        <Flex justifyContent="center">
          <TabGroup index={displayMode} onIndexChange={setDisplayMode} className="max-w-xs">
            <TabList variant="solid">
              <Tab>Period</Tab>
              <Tab>All-Time</Tab>
              <Tab>Both</Tab>
            </TabList>
          </TabGroup>
        </Flex>
        <hr className="my-4 border-tremor-border dark:border-dark-tremor-border" />

        {displayMode === 0 && (
          <Grid numItems={1} className="gap-6">
            {periodCardContent}
          </Grid>
        )}
        {displayMode === 1 && (
          <Grid numItems={1} className="gap-6">
            {allTimeCardContent}
          </Grid>
        )}
        {displayMode === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start w-full">
            {periodCardContent}
            <div className="border-l border-slate-700 pl-3">{allTimeCardContent}</div>
          </div>
        )}
      </Card>
    </div>
  );
} 