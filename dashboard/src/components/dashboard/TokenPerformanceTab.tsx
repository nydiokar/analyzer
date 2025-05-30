"use client";

import React, { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store'; 
import { fetcher } from '../../lib/fetcher'; 
import { Card, Title, Text, Flex } from '@tremor/react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../../components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "../../components/ui/pagination"; 
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
  CalendarDays as CalendarDaysIcon    // For Dates
} from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface TokenPerformanceTabProps {
  walletAddress: string;
}

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
  { id: 'tokenAddress', name: 'Token', isSortable: true, className: 'max-w-xs', icon: HelpCircleIcon },
  { id: 'netSolProfitLoss', name: 'Net PNL (SOL)', isSortable: true, className: 'text-right', icon: DollarSignIcon },
  { id: 'roi', name: 'ROI (%)', isSortable: false, className: 'text-right', icon: PercentIcon }, 
  { id: 'totalSolSpent', name: 'SOL Spent', isSortable: true, className: 'text-right', icon: ArrowLeftCircleIcon },
  { id: 'totalSolReceived', name: 'SOL Received', isSortable: true, className: 'text-right', icon: ArrowRightCircleIcon },
  { id: 'netAmountChange', name: 'Current Supply', isSortable: true, className: 'text-right', icon: PackageIcon },
  { id: 'transferCountIn', name: 'In', isSortable: false, className: 'text-center', icon: ArrowRightLeftIcon }, // Combined In/Out conceptually
  { id: 'transferCountOut', name: 'Out', isSortable: false, className: 'text-center'}, // No separate icon, covered by 'In' column conceptually
  { id: 'firstTransferTimestamp', name: 'First Trade', isSortable: false, className: 'text-center', icon: CalendarDaysIcon }, 
  { id: 'lastTransferTimestamp', name: 'Last Trade', isSortable: true, className: 'text-center', icon: CalendarDaysIcon }, 
];

