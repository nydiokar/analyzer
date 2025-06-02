"use client";

import React, { useState, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import TimeRangeSelector from '@/components/shared/TimeRangeSelector';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  CopyIcon, 
  WalletIcon, 
  ChevronUp, 
  ChevronDown, 
  LayoutDashboard, // Overview
  ListChecks,      // Token Performance (could also be BarChartHorizontal or similar)
  Calculator,      // Account Stats & PNL
  Users,           // Behavioral Patterns (could also be Zap or ActivitySquare)
  FileText,        // Notes
  RefreshCw      // Added for the refresh button
} from 'lucide-react' 
import { useToast } from "@/hooks/use-toast"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTimeRangeStore } from '@/store/time-range-store';
import { isValid, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import ReviewerLogTab from '@/components/dashboard/ReviewerLogTab';

// Basic fetcher function - can be co-located or imported if it's shared
const fetcher = async (url: string, options?: RequestInit) => {
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  let baseHeaders: HeadersInit = {};
  if (apiKey) baseHeaders['X-API-Key'] = apiKey;
  const mergedHeaders = { ...baseHeaders, ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers: mergedHeaders });
  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(errorPayload.message || 'An error occurred') as any;
    error.status = res.status;
    error.payload = errorPayload;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
};

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

const truncateWalletAddress = (address: string, startChars = 6, endChars = 4): string => {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
};

