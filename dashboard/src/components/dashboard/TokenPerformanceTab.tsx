"use client";

import React, { useState } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store'; 
import { fetcher } from '../../lib/fetcher'; 
import { Card, Title, Text, Flex } from '@tremor/react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../../components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "../../components/ui/pagination"; 
import { AlertTriangle, Hourglass, InfoIcon } from 'lucide-react';
import { PaginatedTokenPerformanceResponse, TokenPerformanceDataDto } from '@/types/api'; 

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

const COLUMN_DEFINITIONS = [
  { id: 'tokenAddress', name: 'Token', isSortable: true },
  { id: 'netSolProfitLoss', name: 'Net PNL (SOL)', isSortable: true },
  { id: 'totalSolSpent', name: 'SOL Spent', isSortable: true },
  { id: 'totalSolReceived', name: 'SOL Received', isSortable: true },
  { id: 'netAmountChange', name: 'Net Amount', isSortable: true },
  { id: 'transferCountIn', name: 'Trades In', isSortable: false },
  { id: 'transferCountOut', name: 'Trades Out', isSortable: false },
  { id: 'firstTransferTimestamp', name: 'First Seen', isSortable: false }, // Not in backend enum for sorting
  { id: 'lastTransferTimestamp', name: 'Last Seen', isSortable: true },
];

export default function TokenPerformanceTab({ walletAddress }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('netSolProfitLoss'); 
  const [sortOrder, setSortOrder] = useState('DESC');

  const apiUrlBase = walletAddress ? `/api/v1/wallets/${walletAddress}/token-performance` : null;
  let swrKey: string | null = null;

  if (apiUrlBase) {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('pageSize', pageSize.toString());
    // Only append sortBy if it's a valid backend sortable ID
    if (BACKEND_SORTABLE_IDS.includes(sortBy)) {
        params.append('sortBy', sortBy);
        params.append('sortOrder', sortOrder);
    } else if (sortBy !== 'netSolProfitLoss') { // If current sortBy isn't valid, but not the default, log warning or reset
        console.warn(`Frontend sortBy '${sortBy}' is not backend sortable. Defaulting or API might error.`);
        // Optionally, reset to a default valid sort to prevent API errors if a non-sortable column was previously statefully set
        // params.append('sortBy', 'netSolProfitLoss'); 
        // params.append('sortOrder', 'DESC');
    }

    if (startDate) {
      params.append('startDate', startDate.toISOString());
    }
    if (endDate) {
      params.append('endDate', endDate.toISOString());
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

  const handleSort = (columnId: string) => {
    const columnDef = COLUMN_DEFINITIONS.find(c => c.id === columnId);
    if (!columnDef || !columnDef.isSortable || !BACKEND_SORTABLE_IDS.includes(columnId)) {
      // If column is not sortable by backend, do nothing or clear frontend sort state for it
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
    if (newPage > 0 && newPage <= (data?.totalPages || 1)) {
      setPage(newPage);
    }
  };


  if (!walletAddress) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="center" className="h-full p-6">
          <InfoIcon className="h-5 w-5 mr-2 text-tremor-content-subtle" />
          <Text>No wallet address provided. Please select a wallet.</Text>
        </Flex>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <Hourglass className="h-5 w-5 animate-spin text-tremor-content-subtle" />
          <Text>Loading token performance data...</Text>
        </Flex>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="start" className="space-x-2 p-6">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <Text color="red">
            Error loading token performance: {error.message}
            {(error as any).statusCode && ` (Status: ${(error as any).statusCode})`}
          </Text>
        </Flex>
      </Card>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <Card>
        <Flex alignItems="center" justifyContent="center" className="h-full p-6">
          <InfoIcon className="h-5 w-5 mr-2 text-tremor-content-subtle" />
          <Text>No token performance data available for this wallet or period.</Text>
        </Flex>
      </Card>
    );
  }
  
  // Helper to format date timestamps (assuming they are Unix seconds)
  const formatDate = (timestamp: number | null | undefined) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString(); // Or toLocaleString for date and time
  };

  const formatPnl = (pnl: number | null | undefined) => {
    if (pnl === null || pnl === undefined) return 'N/A';
    return pnl.toFixed(2); // Basic PNL formatting
  };


  return (
    <Card className="p-0 md:p-0 flex flex-col h-full">
      <Title className="p-4 md:p-6 border-b flex-shrink-0">Token Performance</Title>
      <div className="flex-grow overflow-y-auto">
        <Table className="min-w-full">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {COLUMN_DEFINITIONS.map((col) => (
                <TableHead 
                  key={col.id} 
                  onClick={() => col.isSortable && handleSort(col.id)}
                  className={`${col.isSortable ? 'cursor-pointer hover:bg-muted/50' : ''} whitespace-nowrap px-3 py-3 md:px-4 md:py-3 text-xs md:text-sm`}
                >
                  {col.name}
                  {col.isSortable && sortBy === col.id ? (sortOrder === 'ASC' ? ' ▲' : ' ▼') : ''}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((item: TokenPerformanceDataDto, index: number) => (
              <TableRow 
                key={`${item.tokenAddress}-${index}`} 
                className="border-b hover:bg-muted/20 even:bg-muted/5"
              >
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 font-mono text-xs md:text-sm">{item.tokenAddress}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{formatPnl(item.netSolProfitLoss)}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{item.totalSolSpent.toFixed(2)}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{item.totalSolReceived.toFixed(2)}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{item.netAmountChange.toFixed(4)}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{item.transferCountIn}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-right text-xs md:text-sm">{item.transferCountOut}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-xs md:text-sm">{formatDate(item.firstTransferTimestamp)}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 md:px-4 md:py-3 text-xs md:text-sm">{formatDate(item.lastTransferTimestamp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data.totalPages > 1 && (
        <Flex justifyContent="center" className="p-3 border-t flex-shrink-0 bg-card">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious 
                  href="#" 
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); handlePageChange(page - 1); }}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : undefined} 
                />
              </PaginationItem>
              {[...Array(data.totalPages)].map((_, i) => {
                const pageNum = i + 1;
                // Show first page, last page, and pages around current page
                const showPage = pageNum === 1 || pageNum === data.totalPages || (pageNum >= page -1 && pageNum <= page + 1) || (page <=3 && pageNum <=3) || (page >= data.totalPages -2 && pageNum >= data.totalPages-2);
                const isEllipsis = (pageNum === page - 2 && page > 3) || (pageNum === page + 2 && page < data.totalPages - 2);

                if (isEllipsis) {
                    return <PaginationItem key={`ellipsis-${pageNum}`}><Text>...</Text></PaginationItem>;
                }
                if (showPage) {
                    return (
                        <PaginationItem key={pageNum}>
                        <PaginationLink 
                            href="#" 
                            onClick={(e: React.MouseEvent) => { e.preventDefault(); handlePageChange(pageNum); }}
                            isActive={page === pageNum}
                        >
                            {pageNum}
                        </PaginationLink>
                        </PaginationItem>
                    );
                }
                return null;
              })}
              <PaginationItem>
                <PaginationNext 
                  href="#" 
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); handlePageChange(page + 1); }} 
                  className={page >= data.totalPages ? 'pointer-events-none opacity-50' : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Flex>
      )}
    </Card>
  );
} 