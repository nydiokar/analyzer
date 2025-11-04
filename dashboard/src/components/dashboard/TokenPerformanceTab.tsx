"use client";

import React, { useState, useMemo, useCallback, useEffect, memo, startTransition, useDeferredValue, useRef } from 'react';
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
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  ColumnFiltersState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  InfoIcon,
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle as HelpCircleIcon,

  ChevronsLeft,
  ChevronsRight,
  Loader2,
  RefreshCwIcon,
  BarChartBig,
  AlertTriangle,
  Lock,
  LogOut,

} from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button as UiButton } from "@/components/ui/button";
import { useApiKeyStore } from '@/store/api-key-store';
import { fetcher } from '@/lib/fetcher';
import { TokenBadge } from "@/components/shared/TokenBadge";

export interface TokenPerformanceTabProps {
  walletAddress: string;
  isAnalyzingGlobal: boolean;
  triggerAnalysisGlobal: () => void;
  onInitialLoad?: (info: { hasData: boolean }) => void;
  onMutateReady?: (mutate: () => Promise<void>) => void; // NEW: Expose mutate to parent
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
  // REMOVED: 'marketCapUsd' - not supported by backend
];

// This definition should be outside the component to prevent re-creation on every render.
// TanStack Table Column Definitions
const createColumns = (): ColumnDef<TokenPerformanceDataDto>[] => [
  {
    accessorKey: 'tokenAddress',
    header: 'Token',
    cell: ({ row }) => {
      const item = row.original;
      const riskLevel = item.spamRiskLevel ?? 'safe';
      const riskScore = item.spamRiskScore ?? 0;
      const primaryReason = item.spamPrimaryReason ?? (riskLevel === 'safe' ? 'Low risk indicators detected' : 'Flagged for review');
      const totalPnl = item.totalPnlSol ?? 0;
      const roi = item.totalSolSpent && item.totalSolSpent !== 0 ? (totalPnl / item.totalSolSpent) * 100 : (totalPnl > 0 ? Infinity : totalPnl < 0 ? -Infinity : 0);
      
      return (
        <div className="flex items-center gap-3">
          <TokenBadge
            mint={item.tokenAddress}
            metadata={{
              name: item.onchainName || item.name || undefined,
              symbol: item.onchainSymbol || item.symbol || undefined,
              // FIXED: Prioritize onchainImageUrl (IPFS) over imageUrl (DexScreener CDN)
              imageUrl: item.onchainImageUrl || item.imageUrl || undefined,
              websiteUrl: item.websiteUrl || item.onchainWebsiteUrl || undefined,
              twitterUrl: item.twitterUrl || item.onchainTwitterUrl || undefined,
              telegramUrl: item.telegramUrl || item.onchainTelegramUrl || undefined,
            }}
            size="lg"
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            {riskLevel === 'high-risk' ? (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800">
                      <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-48 bg-slate-900 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-white dark:text-slate-900 text-xs font-medium">
                    <div className="space-y-1">
                      <p className="text-red-400 dark:text-red-600 font-semibold">Risk ({riskScore}%)</p>
                      <p>{primaryReason}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (!item.name || !item.symbol || item.name === 'Unknown Token') && riskLevel === 'safe' ? (
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
      );
    },
    meta: { className: 'sticky left-0 z-10 w-[240px] md:w-[280px] text-left pl-4 pr-3' },
  },
  {
    accessorKey: 'totalPnlSol',
    header: 'Total PNL (SOL)',
    cell: ({ row }) => formatPnl(row.original.totalPnlSol),
    meta: { className: 'text-right px-2 min-w-[120px]' },
  },
  {
    accessorFn: (row) => {
      const totalPnl = row.totalPnlSol ?? 0;
      const totalSpent = row.totalSolSpent ?? 0;
      // Match backend sorting logic: when no investment was made, use specific values for proper sorting
      if (totalSpent === 0) {
        return totalPnl > 0 ? Infinity : totalPnl < 0 ? -Infinity : 0;
      }
      return (totalPnl / totalSpent) * 100;
    },
    id: 'roi',
    header: 'ROI (%)',
    cell: ({ row }) => {
      const item = row.original;
      const totalPnl = item.totalPnlSol ?? 0;
      const totalSpent = item.totalSolSpent ?? 0;
      
      // No investment made - show N/A instead of confusing 0%
      if (totalSpent === 0) {
        return <span className="text-slate-400 dark:text-slate-500 text-sm">N/A</span>;
      }
      
      const roi = (totalPnl / totalSpent) * 100;
      return roi === Infinity ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">∞</span> : roi === -Infinity ? <span className="text-red-500 dark:text-red-400 font-semibold">-∞</span> : formatPercentage(roi);
    },
    meta: { className: 'text-right px-2 min-w-[90px]' },
  },
  {
    accessorKey: 'totalSolSpent',
    header: 'SOL Spent',
    cell: ({ row }) => <Text className={cn("text-sm font-mono font-medium", (row.original.totalSolSpent ?? 0) > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-slate-500')}>{formatSolAmount(row.original.totalSolSpent)}</Text>,
    meta: { className: 'text-right px-2 min-w-[100px]' },
  },
  {
    accessorKey: 'totalSolReceived',
    header: 'SOL Received',
    cell: ({ row }) => <Text className={cn("text-sm font-mono font-medium", (row.original.totalSolReceived ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500')}>{formatSolAmount(row.original.totalSolReceived)}</Text>,
    meta: { className: 'text-right px-2 min-w-[110px]' },
  },
  {
    accessorKey: 'currentBalanceDisplay',
    header: 'Current Balance',
    cell: ({ row }) => {
      const item = row.original;
      if (item.currentUiBalance === 0) {
        return <Text className="text-sm text-slate-400 dark:text-slate-500 font-medium">-</Text>;
      }
      return (
        <div className="text-right">
          <div className="flex flex-col items-end space-y-0.5">
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
              <Text className="text-sm text-slate-400 dark:text-slate-500 font-medium">? SOL</Text>
            )}
            <Text className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {item.currentUiBalance ? formatTokenDisplayValue(item.currentUiBalance, null) : 'N/A tokens'}
            </Text>
          </div>
        </div>
      );
    },
    meta: { className: 'text-right px-2 min-w-[130px]' },
  },
  {
    accessorKey: 'netSolProfitLoss',
    header: 'Realized PNL (SOL)',
    cell: ({ row }) => {
      const item = row.original;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end space-y-0.5 cursor-help">
                {formatPnl(item.netSolProfitLoss)}
                {item.realizedPnlPercentage !== null && item.realizedPnlPercentage !== undefined && (
                  <div className="flex justify-end">
                    {formatPercentage(item.realizedPnlPercentage)}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <div className="text-sm">
                <p className="font-semibold mb-1">Realized P&L Explanation:</p>
                <p>• <strong>Amount:</strong> SOL received from sales - Cost basis of sold tokens - Fees</p>
                <p>• <strong>Percentage:</strong> Based on total SOL invested</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This is your actual profit/loss from completed trades
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-right px-2 min-w-[140px]' },
  },
  {
    accessorKey: 'unrealizedPnlSol',
    header: 'Unrealized PNL (SOL)',
    cell: ({ row }) => {
      const item = row.original;
      const hasCurrentHoldings = (item.currentUiBalance ?? 0) > 0;
      const unrealizedPnl = item.unrealizedPnlSol ?? 0;
      const unrealizedPercentage = item.unrealizedPnlPercentage ?? 0;
      
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end space-y-0.5 cursor-help">
                {formatPnl(unrealizedPnl)}
                {item.unrealizedPnlPercentage !== null && item.unrealizedPnlPercentage !== undefined && (
                  <div className="flex justify-end">
                    {formatPercentage(unrealizedPercentage)}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <div className="text-sm">
                <p className="font-semibold mb-1">Unrealized P&L Explanation:</p>
                {hasCurrentHoldings ? (
                  <>
                    <p>• <strong>Amount:</strong> Current value - Cost basis of remaining holdings</p>
                    <p>• <strong>Percentage:</strong> Based on cost basis of current holdings only</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Small holdings can show large % changes on tiny amounts
                    </p>
                  </>
                ) : (
                  <p>No current holdings - all P&L is realized</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-right px-2 min-w-[150px]' },
  },
  {
    accessorKey: 'marketCapDisplay',
    header: 'Market Cap',
    cell: ({ row }) => formatMarketCap(row.original.marketCapUsd),
    meta: { className: 'text-right px-2 min-w-[100px]' },
  },
  {
    accessorKey: 'transferCountIn',
    header: 'In',
    cell: ({ row }) => <Text className="text-sm text-center">{row.original.transferCountIn || 0}</Text>,
    meta: { className: 'text-center px-2 min-w-[50px]' },
  },
  {
    accessorKey: 'transferCountOut',
    header: 'Out',
    cell: ({ row }) => <Text className="text-sm text-center">{row.original.transferCountOut || 0}</Text>,
    meta: { className: 'text-center px-2 min-w-[50px]' },
  },
  {
    accessorKey: 'firstTransferTimestamp',
    header: 'First Trade',
    cell: ({ row }) => <Text className="text-sm text-center">{formatDate(row.original.firstTransferTimestamp)}</Text>,
    meta: { className: 'text-center px-2 min-w-[100px]' },
  },
  {
    accessorKey: 'lastTransferTimestamp',
    header: 'Last Trade',
    cell: ({ row }) => <Text className="text-sm text-center">{formatDate(row.original.lastTransferTimestamp)}</Text>,
    meta: { className: 'text-center px-2 min-w-[100px]' },
  },
];

const ESTIMATED_ROW_HEIGHT = 64;

function TokenPerformanceTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal, onInitialLoad, onMutateReady }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore();
  const [page, setPage] = useState(1);
  // Default to a smaller page size to reduce initial render cost and improve interactivity
  const [pageSize, setPageSize] = useState(10);
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [spamFilter, setSpamFilter] = useState<string>('all');
  
  // Use deferred value for search to prevent blocking main thread during typing
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [enrichmentMessage, setEnrichmentMessage] = useState<string | null>(null);
  const fallbackCacheRef = useRef(new Map<string, PaginatedTokenPerformanceResponse>());
  const [fallbackResponse, setFallbackResponse] = useState<PaginatedTokenPerformanceResponse | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const initialLoadNotifiedRef = useRef(false);
  const tableRef = useRef<HTMLTableElement | null>(null);

  useEffect(() => {
    fallbackCacheRef.current.clear();
    setFallbackResponse(null);
    setIsUsingFallback(false);
    setEnrichmentMessage(null);
    initialLoadNotifiedRef.current = false;
  }, [walletAddress]);

  // Set up container for virtualization
  useEffect(() => {
    const wrapper = tableRef.current?.parentElement as HTMLDivElement | null;
    if (!wrapper) {
      return;
    }
    
    // Set styles for proper virtualization
    wrapper.style.overflow = 'auto';
    
    return () => {
      // Cleanup if needed
    };
  }, []);

  // TanStack Table state - RESTORED BACKEND SORTING
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // PERFORMANCE FIX: Improve debouncing for better responsiveness
  const deferredPnlFilter = useDeferredValue(pnlFilter);
  const deferredSpamFilter = useDeferredValue(spamFilter);

  const apiUrlBase = walletAddress ? `/wallets/${walletAddress}/token-performance` : null;
  let swrKey: string | null = null;

  if (apiUrlBase && isInitialized && apiKey) {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('pageSize', pageSize.toString());
    // RESTORED: Backend sorting for global accuracy
    if (BACKEND_SORTABLE_IDS.includes(sortBy)) {
        params.append('sortBy', sortBy);
        params.append('sortOrder', sortOrder);
    }
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());
    if (showHoldingsOnly) params.append('showOnlyHoldings', 'true');
    if (deferredSearchTerm) params.append('searchTerm', deferredSearchTerm);
    if (deferredSpamFilter !== 'all') params.append('spamFilter', deferredSpamFilter);
    
    if (deferredPnlFilter !== 'any') {
      const operatorMatch = deferredPnlFilter.match(/^([><])/);
      const valueMatch = deferredPnlFilter.match(/-?[\d.]+$/);
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
    swrKey ? [swrKey, apiKey] : null,
    ([url]: [string]) => {
      // console.log(`[TokenPerformance] 🔄 Fetching data:`, {
      //   url,
      //   startDate: startDate?.toISOString(),
      //   endDate: endDate?.toISOString(),
      //   timestamp: new Date().toISOString()
      // });
      return fetcher(url);
    },
    {
      revalidateOnFocus: false,
      keepPreviousData: false, // CHANGED: Don't show stale data - prevents showing old images
      dedupingInterval: 3000, // CHANGED: 3 seconds - faster cache updates after enrichment
      revalidateOnReconnect: false, // Prevent revalidation on network reconnect
      revalidateIfStale: true, // CHANGED: Allow revalidation when cache is stale
      onSuccess: (data) => {
        // console.log(`[TokenPerformance] ✅ Data received:`, {
        //   tokenCount: data?.data?.length || 0,
        //   hasImages: data?.data?.filter(t => t.onchainImageUrl || t.imageUrl).length || 0,
        //   timestamp: new Date().toISOString()
        // });
      },
      onError: (err) => {
        console.error(`[TokenPerformance] ❌ Fetch error:`, err);
      }
    }
  );

  useEffect(() => {
    if (!swrKey) {
      if (!isAnalyzingGlobal) {
        setFallbackResponse(null);
        setIsUsingFallback(false);
        setEnrichmentMessage(null);
      }
      return;
    }

    if (data && data.data.length > 0) {
      fallbackCacheRef.current.set(swrKey, data);
      setFallbackResponse(null);
      setIsUsingFallback(false);
      if (!isAnalyzingGlobal) {
        setEnrichmentMessage(null);
      }
      return;
    }

    if (data && data.data.length === 0) {
      if (isAnalyzingGlobal) {
        const cached = fallbackCacheRef.current.get(swrKey);
        if (cached) {
          setFallbackResponse(cached);
          setIsUsingFallback(true);
          setEnrichmentMessage((prev) => prev ?? 'Showing previous analysis while new data syncs...');
          return;
        }
      } else {
        fallbackCacheRef.current.delete(swrKey);
        setEnrichmentMessage(null);
      }
    }

    if (!isAnalyzingGlobal) {
      setFallbackResponse(null);
      setIsUsingFallback(false);
      setEnrichmentMessage(null);
    }
  }, [data, swrKey, isAnalyzingGlobal]);

  const effectiveResponse = useMemo<PaginatedTokenPerformanceResponse | null>(() => {
    if (isUsingFallback && fallbackResponse) {
      return fallbackResponse;
    }
    return data ?? null;
  }, [data, fallbackResponse, isUsingFallback]);

  const tableData = useMemo(() => effectiveResponse?.data || [], [effectiveResponse]);
  const hasTableData = tableData.length > 0;
  const totalItems = effectiveResponse?.total ?? 0;
  const totalPages = effectiveResponse?.totalPages ?? 0;
  const currentPage = effectiveResponse?.page ?? page;

  useEffect(() => {
    if (!onInitialLoad || initialLoadNotifiedRef.current) {
      return;
    }
    if (isLoadingData && !effectiveResponse && !isUsingFallback && !error) {
      return;
    }

    initialLoadNotifiedRef.current = true;
    onInitialLoad({ hasData: hasTableData });
  }, [onInitialLoad, effectiveResponse, isLoadingData, isUsingFallback, hasTableData, error]);

  useEffect(() => {
    if (isAnalyzingGlobal) {
      setEnrichmentMessage((prev) => prev ?? 'Syncing latest token data...');
    } else if (!isUsingFallback) {
      setEnrichmentMessage(null);
    }
  }, [isAnalyzingGlobal, isUsingFallback]);

  // PERFORMANCE FIX: Columns reference server-provided risk metadata; generate once
  const columns = useMemo(() => createColumns(), []);

  // PERFORMANCE FIX: Memoize table configuration to prevent unnecessary re-creation
  const tableConfig = useMemo(() => ({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: setColumnFilters,
    state: {
      columnFilters,
    },
    enableSorting: false,
  }), [tableData, columns, columnFilters]);

  // TanStack Table instance - SYNCED WITH BACKEND SORTING
  const table = useReactTable(tableConfig);
  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableRef.current?.parentElement ?? null,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    scrollPaddingStart: 8,
    scrollPaddingEnd: 8,
  });

  useEffect(() => {
    const wrapper = tableRef.current?.parentElement;
    if (wrapper) {
      wrapper.scrollTop = 0;
    }
  }, [currentPage, tableRows.length]);

  // Effect for initial load and wallet change - REMOVED automatic enrichment trigger
  // Enrichment should only be triggered manually or by the dashboard analysis job
  useEffect(() => {
    if (walletAddress && swrKey) {
      // Only refresh data, don't trigger enrichment automatically
      // Use SWR's built-in revalidation instead of manual mutate
      // This prevents multiple calls
    }
  }, [walletAddress, apiKey]); // Removed localMutate from dependencies

  // Effect to auto-refresh when analysis completes
  const prevAnalyzingRef = useRef(isAnalyzingGlobal);
  useEffect(() => {
    const wasAnalyzing = prevAnalyzingRef.current;
    const isAnalyzingNow = isAnalyzingGlobal;
    
    // Analysis just completed (was true, now false)
    if (wasAnalyzing && !isAnalyzingNow && swrKey) {
      localMutate();
    }
    
    prevAnalyzingRef.current = isAnalyzingNow;
  }, [isAnalyzingGlobal, swrKey, localMutate]);

  // PERFORMANCE FIX: Memoize handlers to prevent unnecessary re-renders
  const handlePnlFilterChange = useCallback((newValue: string) => {
    startTransition(() => {
      setPnlFilter(newValue);
      setPage(1);
    });
  }, []);

  const handleMinTradesToggleChange = useCallback((checked: boolean) => {
    startTransition(() => {
      setMinTradesToggle(checked);
      setPage(1);
    });
  }, []);

  const handleShowHoldingsToggleChange = useCallback((checked: boolean) => {
    startTransition(() => {
      setShowHoldingsOnly(checked);
      setPage(1);
      // Force refresh when toggling holdings filter to ensure fresh data
      localMutate();
    });
  }, [localMutate]);

  // RESTORED: handleSort function to sync TanStack Table with backend sorting
const handleSort = useCallback((columnId: string) => {
    // Map frontend column IDs to backend field names
    const fieldMapping: Record<string, string> = {
      'currentBalanceDisplay': 'currentSolValue'  // Sort by SOL value, not token amount
      // REMOVED: 'marketCapDisplay': 'marketCapUsd' - not supported by backend
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
  }, [sortBy, sortOrder]);
  
  const handleSearchTermChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Immediate update for responsive typing experience
    setSearchTerm(e.target.value);
    // Page reset in transition to avoid blocking
    startTransition(() => {
      setPage(1);
    });
  }, []);

  const handleSpamFilterChange = useCallback((newValue: string) => {
    startTransition(() => {
      setSpamFilter(newValue);
      setPage(1);
    });
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    const maxPage = totalPages || Math.ceil(totalItems / pageSize) || 1;
    if (newPage > 0 && newPage <= maxPage) {
      setPage(newPage);
    }
  }, [totalPages, totalItems, pageSize]);

  const handleRefresh = useCallback(async () => {
    if (isLoadingData) return;
    setIsRefreshing(true);
    try {
      // console.log('[TokenPerformance] 🔄 Manual refresh triggered');
      // Refresh the main data only
      await localMutate();
      // console.log('[TokenPerformance] ✅ Manual refresh complete');
      // Enrichment is now handled by the dashboard analysis job or manual trigger
    } finally {
      setIsRefreshing(false);
    }
  }, [isLoadingData, localMutate]);

  // NEW: Expose mutate function to parent for cache invalidation
  useEffect(() => {
    if (onMutateReady && localMutate) {
      const mutateWrapper = async () => {
        // console.log('[TokenPerformance] 🔄 Parent-triggered refetch starting');
        await localMutate();
        // console.log('[TokenPerformance] ✅ Parent-triggered refetch complete');
      };
      onMutateReady(mutateWrapper);
    }
  }, [onMutateReady, localMutate]);

  // PERFORMANCE FIX: Memoize skeleton rendering to prevent unnecessary re-creation
  const renderSkeletonTableRows = useCallback(() => {
    return Array.from({ length: 3 }).map((_, rowIndex) => (
      <TableRow key={`skeleton-row-${rowIndex}`} style={{ height: `${ESTIMATED_ROW_HEIGHT}px` }}>
        {table.getAllColumns().map((column, colIndex) => (
          <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`} className={cn((column.columnDef.meta as any)?.className, column.id === 'tokenAddress' && 'sticky left-0 z-10 bg-card dark:bg-dark-tremor-background-default')}>
            <Skeleton className={cn("h-5", column.id === 'tokenAddress' ? "w-3/4" : "w-full")} />
          </TableCell>
        ))}
      </TableRow>
    ));
  }, [table]);

  const renderTableContent = () => {
    // If SWR is loading and we have no cached data, show the skeleton.
    if (isLoadingData && tableData.length === 0 && !error) {
      return <TableBody>{renderSkeletonTableRows()}</TableBody>;
    }

    // If we have an error, show the error state.
    if (error) {
      return <TableBody><TableRow><TableCell colSpan={table.getAllColumns().length}><EmptyState variant="error" title="Error Loading Data" description={error.message} /></TableCell></TableRow></TableBody>;
    }
    
    // Remove duplicate analyzing state - progress is shown in main layout
    // if (isAnalyzingGlobal && !tableData.length) {
    //   return <TableBody><TableRow><TableCell colSpan={table.getAllColumns().length}><EmptyState variant="default" icon={Loader2} title="Analyzing Wallet..." description="Please wait while the wallet analysis is in progress. Token performance data will update shortly." className="my-8" /></TableCell></TableRow></TableBody>;
    // }

    // If there's no data, check if we're enriching before declaring "No Token Data".
    if (tableData.length === 0) {
      if (isAnalyzingGlobal) {
        return <TableBody>{renderSkeletonTableRows()}</TableBody>;
      }
      const hasDateFilter = startDate || endDate;
      const emptyMessage = hasDateFilter
        ? "No token activity or missing token data. Try expanding the date range, selecting 'All' or hit Refresh."
        : "No token activity detected for the selected filters.";

      return <TableBody><TableRow><TableCell colSpan={table.getAllColumns().length}><EmptyState variant="default" icon={BarChartBig} title="No Token Data?" description={emptyMessage} className="my-8" /></TableCell></TableRow></TableBody>;
    }

    const virtualRows = rowVirtualizer.getVirtualItems();
    const totalColumns = table.getAllColumns().length;
    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const paddingBottom =
      virtualRows.length > 0
        ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
        : 0;

    return (
      <TableBody>
        {paddingTop > 0 && (
          <TableRow style={{ height: `${paddingTop}px` }} aria-hidden="true">
            <TableCell colSpan={totalColumns} />
          </TableRow>
        )}
        {virtualRows.map((virtualRow) => {
          const row = tableRows[virtualRow.index];
          return (
            <TableRow
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50"
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={(cell.column.columnDef.meta as any)?.className}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
        {paddingBottom > 0 && (
          <TableRow style={{ height: `${paddingBottom}px` }} aria-hidden="true">
            <TableCell colSpan={totalColumns} />
          </TableRow>
        )}
      </TableBody>
    );
  };
  
  const renderPaginationItems = () => {
    if (!totalPages) return null;
    const items = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    if (endPage - startPage + 1 < maxPagesToShow) { startPage = Math.max(1, endPage - maxPagesToShow + 1); }
    if (startPage > 1) { items.push(<PaginationItem key="start-ellipsis"><PaginationLink onClick={() => handlePageChange(startPage - 1)} className="h-7 w-7 p-0 text-xs">...</PaginationLink></PaginationItem>); }
    for (let i = startPage; i <= endPage; i++) { items.push(<PaginationItem key={i}><PaginationLink onClick={() => handlePageChange(i)} isActive={currentPage === i} className="h-7 min-w-7 px-1 text-xs">{i}</PaginationLink></PaginationItem>); }
    if (endPage < totalPages) { items.push(<PaginationItem key="end-ellipsis"><PaginationLink onClick={() => handlePageChange(endPage + 1)} className="h-7 w-7 p-0 text-xs">...</PaginationLink></PaginationItem>); }
    return items;
  };

  if (!walletAddress) {
    return <Card className="p-4 md:p-6 mt-4"><EmptyState variant="info" icon={InfoIcon} title="No Wallet Selected" description="Please select a wallet to view token performance." /></Card>;
  }

  return (
    <div className="flex flex-col h-full w-full">
      <Card className="p-0 md:p-0 mt-0 flex flex-col border border-slate-200 dark:border-slate-700 shadow-sm flex-1 min-h-0">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-shrink-0">
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
      <div className="overflow-auto bg-white dark:bg-slate-900 flex-1 min-h-0">
        <Table ref={tableRef} className="min-w-full">
          <TableHeader className="bg-slate-50 dark:bg-slate-800">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-slate-200 dark:border-slate-700">
                {headerGroup.headers.map((header) => (
                  <TableHead 
                    key={header.id} 
                    className={cn(
                      "font-semibold text-slate-700 dark:text-slate-300 text-sm h-10",
                      (header.column.columnDef.meta as any)?.className,
                      header.column.id === 'tokenAddress' && 'sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 shadow-sm',
                      (() => {
                        const columnId = header.column.id;
                        const fieldMapping: Record<string, string> = {
                          'currentBalanceDisplay': 'currentSolValue'
                          // REMOVED: 'marketCapDisplay': 'marketCapUsd' - not supported by backend
                        };
                        const backendField = fieldMapping[columnId] || columnId;
                        return BACKEND_SORTABLE_IDS.includes(backendField) && 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors';
                      })()
                    )}
                    onClick={() => {
                      const columnId = header.column.id;
                      const fieldMapping: Record<string, string> = {
                        'currentBalanceDisplay': 'currentSolValue'
                        // REMOVED: 'marketCapDisplay': 'marketCapUsd' - not supported by backend
                      };
                      const backendField = fieldMapping[columnId] || columnId;
                      if (BACKEND_SORTABLE_IDS.includes(backendField)) {
                        handleSort(columnId);
                      }
                    }}
                  >
                    <Flex alignItems="center" justifyContent={(header.column.columnDef.meta as any)?.className?.includes('text-right') ? 'end' : (header.column.columnDef.meta as any)?.className?.includes('text-center') ? 'center' : 'start'} className="gap-1.5 h-full">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {(() => {
                        const columnId = header.column.id;
                        const fieldMapping: Record<string, string> = {
                          'currentBalanceDisplay': 'currentSolValue'
                          // REMOVED: 'marketCapDisplay': 'marketCapUsd' - not supported by backend
                        };
                        const backendField = fieldMapping[columnId] || columnId;
                        if (!BACKEND_SORTABLE_IDS.includes(backendField)) return null;
                        
                        return (
                          <span>
                            {sortBy === backendField && sortOrder === 'ASC' ? <ArrowUpRight className="h-4 w-4" /> : 
                             sortBy === backendField && sortOrder === 'DESC' ? <ArrowDownRight className="h-4 w-4" /> : null}
                          </span>
                        );
                      })()}
                    </Flex>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          {renderTableContent()}
        </Table>
      </div>

      {totalPages > 0 && tableData.length > 0 && (
        <div className="px-4 py-3 border-t flex-shrink-0">
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Per Page:</span>
              <Select value={pageSize.toString()} onValueChange={(value) => startTransition(() => { setPageSize(Number(value)); setPage(1); })}>
                <SelectTrigger className="w-16 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 flex justify-center">
              <Pagination>
                <PaginationContent className="gap-1">
                  <PaginationItem><UiButton variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handlePageChange(1)} disabled={currentPage === 1} aria-label="Go to first page"><ChevronsLeft className="h-3 w-3" /></UiButton></PaginationItem>
                  <PaginationItem><PaginationPrevious onClick={() => handlePageChange(currentPage - 1)} className={cn("h-7 px-2 text-xs", currentPage === 1 && "pointer-events-none opacity-50")} /></PaginationItem>
                  {renderPaginationItems()}
                  <PaginationItem><PaginationNext onClick={() => handlePageChange(currentPage + 1)} className={cn("h-7 px-2 text-xs", (totalPages === 0 || currentPage === totalPages) && "pointer-events-none opacity-50")} /></PaginationItem>
                  <PaginationItem><UiButton variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handlePageChange(totalPages)} disabled={totalPages === 0 || currentPage === totalPages} aria-label="Go to last page"><ChevronsRight className="h-3 w-3" /></UiButton></PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
            <div className="flex-shrink-0 w-16"></div>
          </div>
        </div>
      )}
    </Card>
    </div>
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



// Memoize the component to prevent unnecessary re-renders
export default memo(TokenPerformanceTab);
