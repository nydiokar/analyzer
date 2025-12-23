"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Calendar,
  Info,
  Loader2,
  RefreshCcw,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { WalletBadge } from "@/components/shared/WalletBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { DiscoverWallet, DiscoverWalletsResponse } from "@/types/discover";

const PAGE_SIZE = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;

const sortOptions = [
  { value: 'interesting', label: 'Interesting', hint: 'Activity + PnL + recency' },
  { value: 'most_active', label: 'Most active', hint: 'Trade count first' },
  { value: 'best_pnl', label: 'Best PnL', hint: 'Realized PnL focus' },
  { value: 'longest_holders', label: 'Longest holders', hint: 'Hold time' },
  { value: 'recently_updated', label: 'Recently updated', hint: 'Fresh data' },
] as const;

const styleOptions = [
  { value: 'any', label: 'Any style' },
  { value: 'SNIPER', label: 'Sniper' },
  { value: 'SCALPER', label: 'Scalper' },
  { value: 'FLIPPER', label: 'Flipper' },
  { value: 'MOMENTUM', label: 'Momentum' },
  { value: 'INTRADAY', label: 'Intraday' },
  { value: 'DAY_TRADER', label: 'Day Trader' },
  { value: 'SWING', label: 'Swing' },
  { value: 'POSITION', label: 'Position' },
  { value: 'HOLDER', label: 'Holder' },
] as const;

const holdBiasOptions = [
  { value: 'any', label: 'Any' },
  { value: 'short', label: 'Short (<12h)' },
  { value: 'medium', label: 'Medium (12–72h)' },
  { value: 'long', label: 'Long (>72h)' },
] as const;

const behaviorTagCopy: Record<
  string,
  { label: string; fallbackDetail: string }
> = {
  FLIPPER: { label: "Fast rotations", fallbackDetail: "Short holds and timing-focused moves." },
  HOLDER: { label: "Patient moves", fallbackDetail: "Longer holds and selective entries." },
  EXPLORER: { label: "Token scout", fallbackDetail: "Sampling many tokens to find momentum." },
  RECENT: { label: "Warming up", fallbackDetail: "Fresh on-chain activity to watch." },
  PNL: { label: "Profitable streak", fallbackDetail: "Realized gains worth a look." },
  WINNER: { label: "High win rate", fallbackDetail: "Converting trades efficiently." },
  INTERESTING: { label: "Curated pick", fallbackDetail: "Signals that merit a closer look." },
};

const formatHours = (val?: number | null) => {
  if (!val) return "—";
  if (val < 1) return `${Math.round(val * 60)}m`;
  if (val < 24) return `${Math.round(val)}h`;
  return `${Math.round(val / 24)}d`;
};

const formatLastActive = (isoString?: string | null) => {
  if (!isoString) return { text: "No activity yet", tooltip: null };
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return { text: "No activity yet", tooltip: null };

  return {
    text: formatDistanceToNow(date, { addSuffix: true }),
    tooltip: format(date, "PPpp"),
  };
};

const formatUpdatedAgo = (wallet: DiscoverWallet) => {
  if (wallet.metrics.stalenessMinutes !== null && wallet.metrics.stalenessMinutes !== undefined) {
    const minutes = Math.round(wallet.metrics.stalenessMinutes);
    if (minutes < 60) return { label: `${minutes}m ago`, status: "fresh" as const };
    const hours = Math.round(minutes / 60);
    if (hours < 48) return { label: `${hours}h ago`, status: hours <= 12 ? "fresh" as const : "ok" as const };
    return { label: `${Math.round(hours / 24)}d ago`, status: "stale" as const };
  }

  if (wallet.lastUpdatedAt) {
    const date = new Date(wallet.lastUpdatedAt);
    if (!Number.isNaN(date.getTime())) {
      return { label: formatDistanceToNow(date, { addSuffix: true }), status: "ok" as const };
    }
  }

  return { label: "Unknown recency", status: "stale" as const };
};

