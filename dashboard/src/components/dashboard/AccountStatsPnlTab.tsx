"use client";

import React, { useEffect, useState } from 'react';
import { useTimeRangeStore } from '@/store/time-range-store';
import { PnlOverviewResponse, PnlOverviewResponseData } from '@/types/api'; 
import { Card, Metric, Text, Flex, Grid, Title, Subtitle, TabGroup, TabList, Tab } from '@tremor/react';
import { useToast } from "@/hooks/use-toast";
import { fetcher } from '@/lib/fetcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, TrendingUp, AlertTriangle, Info, SearchX } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import EmptyState from '@/components/shared/EmptyState'; // Added EmptyState
import { Skeleton } from "@/components/ui/skeleton"; // Ensure Skeleton is imported
import { format, isValid } from 'date-fns'; // Import isValid
import useSWR from 'swr'; // Added SWR import
import { useApiKeyStore } from '@/store/api-key-store'; // Import the key store

interface AccountStatsPnlTabProps {
  walletAddress: string;
  isAnalyzingGlobal?: boolean;
  triggerAnalysisGlobal?: () => void;
  lastAnalysisTimestamp?: Date | null;
}

interface AccountStatsPnlDisplayProps {
  data: PnlOverviewResponseData | null;
  title: string;
}

const AccountStatsPnlDisplay: React.FC<AccountStatsPnlDisplayProps> = ({ data, title }) => {
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
        <span className="inline-block mt-1 mb-2 h-[1.25rem] w-px" />
      )}
      
      {/* Section 1: Core Trading Metrics with bottom border */}
      <div className="mt-4 pt-3 mb-4">
        <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Core Trading Metrics</Text>
        <Card className="p-0">
          <div className="px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border pb-4">
            <Grid numItemsSm={2} numItemsMd={4} className="gap-x-4 gap-y-4">
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Realized PNL</Text>
                <Metric className="text-base">{formatMetric(data.realizedPnl, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Unrealized PNL</Text>
                <Metric className="text-base">{formatMetric(data.unrealizedPnl, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5">Avg. P/L per Trade</Text>
                <Metric className="text-base">{formatMetric(data.avgPLTrade, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-xs text-tremor-content dark:text-dark-tremor-content mb-0.5 flex items-center">
                  Token Win Rate
                  <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">Percentage of tokens that were profitable (realized PnL &gt; 0) out of all tokens traded. This represents token selection success.</p></TooltipContent></Tooltip></TooltipProvider>
                </Text>
                <Metric className="text-base">{formatPercentage(data.tokenWinRate)}</Metric>
                {data.profitableTokensCount !== null && data.profitableTokensCount !== undefined &&
                 data.unprofitableTokensCount !== null && data.unprofitableTokensCount !== undefined && (
                  <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-0.5">
                    {data.profitableTokensCount}/{data.profitableTokensCount + data.unprofitableTokensCount} tokens
                  </Text>
                )}
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
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-sm">Average PnL per token divided by average trading duration per token. Shows trading intensity - how much PnL each token generated per day of active trading.</p></TooltipContent></Tooltip></TooltipProvider>
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

const PnlDisplaySkeleton: React.FC<{ title: string }> = ({ title }) => (
  <Card className="w-full h-full">
    <Title>{title}</Title>
    <Subtitle className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-1 mb-2">
      <span className="inline-block animate-pulse rounded-md bg-primary/10 h-4 w-1/3">&nbsp;</span>
    </Subtitle>
    
    {/* Section 1: Core Trading Metrics Skeleton */}
    <div className="mt-4 pt-3 mb-4">
      <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Core Trading Metrics</Text>
      <Card className="p-0">
        <div className="px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border pb-4">
          <Grid numItemsSm={2} numItemsMd={4} className="gap-x-4 gap-y-4">
            {[...Array(4)].map((_, i) => (
              <Flex key={`core-metric-skel-${i}`} flexDirection="col" alignItems="start" justifyContent="start">
                <Skeleton className="h-3 w-1/2 mb-1" />
                <Skeleton className="h-6 w-3/4" />
              </Flex>
            ))}
          </Grid>
        </div>
      </Card>
    </div>

    {/* Section 2: Volume & Capital Flow Skeleton */}
    <div className="mt-4 pt-3 mb-4">
      <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">Volume & Capital Flow</Text>
      <Card className="p-0">
        <div className="px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border pb-4">
          <Grid numItemsSm={2} numItemsMd={3} className="gap-x-4 gap-y-4">
            {[...Array(3)].map((_, i) => (
              <Flex key={`volume-metric-skel-${i}`} flexDirection="col" alignItems="start" justifyContent="start">
                <Skeleton className="h-3 w-1/2 mb-1" />
                <Skeleton className="h-6 w-3/4" />
              </Flex>
            ))}
          </Grid>
        </div>
      </Card>
    </div>

    {/* Section 3: Advanced Token Analytics Skeleton */}
    <div className="mt-4 pt-3 mb-4 p-3 rounded-md bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle">
      <Text className="text-base font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong flex items-center mb-3">
        Advanced Token Analytics
      </Text>
      <Accordion type="single" collapsible className="w-full" defaultValue="item-advanced-metrics-skeleton">
        <AccordionItem value="item-advanced-metrics-skeleton" className="border-none rounded-md data-[state=open]:bg-tremor-background-muted dark:data-[state=open]:bg-dark-tremor-background-muted px-2">
          <AccordionTrigger className="py-2 hover:no-underline">
            <Flex alignItems="center">
              <Skeleton className="h-4 w-4 mr-2 rounded-full" />
              <Skeleton className="h-4 w-1/3" />
            </Flex>
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-2">
            <Grid numItemsSm={2} numItemsMd={2} numItemsLg={2} className="gap-3 mt-1">
              {[...Array(6)].map((_, i) => (
                <Card key={`adv-metric-card-skel-${i}`} className="p-2.5 text-left">
                  <Skeleton className="h-3 w-3/4 mb-1" />
                  <Skeleton className="h-6 w-1/2" />
                </Card>
              ))}
            </Grid>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  </Card>
);

export default function AccountStatsPnlTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal, lastAnalysisTimestamp }: AccountStatsPnlTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore(); // Get key and init status
  const [displayMode, setDisplayMode] = useState<number>(2);

  const pnlOverviewApiUrlBase = walletAddress ? `/wallets/${walletAddress}/pnl-overview` : null;
  let swrKeyPnl: (string | null)[] | null = null;

  if (pnlOverviewApiUrlBase && !isAnalyzingGlobal && isInitialized && apiKey) { // Only build key if not analyzing and store is ready
    const queryParams = new URLSearchParams();
    if (startDate) queryParams.append('startDate', startDate.toISOString());
    if (endDate) queryParams.append('endDate', endDate.toISOString());
    const url = queryParams.toString() ? `${pnlOverviewApiUrlBase}?${queryParams.toString()}` : pnlOverviewApiUrlBase;
    // The key now includes the URL and the API key for reactivity
    swrKeyPnl = [url, apiKey];
  }
  
  const { 
    data: pnlData, 
    error, 
    isLoading,
    mutate: mutatePnlData 
  } = useSWR<PnlOverviewResponse, Error & { payload?: any; status?: number }>(
    swrKeyPnl,
    ([url]) => fetcher(url), // Pass only the URL to the fetcher
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        if (error.status === 404) return; // Don't retry on 404
        if (retryCount >= 2) return;
        // Potentially use toast here for retry attempts or persistent errors
        // toast({ title: "Data Fetch Error", description: `Retrying PNL data... (${retryCount + 1})`, variant: "destructive" });
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
      // onSuccess: () => {
      //   toast({ title: "PNL Data Loaded", description: "Successfully fetched PNL overview." });
      // }
    }
  );

  // useEffect to handle isAnalyzingGlobal changes.
  useEffect(() => {
    if (!isAnalyzingGlobal && swrKeyPnl) {
      // If analysis just finished, and we have a key, consider revalidating.
      // This could be useful if the analysis might have updated data for the current view.
      // mutatePnlData(); // Uncomment if explicit revalidation is needed after global analysis.
    }
  }, [isAnalyzingGlobal, swrKeyPnl, mutatePnlData]);


  // Remove duplicate analyzing state - progress is shown in main layout
  // if (isAnalyzingGlobal) {
  //   return (
  //     <EmptyState
  //       variant="default"
  //       icon={Loader2}
  //       title="Analyzing Wallet..."
  //       description="Please wait while the wallet analysis is in progress. PNL data will update shortly."
  //       className="mt-4 md:mt-6 lg:mt-8"
  //     />
  //   );
  // }
  
  if (isLoading && !isAnalyzingGlobal) {
    // Preserve the existing displayMode state for skeleton rendering
    // const skeletonTitle = displayMode === 1 ? "Period Specific PNL" : "All-Time PNL"; // No longer needed directly here
    return (
      <div className="space-y-6 p-1 md:p-0">
        <Card className="space-y-1 p-1 w-full">
          <Flex justifyContent="center">
            {/* Skeleton for the TabGroup */}
            <div className="max-w-xs flex space-x-1 p-1 bg-tremor-background-muted dark:bg-dark-tremor-background-muted rounded-lg">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </Flex>
          <hr className="my-4 border-tremor-border dark:border-dark-tremor-border" />

          {displayMode === 2 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start w-full">
              <PnlDisplaySkeleton title="Period Specific PNL & Stats" />
              <div className="border-l border-slate-700 pl-3 md:mt-0 mt-6">
                <PnlDisplaySkeleton title="All-Time PNL & Stats" />
              </div>
            </div>
          ) : displayMode === 0 ? (
            <Grid numItems={1} className="gap-6">
              <PnlDisplaySkeleton title="Period Specific PNL & Stats" />
            </Grid>
          ) : (
            <Grid numItems={1} className="gap-6">
              <PnlDisplaySkeleton title="All-Time PNL & Stats" />
            </Grid>
          )}
        </Card>
      </div>
    );
  }

  if (error && !isAnalyzingGlobal) {
    if (error.status === 404) { // Adjusted to error.status
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
  
  if (!pnlData && !isAnalyzingGlobal) { 
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
  if (pnlData && pnlData.periodData && Object.keys(pnlData.periodData).length > 0) { // Check pnlData exists
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
  if (pnlData && pnlData.allTimeData && Object.keys(pnlData.allTimeData).length > 0) { // Check pnlData exists
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
      <Card className="space-y-1 p-1 w-full">
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