export default function WalletProfileLayout({
  children,
  walletAddress,
}: WalletProfileLayoutProps) {
  const { toast } = useToast();
  const { mutate, cache } = useSWRConfig();
  const { startDate, endDate } = useTimeRangeStore();
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<Date | null>(null);

  // SWR hook to fetch wallet summary data
  const walletSummaryKey = walletAddress ? `/api/v1/wallets/${walletAddress}/summary` : null;
  const { data: walletSummary, error: summaryError } = useSWR<{ lastAnalyzedAt?: string | null, [key: string]: any }>(
    walletSummaryKey,
    fetcher,
    {
      revalidateOnFocus: false, // Optional: prevent re-fetch on window focus for this piece of data
    }
  );

  // Effect to initialize analysis status from fetched summary
  useEffect(() => {
    if (walletSummary && typeof walletSummary.lastAnalyzedAt === 'string') {
      const analysisDate = new Date(walletSummary.lastAnalyzedAt);
      if (isValid(analysisDate)) {
        setLastAnalysisTimestamp(analysisDate);
        const now = new Date();
        // Consider analysis fresh if within the last 24 hours
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        if (analysisDate > twentyFourHoursAgo) {
          setLastAnalysisStatus('success'); // Fresh
        } else {
          setLastAnalysisStatus('idle');    // Stale (was successful, but old)
        }
      } else { // Invalid date string from backend
        setLastAnalysisTimestamp(null);
        setLastAnalysisStatus('idle'); // Treat as never analyzed or unknown
      }
    } else if (walletSummary && !walletSummary.lastAnalyzedAt) { // Explicitly null or undefined means never analyzed
      setLastAnalysisTimestamp(null);
      setLastAnalysisStatus('idle'); // Means "never analyzed"
    }
    // If summaryError, we don't automatically set analysis status to 'error'
    // as this effect is for initial load. `handleTriggerAnalysis` handles specific analysis errors.
  }, [walletSummary]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(walletAddress)
      .then(() => {
        toast({
          title: "Copied!",
          description: "Wallet address copied to clipboard.",
          duration: 2000,
        });
      })
      .catch(err => {
        toast({
          title: "Failed to copy",
          description: "Could not copy address to clipboard.",
          variant: "destructive",
          duration: 2000,
        });
        console.error('Failed to copy: ', err);
      });
  };

  const handleTriggerAnalysis = async () => {
    if (!walletAddress) {
      toast({
        title: "Wallet Address Missing",
        description: "Cannot trigger analysis without a wallet address.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    toast({
      title: "Analysis Started",
      description: `Fetching and analyzing data for ${walletAddress}. This may take a moment.`,
    });

    try {
      await fetcher(`/api/v1/analyses/wallets/${walletAddress}/trigger-analysis`, {
        method: 'POST',
      });
      
      // Revalidate all SWR keys related to this wallet
      let revalidatedCount = 0;
      if (cache instanceof Map) { // Ensure cache is iterable, typically a Map
        for (const key of cache.keys()) {
          if (typeof key === 'string' && key.startsWith(`/api/v1/wallets/${walletAddress}`)) {
            mutate(key); // This will trigger the useEffect to update status and timestamp based on new server data
            revalidatedCount++;
          }
        }
      } else {
        const baseApiUrl = `/api/v1/wallets/${walletAddress}/summary`;
        const queryParams = new URLSearchParams();
        if (startDate && isValid(startDate)) queryParams.append('startDate', startDate.toISOString());
        if (endDate && isValid(endDate)) queryParams.append('endDate', endDate.toISOString());
        const queryString = queryParams.toString();
        const apiUrlWithTime = queryString ? `${baseApiUrl}?${queryString}` : baseApiUrl;
        mutate(apiUrlWithTime); // Trigger re-fetch of summary data
        revalidatedCount = 1; 
      }

      toast({
        title: "Analysis Triggered & Refresh Queued",
        description: `Data for ${walletAddress} will be updated shortly. ${revalidatedCount} data source(s) are being refreshed.`,
      });
    } catch (err: any) {
      console.error("Error triggering analysis:", err);
      toast({
        title: "Analysis Failed to Trigger",
        description: err.message || "An unexpected error occurred. Please check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Tabs defaultValue="overview" className="flex flex-col w-full h-full bg-muted/40">
      <header className="sticky top-0 z-30 bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-2 py-2 px-1 md:py-3">
          <div className='flex flex-col items-start gap-1 flex-shrink min-w-0'> 
            {walletAddress && (
              <>
                <div className="flex items-center gap-1">
                  <WalletIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <Badge variant="outline" className="px-2 py-1 text-xs md:text-sm font-mono truncate">
                    {truncateWalletAddress(walletAddress, 8, 6)} 
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                    <CopyIcon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="sr-only">Copy wallet address</span>
                  </Button>
                </div>
                <Button 
                  onClick={handleTriggerAnalysis} 
                  variant="outline"
                  size="sm"
                  className="mt-1 w-full md:w-auto"
                  disabled={isAnalyzing || !walletAddress}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Refresh Wallet Analysis'}
                  {/* Analysis Status Display */}
                  {lastAnalysisTimestamp && isValid(lastAnalysisTimestamp) ? (
                    <div className="flex items-center space-x-1.5 text-xs text-muted-foreground mt-1 md:mt-0 md:ml-2">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          lastAnalysisStatus === 'success' && "bg-green-500", // Fresh
                          lastAnalysisStatus === 'error' && "bg-red-500",   // Error during last attempt
                          lastAnalysisStatus === 'idle' && "bg-yellow-500",// Stale (successfully analyzed but old)
                        )}
                        title={
                          lastAnalysisStatus === 'success' ? 'Analysis data is fresh' :
                          lastAnalysisStatus === 'error'   ? 'Last analysis attempt failed' :
                          lastAnalysisStatus === 'idle'    ? 'Analysis data may be outdated' : ''
                        }
                      />
                      <span>Refreshed {formatDistanceToNow(lastAnalysisTimestamp, { addSuffix: true })}</span>
                    </div>
                  ) : lastAnalysisStatus === 'idle' && !isAnalyzing ? ( // lastAnalysisTimestamp is null, status is idle, not currently analyzing -> never analyzed or unknown
                    <div className="flex items-center space-x-1.5 text-xs text-muted-foreground mt-1 md:mt-0 md:ml-2">
                         <span className="h-2 w-2 rounded-full bg-gray-400" title="Wallet has not been analyzed yet or status is unknown" />
                         <span>Not yet analyzed</span>
                    </div>
                  ) : null }
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end flex-grow md:flex-grow-0 flex-shrink min-w-0 mt-2 md:mt-0">
            {isHeaderExpanded && (
              <>
                <AccountSummaryCard walletAddress={walletAddress || ""} /> 
                <TimeRangeSelector />
              </>
            )}
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setIsHeaderExpanded(!isHeaderExpanded)} className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
                    {isHeaderExpanded ? <ChevronUp className="h-4 w-4 md:h-5 md:w-5" /> : <ChevronDown className="h-4 w-4 md:h-5 md:w-5" />}
                    <span className="sr-only">{isHeaderExpanded ? 'Collapse Summary' : 'Expand Summary'}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p>{isHeaderExpanded ? 'Collapse summary' : 'Expand summary'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ThemeToggleButton />
          </div>
        </div>
        <TabsList className="flex items-center justify-start gap-0.5 p-0.5 px-1 border-t w-full bg-muted/20">
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="overview" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span>Overview</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Overview</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="token-performance" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>Token Performance</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Token Performance</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="account-stats" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Account Stats & PNL</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Account Stats & PNL</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="behavioral-patterns" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <Users className="h-3.5 w-3.5" />
                  <span>Behavioral Patterns</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Behavioral Patterns</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger 
                  value="notes" 
                  className="px-3 py-2 text-xs md:text-sm font-medium rounded-t-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold hover:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:opacity-75 hover:opacity-100">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Notes</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center"><p>Reviewer Log / Notes</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TabsList>
      </header>

      <main className="flex-1 overflow-y-auto p-0">
        <div className="w-full h-full">
          <TabsContent value="overview">
            {children}
            <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
              <h3 className="text-lg font-semibold mb-2">Overview Section Placeholder</h3>
              <p className="text-sm text-muted-foreground">This is where the main page content (passed as children) is displayed.</p>
              <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center"> (Overview Content Area) </div>
            </div>
          </TabsContent>

          <TabsContent value="token-performance">
            <TokenPerformanceTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="account-stats">
            <AccountStatsPnlTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="behavioral-patterns">
            <BehavioralPatternsTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="notes">
            <ReviewerLogTab walletAddress={walletAddress} />
          </TabsContent>
        </div>
      </main>
    </Tabs>
  );
} 