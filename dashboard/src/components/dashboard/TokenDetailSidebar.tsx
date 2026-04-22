'use client';

import React, { useMemo } from 'react';
import useSWR from 'swr';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ExternalLink } from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { cn } from '@/lib/utils';
import { fetcher } from '@/lib/fetcher';
import type { TokenPerformanceDataDto, TokenTradeHistoryDto, TokenTradeItemDto } from '@/types/api';

interface TokenDetailSidebarProps {
  open: boolean;
  onClose: () => void;
  tokenData: TokenPerformanceDataDto | null;
  walletAddress: string;
}

// Duration from a timestamp to now (or to endTs if provided)
function formatDuration(startTs: number, endTs?: number): string {
  const seconds = (endTs ?? Math.floor(Date.now() / 1000)) - startTs;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Derive holding duration from trade list.
// For open positions: time since the last cycle opened.
// For closed positions: duration of the last closed cycle.
function computeCurrentHoldingDuration(
  trades: TokenTradeItemDto[],
  hasBalance: boolean
): string {
  // trades come newest-first from API; reverse to walk chronologically
  const chron = [...trades].reverse();
  let balance = 0;
  let cycleOpenTs: number | null = null;
  let lastCycleDuration: string | null = null;

  for (const t of chron) {
    const wasZero = balance <= 0;
    if (t.direction === 'in') {
      balance += t.amount;
    } else {
      balance = Math.max(0, balance - t.amount);
    }
    if (wasZero && balance > 0) {
      cycleOpenTs = t.timestamp;
    }
    if (!wasZero && balance <= 0 && cycleOpenTs != null) {
      lastCycleDuration = formatDuration(cycleOpenTs, t.timestamp);
      cycleOpenTs = null;
    }
  }

  if (hasBalance && cycleOpenTs != null) return formatDuration(cycleOpenTs);
  if (!hasBalance && lastCycleDuration) return lastCycleDuration;
  return '—';
}

function formatTokenAmount(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 0.001) return '~0';
  return n.toFixed(4);
}

