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
import { 
  InfoIcon,
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle as HelpCircleIcon,
  DollarSign as DollarSignIcon,
  Percent as PercentIcon,
  ArrowLeftCircle as ArrowLeftCircleIcon,
  ArrowRightCircle as ArrowRightCircleIcon,
  Package as PackageIcon,
  ArrowRightLeft as ArrowRightLeftIcon,
  CalendarDays as CalendarDaysIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  RefreshCwIcon,
  BarChartBig,
  AlertTriangle,
  Lock,
  LogOut,
  TrendingUpIcon,
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
  // REMOVED: 'marketCapUsd' - not supported by backend
];

// This definition should be outside the component to prevent re-creation on every render.
// TanStack Table Column Definitions
const createColumns = (spamAnalysisResults: Map<string, ReturnType<typeof analyzeTokenSpamRisk>>): ColumnDef<TokenPerformanceDataDto>[] => [
  {
    accessorKey: 'tokenAddress',
    header: 'Token',
    cell: ({ row }) => {
      const item = row.original;
      const spamAnalysis = spamAnalysisResults.get(item.tokenAddress);
      if (!spamAnalysis) return null;
      
      const pnl = item.netSolProfitLoss ?? 0;
      const totalPnl = item.totalPnlSol ?? 0;
      const roi = item.totalSolSpent && item.totalSolSpent !== 0 ? (totalPnl / item.totalSolSpent) * 100 : (totalPnl > 0 ? Infinity : totalPnl < 0 ? -Infinity : 0);
      
      return (
        <div className="flex items-center gap-3">
          <TokenBadge 
            mint={item.tokenAddress}
            metadata={{
              name: item.name || undefined,
              symbol: item.symbol || undefined,
              imageUrl: item.imageUrl || undefined,
              websiteUrl: item.websiteUrl || undefined,
              twitterUrl: item.twitterUrl || undefined,
              telegramUrl: item.telegramUrl || undefined,
            }}
            size="lg"
            className="flex-1"
          />
          <div className="flex items-center gap-1">
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

function TokenPerformanceTab({ walletAddress, isAnalyzingGlobal, triggerAnalysisGlobal }: TokenPerformanceTabProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const { apiKey, isInitialized } = useApiKeyStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
    !isEnriching && swrKey ? [swrKey, apiKey] : null,
    ([url]: [string]) => fetcher(url),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 15000, // Increase to match global config and prevent rapid duplicates during tab switching
      revalidateOnReconnect: false, // Prevent revalidation on network reconnect
    }
  );

  const tableData = useMemo(() => data?.data || [], [data]);

  // CRITICAL PERFORMANCE FIX: Cache spam analysis results per token to avoid recalculation
  // Use a stable cache that persists across renders and only recalculates for new/changed tokens
  const spamAnalysisCache = useRef(new Map<string, { result: ReturnType<typeof analyzeTokenSpamRisk>; timestamp: number }>());
  
  const spamAnalysisResults = useMemo(() => {
    const results = new Map<string, ReturnType<typeof analyzeTokenSpamRisk>>();
    const currentTime = Date.now();
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes cache timeout
    
    tableData.forEach(token => {
      const cached = spamAnalysisCache.current.get(token.tokenAddress);
      
      // Use cached result if it exists and is not expired
      if (cached && (currentTime - cached.timestamp) < cacheTimeout) {
        results.set(token.tokenAddress, cached.result);
      } else {
        // Only compute for new or expired tokens
        const analysis = analyzeTokenSpamRisk(token);
        results.set(token.tokenAddress, analysis);
        spamAnalysisCache.current.set(token.tokenAddress, {
          result: analysis,
          timestamp: currentTime
        });
      }
    });
    
    // Clean up old cache entries to prevent memory leaks
    const allCurrentAddresses = new Set(tableData.map(t => t.tokenAddress));
    for (const [address, cached] of spamAnalysisCache.current.entries()) {
      if (!allCurrentAddresses.has(address) || (currentTime - cached.timestamp) > cacheTimeout) {
        spamAnalysisCache.current.delete(address);
      }
    }
    
    return results;
  }, [tableData]);

  // PERFORMANCE FIX: Memoize columns creation with stable dependency
  const columns = useMemo(() => createColumns(spamAnalysisResults), [spamAnalysisResults]);

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
      console.log('🔄 Analysis completed, refreshing token data...');
      setTimeout(() => {
        localMutate();
      }, 1000); // Small delay to ensure backend is ready
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
    if (newPage > 0 && newPage <= Math.ceil((data?.total || 0) / pageSize)) {
      setPage(newPage);
    }
  }, [data?.total, pageSize]);

  const handleRefresh = useCallback(async () => {
    if (isLoadingData) return;
    setIsRefreshing(true);
    try {
      // Refresh the main data only
      await localMutate();
      // Enrichment is now handled by the dashboard analysis job or manual trigger
    } finally {
      setIsRefreshing(false);
    }
  }, [isLoadingData, localMutate]);

  // PERFORMANCE FIX: Memoize skeleton rendering to prevent unnecessary re-creation
  const renderSkeletonTableRows = useCallback(() => {
    return Array.from({ length: 3 }).map((_, rowIndex) => (
      <TableRow key={`skeleton-row-${rowIndex}`}>
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
      if (isEnriching) {
        // It's too early to say "No data" if enrichment is running. Show skeleton.
        return <TableBody>{renderSkeletonTableRows()}</TableBody>;
      }
      // If not enriching and still no data, then it's final.
      const hasDateFilter = startDate || endDate;
      const emptyMessage = hasDateFilter 
        ? "No token activity or missing token data. Try expanding the date range, selecting 'All' or hit Refresh."
        : "No token activity detected for the selected filters.";
      
      return <TableBody><TableRow><TableCell colSpan={table.getAllColumns().length}><EmptyState variant="default" icon={BarChartBig} title="No Token Data" description={emptyMessage} className="my-8" /></TableCell></TableRow></TableBody>;
    }

    // If we have data, render it with TanStack Table.
    return (
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={(cell.column.columnDef.meta as any)?.className}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
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



// Memoize the component to prevent unnecessary re-renders
export default memo(TokenPerformanceTab);


