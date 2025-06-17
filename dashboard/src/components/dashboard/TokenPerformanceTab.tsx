"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store'; 
import { Card, Text, Flex } from '@tremor/react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../../components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "../../components/ui/pagination"; 
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  InfoIcon,
  ArrowUpRight,
  ArrowDownRight,
  Copy as CopyIcon,
  ExternalLink as ExternalLinkIcon,
  HelpCircle as HelpCircleIcon,
  DollarSign as DollarSignIcon,
  Percent as PercentIcon,
  ArrowLeftCircle as ArrowLeftCircleIcon,
  ArrowRightCircle as ArrowRightCircleIcon,
  Package as PackageIcon,
  ArrowRightLeft as ArrowRightLeftIcon,
  CalendarDays as CalendarDaysIcon,
  Repeat as RepeatIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  X as TwitterIcon, 
  Send as TelegramIcon,
  RefreshCwIcon,
  BarChartBig,
  AlertTriangle,
  Shield,
  Circle,
  ArrowRightLeft,
  Lock,
  LogOut,
  TrendingUpIcon,
} from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button as UiButton } from "@/components/ui/button";
import { useApiKeyStore } from '@/store/api-key-store';
import { fetcher } from '@/lib/fetcher';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Copy,
  ExternalLink,
  Globe,
  Send,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface TokenPerformanceTabProps {
  walletAddress: string;
  isAnalyzingGlobal: boolean;
  triggerAnalysisGlobal: () => void;
}

// Define PNL filter options
const PNL_FILTER_OPTIONS = [  
  { value: 'any', label: 'Any PNL' },
  { value: '>0', label: 'PNL > 0 SOL' },
  { value: '<0', label: 'PNL < 0 SOL' },
  { value: '>10', label: 'PNL > 10 SOL' },
  { value: '<-10', label: 'PNL < -10 SOL' },
  { value: '>100', label: 'PNL > 100 SOL' },
  { value: '<-100', label: 'PNL < -100 SOL' },
];

// Define spam filter options
const SPAM_FILTER_OPTIONS = [
  { value: 'all', label: 'All Tokens' },
  { value: 'safe', label: 'Safe Tokens' },
  { value: 'high-risk', label: 'High Risk Tokens' },
  { value: 'unknown', label: 'Unknown Tokens' },
];

// Valid sortable IDs based on the backend TokenPerformanceSortBy enum
const BACKEND_SORTABLE_IDS = [
  'tokenAddress',
  'netSolProfitLoss',
  'roi',
  'totalSolSpent',
  'totalSolReceived',
  'netAmountChange',
  'lastTransferTimestamp',
];

