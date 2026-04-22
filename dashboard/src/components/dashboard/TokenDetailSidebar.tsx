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

function computeHoldingDuration(
  firstTs: number | null | undefined,
  lastTs: number | null | undefined,
  hasBalance: boolean
): string {
  if (!firstTs) return '—';
  const endTs = hasBalance ? Math.floor(Date.now() / 1000) : (lastTs ?? firstTs);
  const seconds = endTs - firstTs;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatTokenAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}

function formatMcap(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatRelativeTime(timestampSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatSol(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(3);
}

interface StatCardProps {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  subValue?: string;
  positive?: boolean | null;
}

function StatCard({ label, value, suffix, subValue, positive }: StatCardProps) {
  const colorClass =
    positive === true
      ? 'text-green-500'
      : positive === false
      ? 'text-red-500'
      : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-base font-semibold', colorClass)}>
        {value == null ? '—' : value.toFixed(3)}
        {suffix && value != null && <span className="text-xs font-normal text-muted-foreground ml-1">{suffix}</span>}
      </p>
      {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
    </div>
  );
}

interface MetricItemProps {
  label: string;
  value: React.ReactNode;
}

function MetricItem({ label, value }: MetricItemProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === 'buy') {
    return <Badge className="bg-green-500/15 text-green-500 border-green-500/30 text-xs px-1.5 py-0">buy</Badge>;
  }
  if (direction === 'sell') {
    return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-xs px-1.5 py-0">sell</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground text-xs px-1.5 py-0">transfer</Badge>;
}

function TradeRow({ trade }: { trade: TokenTradeItemDto }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-2"><DirectionBadge direction={trade.direction} /></td>
      <td className="py-2 pr-2 text-xs text-right">{formatMcap(trade.marketCapUsd)}</td>
      <td className="py-2 pr-2 text-xs text-right">{formatTokenAmount(trade.amount)}</td>
      <td className="py-2 pr-2 text-xs text-right">◎ {trade.associatedSolValue.toFixed(3)}</td>
      <td className="py-2 pr-2 text-xs text-muted-foreground text-right">{formatRelativeTime(trade.timestamp)}</td>
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

export function TokenDetailSidebar({ open, onClose, tokenData, walletAddress }: TokenDetailSidebarProps) {
  const swrKey = open && tokenData
    ? `/api/v1/wallets/${walletAddress}/token-trades/${tokenData.tokenAddress}`
    : null;

  // isValidating covers the revalidation case (switching tokens while drawer is open)
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

  const holdingDuration = useMemo(() => {
    if (!tokenData) return '—';
    return computeHoldingDuration(
      tokenData.firstTransferTimestamp,
      tokenData.lastTransferTimestamp,
      (tokenData.currentUiBalance ?? 0) > 0
    );
  }, [tokenData]);

  const roi = useMemo(() => {
    if (!tokenData?.totalPnlSol || !tokenData?.totalSolSpent || tokenData.totalSolSpent === 0) return null;
    return ((tokenData.totalPnlSol / tokenData.totalSolSpent) * 100).toFixed(1) + '%';
  }, [tokenData]);

  const tokenMeta = tokenData
    ? {
        name: tokenData.onchainName ?? tokenData.name ?? undefined,
        symbol: tokenData.onchainSymbol ?? tokenData.symbol ?? undefined,
        imageUrl: tokenData.onchainImageUrl ?? tokenData.imageUrl ?? undefined,
        onchainName: tokenData.onchainName ?? undefined,
        onchainSymbol: tokenData.onchainSymbol ?? undefined,
        onchainImageUrl: tokenData.onchainImageUrl ?? undefined,
      }
    : undefined;

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
            'fixed inset-y-0 right-0 z-50 flex flex-col w-[520px] max-w-full',
            'bg-background border-l border-border shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            'duration-200 focus:outline-none'
          )}
        >
          {/* Visually hidden title for screen readers */}
          <DialogPrimitive.Title className="sr-only">{dialogLabel}</DialogPrimitive.Title>

          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-border shrink-0">
            <div className="flex-1 min-w-0">
              {tokenData ? (
                <TokenBadge
                  mint={tokenData.tokenAddress}
                  metadata={tokenMeta}
                  variant="inline"
                  size="m"
                />
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
              {/* 2×2 P&L summary grid */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Total P&L"
                  value={tokenData?.totalPnlSol}
                  suffix="SOL"
                  subValue={roi ?? undefined}
                  positive={tokenData?.totalPnlSol != null ? tokenData.totalPnlSol > 0 : null}
                />
                <StatCard
                  label="Realized"
                  value={tokenData?.realizedPnlSol}
                  suffix="SOL"
                  positive={tokenData?.realizedPnlSol != null ? tokenData.realizedPnlSol > 0 : null}
                />
                <StatCard
                  label="Unrealized"
                  value={tokenData?.unrealizedPnlSol}
                  suffix="SOL"
                  positive={tokenData?.unrealizedPnlSol != null ? tokenData.unrealizedPnlSol > 0 : null}
                />
                <StatCard
                  label="Current Value"
                  value={tokenData?.currentHoldingsValueSol}
                  suffix="SOL"
                />
              </div>

              {/* 3-column metrics grid */}
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <MetricItem
                  label="Balance"
                  value={tokenData?.currentUiBalance != null ? formatTokenAmount(tokenData.currentUiBalance) : '—'}
                />
                <MetricItem
                  label="Cost Basis"
                  value={tokenData?.currentHoldingsCostBasisSol != null ? `◎ ${formatSol(tokenData.currentHoldingsCostBasisSol)}` : '—'}
                />
                <MetricItem label="Holding" value={holdingDuration} />
                <MetricItem label="Receives" value={tokenData?.transferCountIn ?? '—'} />
                <MetricItem label="Sends" value={tokenData?.transferCountOut ?? '—'} />
                <MetricItem
                  label="SOL In / Out"
                  value={tokenData ? `◎ ${formatSol(tokenData.totalSolSpent)} / ${formatSol(tokenData.totalSolReceived)}` : '—'}
                />
                <MetricItem label="Avg Entry MC" value={formatMcap(tradeHistory?.avgEntryMcap)} />
                <MetricItem label="Avg Exit MC" value={formatMcap(tradeHistory?.avgExitMcap)} />
                <MetricItem
                  label="MC Range"
                  value={
                    tradeHistory?.entryMcapP25Usd != null || tradeHistory?.entryMcapP75Usd != null
                      ? `${formatMcap(tradeHistory?.entryMcapP25Usd)}–${formatMcap(tradeHistory?.entryMcapP75Usd)}`
                      : '—'
                  }
                />
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
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">MCAP</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Amount</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">SOL</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Time</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground font-medium">Tx</th>
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
