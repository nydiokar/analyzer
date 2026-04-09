"use client";

import React, { useEffect } from 'react';
import { useTimeRangeStore } from '@/store/time-range-store';
import { PnlOverviewResponse, PnlOverviewResponseData } from '@/types/api'; 
import { fetcher } from '@/lib/fetcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, TrendingUp, AlertTriangle, Info, SearchX } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import EmptyState from '@/components/shared/EmptyState'; // Added EmptyState
import { Skeleton } from "@/components/ui/skeleton"; // Ensure Skeleton is imported
import { format, isValid } from 'date-fns'; // Import isValid
import useSWR from 'swr'; // Added SWR import
import { Card } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Minimal replacements for removed Tremor primitives
const Title = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <h3 className={cn("font-semibold text-foreground", className)}>{children}</h3>
);

const Subtitle = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
);

const Text = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
);

const Flex = ({
  className,
  children,
  alignItems,
  justifyContent,
  flexDirection,
}: {
  className?: string;
  children: React.ReactNode;
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?: "start" | "center" | "end" | "between";
  flexDirection?: "row" | "col";
}) => {
  const alignMap: Record<string, string> = {
    start: "items-start",
    center: "items-center",
    end: "items-end",
    stretch: "items-stretch",
  };
  const justifyMap: Record<string, string> = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
  };

  return (
    <div
      className={cn(
        "flex",
        flexDirection === "col" ? "flex-col" : "flex-row",
        alignItems ? alignMap[alignItems] : "",
        justifyContent ? justifyMap[justifyContent] : "",
        className
      )}
    >
      {children}
    </div>
  );
};

const Grid = ({
  className,
  numItemsSm,
  numItemsMd,
  numItemsLg,
  children,
}: {
  className?: string;
  numItemsSm?: number;
  numItemsMd?: number;
  numItemsLg?: number;
  children: React.ReactNode;
}) => {
  const colMap = (size: "sm" | "md" | "lg", val?: number) => {
    if (!val) return "";
    const prefix = `${size}:grid-cols-`;
    switch (val) {
      case 1:
        return `${prefix}1`;
      case 2:
        return `${prefix}2`;
      case 3:
        return `${prefix}3`;
      case 4:
        return `${prefix}4`;
      default:
        return "";
    }
  };

  const cols = [colMap("sm", numItemsSm), colMap("md", numItemsMd), colMap("lg", numItemsLg)]
    .filter(Boolean)
    .join(" ");

  return <div className={cn("grid grid-cols-1", cols, className)}>{children}</div>;
};

const TabGroup = ({
  index,
  onIndexChange,
  className,
  children,
}: {
  index: number;
  onIndexChange?: (val: number) => void;
  className?: string;
  children: React.ReactNode;
}) => (
  <Tabs
    value={String(index)}
    onValueChange={(val) => onIndexChange?.(Number(val))}
    className={className}
  >
    {children}
  </Tabs>
);

const TabList = ({ children }: { children: React.ReactNode }) => (
  <TabsList className="grid grid-cols-3 w-full">{children}</TabsList>
);

const Tab = ({
  value,
  children,
}: {
  value: number;
  children: React.ReactNode;
}) => (
  <TabsTrigger value={String(value)} className="text-sm">
    {children}
  </TabsTrigger>
);