// This definition should be outside the component to prevent re-creation on every render.
const COLUMN_DEFINITIONS = [
  {
    id: 'tokenAddress',
    name: 'Token',
    className: 'sticky left-0 z-10 w-[250px] md:w-[300px] text-left',
    cell: ({ row }: { row: { original: TokenPerformanceDataDto } }) => {
      const token = row.original;
      const tokenName = token.name || 'Unknown';
      const tokenSymbol = token.symbol || token.tokenAddress.slice(0, 4) + '...';

      const handleCopy = () => {
        navigator.clipboard.writeText(token.tokenAddress);
        toast.success("Token address copied to clipboard!");
      };

      return (
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <div className="flex-grow flex items-center gap-3 cursor-pointer">
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={token.imageUrl ?? undefined}
                    alt={tokenName}
                  />
                  <AvatarFallback>
                    {tokenName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="truncate">
                  <div className="font-medium truncate text-tremor-content-strong dark:text-dark-tremor-content-strong">{tokenName}</div>
                  <div className="text-tremor-content dark:text-dark-tremor-content">{tokenSymbol}</div>
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="space-y-2">
                <div className="font-bold text-sm">{tokenName}</div>
                <div className="text-xs text-muted-foreground break-all">{token.tokenAddress}</div>
                <div className="flex items-center gap-1 pt-1">
                  <UiButton variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" onClick={handleCopy}><Copy className="h-3 w-3 mr-1" />Copy</UiButton>
                  <UiButton variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild>
                    <a href={`https://solscan.io/token/${token.tokenAddress}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Solscan</a>
                  </UiButton>
                  {token.websiteUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={token.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4" /></a></UiButton>}
                  {token.twitterUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={token.twitterUrl} target="_blank" rel="noopener noreferrer"><TwitterIcon className="h-4 w-4" /></a></UiButton>}
                  {token.telegramUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={token.telegramUrl} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4" /></a></UiButton>}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    }
  },
  { id: 'netSolProfitLoss', name: 'Net PNL (SOL)', isSortable: true, className: 'text-right', icon: DollarSignIcon },
  { id: 'roi', name: 'ROI (%)', isSortable: true, className: 'text-right', icon: PercentIcon }, 
  { id: 'totalSolSpent', name: 'SOL Spent', isSortable: true, className: 'text-right', icon: ArrowLeftCircleIcon },
  { id: 'totalSolReceived', name: 'SOL Received', isSortable: true, className: 'text-right', icon: ArrowRightCircleIcon },
  { id: 'currentBalanceDisplay', name: 'Current Balance', isSortable: false, className: 'text-right', icon: PackageIcon },
  { id: 'marketCapDisplay', name: 'Market Cap', isSortable: false, className: 'text-right', icon: TrendingUpIcon },
  { id: 'transferCountIn', name: 'In', isSortable: false, className: 'text-center text-right', icon: ArrowRightLeftIcon },
  { id: 'transferCountOut', name: 'Out', isSortable: false, className: 'text-center text-right'},
  { id: 'firstTransferTimestamp', name: 'First Trade', isSortable: false, className: 'text-center', icon: CalendarDaysIcon }, 
  { id: 'lastTransferTimestamp', name: 'Last Trade', isSortable: true, className: 'text-center', icon: CalendarDaysIcon }, 
];

// Enhanced spam detection using DexScreener data and transaction patterns
const analyzeTokenSpamRisk = (token: TokenPerformanceDataDto): {
  riskLevel: 'safe' | 'high-risk';
  riskScore: number;
  reasons: string[];
  primaryReason: string;
} => {
  let riskScore = 0;
  const reasons: string[] = [];
  
  // Whitelist of well-known legitimate tokens (by symbol or name)
  const LEGITIMATE_TOKENS = [
    'SOL', 'USDC', 'USDT', 'BTC', 'ETH', 'WBTC', 'WETH', 'RAY', 'SRM', 'FTT',
    'MNGO', 'STEP', 'ROPE', 'COPE', 'FIDA', 'KIN', 'MAPS', 'OXY', 'MEDIA',
    'Wrapped SOL', 'USD Coin', 'Tether USD', 'Bitcoin', 'Ethereum', 'Wrapped Bitcoin',
    'Raydium', 'Serum', 'FTX Token', 'Mango', 'Step Finance', 'Rope Token'
  ];
  
  // If it's a legitimate token, mark as safe regardless of other factors
  if (token.symbol && LEGITIMATE_TOKENS.includes(token.symbol)) {
    return { riskLevel: 'safe', riskScore: 0, reasons: ['Whitelisted legitimate token'], primaryReason: 'Whitelisted legitimate token' };
  }
  if (token.name && LEGITIMATE_TOKENS.includes(token.name)) {
    return { riskLevel: 'safe', riskScore: 0, reasons: ['Whitelisted legitimate token'], primaryReason: 'Whitelisted legitimate token' };
  }
  
  const isUnknown = !token.name || !token.symbol || token.name === 'Unknown Token';
  const totalSpent = token.totalSolSpent ?? 0;
  const totalReceived = token.totalSolReceived ?? 0;
  const netPnl = token.netSolProfitLoss ?? 0;
  const transfersIn = token.transferCountIn ?? 0;
  const transfersOut = token.transferCountOut ?? 0;
  const totalTransfers = transfersIn + transfersOut;

  // ULTIMATE SCAM PATTERN: Single transaction with zero SOL movement
  // This is the most obvious scam pattern based on user observation
  if (totalTransfers === 1 && totalSpent === 0 && totalReceived === 0) {
    riskScore += 85; // Very high score for this obvious pattern
    reasons.push('Airdrop scam (1 tx, no SOL movement)');
  }

  // Honeypot detection: Only spent SOL, never received SOL from selling
  // This indicates potential honeypot where you can buy but not sell
  if (transfersIn > 0 && transfersOut === 0 && totalSpent > 0.01 && totalReceived === 0) {
    riskScore += 45; // Increased importance
    reasons.push('Potential honeypot (can buy, cannot sell)');
  }

  // Failed exit patterns: Multiple attempts to sell with minimal success
  if (transfersOut >= 3 && totalReceived < (totalSpent * 0.1) && totalSpent > 0.05) {
    riskScore += 35;
    reasons.push('Failed exit attempts (multiple sells, minimal returns)');
  }

  // High-frequency micro transactions (potential bot/scam activity)
  if (totalTransfers >= 10 && totalSpent < 0.1 && totalReceived < 0.1) {
    riskScore += 60;
    reasons.push('Bot activity (high frequency micro-transactions)');
  }

  // Dust attack pattern: Very small amounts with no real trading activity
  if (totalSpent < 0.001 && totalReceived < 0.001 && totalTransfers > 0) {
    riskScore += 30;
    reasons.push('Dust attack pattern');
  }

  // Pump and dump pattern: Quick buy followed by immediate sell attempt
  if (transfersIn === 1 && transfersOut >= 1 && token.firstTransferTimestamp && token.lastTransferTimestamp) {
    const tradingDuration = token.lastTransferTimestamp - token.firstTransferTimestamp;
    if (tradingDuration < 3600 && totalReceived < (totalSpent * 0.5)) { // Less than 1 hour, big loss
      riskScore += 25;
      reasons.push('Pump & dump pattern (rapid trading, big loss)');
    }
  }

  // Very recent token activity (less than 24 hours) with unknown metadata
  const now = Date.now() / 1000;
  if (isUnknown && token.firstTransferTimestamp && (now - token.firstTransferTimestamp) < (24 * 60 * 60)) {
    riskScore += 15;
    reasons.push('Very recent token (<24h old)');
  }

  // No social links or web presence for unknown tokens
  if (isUnknown && !token.websiteUrl && !token.twitterUrl && !token.telegramUrl) {
    riskScore += 20; // Increased importance
    reasons.push('No web presence or social links');
  }

  // Unknown token metadata (base risk) - only add if no other significant reasons
  if (isUnknown && reasons.length === 0) {
    riskScore += 25;
    reasons.push('Unknown token metadata');
  }

  // DexScreener data integration for enhanced risk assessment
  if ((token as any).marketCapUsd && (token as any).marketCapUsd < 10000) {
    riskScore += 30;
    const marketCapK = ((token as any).marketCapUsd / 1000).toFixed(1);
    reasons.push(`Very low market cap ($${marketCapK}K)`);
  }
  
  if ((token as any).liquidityUsd && (token as any).liquidityUsd < 1000) {
    riskScore += 25;
    const liquidityK = ((token as any).liquidityUsd / 1000).toFixed(1);
    reasons.push(`Very low liquidity ($${liquidityK}K)`);
  }

  // Very new trading pair (less than 7 days old)
  if ((token as any).pairCreatedAt) {
    const pairAge = (Date.now() - (token as any).pairCreatedAt) / (1000 * 60 * 60 * 24); // days
    if (pairAge < 7) {
      riskScore += 20;
      reasons.push(`Very new trading pair (${pairAge.toFixed(1)} days old)`);
    }
  }

  // No trading volume (dead token)
  if ((token as any).volume24h !== undefined && (token as any).volume24h < 100) {
    riskScore += 15;
    reasons.push('Very low trading volume (<$100/24h)');
  }

  // Cap risk score at 100 to avoid confusion
  riskScore = Math.min(riskScore, 100);

  // Determine risk level - lowered threshold to catch more scams
  let riskLevel: 'safe' | 'high-risk';
  if (riskScore >= 35) {
    riskLevel = 'high-risk';
  } else {
    riskLevel = 'safe';
  }

  // Get the most important reason (first one is usually most critical)
  const primaryReason = reasons.length > 0 ? reasons[0] : 'Low risk score';

  return { riskLevel, riskScore, reasons, primaryReason };
};

export default function TokenPerformanceTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [spamFilter, setSpamFilter] = useState<string>('all');

  const [isEnriching, setIsEnriching] = useState<boolean>(false);
  const [enrichmentMessage, setEnrichmentMessage] = useState<string | null>(null);

  const apiUrlBase = walletAddress ? `/wallets/${walletAddress}/token-performance` : null;
  let swrKey: string | null = null;

  if (apiUrlBase && isInitialized && apiKey) {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('pageSize', pageSize.toString());
    if (BACKEND_SORTABLE_IDS.includes(sortBy)) {
        params.append('sortBy', sortBy);
        params.append('sortOrder', sortOrder);
    }
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());
    if (showHoldingsOnly) params.append('showOnlyHoldings', 'true');
    if (searchTerm) params.append('searchTerm', searchTerm);
    if (spamFilter !== 'all') params.append('spamFilter', spamFilter);
    
    if (pnlFilter !== 'any') {
      const operatorMatch = pnlFilter.match(/^([><])/);
      const valueMatch = pnlFilter.match(/-?[\d.]+$/);
      if (operatorMatch && valueMatch) {
        const opMap: { [key: string]: string } = { '>': 'gt', '<': 'lt' };
        params.append('pnlConditionOperator', opMap[operatorMatch[1]]);
        params.append('pnlConditionValue', valueMatch[0]);
      }
    }

    if (minTradesToggle) {
      params.append('minTrades', '2');
    }

    swrKey = `${apiUrlBase}?${params.toString()}`;
  }

  const { data, error, isLoading: isLoadingData, mutate: localMutate } = useSWR<PaginatedTokenPerformanceResponse, Error>(
    // Do not fetch data while enrichment is happening.
    !isEnriching && swrKey ? [swrKey, apiKey] : null,
    ([url]: [string]) => fetcher(url),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
    }
  );

  const tableData = useMemo(() => data?.data || [], [data]);

  const triggerEnrichment = useCallback(() => {
    if (!walletAddress || !apiKey) return;

    setIsEnriching(true);
    setEnrichmentMessage('Fetching latest token info...');
    setTimeout(() => {
      setIsEnriching(false);
      setEnrichmentMessage(null);
    }, 7000); // Hide loader and message after 7s

    fetcher(`/wallets/${walletAddress}/enrich-all-tokens`, {
      method: 'POST',
    })
    .then(data => console.log(`Enrichment triggered: ${data.message}`))
    .catch(error => console.error('Could not trigger enrichment:', error.message));
  }, [walletAddress, apiKey]);

  // Effect for initial load and wallet change
  useEffect(() => {
    if (walletAddress) {
      triggerEnrichment();
      // After triggering enrichment, schedule a refresh to get any new data
      const refreshTimer = setTimeout(() => localMutate(), 2000);
      return () => clearTimeout(refreshTimer);
    }
  }, [walletAddress, apiKey, localMutate, triggerEnrichment]);

  const handlePnlFilterChange = (newValue: string) => {
    setPnlFilter(newValue);
    setPage(1);
  };

  const handleMinTradesToggleChange = (checked: boolean) => {
    setMinTradesToggle(checked);
    setPage(1);
  };

  const handleShowHoldingsToggleChange = (checked: boolean) => {
    setShowHoldingsOnly(checked);
    setPage(1);
  };

  const handleSort = (columnId: string) => {
    if (!BACKEND_SORTABLE_IDS.includes(columnId)) return;
    if (sortBy === columnId) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(columnId);
      setSortOrder('DESC');
    }
    setPage(1);
  };
  
  const handleSearchTermChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setPage(1);
  };

  const handleSpamFilterChange = (newValue: string) => {
    setSpamFilter(newValue);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= Math.ceil((data?.total || 0) / pageSize)) {
      setPage(newPage);
    }
  };

  const handleRefresh = async () => {
    if (isLoadingData) return;
    setIsRefreshing(true);
    try {
      // Refresh the main data first
      await localMutate();
      // Then, check for any newly added tokens that need enrichment
      triggerEnrichment();
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderSkeletonTableRows = () => {
    return Array.from({ length: 5 }).map((_, rowIndex) => (
      <TableRow key={`skeleton-row-${rowIndex}`}>
        {COLUMN_DEFINITIONS.map((col, colIndex) => (
          <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`} className={cn(col.className, col.id === 'tokenAddress' && 'sticky left-0 z-10 bg-card dark:bg-dark-tremor-background-default')}>
            <Skeleton className={cn("h-5", col.id === 'tokenAddress' ? "w-3/4" : "w-full", (col.className?.includes('text-right') || col.className?.includes('text-center')) && "mx-auto")} />
          </TableCell>
        ))}
      </TableRow>
    ));
  };

  const renderTableContent = () => {
    // If SWR is loading and we have no cached data, show the skeleton.
    if (isLoadingData && tableData.length === 0 && !error) {
      return <TableBody>{renderSkeletonTableRows()}</TableBody>;
    }

    // If we have an error, show the error state.
    if (error) {
      return <TableBody><TableRow><TableCell colSpan={COLUMN_DEFINITIONS.length}><EmptyState variant="error" title="Error Loading Data" description={error.message} /></TableCell></TableRow></TableBody>;
    }
    
    // If the parent component is analyzing, show a specific state.
    if (isAnalyzingGlobal && !tableData.length) {
      return <TableBody><TableRow><TableCell colSpan={COLUMN_DEFINITIONS.length}><EmptyState variant="default" icon={Loader2} title="Analyzing Wallet..." description="Please wait while the wallet analysis is in progress. Token performance data will update shortly." className="my-8" /></TableCell></TableRow></TableBody>;
    }

    // If there's no data, check if we're enriching before declaring "No Token Data".
    if (tableData.length === 0) {
      if (isEnriching) {
        // It's too early to say "No data" if enrichment is running. Show skeleton.
        return <TableBody>{renderSkeletonTableRows()}</TableBody>;
      }
      // If not enriching and still no data, then it's final.
      return <TableBody><TableRow><TableCell colSpan={COLUMN_DEFINITIONS.length}><EmptyState variant="default" icon={BarChartBig} title="No Token Data" description="No token activity detected for the selected period or filters." className="my-8" /></TableCell></TableRow></TableBody>;
    }

    // If we have data, render it.
    return (
      <TableBody>
        {tableData.map((item: TokenPerformanceDataDto, index: number) => {
          const pnl = item.netSolProfitLoss ?? 0;
          const pnlColor = pnl > 0 ? 'text-emerald-500' : pnl < 0 ? 'text-red-500' : 'text-muted-foreground';
          const roi = item.totalSolSpent && item.totalSolSpent !== 0 ? (pnl / item.totalSolSpent) * 100 : (pnl > 0 ? Infinity : pnl < 0 ? -Infinity : 0);

          return (
            <TableRow key={item.tokenAddress + index}>
              {COLUMN_DEFINITIONS.map(col => (
                <TableCell key={col.id} className={cn("px-4 py-0.5 text-sm", col.className, col.id === 'tokenAddress' && 'sticky left-0 z-10 whitespace-nowrap bg-card dark:bg-dark-tremor-background-default', (col.id === 'netSolProfitLoss' || col.id === 'roi') && pnlColor)}>
                  {col.id === 'tokenAddress' && (
                     <Popover>
                      <PopoverTrigger asChild>
                        <div className="flex items-center gap-3 cursor-pointer">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={item.imageUrl ?? undefined} alt={item.name || 'Token'} />
                            <AvatarFallback>{(item.name || '?').charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <Text className="font-medium truncate max-w-[120px] sm:max-w-[150px]">
                              {item.name || (item.tokenAddress.substring(0, 6) + '...' + item.tokenAddress.substring(item.tokenAddress.length - 4))}
                            </Text>
                            <Text className="text-muted-foreground text-sm">{item.symbol || 'Unknown'}</Text>
                          </div>
                          <div className="ml-auto flex items-center gap-1">
                            {(() => {
                              const spamAnalysis = analyzeTokenSpamRisk(item);
                              if (spamAnalysis.riskLevel === 'high-risk') {
                                return (
                                  <TooltipProvider delayDuration={300}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800">
                                          <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-48 bg-slate-900 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-white dark:text-slate-900 text-xs font-medium">
                                        <div className="space-y-1">
                                          <p className="text-red-400 dark:text-red-600 font-semibold">Risk ({spamAnalysis.riskScore}%)</p>
                                          <p>{spamAnalysis.primaryReason}</p>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              } else if ((!item.name || !item.symbol || item.name === 'Unknown Token') && spamAnalysis.riskLevel === 'safe') {
                                return (
                                  <TooltipProvider delayDuration={300}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800">
                                          <HelpCircleIcon className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="bg-slate-900 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-white dark:text-slate-900 text-xs font-medium">
                                        <p>Unknown token</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                                const isHeld = (item.currentUiBalance ?? 0) > 0;
                                const hadTrades = ((item.transferCountIn ?? 0) + (item.transferCountOut ?? 0)) > 0;
                                const isExited = !isHeld && hadTrades;
                                if (isHeld) {
                                  return (
                                    <TooltipProvider delayDuration={300}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="flex items-center justify-center w-5 h-5 rounded bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800">
                                            <Lock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="bg-slate-900 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-white dark:text-slate-900 text-xs font-medium">
                                          <p>Currently held</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                }
                                if (isExited) {
                                  return (
                                    <TooltipProvider delayDuration={300}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="flex items-center justify-center w-5 h-5 rounded bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800">
                                            <LogOut className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="bg-slate-900 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-white dark:text-slate-900 text-xs font-medium">
                                          <p>Position exited</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                }
                                return null; // No icon when no trades and no balance
                            })()}
                          </div>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-2" align="start">
                        <div className="space-y-2">
                          <div className="font-bold text-sm">{item.name || 'Unknown Token'}</div>
                          <div className="text-xs text-muted-foreground break-all">{item.tokenAddress}</div>
                          <div className="flex items-center gap-1 pt-1">
                            <UiButton variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => navigator.clipboard.writeText(item.tokenAddress)}><CopyIcon className="h-3 w-3 mr-1"/> Copy</UiButton>
                            <UiButton variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild><a href={`https://solscan.io/token/${item.tokenAddress}`} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon className="h-3 w-3 mr-1"/> Solscan</a></UiButton>
                            {item.websiteUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={item.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4" /></a></UiButton>}
                            {item.twitterUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={item.twitterUrl} target="_blank" rel="noopener noreferrer"><TwitterIcon className="h-4 w-4" /></a></UiButton>}
                            {item.telegramUrl && <UiButton variant="ghost" size="icon" className="h-7 w-7" asChild><a href={item.telegramUrl} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4" /></a></UiButton>}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {col.id === 'netSolProfitLoss' && formatPnl(item.netSolProfitLoss)}
                  {col.id === 'roi' && (roi === Infinity ? <span className="text-emerald-500">∞</span> : roi === -Infinity ? <span className="text-red-500">-∞</span> : formatPercentagePnl(roi))}
                  {col.id === 'totalSolSpent' && (<Text className={cn("text-sm", (item.totalSolSpent ?? 0) > 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>{formatSolAmount(item.totalSolSpent)}</Text>)}
                  {col.id === 'totalSolReceived' && (<Text className={cn("text-sm", (item.totalSolReceived ?? 0) > 0 ? 'text-emerald-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>{formatSolAmount(item.totalSolReceived)}</Text>)}
                  {col.id === 'currentBalanceDisplay' && <Text className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">{item.currentUiBalance === 0 ? '-' : formatTokenDisplayValue(item.currentUiBalance, item.currentUiBalanceString)}</Text>}
                  {col.id === 'marketCapDisplay' && <Text className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">{formatMarketCap((item as any).marketCapUsd)}</Text>}
                  {col.id === 'transferCountIn' && (<Text className={cn("text-sm", (item.transferCountIn ?? 0) > 0 ? 'text-emerald-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>{item.transferCountIn}</Text>)}
                  {col.id === 'transferCountOut' && (<Text className={cn("text-sm", (item.transferCountOut ?? 0) > 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>{item.transferCountOut}</Text>)}
                  {col.id === 'firstTransferTimestamp' && <Text className="text-sm">{formatDate(item.firstTransferTimestamp)}</Text>}
                  {col.id === 'lastTransferTimestamp' && <Text className="text-sm">{formatDate(item.lastTransferTimestamp)}</Text>}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    );
  };
  
  const renderPaginationItems = () => {
    if (!data || !data.totalPages) return null; 
    const { page: currentPage, totalPages } = data; 
    const items = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    if (endPage - startPage + 1 < maxPagesToShow) { startPage = Math.max(1, endPage - maxPagesToShow + 1);}
    if (startPage > 1) { items.push(<PaginationItem key="start-ellipsis"><PaginationLink onClick={() => handlePageChange(startPage - 1)} size="sm">...</PaginationLink></PaginationItem>);}
    for (let i = startPage; i <= endPage; i++) { items.push(<PaginationItem key={i}><PaginationLink onClick={() => handlePageChange(i)} isActive={currentPage === i} size="sm">{i}</PaginationLink></PaginationItem>);}
    if (endPage < totalPages) { items.push(<PaginationItem key="end-ellipsis"><PaginationLink onClick={() => handlePageChange(endPage + 1)} size="sm">...</PaginationLink></PaginationItem>);}
    return items;
  };

  if (!walletAddress) {
    return <Card className="p-4 md:p-6 mt-4"><EmptyState variant="info" icon={InfoIcon} title="No Wallet Selected" description="Please select a wallet to view token performance." /></Card>;
  }

  return (
    <Card className="p-0 md:p-0 mt-0">
      <div className="px-4 py-3 border-b">
        <Flex flexDirection="row" alignItems="center" justifyContent="between" className="gap-2 flex-wrap">
          <Flex flexDirection="row" alignItems="center" className="gap-2 flex-wrap">
            <div className="space-y-4">
              <Input id="token-search" name="token-search" placeholder="Search address..." value={searchTerm} onChange={handleSearchTermChange} className="max-w-xs h-9" />
              {error && <p className="text-red-500">{error.message}</p>}
              {isLoadingData && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{enrichmentMessage}</span>
                </div>
              )}
            </div>
            <Select value={pnlFilter} onValueChange={handlePnlFilterChange}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Filter PNL" /></SelectTrigger>
              <SelectContent>{PNL_FILTER_OPTIONS.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}</SelectContent>
            </Select>
            <Select value={spamFilter} onValueChange={handleSpamFilterChange}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Risk Level" /></SelectTrigger>
              <SelectContent>{SPAM_FILTER_OPTIONS.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}</SelectContent>
            </Select>
            <div className="flex items-center space-x-2"><Switch id="min-trades-toggle" checked={minTradesToggle} onCheckedChange={handleMinTradesToggleChange} /><Label htmlFor="min-trades-toggle">Min. 2 Trades</Label></div>
            <div className="flex items-center space-x-2"><Switch id="holdings-only-toggle" checked={showHoldingsOnly} onCheckedChange={handleShowHoldingsToggleChange} /><Label htmlFor="holdings-only-toggle">Holding Only</Label></div>
            <UiButton variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCwIcon className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />Refresh
            </UiButton>
          </Flex>
        </Flex>
      </div>
      
      <div className="overflow-x-auto">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              {COLUMN_DEFINITIONS.map((col) => (
                <TableHead key={col.id} className={cn("py-3.5 px-4 text-left", col.className, col.isSortable ? 'cursor-pointer hover:bg-muted/50 transition-colors' : '', col.id === 'tokenAddress' && 'sticky left-0 z-20 bg-card dark:bg-dark-tremor-background-default')} onClick={() => col.isSortable && handleSort(col.id)}>
                  <Flex alignItems="center" justifyContent={col.className?.includes('text-right') ? 'end' : col.className?.includes('text-center') ? 'center' : 'start'} className="gap-1.5 h-full">
                    {col.icon && <col.icon className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-semibold whitespace-nowrap text-tremor-content-strong dark:text-dark-tremor-content-strong">{col.name}</span>
                    {col.isSortable && sortBy === col.id && (sortOrder === 'ASC' ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />)}
                  </Flex>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {renderTableContent()}
        </Table>
      </div>

      {data && data.totalPages > 0 && tableData.length > 0 && (
        <div className="px-4 py-3 border-t">
          <Pagination>
            <PaginationContent>
              <PaginationItem><UiButton variant="outline" size="sm" onClick={() => handlePageChange(1)} disabled={data.page === 1} aria-label="Go to first page"><ChevronsLeft className="h-4 w-4" /></UiButton></PaginationItem>
              <PaginationItem><PaginationPrevious onClick={() => handlePageChange(data.page - 1)} className={cn(data.page === 1 && "pointer-events-none opacity-50")} /></PaginationItem>
              {renderPaginationItems()}
              <PaginationItem><PaginationNext onClick={() => handlePageChange(data.page + 1)} className={cn(!data.totalPages || data.page === data.totalPages && "pointer-events-none opacity-50")} /></PaginationItem>
              <PaginationItem><UiButton variant="outline" size="sm" onClick={() => handlePageChange(data.totalPages)} disabled={!data.totalPages || data.page === data.totalPages} aria-label="Go to last page"><ChevronsRight className="h-4 w-4" /></UiButton></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </Card>
  );
}
// Helper to format date timestamps (assuming they are Unix seconds)
const formatDate = (timestamp: number | null | undefined) => {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString();
};

const formatTokenDisplayValue = (value: number | null | undefined, uiString?: string | null) => {
  if (typeof value === 'number' && !isNaN(value)) {
    if (value === 0) return "0";
    const absValue = Math.abs(value);
    if (absValue < 0.001) return `< 0.001`;
    if (absValue > 1e12) return `> 1T`;
    const suffixes = ["", "K", "M", "B", "T"];
    const magnitude = Math.floor(Math.log10(absValue) / 3);
    const scaledValue = absValue / Math.pow(1000, magnitude);
    const precision = scaledValue < 10 ? 2 : scaledValue < 100 ? 1 : 0;
    const numPart = parseFloat(scaledValue.toFixed(precision));
    return (value < 0 ? "-" : "") + numPart.toLocaleString() + suffixes[magnitude];
  }
  if (uiString) return uiString;
  return 'N/A';
};

const formatPnl = (pnl: number | null | undefined) => {
  if (pnl === null || pnl === undefined) return <Text className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A</Text>;
  const value = pnl;
  const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
  const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return <Text className={`font-mono ${textColor} text-sm`}><span className="text-sm mr-0.5 align-middle">{sign}</span>{Math.abs(value).toFixed(2)} SOL</Text>;
};

const formatPercentagePnl = (percentage: number | null | undefined) => {
  if (percentage === null || percentage === undefined || !isFinite(percentage)) return <Text className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A</Text>;
  const value = percentage;
  const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
  const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return <Text className={`font-mono ${textColor} text-sm`}><span className="text-sm mr-0.5 align-middle">{sign}</span>{Math.abs(value).toFixed(1)}%</Text>;
};

const formatSolAmount = (value: number | null | undefined) => {
  if (typeof value !== 'number' || isNaN(value)) return 'N/A';
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001) return '< 0.001';
  const absValue = Math.abs(value);
  const suffixes = ["", "K", "M", "B", "T"];
  const magnitude = absValue >= 1 ? Math.min(Math.floor(Math.log10(absValue) / 3), suffixes.length - 1) : 0;
  const scaledValue = absValue / Math.pow(1000, magnitude);
  const precision = scaledValue < 10 ? 2 : scaledValue < 100 ? 1 : 0;
  const numPart = parseFloat(scaledValue.toFixed(precision));
  return (value < 0 ? "-" : "") + numPart.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }) + (suffixes[magnitude] || '');
};

const formatMarketCap = (value: number | null | undefined) => {
  if (typeof value !== 'number' || isNaN(value) || value === null || value === undefined) return 'N/A';
  if (value === 0) return "$0";
  
  const absValue = Math.abs(value);
  const suffixes = ["", "K", "M", "B", "T"];
  const magnitude = Math.min(Math.floor(Math.log10(absValue) / 3), suffixes.length - 1);
  const scaledValue = absValue / Math.pow(1000, magnitude);
  const precision = scaledValue < 10 ? 1 : 0;
  const numPart = parseFloat(scaledValue.toFixed(precision));
  
  return "$" + numPart.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }) + suffixes[magnitude];
};


