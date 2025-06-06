"use client";

import React, { useState, useMemo, useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr'; // Import useSWRConfig for mutate
import { useTimeRangeStore } from '@/store/time-range-store'; 
import { fetcher } from '../../lib/fetcher'; 
import { Card, Title, Text, Flex, Button } from '@tremor/react'; // Added Button
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../../components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "../../components/ui/pagination"; 
import { Input } from "@/components/ui/input"; // Added Input
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"; // Added Select components here
import { Switch } from "@/components/ui/switch"; // Restored Switch import
import { Label } from "@/components/ui/label";   // Restored Label import
import { Badge } from "@/components/ui/badge";   // Restored Badge import
import { 
  AlertTriangle, 
  Hourglass, 
  InfoIcon,
  ArrowUpRight,
  ArrowDownRight,
  Copy as CopyIcon,
  ExternalLink as ExternalLinkIcon,
  HelpCircle as HelpCircleIcon,     // For Token
  DollarSign as DollarSignIcon,   // For PNL
  Percent as PercentIcon,         // For ROI
  ArrowLeftCircle as ArrowLeftCircleIcon, // For Spent
  ArrowRightCircle as ArrowRightCircleIcon, // For Received
  Package as PackageIcon,             // For Supply
  ArrowRightLeft as ArrowRightLeftIcon, // For In/Out
  CalendarDays as CalendarDaysIcon,    // For Dates
  Repeat as RepeatIcon,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw, // Added RefreshCw icon for the button
  Loader2, // Added Loader2 for loading state
  BarChartIcon, // Added BarChartIcon for empty token data state
} from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 
import { useToast } from "@/hooks/use-toast"; // Added useToast
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import EmptyState from '@/components/shared/EmptyState'; // Added EmptyState import
import { Skeleton } from "@/components/ui/skeleton"; // Added Skeleton import
import { cn } from "@/lib/utils"; // Added cn for classname utility
import { Button as UiButton } from "@/components/ui/button"; // Ensure correct Button import and type
import { useApiKeyStore } from '@/store/api-key-store'; // Import the key store

interface TokenPerformanceTabProps {
  walletAddress: string;
  isAnalyzingGlobal?: boolean;
  triggerAnalysisGlobal?: () => void;
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

// Valid sortable IDs based on the backend TokenPerformanceSortBy enum
const BACKEND_SORTABLE_IDS = [
  'tokenAddress',
  'netSolProfitLoss',
  'totalSolSpent',
  'totalSolReceived',
  'netAmountChange',
  'lastTransferTimestamp',
];

const COLUMN_DEFINITIONS: Array<{id: string; name: string; isSortable: boolean; className?: string; icon?: React.ElementType }> = [
  { id: 'tokenAddress', name: 'Token', isSortable: true, className: 'max-w-xs sticky left-0 bg-card dark:bg-dark-tremor-background-default z-10', icon: HelpCircleIcon },
  { id: 'netSolProfitLoss', name: 'Net PNL (SOL)', isSortable: true, className: 'text-right', icon: DollarSignIcon },
  { id: 'roi', name: 'ROI (%)', isSortable: false, className: 'text-right', icon: PercentIcon }, 
  { id: 'totalSolSpent', name: 'SOL Spent', isSortable: true, className: 'text-right', icon: ArrowLeftCircleIcon },
  { id: 'totalSolReceived', name: 'SOL Received', isSortable: true, className: 'text-right', icon: ArrowRightCircleIcon },
  { id: 'currentBalanceDisplay', name: 'Current Balance', isSortable: false, className: 'text-right', icon: PackageIcon },
  { id: 'transferCountIn', name: 'In', isSortable: false, className: 'text-center text-right', icon: ArrowRightLeftIcon },
  { id: 'transferCountOut', name: 'Out', isSortable: false, className: 'text-center text-right'},
  { id: 'firstTransferTimestamp', name: 'First Trade', isSortable: false, className: 'text-center', icon: CalendarDaysIcon }, 
  { id: 'lastTransferTimestamp', name: 'Last Trade', isSortable: true, className: 'text-center', icon: CalendarDaysIcon }, 
];

export default function TokenPerformanceTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore(); // Get key and init status
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [showPnlAsPercentage, setShowPnlAsPercentage] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false); // Local state for refresh button

  // State for new quick filters
  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const apiUrlBase = walletAddress ? `/api/v1/wallets/${walletAddress}/token-performance` : null;
  let swrKey: (string | null)[] | null = null;

  if (apiUrlBase && isInitialized && apiKey) { // Check for key and init status
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('pageSize', pageSize.toString());
    if (BACKEND_SORTABLE_IDS.includes(sortBy)) {
        params.append('sortBy', sortBy);
        params.append('sortOrder', sortOrder);
    } else if (sortBy !== 'netSolProfitLoss') { 
        console.warn(`Frontend sortBy '${sortBy}' is not backend sortable. Defaulting or API might error.`);
    }
    if (startDate) {
      params.append('startDate', startDate.toISOString());
    }
    if (endDate) {
      params.append('endDate', endDate.toISOString());
    }
    if (showHoldingsOnly) {
      params.append('showOnlyHoldings', 'true');
    }
    if (searchTerm) {
      params.append('searchTerm', searchTerm);
    }

    // Convert pnlFilter state to pnlConditionOperator and pnlConditionValue
    if (pnlFilter !== 'any') {
      const selectedOption = PNL_FILTER_OPTIONS.find(option => option.value === pnlFilter);
      if (selectedOption) {
        const operatorMatch = selectedOption.value.match(/^([><]=?|=)/);
        const valueMatch = selectedOption.value.match(/-?[0-9.]+$/); // Allow negative numbers

        if (operatorMatch && valueMatch) {
          let feOperator = operatorMatch[0];
          const value = parseFloat(valueMatch[0]);
          let beOperator: string | undefined = undefined;

          if (feOperator === '>') beOperator = 'gt';
          else if (feOperator === '<') beOperator = 'lt';
          // Add other mappings if needed, e.g., for >=, <=, =

          if (beOperator) {
            params.append('pnlConditionOperator', beOperator);
            params.append('pnlConditionValue', value.toString());
          } else {
            console.warn("Unsupported PNL filter operator from frontend state:", feOperator);
          }
        } else if (selectedOption.value !== 'any') { // Handle cases like '>0' where value is 0
          let feOperator = selectedOption.value.charAt(0);
          const value = parseFloat(selectedOption.value.substring(1));
           let beOperator: string | undefined = undefined;
          if (feOperator === '>') beOperator = 'gt';
          else if (feOperator === '<') beOperator = 'lt';

          if (beOperator) {
            params.append('pnlConditionOperator', beOperator);
            params.append('pnlConditionValue', value.toString());
          }
        }
      }
    }

    // Convert minTradesToggle to minTrades parameter
    if (minTradesToggle) {
      params.append('minTrades', '2');
    }

    const url = `${apiUrlBase}?${params.toString()}`;
    swrKey = [url, apiKey];
  }

  const { data, error, isLoading: isLoadingData } = useSWR<PaginatedTokenPerformanceResponse, Error>(
    swrKey,
    ([url]) => fetcher(url), // Pass only URL to fetcher
    {
      revalidateOnFocus: false,
      keepPreviousData: true, 
    }
  );

  const tableData = useMemo(() => {
    return data?.data || [];
  }, [data]); 

  const areFiltersActive = useMemo(() => {
    return (
      pnlFilter !== 'any' ||
      minTradesToggle ||
      searchTerm !== '' ||
      showHoldingsOnly
    );
  }, [pnlFilter, minTradesToggle, searchTerm, showHoldingsOnly]);

  // Helper function to render skeleton rows
  const renderSkeletonTableRows = () => {
    const skeletonRowCount = 5;
    return Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
      <TableRow key={`skeleton-row-${rowIndex}`}>
        {COLUMN_DEFINITIONS.map((col, colIndex) => (
          <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`} className={cn(col.className, col.id === 'tokenAddress' && 'sticky left-0 z-10 bg-card dark:bg-dark-tremor-background-default')}>
            <Skeleton className={cn(
              "h-5",
              col.id === 'tokenAddress' ? "w-3/4" : "w-full",
              (col.className?.includes('text-right') || col.className?.includes('text-center')) && "mx-auto"
            )} />
          </TableCell>
        ))}
      </TableRow>
    ));
  };

  // Handler functions must be defined before the main return if they are used by elements in it
  const handlePnlFilterChange = (newValue: string) => {
    setPnlFilter(newValue);
    setPage(1); // Reset to first page on filter change
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
    if (!BACKEND_SORTABLE_IDS.includes(columnId)) {
      console.warn(`Column ${columnId} is not sortable on the backend.`);
      // Optionally, if you want to allow sorting non-backend-sortable columns locally,
      // you might need to adjust or skip backend sort params here.
      // For now, we only sort if it's backend sortable.
      return;
    }
    if (sortBy === columnId) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(columnId);
      setSortOrder('DESC'); // Default to DESC for new column
    }
    setPage(1);
  };
  
  const handleSearchTermChange = (newSearchTerm: string) => {
    setSearchTerm(newSearchTerm);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (data && newPage >= 1 && newPage <= data.totalPages) {
      setPage(newPage);
    } else if (newPage >= 1) {
        setPage(newPage);
    }
  };

  const handleRefresh = async () => {
    if (!swrKey) return;
    setIsRefreshing(true);
    try {
      await mutate(swrKey);
      // Optional: Add a success toast if desired
      // toast({
      //   title: "Data Refreshed",
      //   description: "Token performance data has been updated.",
      // });
    } catch (error) {
      console.error("Refresh error:", error); // Log the error for debugging
      toast({
        title: "Refresh Failed",
        description: (error instanceof Error && error.message) || "Could not refresh token performance data.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // This function will now correctly handle skeleton or actual data for the table body
  const renderTableContent = () => {
    if (isLoadingData && !isAnalyzingGlobal) { // Primary loading state for table data
      return (
        <TableBody>
          {renderSkeletonTableRows()}
        </TableBody>
      );
    }

    if (isAnalyzingGlobal && !data?.data?.length) { // Global analysis is happening, and we don't have any stale data to show
        return (
            <TableBody>
                <TableRow>
                    <TableCell colSpan={COLUMN_DEFINITIONS.length}>
                        <EmptyState 
                            variant="default" 
                            icon={Loader2} 
                            title="Analyzing Wallet..."
                            description="Please wait while the wallet analysis is in progress. Token performance data will update shortly."
                            className="my-8" // Add some margin for better spacing inside table
                        />
                    </TableCell>
                </TableRow>
            </TableBody>
        );
    }
    
    if (error && !data?.data?.length) { // Error and no stale data to show
        return (
            <TableBody>
                <TableRow>
                    <TableCell colSpan={COLUMN_DEFINITIONS.length}>
                        <EmptyState
                            variant="error"
                            icon={AlertTriangle}
                            title="Error Loading Token Performance"
                            description={error.message || "An unexpected error occurred."}
                            actionText={triggerAnalysisGlobal && !isAnalyzingGlobal ? "Retry Analysis" : undefined}
                            onActionClick={triggerAnalysisGlobal}
                            isActionLoading={!!isAnalyzingGlobal}
                            className="my-8"
                        />
                    </TableCell>
                </TableRow>
            </TableBody>
        );
    }

    if (!tableData || tableData.length === 0) { // No data after loading, or filters result in empty
      const emptyStateDescription = areFiltersActive
        ? "Try adjusting your filters or expand the time range."
        : "No token activity detected for the selected period or filters.";
      return (
        <TableBody>
            <TableRow>
            <TableCell colSpan={COLUMN_DEFINITIONS.length}>
                <EmptyState
                    variant="info"
                    icon={BarChartIcon} 
                    title="No Token Data"
                    description={emptyStateDescription}
                    className="my-8"
                />
            </TableCell>
            </TableRow>
        </TableBody>
      );
    }

    // Actual data rendering
    return (
      <TableBody>
        {tableData.map((item: TokenPerformanceDataDto, index: number) => {
          console.log('Token Performance Item:', JSON.stringify(item));
          const pnl = item.netSolProfitLoss ?? 0;
          const pnlColor = pnl > 0 ? 'text-emerald-500' : pnl < 0 ? 'text-red-500' : 'text-muted-foreground';
          const roi = item.totalSolSpent && item.totalSolSpent !== 0 
                      ? (pnl / item.totalSolSpent) * 100 
                      : (pnl > 0 ? Infinity : pnl < 0 ? -Infinity : 0); // Handle division by zero for ROI

          return (
            <TableRow key={item.tokenAddress + index}>
              {COLUMN_DEFINITIONS.map(col => (
                <TableCell 
                    key={col.id} 
                    className={cn(
                        "px-3 py-2.5 text-xs", // Adjusted padding & text size
                        col.className, 
                        col.id === 'tokenAddress' && 'sticky left-0 z-10 whitespace-nowrap bg-card dark:bg-dark-tremor-background-default',
                        (col.id === 'netSolProfitLoss' || col.id === 'roi') && pnlColor
                    )}
                >
                  {/* ... (keep existing cell rendering logic from the original component) ... */}
                  {col.id === 'tokenAddress' && (
                     <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              {(() => {
                                let rawTokenName = item.tokenAddress;
                                if (item.currentUiBalance === 0 && rawTokenName.endsWith(' 0')) {
                                  rawTokenName = rawTokenName.slice(0, -2);
                                } else if (item.currentUiBalance === 0 && rawTokenName.endsWith('0')) {
                                  rawTokenName = rawTokenName.slice(0, -1);
                                }
                                const displayTokenName = rawTokenName.substring(0, 6) + '...' + rawTokenName.substring(rawTokenName.length - 4);
                                return <Text className="font-medium truncate max-w-[120px] sm:max-w-[150px]">{displayTokenName}</Text>;
                              })()}
                            </div>
                            {item.currentUiBalance && item.currentUiBalance > 0 ? <Badge variant="outline" className="ml-auto text-sky-600 border-sky-600/50">Held</Badge> : null}
                            {item.currentUiBalance === 0 && <Badge variant="destructive" className="ml-auto">Exited</Badge>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start">
                          <p className="font-semibold">{item.tokenAddress}</p>
                          <div className="flex gap-2 mt-1">
                            <UiButton variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(item.tokenAddress)}><CopyIcon className="h-3 w-3 mr-1"/> Copy</UiButton>
                            <UiButton variant="ghost" size="sm" onClick={() => window.open(`https://solscan.io/token/${item.tokenAddress}`, '_blank')}><ExternalLinkIcon className="h-3 w-3 mr-1"/> Solscan</UiButton>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {col.id === 'netSolProfitLoss' && formatPnl(item.netSolProfitLoss)}
                  {col.id === 'roi' && (roi === Infinity ? <span className="text-emerald-500">∞</span> : roi === -Infinity ? <span className="text-red-500">-∞</span> : formatPercentagePnl(roi))}
                  {col.id === 'totalSolSpent' && (
                    <Text className={cn("text-xs", (item.totalSolSpent ?? 0) > 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>
                      {formatSolAmount(item.totalSolSpent)}
                    </Text>
                  )}
                  {col.id === 'totalSolReceived' && (
                    <Text className={cn("text-xs", (item.totalSolReceived ?? 0) > 0 ? 'text-emerald-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>
                      {formatSolAmount(item.totalSolReceived)}
                    </Text>
                  )}
                  {col.id === 'currentBalanceDisplay' && (item.currentUiBalance === 0 ? <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">-</Text> : formatTokenDisplayValue(item.currentUiBalance, item.currentUiBalanceString))}
                  {col.id === 'transferCountIn' && (
                    <Text className={cn("text-xs", (item.transferCountIn ?? 0) > 0 ? 'text-emerald-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>
                      {item.transferCountIn}
                    </Text>
                  )}
                  {col.id === 'transferCountOut' && (
                    <Text className={cn("text-xs", (item.transferCountOut ?? 0) > 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle')}>
                      {item.transferCountOut}
                    </Text>
                  )}
                  {col.id === 'firstTransferTimestamp' && formatDate(item.firstTransferTimestamp)}
                  {col.id === 'lastTransferTimestamp' && formatDate(item.lastTransferTimestamp)}
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

  // Fallback for initial load or missing wallet address
  if (!walletAddress) {
    return <Card className="p-4 md:p-6 mt-4"><EmptyState variant="info" icon={InfoIcon} title="No Wallet Selected" description="Please select a wallet to view token performance." /></Card>;
  }

  // Main component return
  return (
    <Card className="p-0 md:p-0 mt-4">
      {/* Filters Section */}
      <div className="px-4 py-3 border-b">
        <Flex flexDirection="row" alignItems="center" justifyContent="between" className="gap-2 flex-wrap">
          <Flex flexDirection="row" alignItems="center" className="gap-2 flex-wrap">
            <Input placeholder="Search token/address..." value={searchTerm} onChange={(e) => handleSearchTermChange(e.target.value)} className="max-w-xs h-9" />
            <Select value={pnlFilter} onValueChange={handlePnlFilterChange}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Filter PNL" /></SelectTrigger>
              <SelectContent>{PNL_FILTER_OPTIONS.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}</SelectContent>
            </Select>
            <div className="flex items-center space-x-2"><Switch id="min-trades-toggle" checked={minTradesToggle} onCheckedChange={handleMinTradesToggleChange} /><Label htmlFor="min-trades-toggle">Min. 2 Trades</Label></div>
            <div className="flex items-center space-x-2"><Switch id="holdings-only-toggle" checked={showHoldingsOnly} onCheckedChange={handleShowHoldingsToggleChange} /><Label htmlFor="holdings-only-toggle">Holding Only</Label></div>
            <UiButton variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoadingData || isAnalyzingGlobal} className="h-9 ml-2">
              <RefreshCw className={cn("mr-2 h-4 w-4", (isRefreshing || isLoadingData || isAnalyzingGlobal) && "animate-spin")} />Refresh
            </UiButton>
          </Flex>
        </Flex>
      </div>
      
      <div className="overflow-x-auto">
        {/* Ensure no whitespace is introduced here by comments or formatting */}
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              {COLUMN_DEFINITIONS.map((col) => (
                <TableHead key={col.id} className={cn("py-2.5 px-3", col.className, col.isSortable ? 'cursor-pointer hover:bg-muted/50 transition-colors' : '', col.id === 'tokenAddress' && 'sticky left-0 z-20 bg-card dark:bg-dark-tremor-background-default')} onClick={() => col.isSortable && handleSort(col.id)}>
                  <Flex alignItems="center" justifyContent={col.className?.includes('text-right') ? 'end' : col.className?.includes('text-center') ? 'center' : 'start'} className="gap-1 h-full">
                    {col.icon && <col.icon className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="text-xs font-semibold whitespace-nowrap">{col.name}</span>
                    {col.isSortable && sortBy === col.id && (sortOrder === 'ASC' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />)}
                  </Flex>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {/* No whitespace or comments directly between TableHeader and renderTableContent output */}
          {renderTableContent()}
          {/* No whitespace or comments directly after renderTableContent output and before </Table> */}
        </Table>
      </div>

      {/* Pagination Section */}
      {data && data.totalPages > 0 && data.data && data.data.length > 0 && (
        <div className="px-4 py-3 border-t">
          <Pagination>
            <PaginationContent>
              <PaginationItem><UiButton variant="outline" size="sm" onClick={() => handlePageChange(1)} disabled={data.page === 1} aria-label="Go to first page" className={cn(data.page === 1 && "opacity-50 cursor-not-allowed")}><ChevronsLeft className="h-4 w-4" /></UiButton></PaginationItem>
              <PaginationItem><PaginationPrevious onClick={() => handlePageChange(data.page - 1)} className={cn(data.page === 1 && "pointer-events-none opacity-50")} /></PaginationItem>
              {renderPaginationItems()}
              <PaginationItem><PaginationNext onClick={() => handlePageChange(data.page + 1)} className={cn(!data.totalPages || data.page === data.totalPages && "pointer-events-none opacity-50")} /></PaginationItem>
              <PaginationItem><UiButton variant="outline" size="sm" onClick={() => handlePageChange(data.totalPages)} disabled={!data.totalPages || data.page === data.totalPages} aria-label="Go to last page" className={cn((!data.totalPages || data.page === data.totalPages) && "opacity-50 cursor-not-allowed")}><ChevronsRight className="h-4 w-4" /></UiButton></PaginationItem>
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
  return new Date(timestamp * 1000).toLocaleDateString(); // Or toLocaleString for date and time
};

const formatTokenDisplayValue = (value: number | null | undefined, uiString?: string | null) => {
  if (typeof value === 'number' && !isNaN(value)) {
    if (value === 0) return "0";
    const absValue = Math.abs(value);
    const suffixes = ["", "K", "M", "B", "T"]; // Add more if needed
    
    // Calculate magnitude, ensuring it's not negative for suffix access
    let magnitude = Math.floor(Math.log10(absValue) / 3);
    if (magnitude < 0) {
      magnitude = 0; // Prevent negative index for suffixes array
    }
    magnitude = Math.min(magnitude, suffixes.length - 1); // Ensure it's within bounds

    const scaledValue = absValue / Math.pow(1000, magnitude);
    
    let precision = 2;
    if (scaledValue < 10 && scaledValue !== Math.floor(scaledValue)) precision = 2;
    else if (scaledValue < 100 && scaledValue !== Math.floor(scaledValue)) precision = 1;
    else precision = 0;

    // Ensure precision does not exceed the natural decimals of the scaled value unless it's intentionally set higher
    const fixedValue = scaledValue.toFixed(precision);
    const numPart = parseFloat(fixedValue);

    return (value < 0 ? "-" : "") + numPart.toLocaleString(undefined, { 
      minimumFractionDigits: precision, 
      maximumFractionDigits: precision 
    }) + suffixes[magnitude];
  }
  if (uiString) return uiString;
  return 'N/A';
};

const formatPnl = (pnl: number | null | undefined) => {
  if (pnl === null || pnl === undefined) return <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A</Text>;
  const value = pnl;
  const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
  const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return <Text className={`font-mono ${textColor} text-xs`}><span className="text-xs mr-0.5 align-middle">{sign}</span>{Math.abs(value).toFixed(2)} SOL</Text>;
};

const formatPercentagePnl = (percentage: number | null | undefined) => {
  if (percentage === null || percentage === undefined) return <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A</Text>;
  const value = percentage;
  const textColor = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-tremor-content-subtle dark:text-dark-tremor-content-subtle';
  const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return <Text className={`font-mono ${textColor} text-xs`}><span className="text-xs mr-0.5 align-middle">{sign}</span>{Math.abs(value).toFixed(1)}%</Text>;
};

const formatSolAmount = (value: number | null | undefined) => {
  if (typeof value === 'number' && !isNaN(value)) {
    if (value === 0) return "0";
    const absValue = Math.abs(value);
    const suffixes = ["", "K", "M", "B", "T"]; // Add more if needed
    
    // Calculate magnitude, ensuring it's not negative for suffix access
    let magnitude = Math.floor(Math.log10(absValue) / 3);
    if (magnitude < 0) {
      magnitude = 0; // Prevent negative index for suffixes array
    }
    magnitude = Math.min(magnitude, suffixes.length - 1); // Ensure it's within bounds

    const scaledValue = absValue / Math.pow(1000, magnitude);
    
    let precision = 2;
    if (scaledValue < 10 && scaledValue !== Math.floor(scaledValue)) precision = 2;
    else if (scaledValue < 100 && scaledValue !== Math.floor(scaledValue)) precision = 1;
    else precision = 0;

    // Ensure precision does not exceed the natural decimals of the scaled value unless it's intentionally set higher
    const fixedValue = scaledValue.toFixed(precision);
    const numPart = parseFloat(fixedValue);

    return (value < 0 ? "-" : "") + numPart.toLocaleString(undefined, { 
      minimumFractionDigits: precision, 
      maximumFractionDigits: precision 
    }) + suffixes[magnitude];
  }
  return 'N/A';
};