"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowRight,
  Calendar,
  Check,
  Copy,
  Loader2,
  RefreshCcw,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { WalletBadge } from "@/components/shared/WalletBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  { value: 'flipper', label: 'Flipper' },
  { value: 'swing', label: 'Swing' },
  { value: 'position', label: 'Position' },
  { value: 'holder', label: 'Holder' },
  { value: 'scalper', label: 'Scalper' },
  { value: 'sniper', label: 'Sniper' },
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
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  if (wallet.lastUpdatedAt) {
    const date = new Date(wallet.lastUpdatedAt);
    if (!Number.isNaN(date.getTime())) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
  }

  return "Unknown recency";
};

const formatPnLValue = (val?: number | null) => {
  if (val === null || val === undefined) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}`;
};

const getBehaviorPresentation = (wallet: DiscoverWallet) => {
  const map = behaviorTagCopy[wallet.reasonCode] || behaviorTagCopy.INTERESTING;
  const hold = wallet.metrics.medianHoldHours ?? wallet.metrics.averageHoldHours;
  const trades = wallet.metrics.totalTrades ?? wallet.metrics.totalExecutedSwaps;

  let detail = map.fallbackDetail;
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
    detail,
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

  const handleCopy = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success('Copied to clipboard');
  };

  const applyPreset = (preset: 'hyper-flipper' | 'balanced-fast' | 'patient-holder') => {
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
      <div className="container max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Discover Wallets</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Explainable picks from cached snapshots with clear reasons to explore further.
            </p>
          </div>
          <Badge variant="outline" className="text-xs px-3 py-1">
            Curated &amp; cache-friendly
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Guide the hunt</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Filters stay open so you can steer the list without digging through menus.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => applyPreset('hyper-flipper')}>
                  Hyper Flipper
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset('balanced-fast')}>
                  Balanced Fast
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset('patient-holder')}>
                  Patient Holder
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Sort wallets</Label>
                <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose sorting" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <div>
                          <div className="font-medium">{o.label}</div>
                          <div className="text-xs text-muted-foreground">{o.hint}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Pick what you care about first: activity, PnL, or freshness.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Trading style</Label>
                <Select value={style} onValueChange={(v) => { setStyle(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any style" />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Narrow to flippers, swing traders, or let us mix them.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Hold bias</Label>
                <Select value={holdBias} onValueChange={(v) => { setHoldBias(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any hold bias" />
                  </SelectTrigger>
                  <SelectContent>
                    {holdBiasOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose whether to spotlight sprinters or patient holders.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Min trades</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 10"
                  className="w-full"
                  value={minTradeCount === '' ? '' : String(minTradeCount)}
                  onChange={(e) => {
                    setMinTradeCount(e.target.value === '' ? '' : Number(e.target.value));
                    setPage(1);
                  }}
                />
                <p className="text-xs text-muted-foreground">Ignore wallets with only a couple of interactions.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Min tokens touched</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 5"
                  className="w-full"
                  value={minUniqueTokens === '' ? '' : String(minUniqueTokens)}
                  onChange={(e) => {
                    setMinUniqueTokens(e.target.value === '' ? '' : Number(e.target.value));
                    setPage(1);
                  }}
                />
                <p className="text-xs text-muted-foreground">Focus on explorers instead of single-token experiments.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Filters apply instantly; refresh if you want a clean fetch.
              </p>
              <Button variant="outline" size="sm" onClick={fetchWallets} disabled={isUpdating}>
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                <span className="ml-2 hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </CardContent>
        </Card>

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
          <Card>
            <CardContent className="p-0">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="border-b last:border-0 p-4">
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && wallets.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-sm">Wallet</th>
                      <th className="text-left p-3 font-medium text-sm">Activity</th>
                      <th className="text-left p-3 font-medium text-sm">Behavior Tag</th>
                      <th className="text-left p-3 font-medium text-sm">Trading Style</th>
                      <th className="text-right p-3 font-medium text-sm">Trades</th>
                      <th className="text-right p-3 font-medium text-sm">Tokens</th>
                      <th className="text-right p-3 font-medium text-sm">Hold Time</th>
                      <th className="text-right p-3 font-medium text-sm">PnL</th>
                      <th className="text-right p-3 font-medium text-sm">Win Rate</th>
                      <th className="text-right p-3 font-medium text-sm"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map((wallet) => (
                      <WalletRow key={wallet.walletAddress} wallet={wallet} onCopy={handleCopy} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && wallets.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center space-y-3">
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
                  }}
                >
                  Reset filters
                </Button>
                <Button size="sm" variant="secondary" onClick={() => applyPreset('balanced-fast')}>
                  Try Balanced Fast
                </Button>
              </div>
            </CardContent>
          </Card>
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

function WalletRow({ wallet, onCopy }: { wallet: DiscoverWallet; onCopy: (address: string) => void }) {
  const [copied, setCopied] = useState(false);
  const reasonMeta = getBehaviorPresentation(wallet);
  const reasonColor = reasonColorMap[wallet.reasonCode] || reasonColorMap.INTERESTING;
  const lastActive = formatLastActive(wallet.metrics.lastActiveAt);
  const updatedAgo = formatUpdatedAgo(wallet);
  const trades = wallet.metrics.totalTrades ?? wallet.metrics.totalExecutedSwaps;
  const tradesDisplay =
    trades === null || trades === undefined ? "—" : trades.toLocaleString();
  const pnlDisplay =
    wallet.metrics.realizedPnl === null || wallet.metrics.realizedPnl === undefined
      ? "—"
      : `${formatPnLValue(wallet.metrics.realizedPnl)} SOL`;
  const pnlClass =
    wallet.metrics.realizedPnl !== null && wallet.metrics.realizedPnl !== undefined && wallet.metrics.realizedPnl > 0
      ? "text-green-600"
      : wallet.metrics.realizedPnl !== null && wallet.metrics.realizedPnl !== undefined && wallet.metrics.realizedPnl < 0
        ? "text-red-600"
        : "";

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors align-top">
      <td className="p-3">
        <div className="space-y-2">
          <WalletBadge address={wallet.walletAddress} className="text-xs px-2 py-1 bg-muted/80 hover:bg-muted" />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {lastActive.text}
                  </span>
                </TooltipTrigger>
                {lastActive.tooltip && (
                  <TooltipContent>
                    <p>Last on-chain activity</p>
                    <p className="text-xs text-muted-foreground">{lastActive.tooltip}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            <span className="inline-flex items-center gap-1">
              <RefreshCcw className="h-3 w-3" />
              Updated {updatedAgo}
            </span>
            <button
              onClick={() => {
                onCopy(wallet.walletAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>Copy</span>
            </button>
          </div>
        </div>
      </td>
      <td className="p-3">
        <div className="space-y-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className={`text-[11px] ${reasonColor}`}>
                  {reasonMeta.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="font-medium">{reasonMeta.label}</p>
                <p className="text-xs text-muted-foreground">{reasonMeta.rawReason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p className="text-xs text-muted-foreground">{reasonMeta.detail}</p>
        </div>
      </td>
      <td className="p-3 align-top">
        <span className="text-sm">{wallet.metrics.tradingStyle || "—"}</span>
      </td>
      <td className="p-3 text-right text-sm align-top">
        {tradesDisplay}
      </td>
      <td className="p-3 text-right text-sm align-top">
        {wallet.metrics.uniqueTokensTraded ?? "—"}
      </td>
      <td className="p-3 text-right text-sm">
        {formatHours(wallet.metrics.medianHoldHours ?? wallet.metrics.averageHoldHours)}
      </td>
      <td className="p-3 text-right text-sm">
        <span className={pnlClass}>{pnlDisplay}</span>
      </td>
      <td className="p-3 text-right text-sm">
        {wallet.metrics.winRatePercent !== null && wallet.metrics.winRatePercent !== undefined
          ? `${Math.round(wallet.metrics.winRatePercent)}%`
          : "—"}
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