export default function TokenPerformanceTab({ walletAddress }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showHoldingsOnly, setShowHoldingsOnly] = useState<boolean>(false);

  // State for new quick filters
  const [minPnl, setMinPnl] = useState<string>('any'); // PNL filter, e.g., '>10', '<0', 'any'
  const [minTradesToggle, setMinTradesToggle] = useState<boolean>(false); // For '>= 2 Trades' toggle
  const [searchTerm, setSearchTerm] = useState<string>(''); // For text search

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
    swrKey = `${apiUrlBase}?${params.toString()}`;
  }

  const { data, error, isLoading } = useSWR<PaginatedTokenPerformanceResponse, Error>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      keepPreviousData: true, 
    }
  );

  const tableData = useMemo(() => {
    let filtered = data?.data || [];
    if (searchTerm) {
      filtered = filtered.filter(token => 
        token.tokenAddress.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (minTradesToggle) {
      filtered = filtered.filter(token => 
        ((token.transferCountIn ?? 0) + (token.transferCountOut ?? 0)) >= 2
      );
    }
    if (minPnl !== 'any') {
      const pnlValue = parseFloat(minPnl.substring(1)); 
      const operator = minPnl.charAt(0); 
      if (!isNaN(pnlValue)) {
        filtered = filtered.filter(token => {
          const currentPnl = token.netSolProfitLoss ?? 0;
          if (operator === '>') {
            return currentPnl > pnlValue;
          } else if (operator === '<') {
            return currentPnl < pnlValue;
          }
          return true; 
        });
      }
    }
    return filtered;
  }, [data, searchTerm, minTradesToggle, minPnl]);

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
  
  const handlePageChange = (newPage: number) => {
    if (data && newPage > 0 && newPage <= data.totalPages) {
      setPage(newPage);
    }
  };

  // --- Render Logic Starts Here ---

  const renderContent = () => {
    if (isLoading) {
      return (
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <Hourglass className="h-5 w-5 animate-spin text-tremor-content-subtle" />
          <Text>Loading token performance data...</Text>
        </Flex>
      );
    }

    if (error) {
      return (
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <Text color="red">
            Error loading token performance: {error.message}
            {(error as any).statusCode && ` (Status: ${(error as any).statusCode})`}
          </Text>
        </Flex>
      );
    }

    if (tableData.length === 0) {
      if (showHoldingsOnly) {
        return (
          <Flex alignItems="center" justifyContent="center" className="h-full p-6 flex-grow">
            <InfoIcon className="h-5 w-5 mr-2 text-tremor-content-subtle" />
            <Text>No current holdings match your filter.</Text>
          </Flex>
        );
      }
      return (
        <Flex alignItems="center" justifyContent="center" className="h-full p-6">
          <InfoIcon className="h-5 w-5 mr-2 text-tremor-content-subtle" />
          <Text>No token performance data available for this wallet or period.</Text>
        </Flex>
      );
    }

    // If we have data, render the table (actual table structure to be added based on full file content)
    return (
      <div className="overflow-x-auto flex-grow relative">
        <Table className="min-w-full">
          <TableHeader className="sticky top-0 z-10 bg-card dark:bg-background shadow-sm">
            <TableRow>
              {COLUMN_DEFINITIONS.map((col) => (
                <TableHead 
                  key={col.id} 
                  onClick={() => col.isSortable && handleSort(col.id)}
                  className={`${col.className || ''} ${col.isSortable ? 'cursor-pointer hover:bg-muted/50' : ''} py-3 px-4`}
                >
                  <Flex alignItems="center" justifyContent={col.className?.includes('text-right') ? 'end' : col.className?.includes('text-center') ? 'center' : 'start' } className="space-x-1">
                    <span>{col.name}</span>
                    {col.isSortable && (
                      <span className={`transition-transform duration-150 ${sortBy === col.id ? 'opacity-100' : 'opacity-30 hover:opacity-70'} ${sortBy === col.id && sortOrder === 'ASC' ? 'transform rotate-180' : ''}`}>
                        ▼
                      </span>
                    )}
                  </Flex>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableData.map((token: TokenPerformanceDataDto, index: number) => {
              const isHeld = (token.currentUiBalance ?? 0) > 0;
              const totalTrades = (token.transferCountIn ?? 0) + (token.transferCountOut ?? 0);
              const isExited = !isHeld && totalTrades > 0;
              const isHighTradeCount = totalTrades >= 10;

              let rowClassName = 'transition-colors group';
              if (!isHeld) {
                rowClassName += ' opacity-75 group-hover:opacity-100';
              }
              
              const pnl = token.netSolProfitLoss ?? 0;
              if (pnl > 10) {
                rowClassName += ' bg-green-500/10 hover:bg-green-500/15';
              } else if (pnl < -5) {
                rowClassName += ' bg-red-500/10 hover:bg-red-500/15';
              }

              if (index % 2 !== 0) {
                rowClassName += ' bg-muted/30 dark:bg-muted/20';
              }

              return (
                <TableRow key={token.tokenAddress + index} className={rowClassName}>
                  <TableCell className={`py-3 px-4 font-medium truncate ${COLUMN_DEFINITIONS[0].className} border-r dark:border-slate-700`}>
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
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[1].className} border-r dark:border-slate-700`}>{formatPnl(token.netSolProfitLoss)}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[2].className} border-r dark:border-slate-700`}>
                    {(() => {
                      const spent = token.totalSolSpent ?? 0;
                      const received = token.totalSolReceived ?? 0;
                      if (spent === 0) {
                        if (received > 0) return <span className="text-green-500 flex items-center justify-end">+∞ %<ArrowUpRight className="w-3 h-3 ml-1 flex-shrink-0" /></span>;
                        return <span className="text-gray-500">N/A</span>;
                      }
                      const roi = ((received - spent) / spent) * 100;
                      const roiColor = roi >= 0 ? 'text-green-500' : 'text-red-500';
                      const ArrowIcon = roi >= 0 ? ArrowUpRight : ArrowDownRight;
                      return (
                        <span className={`${roiColor} flex items-center justify-end`}>
                          {roi.toFixed(1)}%
                          <ArrowIcon className="w-3 h-3 ml-1 flex-shrink-0" />
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[3].className} border-r dark:border-slate-700`}>{formatTokenDisplayValue(token.totalSolSpent)}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[4].className} border-r dark:border-slate-700`}>{formatTokenDisplayValue(token.totalSolReceived)}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[5].className} border-r dark:border-slate-700`}>
                    {formatTokenDisplayValue(token.currentUiBalance, token.currentUiBalanceString || (token.currentUiBalance !== null && token.currentUiBalance !== undefined ? String(token.currentUiBalance) : 'N/A'))}
                  </TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[6].className} border-r dark:border-slate-700`}>{token.transferCountIn ?? 'N/A'}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[7].className} border-r dark:border-slate-700`}>{token.transferCountOut ?? 'N/A'}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[8].className} border-r dark:border-slate-700`}>{formatDate(token.firstTransferTimestamp)}</TableCell>
                  <TableCell className={`py-3 px-4 font-mono ${COLUMN_DEFINITIONS[9].className}`}>{formatDate(token.lastTransferTimestamp)}</TableCell>{/* No border-r on last cell */}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {data && data.totalPages > 1 && (
          <Pagination className="p-4">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious 
                  href="#"
                  onClick={(e) => { e.preventDefault(); handlePageChange(page - 1); }}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : undefined}
                />
              </PaginationItem>
              {[...Array(data.totalPages)].map((_, i) => (
                <PaginationItem key={i + 1}>
                  <PaginationLink 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); handlePageChange(i + 1); }}
                    isActive={page === i + 1}
                  >
                    {i + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext 
                  href="#"
                  onClick={(e) => { e.preventDefault(); handlePageChange(page + 1); }}
                  className={page >= data.totalPages ? 'pointer-events-none opacity-50' : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    );
  };

  if (!walletAddress) {
    return (
      <Card className="p-4 md:p-6">
        <Flex alignItems="center" justifyContent="center" className="h-full">
          <InfoIcon className="h-5 w-5 mr-2 text-tremor-content-subtle" />
          <Text>No wallet address provided. Please select a wallet.</Text>
        </Flex>
      </Card>
    );
  }
  
  return (
    <Card className="p-0 md:p-0 flex flex-col h-full">
      <div className="p-4 md:p-6 border-b flex-shrink-0 space-y-4">
        {/* Row 1: Show Holdings Only Toggle */}
        <div className="flex items-center space-x-2">
          <Switch
            id="holdings-filter"
            checked={showHoldingsOnly}
            onCheckedChange={(checked) => {
              setShowHoldingsOnly(checked);
              setPage(1); // Reset to page 1 when filter changes
            }}
          />
          <Label htmlFor="holdings-filter">Show Only Holding (Balance &gt; 0)</Label>
        </div>

        {/* Row 2: Quick Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <div>
            <Label htmlFor="pnl-filter" className="text-xs font-medium">PNL (SOL)</Label>
            <select 
              id="pnl-filter"
              value={minPnl}
              onChange={(e) => {
                setMinPnl(e.target.value);
                setPage(1); // Reset page
              }}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md bg-card dark:bg-background text-tremor-content dark:text-dark-tremor-content"
            >
              <option value="any">Any PNL</option>
              <option value=">0">{`> 0 (Profitable)`}</option>
              <option value=">1">{`> 1`}</option>
              <option value=">10">{`> 10`}</option>
              <option value=">50">{`> 50`}</option>
              <option value="<0">{`< 0 (Losses)`}</option>
              <option value="<-1">{`< -1`}</option>
              <option value="<-10">{`< -10`}</option>
            </select>
          </div>
          
          <div>
            <Label htmlFor="search-token" className="text-xs font-medium">Search Token</Label>
            <input 
              type="text"
              id="search-token"
              placeholder="Name or Address..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1); // Reset page
              }}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-card dark:bg-background text-tremor-content dark:text-dark-tremor-content"
            />
          </div>

          <div className="flex items-center space-x-2 mt-5"> {/* mt-5 for alignment if Label is above */}
            <Switch
              id="min-trades-filter"
              checked={minTradesToggle}
              onCheckedChange={(checked) => {
                setMinTradesToggle(checked);
                setPage(1); // Reset page
              }}
            />
            <Label htmlFor="min-trades-filter">Min. 2 Trades</Label>
          </div>
        </div>
      </div>

      {/* Content: Table, Loading, Error, or No Data Message */}
      <div className="flex-grow overflow-y-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}> {/* Increased offset for scrollbar */}
        {renderContent()}
      </div>
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
    const magnitude = Math.min(Math.floor(Math.log10(absValue) / 3), suffixes.length - 1);
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
  if (pnl === null || pnl === undefined) return 'N/A';
  return pnl.toFixed(2); // Basic PNL formatting
};