const formatPnLValue = (val?: number | null) => {
  if (val === null || val === undefined) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}`;
};

const getBehaviorPresentation = (wallet: DiscoverWallet) => {
  const map = behaviorTagCopy[wallet.reasonCode] || behaviorTagCopy.INTERESTING;
  const hold = wallet.metrics.medianHoldHours ?? wallet.metrics.averageHoldHours;
  const trades = wallet.metrics.totalTrades ?? wallet.metrics.totalExecutedSwaps;
  const tokens = wallet.metrics.uniqueTokensTraded;

  let detail = map.fallbackDetail;
  if (trades !== null && trades !== undefined && trades < 3) {
    return {
      label: "New data",
      detail: `${trades} trade${trades === 1 ? "" : "s"} so far · rerun analysis for depth`,
      rawReason: wallet.reason,
    };
  }

  if (wallet.reasonCode === "FLIPPER" && hold) {
    detail = `Quick exits (~${formatHours(hold)}) across ${trades ?? "many"} trades`;
  } else if (wallet.reasonCode === "HOLDER" && hold) {
    detail = `Prefers longer holds (~${formatHours(hold)})`;
  } else if (wallet.reasonCode === "EXPLORER" && wallet.metrics.uniqueTokensTraded) {
    detail = `${wallet.metrics.uniqueTokensTraded} unique tokens explored`;
  } else if (wallet.reasonCode === "RECENT") {
    const lastActive = formatLastActive(wallet.metrics.lastActiveAt);
    detail = `Active ${lastActive.text}`;
  } else if (wallet.reasonCode === "PNL" && wallet.metrics.realizedPnl !== null && wallet.metrics.realizedPnl !== undefined) {
    detail = `Realized ${formatPnLValue(wallet.metrics.realizedPnl)} SOL recently`;
  } else if (wallet.metrics.tradingStyle) {
    detail = wallet.metrics.tradingStyle;
  }

  return {
    label: map.label,
    detail: tokens === 0 && (trades ?? 0) > 0 ? `${detail} · token details pending` : detail,
    rawReason: wallet.reason,
  };
};

type CacheShape = { timestamp: number; data: DiscoverWalletsResponse };

const readCache = (key: string): DiscoverWalletsResponse | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: CacheShape = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

const writeCache = (key: string, data: DiscoverWalletsResponse) => {
  if (typeof window === 'undefined') return;
  const payload: CacheShape = { timestamp: Date.now(), data };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore
  }
};

const reasonColorMap: Record<string, string> = {
  FLIPPER: 'bg-pink-100 text-pink-800 border-pink-200',
  HOLDER: 'bg-amber-100 text-amber-800 border-amber-200',
  ACCUMULATOR: 'bg-blue-100 text-blue-800 border-blue-200',
  PARTIAL_HOLDER: 'bg-teal-100 text-teal-800 border-teal-200',
  SWING: 'bg-orange-100 text-orange-800 border-orange-200',
  EXPLORER: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  RECENT: 'bg-purple-100 text-purple-800 border-purple-200',
  PNL: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  WINNER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  INTERESTING: 'bg-slate-100 text-slate-800 border-slate-200',
};

export default function DiscoverPage() {
  const [wallets, setWallets] = useState<DiscoverWallet[]>([]);
  const [sort, setSort] = useState<string>('interesting');
  const [minTradeCount, setMinTradeCount] = useState<number | ''>('');
  const [minUniqueTokens, setMinUniqueTokens] = useState<number | ''>('');
  const [style, setStyle] = useState<string>('any');
  const [holdBias, setHoldBias] = useState<string>('any');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const cacheKey = useMemo(
    () =>
      `discover:${sort}:${page}:${minTradeCount || 'any'}:${style !== 'any' ? style : 'any'}:${minUniqueTokens || 'any'}:${holdBias !== 'any' ? holdBias : 'any'}:${PAGE_SIZE}`,
    [sort, page, minTradeCount, style, minUniqueTokens, holdBias],
  );

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((total || wallets.length || PAGE_SIZE) / PAGE_SIZE)),
    [total, wallets.length],
  );

  const fetchWallets = useCallback(async () => {
    setError(null);
    setIsUpdating(true);
    try {
      const params = new URLSearchParams({
        sort,
        timeframe: 'all',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });

      if (minTradeCount !== '' && minTradeCount > 0) params.set('minTradeCount', String(minTradeCount));
      if (minUniqueTokens !== '' && minUniqueTokens > 0) params.set('minUniqueTokens', String(minUniqueTokens));
      if (style && style !== 'any') params.set('style', style);
      if (holdBias && holdBias !== 'any') params.set('holdBias', holdBias);

      const data = (await fetcher(`/discover/wallets?${params.toString()}`)) as DiscoverWalletsResponse;
      setWallets(data.items || []);
      setTotal(data.total || 0);
      writeCache(cacheKey, data);
    } catch (err: unknown) {
      const fallback = 'Failed to load wallets';
      const errorMessage =
        (err as { payload?: { message?: string } })?.payload?.message ||
        (err as Error).message ||
        fallback;
      setError(errorMessage || fallback);
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, [cacheKey, holdBias, minTradeCount, minUniqueTokens, page, sort, style]);

  useEffect(() => {
    const cached = readCache(cacheKey);
    if (cached) {
      setWallets(cached.items || []);
      setTotal(cached.total || 0);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchWallets();
  }, [cacheKey, fetchWallets]);

  const applyPreset = (preset: 'hyper-flipper' | 'balanced-fast' | 'patient-holder') => {
    setActivePreset(preset);
    if (preset === 'hyper-flipper') {
      setStyle('flipper');
      setHoldBias('short');
      setMinTradeCount(20);
      setMinUniqueTokens(5);
    } else if (preset === 'balanced-fast') {
      setStyle('swing');
      setHoldBias('medium');
      setMinTradeCount(30);
      setMinUniqueTokens(8);
    } else if (preset === 'patient-holder') {
      setStyle('holder');
      setHoldBias('long');
      setMinTradeCount(10);
      setMinUniqueTokens(3);
    }
    setPage(1);
  };

  return (
    <AppShell>
      <div className="w-full px-6 py-4 space-y-3">
        {/* Compact header + filters in one line */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold">Discover</h1>

          {/* Preset filters as distinct pills */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-accent/50 border border-border/50">
            <Button
              size="sm"
              variant={activePreset === 'hyper-flipper' ? 'default' : 'ghost'}
              onClick={() => applyPreset('hyper-flipper')}
              className={cn(
                "h-7 text-xs font-medium transition-all",
                activePreset === 'hyper-flipper' && "bg-primary text-primary-foreground shadow-sm"
              )}
            >
              Hyper Flipper
            </Button>
            <Button
              size="sm"
              variant={activePreset === 'balanced-fast' ? 'default' : 'ghost'}
              onClick={() => applyPreset('balanced-fast')}
              className={cn(
                "h-7 text-xs font-medium transition-all",
                activePreset === 'balanced-fast' && "bg-primary text-primary-foreground shadow-sm"
              )}
            >
              Balanced Fast
            </Button>
            <Button
              size="sm"
              variant={activePreset === 'patient-holder' ? 'default' : 'ghost'}
              onClick={() => applyPreset('patient-holder')}
              className={cn(
                "h-7 text-xs font-medium transition-all",
                activePreset === 'patient-holder' && "bg-primary text-primary-foreground shadow-sm"
              )}
            >
              Patient Holder
            </Button>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-border" />

          {/* Inline filters */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort:</span>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[140px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Style:</span>
            <Select value={style} onValueChange={(v) => { setStyle(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[110px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Hold:</span>
            <Select value={holdBias} onValueChange={(v) => { setHoldBias(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[110px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {holdBiasOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            type="number"
            inputMode="numeric"
            placeholder="Min trades"
            className="w-[90px] h-7 text-xs"
            value={minTradeCount === '' ? '' : String(minTradeCount)}
            onChange={(e) => {
              setMinTradeCount(e.target.value === '' ? '' : Number(e.target.value));
              setPage(1);
              setActivePreset(null);
            }}
          />

          <Input
            type="number"
            inputMode="numeric"
            placeholder="Min tokens"
            className="w-[90px] h-7 text-xs"
            value={minUniqueTokens === '' ? '' : String(minUniqueTokens)}
            onChange={(e) => {
              setMinUniqueTokens(e.target.value === '' ? '' : Number(e.target.value));
              setPage(1);
              setActivePreset(null);
            }}
          />

          {/* Refresh */}
          <Button variant="outline" size="sm" onClick={fetchWallets} disabled={isUpdating} className="h-7">
            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Results count */}
          <div className="text-sm text-muted-foreground">
            {total.toLocaleString()} wallets
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load wallets</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{error}</span>
              <Button size="sm" variant="secondary" onClick={fetchWallets} disabled={isUpdating}>
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                <span className="ml-2">Retry</span>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Table */}
        {loading && (
          <div className="border rounded-lg bg-card">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="border-b last:border-0 p-3">
                <Skeleton className="h-14 w-full" />
              </div>
            ))}
          </div>
        )}

        {!loading && wallets.length > 0 && (
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/50">
                  <tr className="align-bottom">
                    <th className="text-left p-3 font-medium text-sm">Wallet</th>
                    <th className="text-left p-3 font-medium text-sm">Recency</th>
                    <th className="text-left p-3 font-medium text-sm">
                      <div className="inline-flex items-center gap-1">
                        Behavior tag
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Signal we think makes this wallet worth a look (flipping speed, explorer behavior, profitability, or recent activity).
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </th>
                    <th className="text-left p-3 font-medium text-sm">
                      <div className="inline-flex items-center gap-1">
                        Trading style
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>Classification from behavior analysis.</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </th>
                    <th className="text-right p-3 font-medium text-sm">Trades</th>
                    <th className="text-right p-3 font-medium text-sm">
                      <div className="inline-flex items-center gap-1 justify-end">
                        Tokens
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>Unique tokens traded (0 can mean token metadata not captured yet).</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </th>
                    <th className="text-right p-3 font-medium text-sm">Hold</th>
                    <th className="text-right p-3 font-medium text-sm">PnL</th>
                    <th className="text-right p-3 font-medium text-sm">Win</th>
                    <th className="text-right p-3 font-medium text-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map((wallet) => (
                    <WalletRow key={wallet.walletAddress} wallet={wallet} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && wallets.length === 0 && (
          <div className="border rounded-lg bg-card p-12 text-center space-y-3">
            <p className="text-muted-foreground">No wallets match these filters yet.</p>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSort('interesting');
                  setStyle('any');
                  setHoldBias('any');
                  setMinTradeCount('');
                  setMinUniqueTokens('');
                  setPage(1);
                  setActivePreset(null);
                }}
              >
                Reset filters
              </Button>
              <Button size="sm" variant="secondary" onClick={() => applyPreset('balanced-fast')}>
                Try Balanced Fast
              </Button>
              <Button size="sm" variant="secondary" onClick={() => applyPreset('hyper-flipper')}>
                Try Hyper Flipper
              </Button>
            </div>
          </div>
        )}

        {/* Pagination */}
        {!loading && wallets.length > 0 && (
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Page {page} of {pageCount} · {total} wallets
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function WalletRow({ wallet }: { wallet: DiscoverWallet }) {
  const reasonMeta = getBehaviorPresentation(wallet);
  const reasonColor = reasonColorMap[wallet.reasonCode] || reasonColorMap.INTERESTING;
  const lastActive = formatLastActive(wallet.metrics.lastActiveAt);
  const updatedAgo = formatUpdatedAgo(wallet);

  // Trades with buy/sell breakdown
  const trades = wallet.metrics.totalTrades ?? wallet.metrics.totalExecutedSwaps;
  const buys = wallet.metrics.totalBuys ?? null;
  const sells = wallet.metrics.totalSells ?? null;
  const tradesDisplay = trades === null || trades === undefined ? "—" : trades.toLocaleString();
  const hasBuySellData = buys !== null && sells !== null;

  // PnL - prioritize unrealized for holders
  const unrealizedPnl = wallet.metrics.unrealizedPnl;
  const realizedPnl = wallet.metrics.realizedPnl;
  const hasUnrealizedPnl = unrealizedPnl !== null && unrealizedPnl !== undefined;

  const pnlValue = hasUnrealizedPnl ? unrealizedPnl : realizedPnl;
  const pnlLabel = hasUnrealizedPnl ? "unrealized" : "realized";
  const pnlDisplay =
    pnlValue === null || pnlValue === undefined
      ? "—"
      : `${formatPnLValue(pnlValue)} SOL`;
  const pnlClass =
    pnlValue !== null && pnlValue !== undefined && pnlValue > 0
      ? "text-green-600"
      : pnlValue !== null && pnlValue !== undefined && pnlValue < 0
        ? "text-red-600"
        : "";

  const winRateDisplay =
    wallet.metrics.winRatePercent !== null && wallet.metrics.winRatePercent !== undefined
      ? `${Math.round(wallet.metrics.winRatePercent)}%`
      : "—";
  const holdDisplay = formatHours(wallet.metrics.medianHoldHours ?? wallet.metrics.averageHoldHours);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors align-top">
      <td className="p-3">
        <div className="space-y-2">
          <WalletBadge address={wallet.walletAddress} className="text-xs px-2 py-1 bg-muted/80 hover:bg-muted" />
        </div>
      </td>
      <td className="p-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 flex-shrink-0" />
            <span>{lastActive.text}</span>
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              updatedAgo.status === "fresh"
                ? "text-emerald-600"
                : updatedAgo.status === "stale"
                  ? "text-amber-600"
                  : "text-muted-foreground"
            )}
          >
            <RefreshCcw className="h-3 w-3 flex-shrink-0" />
            <span>upd. {updatedAgo.label}</span>
          </div>
        </div>
      </td>
      <td className="p-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={`text-[11px] font-medium ${reasonColor}`}>
                {reasonMeta.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-medium mb-1">{reasonMeta.label}</p>
              <p className="text-xs text-muted-foreground">{reasonMeta.detail}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
      <td className="p-3 align-top">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{wallet.metrics.tradingStyle || "Unknown"}</div>
          <div className="text-xs text-muted-foreground">
            {holdDisplay} avg hold
          </div>
        </div>
      </td>
      <td className="p-3 text-right align-top">
        <div className="flex flex-col items-end">
          <div className="text-sm font-medium">{tradesDisplay}</div>
          {hasBuySellData && (
            <div className="text-xs text-muted-foreground">
              <span className="text-green-600">{buys}↑</span>
              {" / "}
              <span className="text-red-600">{sells}↓</span>
            </div>
          )}
        </div>
      </td>
      <td className="p-3 text-right text-sm align-top">
        {wallet.metrics.uniqueTokensTraded ?? "—"}
      </td>
      <td className="p-3 text-right text-sm">
        {holdDisplay}
      </td>
      <td className="p-3 text-right align-top">
        <div className="flex flex-col items-end">
          <div className={cn("text-sm font-medium", pnlClass)}>{pnlDisplay}</div>
          {pnlValue !== null && pnlValue !== undefined && (
            <div className="text-xs text-muted-foreground">{pnlLabel}</div>
          )}
        </div>
      </td>
      <td className="p-3 text-right text-sm">
        {winRateDisplay}
      </td>
      <td className="p-3 text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/wallets/${wallet.walletAddress}`}>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </td>
    </tr>
  );
}
