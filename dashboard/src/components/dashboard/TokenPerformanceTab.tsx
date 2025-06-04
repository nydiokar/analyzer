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
  const { mutate } = useSWRConfig(); // For revalidating SWR cache
  const { toast } = useToast(); // For displaying notifications
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);
  const [showPnlAsPercentage, setShowPnlAsPercentage] = useState<boolean>(false);

  // State for new quick filters
  const [pnlFilter, setPnlFilter] = useState<string>('any');
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const apiUrlBase = walletAddress ? `/api/v1/wallets/${walletAddress}/token-performance` : null;
  let swrKey: string | null = null;

  if (apiUrlBase) {
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
      params.append('minTrades', '2'); // Backend logic is specific to 2 for now
    }

    swrKey = `${apiUrlBase}?${params.toString()}`;
  }

  const { data, error, isLoading: isLoadingData } = useSWR<PaginatedTokenPerformanceResponse, Error>(
    swrKey,
    fetcher,
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

  if (!walletAddress) {
    return (
      <Card className="p-4 md:p-6 mt-4">
         <EmptyState
          variant="info"
          icon={InfoIcon} 
          title="No Wallet Selected"
          description="Please select a wallet to view its token performance."
        />
      </Card>
    );
  }

  if (isLoadingData && !isAnalyzingGlobal) {
    return (
      <EmptyState 
        variant="default" 
        icon={Loader2} 
        title="Loading..."
        description="Please wait while we fetch the token performance data."
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }
  
  if (isAnalyzingGlobal) {
    return (
      <EmptyState 
        variant="default" 
        icon={Loader2} 
        title="Analyzing Wallet..."
        description="Please wait while the wallet analysis is in progress. Token performance data will update shortly."
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        variant="error"
        icon={AlertTriangle}
        title="Error Loading Token Performance"
        description={error.message || "An unexpected error occurred while fetching token data."}
        actionText={isAnalyzingGlobal ? "Analyzing..." : "Retry Analysis"}
        onActionClick={triggerAnalysisGlobal}
        isActionLoading={!!isAnalyzingGlobal}
        className="mt-4 md:mt-6 lg:mt-8"
      />
    );
  }

  const handlePnlFilterChange = (newValue: string) => {
    setPnlFilter(newValue);
    setPage(1); // Reset to page 1
  };

  // Correctly scoped helper functions
  const handleSort = (columnId: string) => {
    const columnDef = COLUMN_DEFINITIONS.find(c => c.id === columnId);
    if (!columnDef || !columnDef.isSortable || !BACKEND_SORTABLE_IDS.includes(columnId)) {
      console.log(`Column ${columnId} is not sortable by the backend.`);
      return;
    }
    if (sortBy === columnId) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(columnId);
      setSortOrder('DESC'); 
    }
    setPage(1); 
  };
  
  const handleSearchTermChange = (newSearchTerm: string) => {
    setSearchTerm(newSearchTerm);
    setPage(1); // Reset to page 1 when search term changes
  };

  const handlePageChange = (newPage: number) => {
    if (data && newPage > 0 && newPage <= data.totalPages) {
      setPage(newPage);
    }
  };

  // --- Render Logic Starts Here ---

  const renderTableContent = () => {
    if (!data && !isLoadingData) {
      return (
        <TableRow>
          <TableCell colSpan={COLUMN_DEFINITIONS.length} className="h-24 text-center">
            No data available.
          </TableCell>
        </TableRow>
      );
    }
    
    if (tableData.length === 0) {
      const emptyStateDescription = areFiltersActive
        ? "Try adjusting your filters or expand the time range."
        : "No token activity detected for the selected period or filters.";
      return (
        <TableRow>
          <TableCell colSpan={COLUMN_DEFINITIONS.length}>
            <EmptyState
              variant="info"
              icon={BarChartIcon}
              title="No Token Data Found"
              description={emptyStateDescription}
              actionText={isAnalyzingGlobal ? "Analyzing..." : "Analyze This Wallet"}
              onActionClick={triggerAnalysisGlobal}
              isActionLoading={!!isAnalyzingGlobal}
              className="my-8"
            />
          </TableCell>
        </TableRow>
      );
    }

    return tableData.map((token: TokenPerformanceDataDto, index: number) => {
      const isHeld = (token.currentUiBalance ?? 0) > 0;
      const totalTrades = (token.transferCountIn ?? 0) + (token.transferCountOut ?? 0);
      const isExited = !isHeld && totalTrades > 0;
      const isHighTradeCount = totalTrades >= 10;

      let rowClassName = 'transition-colors group hover:bg-muted/20';
      
      const pnl = token.netSolProfitLoss ?? 0;
      if (pnl > 10) {
        rowClassName += ' bg-green-500/5 dark:bg-green-500/10';
      } else if (pnl < -5) {
        rowClassName += ' bg-red-500/5 dark:bg-red-500/10';
      }

      // Conditional border every 5 rows
      if ((index + 1) % 5 === 0 && index !== tableData.length - 1) {
        rowClassName += ' border-b-2 border-blue-500/30 dark:border-blue-400/40';
      } else {
        rowClassName += ' border-b border-tremor-border dark:border-dark-tremor-border'; // Standard border
      }

      return (
        <TableRow key={token.tokenAddress + index} className={rowClassName}>
          <TableCell className={`py-2.5 px-4 font-medium truncate sticky left-0 bg-card dark:bg-dark-tremor-background-default z-10 ${COLUMN_DEFINITIONS[0].className} border-r dark:border-slate-700`}>
            <Flex alignItems="center" className="space-x-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default truncate">{token.tokenAddress}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start">
                    <p className="font-mono text-xs mb-2">{token.tokenAddress}</p>
                    <Flex justifyContent="start" className="space-x-2">
                      <CopyIcon aria-label="Copy address" className="h-3.5 w-3.5 cursor-pointer hover:text-tremor-brand" onClick={() => navigator.clipboard.writeText(token.tokenAddress)} />
                      <a href={`https://solscan.io/token/${token.tokenAddress}`} target="_blank" rel="noopener noreferrer" title="View on Solscan">
                        <ExternalLinkIcon className="h-3.5 w-3.5 hover:text-tremor-brand" />
                      </a>
                    </Flex>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center space-x-1 flex-shrink-0">
                {isHeld && <Badge variant="outline" className="font-medium bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/40 text-xs px-1.5 py-0.5">Held</Badge>}
                {isExited && <Badge variant="outline" className="font-medium bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40 text-xs px-1.5 py-0.5">Exited</Badge>}
                {isHighTradeCount && <Badge variant="outline" className="font-medium bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40 text-xs px-1.5 py-0.5">Active</Badge>}
              </div>
            </Flex>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[1].className}`}>
            {showPnlAsPercentage ? (
              (token.totalSolSpent ?? 0) > 0 ? (
                formatPercentagePnl(((token.netSolProfitLoss ?? 0) / (token.totalSolSpent ?? 1)) * 100) 
              ) : (
                <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A (No Spend)</Text>
              )
            ) : (
              formatPnl(token.netSolProfitLoss)
            )}
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[2].className}`}>
            {(() => {
              const spent = token.totalSolSpent ?? 0;
              const received = token.totalSolReceived ?? 0;
              if (spent === 0) {
                return received > 0 ? 
                  <Text className="text-xs text-green-500">+∞</Text> : 
                  <Text className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">N/A</Text>;
              }
              const roiValue = ((received - spent) / spent) * 100;
              return formatPercentagePnl(roiValue);
            })()}
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[3].className}`}>
            <Text className="font-mono text-xs">{formatSolAmount(token.totalSolSpent)}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[4].className}`}>
            <Text className="font-mono text-xs">{formatSolAmount(token.totalSolReceived)}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[5].className}`}>
            <Text className="font-mono text-xs">{formatTokenDisplayValue(token.currentUiBalance, token.currentUiBalanceString)}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[6].className} text-center`}>
            <Text className="font-mono text-xs">{token.transferCountIn ?? 0}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[7].className} text-center`}>
            <Text className="font-mono text-xs">{token.transferCountOut ?? 0}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[8].className} text-center`}>
            <Text className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-xs">{formatDate(token.firstTransferTimestamp)}</Text>
          </TableCell>
          <TableCell className={`py-2.5 px-4 ${COLUMN_DEFINITIONS[9].className} text-center`}>
            <Text className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-xs">{formatDate(token.lastTransferTimestamp)}</Text>
          </TableCell>
        </TableRow>
      );
    });
  };

  const renderPaginationItems = () => {
    if (!data || data.totalPages <= 1) return null;
    const items = [];
    const totalPages = data.totalPages;
    const currentPage = page;
    const pageRangeDisplayed = 5;
    let startPage = Math.max(1, currentPage - Math.floor(pageRangeDisplayed / 2));
    let endPage = Math.min(totalPages, startPage + pageRangeDisplayed - 1);
    if (endPage - startPage + 1 < pageRangeDisplayed && totalPages >= pageRangeDisplayed) {
        if (startPage === 1) endPage = Math.min(totalPages, pageRangeDisplayed);
        else startPage = Math.max(1, totalPages - pageRangeDisplayed + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
      items.push(
        <PaginationItem key={i}>
          <PaginationLink 
            href="#"
            onClick={(e) => { e.preventDefault(); handlePageChange(i); }}
            isActive={currentPage === i}
            className="text-xs h-8 w-8 p-0"
          >
            {i}
          </PaginationLink>
        </PaginationItem>
      );
    }
    return items;
  };

  const startItem = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const endItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <Card className="h-full flex flex-col relative overflow-hidden">
      {/* Filter controls & Info Tooltip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 border-b bg-card dark:bg-dark-tremor-background-muted sticky top-0 z-20">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center text-xs text-tremor-content dark:text-dark-tremor-content cursor-help">
                <InfoIcon className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                <span>Data Interpretation Note</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-sm">
              <p className="text-sm">
                The global time filter (e.g., 24h, 7d, All-Time) selects tokens that had any trading activity within that period. 
                However, the metrics displayed in this table (like PNL, SOL Spent/Received, trade counts) are lifetime totals for each of those included tokens.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Spacer to push other filters to the right if needed, or let them flow naturally */}
        {/* <div className="flex-grow"></div> */}

        {/* Search Input - Reduced Width */}
        <div className="flex-grow sm:flex-grow-0 sm:w-64 md:w-72">
          <Input 
            placeholder="Search token address or symbol..."
            value={searchTerm}
            onChange={(e) => handleSearchTermChange(e.target.value)}
            className="h-10" // Ensure consistent height
          />
        </div>

        {/* PNL Filter Select */}
        <div className="flex items-center space-x-2">
          <Label htmlFor="pnl-filter" className="text-sm font-medium">PNL (SOL)</Label>
          <Select value={pnlFilter} onValueChange={handlePnlFilterChange}>
            <SelectTrigger id="pnl-filter" className="h-10 w-[180px]">
              <SelectValue placeholder="Filter by PNL" />
            </SelectTrigger>
            <SelectContent>
              {PNL_FILTER_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Toggle for Show Holdings Only */}
        <div className="flex items-center space-x-2">
          <Switch 
            id="holdings-filter" 
            checked={showHoldingsOnly} 
            onCheckedChange={(checked: boolean) => { setShowHoldingsOnly(checked); setPage(1); }}
          />
          <Label htmlFor="holdings-filter" className="text-sm font-medium whitespace-nowrap">Holdings Only</Label>
        </div>

        {/* Toggle for Show PNL as Percentage */}
        <div className="flex items-center space-x-2">
          <Switch
            id="pnl-display-mode"
            checked={showPnlAsPercentage}
            onCheckedChange={(checked: boolean) => setShowPnlAsPercentage(checked)}
          />
          <Label htmlFor="pnl-display-mode" className="text-sm font-medium flex items-center">
            <RepeatIcon className="w-4 h-4 mr-1.5 text-tremor-content-subtle dark:text-dark-tremor-content-subtle" /> Show PNL as %
          </Label>
        </div>
        
        {/* Toggle for Min. 2 Trades */}
        <div className="flex items-center space-x-2">
          <Switch 
            id="min-trades-filter" 
            checked={minTradesToggle} 
            onCheckedChange={(checked: boolean) => { setMinTradesToggle(checked); setPage(1); }}
          />
          <Label htmlFor="min-trades-filter" className="text-sm font-medium whitespace-nowrap">Min. 2 Trades</Label>
        </div>
      </div>

      {/* SCROLLABLE TABLE AREA - New structure for isolated scroll */}
      <div className="flex-grow overflow-hidden"> 
        <div className="h-full overflow-y-auto"> 
          <Table className="min-w-full">
            {/* TableHeader sticky top-[60px] z-20 (below filters) */}
            <TableHeader className="sticky top-0 z-20 bg-card dark:bg-background shadow">
              <TableRow>
                {COLUMN_DEFINITIONS.map((col) => (
                  <TableHead 
                    key={col.id} 
                    onClick={() => col.isSortable && handleSort(col.id)}
                    className={`py-3 px-4 whitespace-nowrap ${col.className || ''} ${col.isSortable ? 'cursor-pointer hover:bg-muted/50' : ''} ${col.id === 'tokenAddress' ? 'sticky left-0 top-0 z-20 bg-card dark:bg-dark-tremor-background-default border-r dark:border-slate-700' : 'top-0 z-10 bg-card dark:bg-dark-tremor-background-default'}`}>
                    <Flex alignItems="center" className={col.id.includes('Count') || col.id.includes('Timestamp') ? 'justify-center' : 'justify-start'}> 
                      {col.icon && <col.icon className={`h-3.5 w-3.5 mr-1.5 ${col.id.includes('Timestamp') ? 'text-tremor-content-subtle' : 'text-blue-500/70'}`} />}
                      <span>{col.name}</span>
                      {col.isSortable && (
                        <span className={`transition-transform duration-150 ${sortBy === col.id ? 'opacity-100' : 'opacity-30 hover:opacity-70'} ${sortBy === col.id && sortOrder === 'ASC' ? 'transform rotate-180' : ''}`}>▼</span>
                      )}
                    </Flex>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderTableContent()} 
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Sticky Pagination - Corrected variables */}
      {data && data.data && data.data.length > 0 && data.totalPages > 1 && (
        <div className="sticky bottom-0 z-30 bg-card dark:bg-background border-t p-3 flex-shrink-0">
          <Flex alignItems="center" justifyContent="between" className="w-full">
            <Text className="text-xs text-tremor-content dark:text-dark-tremor-content">
              Showing {startItem}-{endItem} of {data.total} tokens
            </Text>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); handlePageChange(1); }}
                    className={`${data.page <= 1 ? 'pointer-events-none opacity-50' : ''} text-xs h-8 px-2`} 
                    aria-label="Go to first page"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationPrevious 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); handlePageChange(data.page - 1); }}
                    className={`${data.page <= 1 ? 'pointer-events-none opacity-50' : ''} text-xs h-8 px-2`} 
                  />
                </PaginationItem>
                {renderPaginationItems()}
                <PaginationItem>
                  <PaginationNext 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); handlePageChange(data.page + 1); }} 
                    className={`${data.page >= data.totalPages ? 'pointer-events-none opacity-50' : ''} text-xs h-8 px-2`} 
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); handlePageChange(data.totalPages); }}
                    className={`${data.page >= data.totalPages ? 'pointer-events-none opacity-50' : ''} text-xs h-8 px-2`} 
                    aria-label="Go to last page"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </Flex>
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