"use client";

import React, { useState, useMemo, useCallback, useEffect, memo, startTransition, useDeferredValue } from 'react';
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


// Enhanced spam detection using DexScreener data and transaction patterns  
// MOVED OUTSIDE COMPONENT TO PREVENT RE-CREATION ON EVERY RENDER
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
  if (totalTransfers === 1 && totalSpent === 0 && totalReceived === 0) {
    riskScore += 85;
    reasons.push('Airdrop scam (1 tx, no SOL movement)');
  }

  // Honeypot detection: Only spent SOL, never received SOL from selling
  if (transfersIn > 0 && transfersOut === 0 && totalSpent > 0.01 && totalReceived === 0) {
    riskScore += 45;
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
    if (tradingDuration < 3600 && totalReceived < (totalSpent * 0.5)) {
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
    riskScore += 20;
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
    const pairAge = (Date.now() - (token as any).pairCreatedAt) / (1000 * 60 * 60 * 24);
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

  // Determine risk level
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
  'totalPnlSol',
  'unrealizedPnlSol',
  'roi',
  'totalSolSpent',
  'totalSolReceived',
  'currentUiBalance',
  'currentSolValue',
  'netAmountChange',
  'lastTransferTimestamp',
];

// This definition should be outside the component to prevent re-creation on every render.
const COLUMN_DEFINITIONS = [
  {
    id: 'tokenAddress',
    name: 'Token',
    className: 'sticky left-0 z-10 w-[240px] md:w-[280px] text-left pl-4 pr-3',
    cell: ({ row }: { row: { original: TokenPerformanceDataDto } }) => {
      const token = row.original;
      const tokenName = token.name || 'Unknown';
      const tokenSymbol = token.symbol || token.tokenAddress.slice(0, 4) + '...';

      const handleCopy = () => {
        navigator.clipboard.writeText(token.tokenAddress);
        toast.success("Token address copied to clipboard!");
      };

      return (
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <div className="flex-grow flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded p-1 -m-1 transition-colors">
                <Avatar className="h-8 w-8 border border-slate-200 dark:border-slate-700">
                  <AvatarImage
                    src={token.imageUrl ?? undefined}
                    alt={tokenName}
                  />
                  <AvatarFallback className="text-xs font-semibold">
                    {tokenName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="truncate">
                  <div className="font-semibold truncate text-slate-900 dark:text-slate-100 text-sm">{tokenName}</div>
                  <div className="text-slate-500 dark:text-slate-400 text-xs font-medium">{tokenSymbol}</div>
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
              <div className="space-y-3">
                <div className="font-bold text-base">{tokenName}</div>
                <div className="text-xs text-muted-foreground break-all font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded">{token.tokenAddress}</div>
                <div className="flex items-center gap-2 pt-1">
                  <UiButton variant="outline" size="sm" className="h-auto px-3 py-2 text-xs" onClick={handleCopy}><Copy className="h-3 w-3 mr-1" />Copy</UiButton>
                  <UiButton variant="outline" size="sm" className="h-auto px-3 py-2 text-xs" asChild>
                    <a href={`https://solscan.io/token/${token.tokenAddress}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Solscan</a>
                  </UiButton>
                  {token.websiteUrl && <UiButton variant="ghost" size="icon" className="h-8 w-8" asChild><a href={token.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4" /></a></UiButton>}
                  {token.twitterUrl && <UiButton variant="ghost" size="icon" className="h-8 w-8" asChild><a href={token.twitterUrl} target="_blank" rel="noopener noreferrer"><TwitterIcon className="h-4 w-4" /></a></UiButton>}
                  {token.telegramUrl && <UiButton variant="ghost" size="icon" className="h-8 w-8" asChild><a href={token.telegramUrl} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4" /></a></UiButton>}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    }
  },
  // Prioritized order with compact spacing and alignment
  { id: 'totalPnlSol', name: 'Total PNL (SOL)', isSortable: true, className: 'text-right px-2 min-w-[120px]', icon: DollarSignIcon },
  { id: 'roi', name: 'ROI (%)', isSortable: true, className: 'text-right px-2 min-w-[90px]', icon: PercentIcon }, 
  { id: 'totalSolSpent', name: 'SOL Spent', isSortable: true, className: 'text-right px-2 min-w-[100px]', icon: ArrowLeftCircleIcon },
  { id: 'totalSolReceived', name: 'SOL Received', isSortable: true, className: 'text-right px-2 min-w-[110px]', icon: ArrowRightCircleIcon },
  { id: 'currentBalanceDisplay', name: 'Current Balance', isSortable: true, className: 'text-right px-2 min-w-[130px]', icon: PackageIcon },
  { id: 'netSolProfitLoss', name: 'Realized PNL (SOL)', isSortable: true, className: 'text-right px-2 min-w-[140px]', icon: DollarSignIcon },
  { id: 'unrealizedPnlSol', name: 'Unrealized PNL (SOL)', isSortable: true, className: 'text-right px-2 min-w-[150px]', icon: TrendingUpIcon },
  { id: 'marketCapDisplay', name: 'Market Cap', isSortable: false, className: 'text-right px-2 min-w-[100px]', icon: TrendingUpIcon },
  { id: 'transferCountIn', name: 'In', isSortable: false, className: 'text-center px-2 min-w-[50px]', icon: ArrowRightLeftIcon },
  { id: 'transferCountOut', name: 'Out', isSortable: false, className: 'text-center px-2 min-w-[50px]'},
  { id: 'firstTransferTimestamp', name: 'First Trade', isSortable: false, className: 'text-center px-2 min-w-[100px]', icon: CalendarDaysIcon }, 
  { id: 'lastTransferTimestamp', name: 'Last Trade', isSortable: true, className: 'text-center px-2 min-w-[100px]', icon: CalendarDaysIcon }, 
];

function TokenPerformanceTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // Initial page size
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [spamFilter, setSpamFilter] = useState<string>('all');
  
  // Use deferred value for search to prevent blocking main thread during typing
  const deferredSearchTerm = useDeferredValue(searchTerm);

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
    if (deferredSearchTerm) params.append('searchTerm', deferredSearchTerm);
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

  // Memoize spam analysis results to prevent expensive recalculations
  const spamAnalysisResults = useMemo(() => {
    const results = new Map<string, ReturnType<typeof analyzeTokenSpamRisk>>();
    tableData.forEach(token => {
      results.set(token.tokenAddress, analyzeTokenSpamRisk(token));
    });
    return results;
  }, [tableData]);

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
    startTransition(() => {
      setPnlFilter(newValue);
      setPage(1);
    });
  };

  const handleMinTradesToggleChange = (checked: boolean) => {
    startTransition(() => {
      setMinTradesToggle(checked);
      setPage(1);
    });
  };

  const handleShowHoldingsToggleChange = (checked: boolean) => {
    startTransition(() => {
      setShowHoldingsOnly(checked);
      setPage(1);
      // Force refresh when toggling holdings filter to ensure fresh data
      localMutate();
    });
  };

  const handleSort = (columnId: string) => {
    // Map frontend column IDs to backend field names
    const fieldMapping: Record<string, string> = {
      'currentBalanceDisplay': 'currentSolValue'  // Sort by SOL value, not token amount
    };
    
    const backendField = fieldMapping[columnId] || columnId;
    
    if (!BACKEND_SORTABLE_IDS.includes(backendField)) return;
    if (sortBy === backendField) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(backendField);
      setSortOrder('DESC');
    }
    setPage(1);
  };
  
  const handleSearchTermChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Immediate update for responsive typing experience
    setSearchTerm(e.target.value);
    // Page reset in transition to avoid blocking
    startTransition(() => {
      setPage(1);
    });
  };

  const handleSpamFilterChange = (newValue: string) => {
    startTransition(() => {
      setSpamFilter(newValue);
      setPage(1);
    });
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
    return Array.from({ length: 3 }).map((_, rowIndex) => ( // Reduced skeleton rows for faster initial render
      <TableRow key={`skeleton-row-${rowIndex}`}>
        {COLUMN_DEFINITIONS.map((col, colIndex) => (
          <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`} className={cn(col.className, col.id === 'tokenAddress' && 'sticky left-0 z-10 bg-card dark:bg-dark-tremor-background-default')}>
            <Skeleton className={cn("h-5", col.id === 'tokenAddress' ? "w-3/4" : "w-full")} />
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
      const hasDateFilter = startDate || endDate;
      const emptyMessage = hasDateFilter 
        ? "No token activity detected for the selected time period. Try expanding the date range or selecting 'All' to see historical data."
        : "No token activity detected for the selected filters.";
      
      return <TableBody><TableRow><TableCell colSpan={COLUMN_DEFINITIONS.length}><EmptyState variant="default" icon={BarChartBig} title="No Token Data" description={emptyMessage} className="my-8" /></TableCell></TableRow></TableBody>;
    }

    // If we have data, render it.
    return (
      <TableBody>
        {tableData.map((item: TokenPerformanceDataDto, index: number) => {
          const spamAnalysis = spamAnalysisResults.get(item.tokenAddress);
          if (!spamAnalysis) return null;
          
          return (
            <TokenTableRow
              key={item.tokenAddress}
              item={item}
              index={index}
              spamAnalysis={spamAnalysis}
              columns={COLUMN_DEFINITIONS}
            />
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
    if (startPage > 1) { items.push(<PaginationItem key="start-ellipsis"><PaginationLink onClick={() => handlePageChange(startPage - 1)} className="h-7 w-7 p-0 text-xs">...</PaginationLink></PaginationItem>);}
    for (let i = startPage; i <= endPage; i++) { items.push(<PaginationItem key={i}><PaginationLink onClick={() => handlePageChange(i)} isActive={currentPage === i} className="h-7 min-w-7 px-1 text-xs">{i}</PaginationLink></PaginationItem>);}
    if (endPage < totalPages) { items.push(<PaginationItem key="end-ellipsis"><PaginationLink onClick={() => handlePageChange(endPage + 1)} className="h-7 w-7 p-0 text-xs">...</PaginationLink></PaginationItem>);}
    return items;
  };

  if (!walletAddress) {
    return <Card className="p-4 md:p-6 mt-4"><EmptyState variant="info" icon={InfoIcon} title="No Wallet Selected" description="Please select a wallet to view token performance." /></Card>;
  }

  return (
    <Card className="p-0 md:p-0 mt-0 flex flex-col border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
        <Flex flexDirection="row" alignItems="center" justifyContent="between" className="gap-3 flex-wrap">
          <Flex flexDirection="row" alignItems="center" className="gap-3 flex-wrap">
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center space-x-2">
                    <Switch id="min-trades-toggle" checked={minTradesToggle} onCheckedChange={handleMinTradesToggleChange} />
                    <Label htmlFor="min-trades-toggle" className="cursor-pointer">Min. 2 Trades</Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Only show tokens with at least 2 transactions (buy + sell activity)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center space-x-2">
                    <Switch id="holdings-only-toggle" checked={showHoldingsOnly} onCheckedChange={handleShowHoldingsToggleChange} />
                    <Label htmlFor="holdings-only-toggle" className="cursor-pointer">Holding Only</Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Only show tokens that are currently held (have a balance &gt; 0)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <UiButton variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCwIcon className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />Refresh
            </UiButton>
          </Flex>
        </Flex>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto bg-white dark:bg-slate-900">
        <Table className="min-w-full">
          <TableHeader className="bg-slate-50 dark:bg-slate-800">
            <TableRow className="border-b border-slate-200 dark:border-slate-700">
              {COLUMN_DEFINITIONS.map(col => (
                <TableHead 
                  key={col.id} 
                  className={cn(
                    "font-semibold text-slate-700 dark:text-slate-300 text-sm h-10",
                    col.className,
                    col.id === 'tokenAddress' && 'sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 shadow-sm',
                    col.isSortable && 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors'
                  )}
                  onClick={() => col.isSortable && handleSort(col.id)}
                >
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
        <div className="px-4 py-2 border-t">
          <div className="flex items-center justify-between gap-2 min-h-8 w-full">
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Per Page:</span>
              <Select value={pageSize.toString()} onValueChange={(value) => startTransition(() => { setPageSize(Number(value)); setPage(1); })}>
                <SelectTrigger className="w-16 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 flex justify-center min-w-0 overflow-hidden">
              <Pagination>
                <PaginationContent className="gap-1">
                  <PaginationItem><UiButton variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handlePageChange(1)} disabled={data.page === 1} aria-label="Go to first page"><ChevronsLeft className="h-3 w-3" /></UiButton></PaginationItem>
                  <PaginationItem><PaginationPrevious onClick={() => handlePageChange(data.page - 1)} className={cn("h-7 px-2 text-xs", data.page === 1 && "pointer-events-none opacity-50")} /></PaginationItem>
                  {renderPaginationItems()}
                  <PaginationItem><PaginationNext onClick={() => handlePageChange(data.page + 1)} className={cn("h-7 px-2 text-xs", !data.totalPages || data.page === data.totalPages && "pointer-events-none opacity-50")} /></PaginationItem>
                  <PaginationItem><UiButton variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handlePageChange(data.totalPages)} disabled={!data.totalPages || data.page === data.totalPages} aria-label="Go to last page"><ChevronsRight className="h-3 w-3" /></UiButton></PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
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
    const magnitude = Math.min(Math.floor(Math.log10(absValue) / 3), suffixes.length - 1);
    const scaledValue = absValue / Math.pow(1000, magnitude);
    const precision = scaledValue < 10 ? 2 : scaledValue < 100 ? 1 : 0;
    const numPart = parseFloat(scaledValue.toFixed(precision));
    return (value < 0 ? "-" : "") + numPart.toLocaleString() + (suffixes[magnitude] || '');
  }
  if (uiString) return uiString;
  return 'N/A';
};

const formatPnl = (pnl: number | null | undefined) => {
  if (pnl === null || pnl === undefined) return <Text className="text-sm text-slate-400 dark:text-slate-500">N/A</Text>;
  const value = pnl;
  const textColor = value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-slate-400';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return (
    <Text className={`font-mono ${textColor} text-sm font-semibold`}>
      <span className="text-sm mr-1 align-middle">{sign}</span>
      {Math.abs(value).toFixed(2)} SOL
    </Text>
  );
};
  
  const formatPercentage = (percentage: number | null | undefined) => {
    if (percentage === null || percentage === undefined || !isFinite(percentage)) return null;
    const value = percentage;
    const isPositive = value > 0;
    const bgColor = isPositive ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30';
    const textColor = isPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
    const sign = isPositive ? '+' : '-';
    
    // Format large percentages: 1000+ becomes 1k%, etc.
    const absValue = Math.abs(value);
    let formattedValue: string;
    
    if (absValue >= 1000000) {
      formattedValue = (absValue / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
      formattedValue = (absValue / 1000).toFixed(1) + 'k';
    } else {
      formattedValue = absValue.toFixed(1);
    }
    
    // Return as a small, compact badge/chip
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${bgColor} ${textColor} border border-current/20`}>
        {sign}{formattedValue}%
      </span>
    );
  };

const formatSolAmount = (value: number | null | undefined) => {
  if (typeof value === 'number' && !isNaN(value)) {
    if (value === 0) return "0";
    const absValue = Math.abs(value);
    if (absValue < 0.01) return `< 0.01`;
    if (absValue > 1e6) return `> 1M`;
    return parseFloat(value.toFixed(2)).toLocaleString();
  }
  return 'N/A';
};

const formatMarketCap = (value: number | null | undefined) => {
  if (typeof value === 'number' && !isNaN(value) && value > 0) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  return 'N/A';
};

// Memoized table row component for better performance
const TokenTableRow = memo(({ 
  item, 
  index, 
  spamAnalysis,
  columns 
}: {
  item: TokenPerformanceDataDto;
  index: number;
  spamAnalysis: ReturnType<typeof analyzeTokenSpamRisk>;
  columns: typeof COLUMN_DEFINITIONS;
}) => {
  const pnl = item.netSolProfitLoss ?? 0;
  const totalPnl = item.totalPnlSol ?? 0;
  const pnlColor = pnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : pnl < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-slate-400';
  const roi = item.totalSolSpent && item.totalSolSpent !== 0 ? (totalPnl / item.totalSolSpent) * 100 : (totalPnl > 0 ? Infinity : totalPnl < 0 ? -Infinity : 0);

  return (
    <TableRow 
      key={item.tokenAddress + index}
      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-200/60 dark:border-slate-700/60"
    >
      {columns.map(col => (
        <TableCell 
          key={col.id} 
          className={cn(
            "py-2 text-sm", 
            col.className, 
            col.id === 'tokenAddress' && 'sticky left-0 z-10 whitespace-nowrap bg-white dark:bg-slate-900 shadow-sm', 
            (col.id === 'netSolProfitLoss' || col.id === 'roi') && pnlColor
          )}
        >
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
                    {spamAnalysis.riskLevel === 'high-risk' ? (
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
                    ) : (!item.name || !item.symbol || item.name === 'Unknown Token') && spamAnalysis.riskLevel === 'safe' ? (
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
                    ) : null}
                    {(() => {
                        // Optimize holding status calculation - use backend-calculated values
                        const currentBalance = item.currentUiBalance ?? 0;
                        const currentValueUsd = item.currentHoldingsValueUsd ?? 0;
                        
                        // Must have token balance AND USD value >= $1.44 (equivalent to 0.01 SOL at ~$144)
                        // Using USD threshold avoids need for real-time SOL price conversion on frontend
                        const isHeld = currentBalance > 0 && currentValueUsd >= 1.44;
                        const hadTrades = ((item.transferCountIn ?? 0) + (item.transferCountOut ?? 0)) > 0;
                        const isExited = !isHeld && hadTrades;
                        if (isHeld) {
                          return (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50">
                                    <Lock className="h-3 w-3 text-slate-400 dark:text-slate-500" />
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
                                  <div className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                                    <LogOut className="h-3 w-3 text-slate-500 dark:text-slate-400" />
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
          {col.id === 'netSolProfitLoss' && (
            <div className="flex flex-col items-end space-y-0.5">
              {formatPnl(item.netSolProfitLoss)}
              {item.realizedPnlPercentage !== null && item.realizedPnlPercentage !== undefined && (
                <div className="flex justify-end">
                  {formatPercentage(item.realizedPnlPercentage)}
                </div>
              )}
            </div>
          )}
          {col.id === 'unrealizedPnlSol' && (
            <div className="flex flex-col items-end space-y-0.5">
              {formatPnl(item.unrealizedPnlSol)}
              {item.unrealizedPnlPercentage !== null && item.unrealizedPnlPercentage !== undefined && (
                <div className="flex justify-end">
                  {formatPercentage(item.unrealizedPnlPercentage)}
                </div>
              )}
            </div>
          )}
          {col.id === 'totalPnlSol' && formatPnl(item.totalPnlSol)}
          {col.id === 'roi' && (roi === Infinity ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">∞</span> : roi === -Infinity ? <span className="text-red-500 dark:text-red-400 font-semibold">-∞</span> : formatPercentage(roi))}
          {col.id === 'totalSolSpent' && (<Text className={cn("text-sm font-mono font-medium", (item.totalSolSpent ?? 0) > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-slate-500')}>{formatSolAmount(item.totalSolSpent)}</Text>)}
          {col.id === 'totalSolReceived' && (<Text className={cn("text-sm font-mono font-medium", (item.totalSolReceived ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500')}>{formatSolAmount(item.totalSolReceived)}</Text>)}
          {col.id === 'currentBalanceDisplay' && (
            <div className="text-right">
              {item.currentUiBalance === 0 ? (
                <Text className="text-sm text-slate-400 dark:text-slate-500 font-medium">-</Text>
              ) : (
                <div className="flex flex-col items-end space-y-0.5">
                  {/* SOL Value First - Most Important */}
                  {item.currentHoldingsValueSol ? (
                    <Text className={cn(
                      "text-sm font-mono font-semibold",
                      item.currentHoldingsValueSol >= 1 ? "text-orange-600 dark:text-orange-400" : // Significant position
                      item.currentHoldingsValueSol >= 0.1 ? "text-slate-700 dark:text-slate-300" : // Medium position  
                      "text-slate-500 dark:text-slate-400" // Small position
                    )}>
                      {formatSolAmount(item.currentHoldingsValueSol)} SOL
                    </Text>
                  ) : (
                    <Text className="text-sm text-slate-500 dark:text-slate-400 font-mono font-medium">
                      ? SOL
                    </Text>
                  )}
                  {/* Token Amount Second - Less Important */}
                  <Text className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                    {formatTokenDisplayValue(item.currentUiBalance, item.currentUiBalanceString)} tokens
                  </Text>
                </div>
              )}
            </div>
          )}
          {col.id === 'marketCapDisplay' && <Text className="text-sm font-medium text-slate-600 dark:text-slate-400">{formatMarketCap((item as any).marketCapUsd)}</Text>}
          {col.id === 'transferCountIn' && (<Text className={cn("text-sm font-medium", (item.transferCountIn ?? 0) > 0 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500')}>{item.transferCountIn}</Text>)}
          {col.id === 'transferCountOut' && (<Text className={cn("text-sm font-medium", (item.transferCountOut ?? 0) > 0 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500')}>{item.transferCountOut}</Text>)}
          {col.id === 'firstTransferTimestamp' && <Text className="text-sm font-medium text-slate-600 dark:text-slate-400">{formatDate(item.firstTransferTimestamp)}</Text>}
          {col.id === 'lastTransferTimestamp' && <Text className="text-sm font-medium text-slate-600 dark:text-slate-400">{formatDate(item.lastTransferTimestamp)}</Text>}
        </TableCell>
      ))}
    </TableRow>
  );
});

TokenTableRow.displayName = 'TokenTableRow';

// Memoize the component to prevent unnecessary re-renders
export default memo(TokenPerformanceTab);