export interface AccountStatsPnlTabProps {
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
      <div className="w-full h-full overflow-auto p-6 border rounded-lg bg-card">
        <Title>{title}</Title>
        <Text>No data available for this period.</Text>
      </div>
    );
  }

  const formatMetric = (value: number | undefined | null, unit: string = '', decimals: number = 2) => {
    if (value === undefined || value === null) return 'N/A';
    const sign = Math.sign(value);
    const textColor = sign === 1 ? 'text-green-500' : sign === -1 ? 'text-red-500' : 'text-muted-foreground';
    const arrowChar = sign === 1 ? '▲' : sign === -1 ? '▼' : '';
    const arrowElement = arrowChar ? <span className="text-xs mr-1 align-middle">{arrowChar}</span> : null;
    const formatted = Number(value.toFixed(decimals)).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return <span className={textColor}>{arrowElement}{formatted} {unit}</span>;
  };

  const formatPlainNumber = (value: number | undefined | null, decimals: number = 2): string => {
    if (value === undefined || value === null) return 'N/A';
    return Number(value.toFixed(decimals)).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatPercentage = (value: number | undefined | null) => {
    if (value === undefined || value === null) return 'N/A';
    const sign = Math.sign(value);
    const textColor = sign === 1 ? 'text-green-500' : sign === -1 ? 'text-red-500' : 'text-muted-foreground';
    return <span className={textColor}>{value.toFixed(1)}%</span>;
  };
  
  return (
    <div className="w-full h-full p-2 sm:p-3 border rounded-lg bg-card flex flex-col overflow-y-auto">
      <Title className="text-sm sm:text-base">{title}</Title>
      {data?.dataFrom ? (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div className="w-fit">
                <Subtitle className="text-muted-foreground mt-0.5 mb-2 text-[10px] sm:text-xs cursor-help">
                  <span className="font-medium">Period: </span>
                  {(() => {
                    // Parse the date range from "YYYY-MM-DD HH:mm:ss to YYYY-MM-DD HH:mm:ss UTC"
                    const match = data.dataFrom.match(/(\d{4}-\d{2}-\d{2}).*?to (\d{4}-\d{2}-\d{2})/);
                    if (match) {
                      const [_, startDate, endDate] = match;
                      const formatShortDate = (dateStr: string) => {
                        const [year, month, day] = dateStr.split('-');
                        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                        return `${parseInt(day)} ${monthNames[parseInt(month) - 1]} ${year}`;
                      };
                      return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
                    }
                    return data.dataFrom.replace(" UTC", "");
                  })()}
                </Subtitle>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs font-mono">{data.dataFrom}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="inline-block mt-0.5 mb-2 h-[0.5rem] w-px" />
      )}

      {/* Section 1: Core Trading Metrics with bottom border */}
      <div className="mb-2">
        <Text className="text-[10px] sm:text-xs font-semibold text-foreground mb-1">Core Trading Metrics</Text>
        <Card className="p-0">
          <div className="px-2 py-1 sm:px-2 sm:py-1.5">
            <Grid numItemsSm={1} numItemsMd={2} numItemsLg={4} className="gap-x-2 gap-y-2">
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Realized PNL</Text>
                <Metric className="text-xs sm:text-sm">{formatMetric(data.realizedPnl, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Unrealized PNL</Text>
                <Metric className="text-xs sm:text-sm">{formatMetric(data.unrealizedPnl, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Avg. P/L per Trade</Text>
                <Metric className="text-xs sm:text-sm">{formatMetric(data.avgPLTrade, 'SOL')}</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5 flex items-center">
                  <span>Token Win Rate</span>
                  <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-2.5 w-2.5 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">Percentage of tokens that were profitable (realized PnL &gt; 0) out of all tokens traded. This represents token selection success.</p></TooltipContent></Tooltip></TooltipProvider>
                </Text>
                <Metric className="text-xs sm:text-sm">{formatPercentage(data.tokenWinRate)}</Metric>
                {data.profitableTokensCount !== null && data.profitableTokensCount !== undefined &&
                 data.unprofitableTokensCount !== null && data.unprofitableTokensCount !== undefined && (
                  <Text className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                    {Number(data.profitableTokensCount).toLocaleString()}/{Number((data.profitableTokensCount || 0) + (data.unprofitableTokensCount || 0)).toLocaleString()} tokens
                  </Text>
                )}
              </Flex>
            </Grid>
          </div>
        </Card>
      </div>

      {/* Section 2: Volume & Capital Flow with bottom border */}
      <div className="mb-2">
        <Text className="text-[10px] sm:text-xs font-semibold text-foreground mb-1">Volume & Capital Flow</Text>
        <Card className="p-0">
          <div className="px-2 py-1 sm:px-2 sm:py-1.5">
            <Grid numItemsSm={1} numItemsMd={3} className="gap-x-2 gap-y-2">
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Total Volume Traded</Text>
                <Metric className="text-xs sm:text-sm text-blue-500">{formatPlainNumber(data.totalVolume, 2)} SOL</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Total SOL Spent</Text>
                <Metric className="text-xs sm:text-sm text-blue-500">{formatPlainNumber(data.totalSolSpent, 2)} SOL</Metric>
              </Flex>
              <Flex flexDirection="col" alignItems="start" justifyContent="start">
                <Text className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">Total SOL Received</Text>
                <Metric className="text-xs sm:text-sm text-blue-500">{formatPlainNumber(data.totalSolReceived, 2)} SOL</Metric>
              </Flex>
            </Grid>
          </div>
        </Card>
      </div>

      {/* Section 3: Advanced Token Analytics */}
      <div className="flex-1 p-1.5 rounded-md bg-muted/30 flex flex-col min-h-0">
        <Text className="text-[10px] sm:text-xs font-semibold text-foreground flex items-center mb-1">
          <span>Advanced Token Analytics</span>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <HelpCircle className="h-2.5 w-2.5 ml-1 text-muted-foreground cursor-help flex-shrink-0" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm">Key statistical measures focusing on token-level profit, loss, and risk characteristics, excluding stablecoins.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Text>

        <Accordion type="single" collapsible className="w-full flex-1 flex flex-col min-h-0" defaultValue="item-advanced-metrics">
          <AccordionItem value="item-advanced-metrics" className="border-none rounded-md data-[state=open]:bg-muted px-1 sm:px-1.5 flex-1 flex flex-col">
            <AccordionTrigger className="py-0.5 hover:no-underline">
              <Flex alignItems="center">
                <TrendingUp className="w-2.5 h-2.5 mr-1 text-blue-500 flex-shrink-0" />
                <Text className="text-[9px] sm:text-[10px] font-medium text-foreground">Detailed Token Metrics</Text>
              </Flex>
            </AccordionTrigger>
            <AccordionContent className="pt-1 pb-1">
              <Grid numItemsSm={1} numItemsMd={2} numItemsLg={2} className="gap-1.5">
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>Median P/L per Token</span>
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">The median (middle value) of profit or loss across all individual tokens traded.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.medianPLToken, 'SOL')}</Metric>
                </Card>
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>PNL Std Deviation</span>
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">Measures the dispersion or variability of PNL values across different tokens. Higher values indicate greater PNL volatility.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.standardDeviationPnl, 'SOL')}</Metric>
                </Card>
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>Trimmed Mean PNL</span>
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">The average PNL per token after removing extreme outliers (e.g., top/bottom 5-10% of PNL values).</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.trimmedMeanPnlPerToken, 'SOL')}</Metric>
                </Card>
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>PNL/Volatility Ratio</span>
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">Median token PNL divided by PNL standard deviation. A measure of risk-adjusted return.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.medianPnlToVolatilityRatio, '', 2)}</Metric>
                </Card>
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>Avg. PNL/Day Active</span>
                    <TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" /></TooltipTrigger><TooltipContent><p className="text-sm">Average PnL per token divided by average trading duration per token. Shows trading intensity - how much PnL each token generated per day of active trading.</p></TooltipContent></Tooltip></TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.averagePnlPerDayActiveApprox, 'SOL')}</Metric>
                </Card>
                <Card className="p-1.5 sm:p-2 text-left">
                  <Text className="text-[10px] sm:text-xs font-medium mb-0.5 text-muted-foreground flex items-center flex-wrap">
                    <span>Efficiency Score</span>
                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 ml-1 text-muted-foreground cursor-help flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-sm">
                            Combines per-token profitability and win rate: WES = (Avg PnL per token) × (1 + Win Rate) × 10. Higher is better; negative means net loss on average.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Text>
                  <Metric className="text-xs sm:text-sm break-words">{formatMetric(data.weightedEfficiencyScore, '', 2)}</Metric>
                </Card>
              </Grid>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};

const PnlDisplaySkeleton: React.FC<{ title: string }> = ({ title }) => (
  <div className="w-full h-full p-4 border rounded-lg bg-card flex flex-col">
    <Title className="text-lg">{title}</Title>
    <Subtitle className="text-muted-foreground mt-1 mb-3 text-sm">
      <span className="inline-block animate-pulse rounded-md bg-primary/10 h-3 w-1/3">&nbsp;</span>
    </Subtitle>

    {/* Section 1: Core Trading Metrics Skeleton */}
    <div className="mb-3">
      <Text className="text-sm font-semibold text-foreground mb-2">Core Trading Metrics</Text>
      <Card className="p-0">
        <div className="px-3 py-2">
          <Grid numItemsSm={2} numItemsMd={4} className="gap-x-3 gap-y-3">
            {[...Array(4)].map((_, i) => (
              <Flex key={`core-metric-skel-${i}`} flexDirection="col" alignItems="start" justifyContent="start">
                <Skeleton className="h-3 w-1/2 mb-1" />
                <Skeleton className="h-5 w-3/4" />
              </Flex>
            ))}
          </Grid>
        </div>
      </Card>
    </div>

    {/* Section 2: Volume & Capital Flow Skeleton */}
    <div className="mb-3">
      <Text className="text-sm font-semibold text-foreground mb-2">Volume & Capital Flow</Text>
      <Card className="p-0">
        <div className="px-3 py-2">
          <Grid numItemsSm={2} numItemsMd={3} className="gap-x-3 gap-y-3">
            {[...Array(3)].map((_, i) => (
              <Flex key={`volume-metric-skel-${i}`} flexDirection="col" alignItems="start" justifyContent="start">
                <Skeleton className="h-3 w-1/2 mb-1" />
                <Skeleton className="h-5 w-3/4" />
              </Flex>
            ))}
          </Grid>
        </div>
      </Card>
    </div>

    {/* Section 3: Advanced Token Analytics Skeleton */}
    <div className="flex-1 p-2 rounded-md bg-muted/30 overflow-hidden flex flex-col">
      <Text className="text-sm font-semibold text-foreground flex items-center mb-2">
        Advanced Token Analytics
      </Text>
      <Accordion type="single" collapsible className="w-full flex-1 overflow-hidden flex flex-col" defaultValue="item-advanced-metrics-skeleton">
        <AccordionItem value="item-advanced-metrics-skeleton" className="border-none rounded-md data-[state=open]:bg-muted px-2 flex-1 flex flex-col">
          <AccordionTrigger className="py-1 hover:no-underline">
            <Flex alignItems="center">
              <Skeleton className="h-3 w-3 mr-1.5 rounded-full" />
              <Skeleton className="h-3 w-1/3" />
            </Flex>
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-2 overflow-auto">
            <Grid numItemsSm={2} numItemsMd={2} numItemsLg={2} className="gap-2">
              {[...Array(6)].map((_, i) => (
                <Card key={`adv-metric-card-skel-${i}`} className="p-2 text-left">
                  <Skeleton className="h-3 w-3/4 mb-1" />
                  <Skeleton className="h-4 w-1/2" />
                </Card>
              ))}
            </Grid>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  </div>
);

export default function AccountStatsPnlTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal, lastAnalysisTimestamp }: AccountStatsPnlTabProps) {
  const { startDate, endDate } = useTimeRangeStore();

  const pnlOverviewApiUrlBase = walletAddress ? `/wallets/${walletAddress}/pnl-overview` : null;
  let swrKeyPnl: (string | null)[] | null = null;

  if (pnlOverviewApiUrlBase) {
    const queryParams = new URLSearchParams();
    if (startDate) queryParams.append('startDate', startDate.toISOString());
    if (endDate) queryParams.append('endDate', endDate.toISOString());
    const url = queryParams.toString() ? `${pnlOverviewApiUrlBase}?${queryParams.toString()}` : pnlOverviewApiUrlBase;
    swrKeyPnl = [url];
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
    return (
      <div className="h-full flex flex-col p-2 sm:p-3 md:p-4">
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
          <div className="min-h-0">
            <PnlDisplaySkeleton title="Period Specific PNL & Stats" />
          </div>
          <div className="min-h-0 lg:border-l border-slate-700 lg:pl-3 xl:pl-4">
            <PnlDisplaySkeleton title="All-Time PNL & Stats" />
          </div>
        </div>
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
    <div className="h-full flex flex-col p-2 sm:p-3 md:p-4">
      {/* Period + all-time panels side by side */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
        <div className="min-h-0">{periodCardContent}</div>
        <div className="min-h-0 lg:border-l border-slate-700 lg:pl-3 xl:pl-4">{allTimeCardContent}</div>
      </div>
    </div>
  );
} 
