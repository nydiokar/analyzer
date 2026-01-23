"use client";

import React, { useState, useMemo, useCallback, useEffect, memo, useDeferredValue, useRef } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../../components/ui/table";
import { Input } from "@/components/ui/input";
import { useInView } from 'react-intersection-observer';
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
import {
  InfoIcon,
  ChevronUp,
  ChevronDown,
  Loader2,
  RefreshCwIcon,
  BarChartBig,
  AlertTriangle,
} from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import EmptyState from '@/components/shared/EmptyState';
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button as UiButton } from "@/components/ui/button";
import { fetcher } from '@/lib/fetcher';
import { TokenBadge } from "@/components/shared/TokenBadge";

export interface TokenPerformanceTabProps {
  walletAddress: string;
  isAnalyzingGlobal: boolean;
  triggerAnalysisGlobal: () => void;
  onInitialLoad?: (info: { hasData: boolean }) => void;
  onMutateReady?: (mutate: () => Promise<void>) => void; // NEW: Expose mutate to parent
  tokenAddressesFilter?: string | string[]; // Optional: comma-separated string OR array of token addresses to filter by
  defaultSortBy?: string; // Optional: default sort field
  defaultSortOrder?: 'ASC' | 'DESC'; // Optional: default sort order
}

// Define Profit filter options
const PROFIT_FILTER_OPTIONS = [
  { value: 'any', label: 'Any Profit' },
  { value: '>0', label: 'Profit > 0' },
  { value: '<0', label: 'Loss < 0' },
  { value: '>10', label: 'Profit > 10' },
  { value: '<-10', label: 'Loss < -10' },
  { value: '>100', label: 'Profit > 100' },
  { value: '<-100', label: 'Loss < -100' },
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
  'realizedPnlSol',
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
// TanStack Table Column Definitions - REDESIGNED for better UX
const createColumns = (): ColumnDef<TokenPerformanceDataDto>[] => [
  {
    accessorKey: 'tokenAddress',
    header: 'Token / Last Active',
    cell: ({ row }) => {
      const item = row.original;
      const riskLevel = item.spamRiskLevel ?? 'safe';
      const riskScore = item.spamRiskScore ?? 0;
      const lastActive = item.lastTransferTimestamp;
      const lastActiveFormatted = formatRelativeTimeCompact(lastActive);

      return (
        <div className="flex items-center gap-1 min-w-0">
          <TokenBadge
            mint={item.tokenAddress}
            metadata={{
              name: item.name || undefined,
              symbol: item.symbol || undefined,
              imageUrl: item.imageUrl || undefined,
              websiteUrl: item.websiteUrl || undefined,
              twitterUrl: item.twitterUrl || undefined,
              telegramUrl: item.telegramUrl || undefined,
              onchainName: item.onchainName || undefined,
              onchainSymbol: item.onchainSymbol || undefined,
              onchainImageUrl: item.onchainImageUrl || undefined,
              onchainWebsiteUrl: item.onchainWebsiteUrl || undefined,
              onchainTwitterUrl: item.onchainTwitterUrl || undefined,
              onchainTelegramUrl: item.onchainTelegramUrl || undefined,
              marketCapUsd: item.marketCapUsd || undefined,
            }}
            variant="inline"
            size="s"
            className="flex-1 min-w-0 overflow-hidden"
          />
          {lastActive && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground/70 font-mono whitespace-nowrap cursor-help">
                    {lastActiveFormatted}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-semibold mb-1">Last Active</p>
                  <p>{new Date(lastActive * 1000).toLocaleString()}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {riskLevel === 'high-risk' && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center w-3 h-3 rounded-full bg-red-100 dark:bg-red-900/40">
                      <AlertTriangle className="h-2 w-2 text-red-600 dark:text-red-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="text-red-400 font-semibold">Risk {riskScore}%</p>
                    <p>{item.spamPrimaryReason || 'High risk token'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      );
    },
    meta: { className: 'sticky left-0 z-10 w-[180px] max-w-[180px] text-left pl-2 pr-1' },
  },
  {
    accessorKey: 'totalPnlSol',
    header: 'Total Profit',
    cell: ({ row }) => {
      const item = row.original;
      const totalSpent = item.totalSolSpent ?? 0;
      const totalProfit = item.totalPnlSol;

      // ROI FIX: Don't show ROI for dust trades (< 0.01 SOL spent)
      const DUST_THRESHOLD = 0.01;
      const isDustTrade = totalSpent < DUST_THRESHOLD;

      // Calculate ROI based on corrected total profit
      const roi = totalProfit !== null && totalProfit !== undefined && !isDustTrade && totalSpent !== 0
        ? (totalProfit / totalSpent) * 100
        : null;

      return (
        <div className="flex flex-col items-start space-y-0">
          {formatPnl(totalProfit)}
          {roi !== null && isFinite(roi) && (
            <div className="flex justify-start">
              {formatPercentage(roi)}
            </div>
          )}
        </div>
      );
    },
    meta: { className: 'text-left px-1 w-[90px] max-w-[90px]' },
  },
  {
    accessorKey: 'realizedPnlSol',
    header: 'Realized',
    cell: ({ row }) => {
      const item = row.original;
      const realizedValue = item.realizedPnlSol;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-start space-y-0 cursor-help">
                {formatPnl(realizedValue)}
                {item.realizedPnlPercentage !== null && item.realizedPnlPercentage !== undefined && (
                  <div className="flex justify-start">
                    {formatPercentage(item.realizedPnlPercentage)}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold mb-1">Realized P&L</p>
              <p>Profit/loss from <span className="text-emerald-600 dark:text-emerald-400">completed</span> trades</p>
              <p className="text-muted-foreground mt-1">Actual SOL received minus cost & fees</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-left px-1 w-[90px] max-w-[90px]' },
  },
  {
    accessorKey: 'unrealizedPnlSol',
    header: 'Unrealized',
    cell: ({ row }) => {
      const item = row.original;
      const hasCurrentHoldings = (item.currentUiBalance ?? 0) > 0;

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-start space-y-0 cursor-help">
                {formatPnl(item.unrealizedPnlSol)}
                {item.unrealizedPnlPercentage !== null && item.unrealizedPnlPercentage !== undefined && (
                  <div className="flex justify-start">
                    {formatPercentage(item.unrealizedPnlPercentage)}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold mb-1">Unrealized P&L</p>
              {hasCurrentHoldings ? (
                <>
                  <p>Profit/loss from <span className="text-orange-600 dark:text-orange-400">current</span> holdings</p>
                  <p className="text-muted-foreground mt-1">Current value minus cost basis</p>
                </>
              ) : (
                <p className="text-muted-foreground">No current holdings</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-left px-1 w-[95px] max-w-[95px]' },
  },
  {
    accessorKey: 'totalSolSpent',
    header: 'Bought',
    cell: ({ row }) => (
      <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
        {formatSolAmount(row.original.totalSolSpent)} SOL
      </span>
    ),
    meta: { className: 'text-left px-1 w-[75px] max-w-[75px]' },
  },
  {
    accessorKey: 'totalSolReceived',
    header: 'Sold',
    cell: ({ row }) => (
      <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
        {formatSolAmount(row.original.totalSolReceived)} SOL
      </span>
    ),
    meta: { className: 'text-left px-1 w-[75px] max-w-[75px]' },
  },
  {
    accessorKey: 'currentBalanceDisplay',
    header: 'Balance',
    cell: ({ row }) => {
      const item = row.original;
      if (item.currentUiBalance === 0) {
        return <span className="text-xs text-slate-400 dark:text-slate-500">-</span>;
      }
      return (
        <div className="flex flex-col items-start space-y-0">
          {item.currentHoldingsValueSol ? (
            <span
              className={cn(
                "text-xs font-mono font-semibold",
                item.currentHoldingsValueSol >= 1
                  ? "text-orange-600 dark:text-orange-400" // Significant position
                  : item.currentHoldingsValueSol >= 0.1
                    ? "text-slate-700 dark:text-slate-300" // Medium position
                    : "text-slate-500 dark:text-slate-400" // Small position
              )}
            >
              {formatSolAmount(item.currentHoldingsValueSol)} SOL
            </span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">?</span>
          )}
          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[60px]">
            {item.currentUiBalance ? formatTokenDisplayValue(item.currentUiBalance, null) : 'N/A'}
          </span>
        </div>
      );
    },
    meta: { className: 'text-left px-1 w-[85px] max-w-[85px]' },
  },
  {
    accessorKey: 'transferCountIn',
    header: 'Trades',
    cell: ({ row }) => {
      const inCount = row.original.transferCountIn || 0;
      const outCount = row.original.transferCountOut || 0;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-left block font-mono cursor-help">
                <span className="text-emerald-600 dark:text-emerald-400">{inCount}</span>
                <span className="text-slate-400 dark:text-slate-500">/</span>
                <span className="text-red-600 dark:text-red-400">{outCount}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold mb-1">Trade Count</p>
              <p><span className="text-emerald-600">Buys</span> / <span className="text-red-600">Sells</span></p>
              <p className="text-muted-foreground mt-1">Number of buy and sell transactions</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-left px-1 w-[50px] max-w-[50px]' },
  },
  {
    accessorKey: 'firstTransferTimestamp',
    header: 'First Seen',
    cell: ({ row }) => {
      const timestamp = row.original.firstTransferTimestamp;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-center block cursor-help">{formatDate(timestamp)}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold mb-1">First Activity</p>
              <p>First time this token appeared in wallet</p>
              <p className="text-muted-foreground mt-1">Based on transaction history</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { className: 'text-center px-1 w-[85px] max-w-[85px]' },
  },
];

function TokenPerformanceTab({
  walletAddress,
  isAnalyzingGlobal,
  triggerAnalysisGlobal,
  onInitialLoad,
  onMutateReady,
  tokenAddressesFilter,
  defaultSortBy = 'lastTransferTimestamp',
  defaultSortOrder = 'DESC',
}: TokenPerformanceTabProps) {
  // TIME FILTER: Pass to backend for hasActivityInPeriod calculation, but don't cache on it
  const { startDate, endDate } = useTimeRangeStore();

  // Infinite scroll pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50); // Load 50 tokens per page
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState(true);

  // Accumulated tokens from all loaded pages
  const [allTokens, setAllTokens] = useState<TokenPerformanceDataDto[]>([]);

  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [spamFilter, setSpamFilter] = useState<string>('all');

  // TanStack Table state - use props or default to Last Active (most recent first)
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortOrder, setSortOrder] = useState(defaultSortOrder);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Use deferred value for search to prevent blocking main thread during typing
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // PERFORMANCE FIX: Improve debouncing for better responsiveness
  const deferredPnlFilter = useDeferredValue(pnlFilter);
  const deferredSpamFilter = useDeferredValue(spamFilter);

  const [enrichmentMessage, setEnrichmentMessage] = useState<string | null>(null);
  const fallbackCacheRef = useRef(new Map<string, PaginatedTokenPerformanceResponse>());
  const [fallbackResponse, setFallbackResponse] = useState<PaginatedTokenPerformanceResponse | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const initialLoadNotifiedRef = useRef(false);

  const querySignature = useMemo(() => JSON.stringify({
    walletAddress,
    sortBy,
    sortOrder,
    showHoldingsOnly,
    search: deferredSearchTerm,
    spam: deferredSpamFilter,
    pnl: deferredPnlFilter,
    minTrades: minTradesToggle,
    startDate: startDate?.toISOString() ?? null,
    endDate: endDate?.toISOString() ?? null,
    tokenAddressesFilter,
  }), [
    walletAddress,
    sortBy,
    sortOrder,
    showHoldingsOnly,
    deferredSearchTerm,
    deferredSpamFilter,
    deferredPnlFilter,
    minTradesToggle,
    startDate,
    endDate,
    tokenAddressesFilter,
  ]);

  const lastQuerySignatureRef = useRef<string>('');
  const effectivePage = lastQuerySignatureRef.current === querySignature ? page : 1;

  // Reset ALL state when wallet or filters change
  useEffect(() => {
    if (lastQuerySignatureRef.current === querySignature) {
      return;
    }
    lastQuerySignatureRef.current = querySignature;
    fallbackCacheRef.current.clear();
    setFallbackResponse(null);
    setIsUsingFallback(false);
    setEnrichmentMessage(null);
    initialLoadNotifiedRef.current = false;

    // Reset pagination and tokens
    setPage(1);
    setAllTokens([]);
    setHasMore(true);
  }, [querySignature]);

  const apiUrlBase = walletAddress ? `/wallets/${walletAddress}/token-performance` : null;
  let swrKey: string | null = null;
  let fetchUrl: string | null = null;

  if (apiUrlBase) {
    // Build params for ACTUAL API call (includes time filter and sorting)
    const fetchParams = new URLSearchParams();
    fetchParams.append('page', effectivePage.toString());
    fetchParams.append('pageSize', pageSize.toString());

    // IMPORTANT: Include time filter for backend's hasActivityInPeriod calculation
    if (startDate) fetchParams.append('startDate', startDate.toISOString());
    if (endDate) fetchParams.append('endDate', endDate.toISOString());

    // Backend sorting - sorts ALL tokens before pagination
    fetchParams.append('sortBy', sortBy);
    fetchParams.append('sortOrder', sortOrder);

    if (showHoldingsOnly) fetchParams.append('showOnlyHoldings', 'true');
    if (deferredSearchTerm) fetchParams.append('searchTerm', deferredSearchTerm);
    if (deferredSpamFilter !== 'all') fetchParams.append('spamFilter', deferredSpamFilter);

    if (deferredPnlFilter !== 'any') {
      const operatorMatch = deferredPnlFilter.match(/^([><])/);
      const valueMatch = deferredPnlFilter.match(/-?[\d.]+$/);
      if (operatorMatch && valueMatch) {
        const opMap: { [key: string]: string } = { '>': 'gt', '<': 'lt' };
        fetchParams.append('pnlConditionOperator', opMap[operatorMatch[1]]);
        fetchParams.append('pnlConditionValue', valueMatch[0]);
      }
    }

    if (minTradesToggle) {
      fetchParams.append('minTrades', '2');
    }

    // Add token address filter if provided
    if (tokenAddressesFilter) {
      const tokenAddresses = Array.isArray(tokenAddressesFilter)
        ? tokenAddressesFilter.join(',')
        : tokenAddressesFilter;
      fetchParams.append('tokenAddresses', tokenAddresses);
    }

    fetchUrl = `${apiUrlBase}?${fetchParams.toString()}`;

    // SWR cache key includes page number for infinite scroll
    swrKey = fetchUrl;
  }

  const { data, error, isLoading: isLoadingData, mutate: localMutate } = useSWR<PaginatedTokenPerformanceResponse, Error>(
    swrKey ? [swrKey] : null,
    // Use fetchUrl (with time filter) instead of cache key for actual API call
    () => fetchUrl ? fetcher(fetchUrl) : Promise.reject(new Error('No fetch URL')),
    {
      revalidateOnFocus: false,
      keepPreviousData: false,
      dedupingInterval: 3000,
      revalidateOnReconnect: false,
      revalidateIfStale: true,
      onError: (err) => {
        console.error(`[TokenPerformance] ❌ Fetch error:`, err);
      }
    }
  );

  // Accumulate pages for infinite scroll
  useEffect(() => {
    if (!data) return;

    // If page 1, replace all tokens (fresh start)
    if ((data.page ?? effectivePage) === 1) {
      setAllTokens(data.data);
    } else {
      // Append new page to existing tokens
      setAllTokens(prev => [...prev, ...data.data]);
    }

    // Check if there are more pages
    const totalLoaded = (data.page ?? effectivePage) * pageSize;
    setHasMore(totalLoaded < (data.total || 0));
  }, [data, effectivePage, pageSize]);

  // Backend handles sorting - just use accumulated tokens
  const tableData = useMemo(() => allTokens, [allTokens]);

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

  const hasTableData = tableData.length > 0;
  const totalItems = effectiveResponse?.total ?? 0;

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

  // TanStack Table instance
  const table = useReactTable(tableConfig);
  const tableRows = table.getRowModel().rows;

  // Intersection observer for infinite scroll
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: '200px', // Trigger 200px before reaching bottom
  });

  // Load more when scrolled near bottom
  useEffect(() => {
    if (inView && hasMore && !isLoadingData && page > 0) {
      setPage(prev => prev + 1);
    }
  }, [inView, hasMore, isLoadingData, page]);

  // Effect for initial load and wallet change - REMOVED automatic enrichment trigger
  // Enrichment should only be triggered manually or by the dashboard analysis job
  useEffect(() => {
    if (walletAddress && swrKey) {
      // Only refresh data, don't trigger enrichment automatically
      // Use SWR's built-in revalidation instead of manual mutate
      // This prevents multiple calls
    }
  }, [walletAddress]); // Removed localMutate from dependencies

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
  // Just set state - the reset effect handles page reset and data clearing
  const handlePnlFilterChange = useCallback((newValue: string) => {
    setPnlFilter(newValue);
  }, []);

  const handleMinTradesToggleChange = useCallback((checked: boolean) => {
    setMinTradesToggle(checked);
  }, []);

  const handleShowHoldingsToggleChange = useCallback((checked: boolean) => {
    setShowHoldingsOnly(checked);
  }, []);

  // RESTORED: handleSort function to sync TanStack Table with backend sorting
const handleSort = useCallback((columnId: string) => {
    // Map frontend column IDs to backend field names
    const fieldMapping: Record<string, string> = {
      'currentBalanceDisplay': 'currentSolValue',  // Sort by SOL value, not token amount
      'tokenAddress': 'lastTransferTimestamp'  // Token column sorts by Last Active
    };

    const backendField = fieldMapping[columnId] || columnId;

    if (!BACKEND_SORTABLE_IDS.includes(backendField)) return;
    if (sortBy === backendField) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(backendField);
      setSortOrder('DESC');
    }
    // Note: setPage(1) is handled by the reset effect below, no need to call it here
  }, [sortBy, sortOrder]);
  
  const handleSearchTermChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  const handleSpamFilterChange = useCallback((newValue: string) => {
    setSpamFilter(newValue);
  }, []);

  // REMOVED: handlePageChange - no longer needed with infinite scroll

  const handleRefresh = useCallback(async () => {
    if (isLoadingData) return;
    setIsRefreshing(true);
    try {
      // Refresh all data from backend
      await localMutate();
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
    return Array.from({ length: 5 }).map((_, rowIndex) => (
      <TableRow key={`skeleton-row-${rowIndex}`}>
        {table.getAllColumns().map((column, colIndex) => (
          <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`} className={cn("overflow-hidden", (column.columnDef.meta as any)?.className, column.id === 'tokenAddress' && 'sticky left-0 z-10 bg-card dark:bg-dark-tremor-background-default')}>
            <Skeleton className={cn("h-4", column.id === 'tokenAddress' ? "w-3/4" : "w-full")} />
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
      // TIME FILTER DETACHMENT: Simplified message - no time filter in this tab
      const emptyMessage = "No token activity detected for this wallet. Try adjusting filters or hit Refresh.";

      return <TableBody><TableRow><TableCell colSpan={table.getAllColumns().length}><EmptyState variant="default" icon={BarChartBig} title="No Token Data?" description={emptyMessage} className="my-8" /></TableCell></TableRow></TableBody>;
    }

    // Infinite scroll - regular table rendering
    return (
      <TableBody>
        {tableRows.map((row) => (
          <TableRow key={row.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(
                  "overflow-hidden",
                  (cell.column.columnDef.meta as any)?.className
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {/* Loading indicator for infinite scroll */}
        {hasMore && (
          <TableRow ref={loadMoreRef}>
            <TableCell colSpan={table.getAllColumns().length} className="text-center py-4">
              {isLoadingData ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading more tokens...</span>
                </div>
              ) : (
                <div className="h-4" /> // Invisible trigger element
              )}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    );
  };
  
  // REMOVED: Pagination UI - replaced with infinite scroll

  if (!walletAddress) {
    return (
      <Card className="mt-4 p-6 rounded-xl shadow-base">
        <EmptyState
          variant="info"
          icon={InfoIcon}
          title="No Wallet Selected"
          description="Please select a wallet to view token performance."
        />
      </Card>
    );
  }

  return (
    <div className="w-full">
      <Card className="w-full flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 shadow-base hover:shadow-hover transition-shadow">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-shrink-0 rounded-t-xl">
        <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-row items-center gap-3 flex-wrap">
            <div>
              <Input id="token-search" name="token-search" placeholder="Search address..." value={searchTerm} onChange={handleSearchTermChange} className="max-w-xs h-9" />
              {error && <p className="text-red-500 text-xs mt-1">{error.message}</p>}
            </div>
            <Select value={pnlFilter} onValueChange={handlePnlFilterChange}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Filter Profit" /></SelectTrigger>
              <SelectContent>{PROFIT_FILTER_OPTIONS.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}</SelectContent>
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <UiButton variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                    <RefreshCwIcon className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />Refresh
                  </UiButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reload token performance data from the server</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Table container - infinite scroll, natural page flow */}
      <div className="bg-white dark:bg-slate-900 w-full">
        <Table className="w-full table-fixed">
          <TableHeader className="bg-slate-50 dark:bg-slate-800">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-slate-200 dark:border-slate-700">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "font-semibold text-slate-700 dark:text-slate-300 text-xs h-8 py-2 overflow-hidden",
                      (header.column.columnDef.meta as any)?.className,
                      header.column.id === 'tokenAddress' && 'sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 shadow-sm',
                      (() => {
                        const columnId = header.column.id;
                        const fieldMapping: Record<string, string> = {
                          'currentBalanceDisplay': 'currentSolValue',
                          'tokenAddress': 'lastTransferTimestamp'
                        };
                        const backendField = fieldMapping[columnId] || columnId;
                        return BACKEND_SORTABLE_IDS.includes(backendField) && 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors';
                      })()
                    )}
                    onClick={() => {
                      const columnId = header.column.id;
                      const fieldMapping: Record<string, string> = {
                        'currentBalanceDisplay': 'currentSolValue',
                        'tokenAddress': 'lastTransferTimestamp'
                      };
                      const backendField = fieldMapping[columnId] || columnId;
                      if (BACKEND_SORTABLE_IDS.includes(backendField)) {
                        handleSort(columnId);
                      }
                    }}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1.5 h-full",
                        (header.column.columnDef.meta as any)?.className?.includes("text-right")
                          ? "justify-end text-right"
                          : (header.column.columnDef.meta as any)?.className?.includes("text-center")
                            ? "justify-center text-center"
                            : "justify-start"
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {(() => {
                        const columnId = header.column.id;
                        const fieldMapping: Record<string, string> = {
                          'currentBalanceDisplay': 'currentSolValue',
                          'tokenAddress': 'lastTransferTimestamp'
                        };
                        const backendField = fieldMapping[columnId] || columnId;
                        if (!BACKEND_SORTABLE_IDS.includes(backendField)) return null;

                        const isActiveSortColumn = sortBy === backendField;

                        return (
                          <div className="flex flex-col items-center">
                            <ChevronUp
                              className={cn(
                                "h-3 w-3",
                                isActiveSortColumn && sortOrder === 'ASC'
                                  ? "text-slate-900 dark:text-slate-100"
                                  : "text-slate-500 dark:text-slate-400"
                              )}
                            />
                            <ChevronDown
                              className={cn(
                                "h-3 w-3 -mt-1.5",
                                isActiveSortColumn && sortOrder === 'DESC'
                                  ? "text-slate-900 dark:text-slate-100"
                                  : "text-slate-500 dark:text-slate-400"
                              )}
                            />
                          </div>
                        );
                      })()}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          {renderTableContent()}
        </Table>

      </div>
    </Card>
    </div>
  );
}
// Helper to format date timestamps (assuming they are Unix seconds)
const formatDate = (timestamp: number | null | undefined) => {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString();
};

// Helper to format relative time for "Last Active" - compact format
const formatRelativeTimeCompact = (timestamp: number | null | undefined): string => {
  if (!timestamp) return '';

  const now = Date.now();
  const date = new Date(timestamp * 1000);
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffMs / 604800000);
  const diffMonths = Math.floor(diffMs / 2592000000);

  // Super compact format - just number + unit
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 4) return `${diffWeeks}w`;
  if (diffMonths < 12) return `${diffMonths}mo`;

  const years = Math.floor(diffMonths / 12);
  return `${years}y`;
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
  if (pnl === null || pnl === undefined) return <span className="text-xs text-slate-400 dark:text-slate-500">N/A</span>;
  const value = pnl;
  const textColor = value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return (
    <span className={`font-mono ${textColor} text-xs font-semibold`}>
      <span className="text-xs mr-0.5 align-middle">{sign}</span>
      {Math.abs(value).toFixed(2)} SOL
    </span>
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

    // Return as tiny colored badge
    return (
      <span className={`inline-flex items-center px-1 py-0 rounded text-[10px] font-medium ${bgColor} ${textColor}`}>
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

// formatMarketCap removed - now handled by TokenBadge component

// Memoize the component to prevent unnecessary re-renders
export default memo(TokenPerformanceTab);