function formatMcap(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatSol(v: number | null | undefined): string {
  if (v == null) return '—';
  if (Math.abs(v) < 0.001) return '~0';
  return v.toFixed(3);
}

function formatPct(pnl: number | null | undefined, basis: number | null | undefined): string | null {
  if (pnl == null || !basis || basis === 0) return null;
  return `${pnl >= 0 ? '+' : ''}${((pnl / basis) * 100).toFixed(1)}%`;
}

function formatRelativeTime(timestampSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// --- Sub-components ---

interface PnlCardProps {
  label: string;
  value: number | null | undefined;
  pct?: string | null;
}

function PnlCard({ label, value, pct }: PnlCardProps) {
  const isPositive = value != null && value > 0;
  const isNegative = value != null && value < 0;
  const valueColor = isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-foreground';

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-base font-semibold', valueColor)}>
          {value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}`}
        </span>
        {value != null && (
          <span className={cn('text-xs font-normal', valueColor)}>SOL</span>
        )}
      </div>
      {pct && (
        <span className={cn('text-xs font-medium', valueColor)}>{pct}</span>
      )}
    </div>
  );
}

interface MetricItemProps {
  label: string;
  children: React.ReactNode;
}

function MetricItem({ label, children }: MetricItemProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children ?? '—'}</span>
    </div>
  );
}

function classifyTrade(direction: string, solValue: number): 'buy' | 'sell' | 'transfer' {
  if (solValue <= 0) return 'transfer';
  return direction === 'in' ? 'buy' : 'sell';
}

function DirectionBadge({ kind }: { kind: 'buy' | 'sell' | 'transfer' }) {
  if (kind === 'buy') {
    return (
      <Badge className="bg-green-500/15 text-green-500 border-green-500/30 text-xs px-2 py-0 w-16 justify-center">
        Buy
      </Badge>
    );
  }
  if (kind === 'sell') {
    return (
      <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-xs px-2 py-0 w-16 justify-center">
        Sell
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs px-2 py-0 w-16 justify-center">
      Transfer
    </Badge>
  );
}

function TradeRow({ trade }: { trade: TokenTradeItemDto }) {
  const kind = classifyTrade(trade.direction, trade.associatedSolValue);
  const isBuy = kind === 'buy';
  const isSell = kind === 'sell';
  const solColorClass = isBuy ? 'text-green-500' : isSell ? 'text-red-500' : 'text-muted-foreground';

  const rowClass = isBuy
    ? 'border-b border-border/50 last:border-0 bg-green-500/5 hover:bg-green-500/10'
    : isSell
    ? 'border-b border-border/50 last:border-0 bg-red-500/5 hover:bg-red-500/10'
    : 'border-b border-border/50 last:border-0 hover:bg-muted/30';

  return (
    <tr className={rowClass}>
      <td className="py-2 pr-3"><DirectionBadge kind={kind} /></td>
      <td className="py-2 pr-3 text-xs text-right">{formatMcap(trade.marketCapUsd)}</td>
      <td className="py-2 pr-3 text-xs text-right">{formatTokenAmount(trade.amount)}</td>
      <td className={cn('py-2 pr-3 text-xs text-right font-medium', solColorClass)}>
        {trade.associatedSolValue.toFixed(3)} SOL
      </td>
      <td
        className="py-2 pr-3 text-xs text-muted-foreground text-right whitespace-nowrap cursor-default"
        title={new Date(trade.timestamp * 1000).toLocaleString()}
      >
        {formatRelativeTime(trade.timestamp)}
      </td>
      <td className="py-2 text-right">
        <a
          href={`https://solscan.io/tx/${trade.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
    </tr>
  );
}

// --- Main component ---

export function TokenDetailSidebar({ open, onClose, tokenData, walletAddress }: TokenDetailSidebarProps) {
  const swrKey = open && tokenData
    ? `/wallets/${walletAddress}/token-trades/${tokenData.tokenAddress}`
    : null;

  const { data: tradeHistory, isLoading, isValidating, error: tradeError } = useSWR<TokenTradeHistoryDto>(
    swrKey,
    fetcher
  );

  const showSkeleton = isLoading || isValidating;

  const tradeRows = useMemo<React.ReactElement[]>(() => {
    if (!tradeHistory?.trades) return [];
    return tradeHistory.trades.map((trade) => (
      <TradeRow key={trade.signature} trade={trade} />
    ));
  }, [tradeHistory]);

  const hasBalance = (tokenData?.currentUiBalance ?? 0) > 0;

  const holdingDuration = useMemo(() => {
    if (!tradeHistory?.trades?.length) {
      // Fallback: first→last timestamps while data loads
      if (!tokenData?.firstTransferTimestamp) return '—';
      if (!hasBalance) return '—';
      return formatDuration(tokenData.firstTransferTimestamp);
    }
    return computeCurrentHoldingDuration(tradeHistory.trades, hasBalance);
  }, [tradeHistory, tokenData, hasBalance]);

  const totalPnlPct = useMemo(
    () => formatPct(tokenData?.totalPnlSol, tokenData?.totalSolSpent),
    [tokenData]
  );
  const realizedPct = useMemo(
    () => formatPct(tokenData?.realizedPnlSol, tokenData?.totalSolSpent),
    [tokenData]
  );
  const unrealizedPct = useMemo(
    () => formatPct(tokenData?.unrealizedPnlSol, tokenData?.totalSolSpent),
    [tokenData]
  );

  const tokenMeta = tokenData ? {
    name: tokenData.onchainName ?? tokenData.name ?? undefined,
    symbol: tokenData.onchainSymbol ?? tokenData.symbol ?? undefined,
    imageUrl: tokenData.onchainImageUrl ?? tokenData.imageUrl ?? undefined,
    onchainName: tokenData.onchainName ?? undefined,
    onchainSymbol: tokenData.onchainSymbol ?? undefined,
    onchainImageUrl: tokenData.onchainImageUrl ?? undefined,
    marketCapUsd: tokenData.marketCapUsd ?? undefined,
    priceUsd: tokenData.priceUsd ?? undefined,
  } : undefined;

  const dialogLabel = tokenData
    ? `Token detail: ${tokenData.onchainSymbol ?? tokenData.symbol ?? tokenData.tokenAddress}`
    : 'Token detail';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-label={dialogLabel}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex flex-col w-[600px] max-w-full',
            'bg-background border-l border-border shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            'duration-200 focus:outline-none'
          )}
        >
          <DialogPrimitive.Title className="sr-only">{dialogLabel}</DialogPrimitive.Title>

          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-border shrink-0">
            <div className="flex-1 min-w-0">
              {tokenData ? (
                <TokenBadge mint={tokenData.tokenAddress} metadata={tokenMeta} variant="inline" size="m" />
              ) : (
                <Skeleton className="h-8 w-48" />
              )}
            </div>
            {tokenData?.spamRiskLevel === 'high-risk' && (
              <Badge variant="destructive" className="text-xs shrink-0">High Risk</Badge>
            )}
            <DialogPrimitive.Close asChild>
              <button
                onClick={onClose}
                className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          <ScrollArea className="flex-1 overflow-hidden">
            <div className="p-4 space-y-4">

              {/* P&L section */}
              <div className="space-y-2">
                {/* Total P&L — full width, prominent */}
                <PnlCard
                  label="Total P&L"
                  value={tokenData?.totalPnlSol}
                  pct={totalPnlPct}
                />
                {/* Realized / Unrealized side by side */}
                <div className="grid grid-cols-2 gap-2">
                  <PnlCard
                    label="Realized"
                    value={tokenData?.realizedPnlSol}
                    pct={realizedPct}
                  />
                  <PnlCard
                    label="Unrealized"
                    value={tokenData?.unrealizedPnlSol}
                    pct={unrealizedPct}
                  />
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <MetricItem label="Balance">
                  <span>
                    {tokenData?.currentUiBalance != null ? formatTokenAmount(tokenData.currentUiBalance) : '—'}
                    {tokenData?.currentHoldingsValueSol != null && (
                      <span className="text-muted-foreground font-normal text-xs ml-1.5">
                        ({tokenData.currentHoldingsValueSol.toFixed(3)} SOL)
                      </span>
                    )}
                  </span>
                </MetricItem>
                <MetricItem label="Holding Duration">
                  {holdingDuration}
                </MetricItem>
                <MetricItem label="Open Cost">
                  {tokenData?.currentHoldingsCostBasisSol != null
                    ? `${formatSol(tokenData.currentHoldingsCostBasisSol)} SOL`
                    : '—'}
                </MetricItem>
                <MetricItem label="Avg MC B/S">
                  <span>
                    <span className="text-green-500">{formatMcap(tradeHistory?.avgEntryMcap)}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-red-500">{formatMcap(tradeHistory?.avgExitMcap)}</span>
                  </span>
                </MetricItem>
                <MetricItem label="Bought">
                  <span>
                    <span className="text-green-500">{formatSol(tokenData?.totalSolSpent)} SOL</span>
                    <span className="text-muted-foreground text-xs ml-1">
                      / {tokenData?.transferCountIn ?? '—'} TXs
                    </span>
                  </span>
                </MetricItem>
                <MetricItem label="Sold">
                  <span>
                    <span className="text-red-500">{formatSol(tokenData?.totalSolReceived)} SOL</span>
                    <span className="text-muted-foreground text-xs ml-1">
                      / {tokenData?.transferCountOut ?? '—'} TXs
                    </span>
                  </span>
                </MetricItem>
              </div>

              <Separator />

              {/* Trade history */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Trade History</h3>
                {showSkeleton ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : tradeError ? (
                  <p className="text-sm text-destructive text-center py-6">Failed to load trade history.</p>
                ) : tradeRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No trade history found.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-xs text-muted-foreground font-medium">Type</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">MC</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Amount</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Total SOL</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Time</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>{tradeRows}</tbody>
                  </table>
                )}
              </div>

            </div>
          </ScrollArea>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
