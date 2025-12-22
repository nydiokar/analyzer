'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from '@/components/layout/AppShell';
import { cn } from '@/lib/utils';
import { fetcher } from '@/lib/fetcher';
import { DiscoverWallet, DiscoverWalletsResponse } from '@/types/discover';
import { toast } from 'sonner';
import {
  ArrowRight,
  Clock,
  Compass,
  Copy,
  Filter,
  Info,
  LineChart,
  Loader2,
  RefreshCcw,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const PAGE_SIZE = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;

const sortOptions = [
  { value: 'interesting', label: 'Interesting (default)', hint: 'Activity + PnL + recency' },
  { value: 'most_active', label: 'Most active', hint: 'Trade count first' },
  { value: 'best_pnl', label: 'Best PnL', hint: 'Realized PnL focus' },
  { value: 'longest_holders', label: 'Longest holders', hint: 'Prefers long hold time' },
  { value: 'recently_updated', label: 'Recently updated', hint: 'Freshest analyses' },
] as const;

const freshnessOptions = [
  { value: '', label: 'Any freshness' },
  { value: '24', label: 'Updated in last 24h' },
  { value: '72', label: 'Updated in last 72h' },
] as const;

const styleOptions = [
  { value: '', label: 'Any style' },
  { value: 'flipper', label: 'Flipper / Scalper' },
  { value: 'swing', label: 'Swing' },
  { value: 'position', label: 'Position' },
  { value: 'holder', label: 'Holder' },
  { value: 'scalper', label: 'Scalper' },
  { value: 'sniper', label: 'Sniper' },
] as const;

const holdBiasOptions = [
  { value: '', label: 'Any hold bias' },
  { value: 'short', label: 'Short (<12h)' },
  { value: 'medium', label: 'Medium (12–72h)' },
  { value: 'long', label: 'Long (>72h)' },
] as const;

const reasonClassMap: Record<string, string> = {
  WINNER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ACTIVE: 'bg-blue-100 text-blue-800 border-blue-200',
  HOLDER: 'bg-amber-100 text-amber-800 border-amber-200',
  FLIPPER: 'bg-pink-100 text-pink-800 border-pink-200',
  EXPLORER: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  RECENT: 'bg-purple-100 text-purple-800 border-purple-200',
  PNL: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  INTERESTING: 'bg-slate-100 text-slate-800 border-slate-200',
};

type CacheShape = { timestamp: number; data: DiscoverWalletsResponse };

const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
const formatPnL = (value?: number | null) =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} SOL`;
const formatWinRate = (value?: number | null) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;
const formatNumber = (value?: number | null) =>
  value === null || value === undefined ? '—' : value.toLocaleString();
const formatHours = (value?: number | null) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}h`;
const timeAgo = (iso?: string | null) => {
  if (!iso) return 'Unknown';
  const deltaMs = Date.now() - new Date(iso).getTime();
  const hours = Math.max(1, Math.round(deltaMs / (1000 * 60 * 60)));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const stalenessLabel = (minutes?: number | null) => {
  if (minutes === null || minutes === undefined) return 'Staleness unknown';
  if (minutes < 90) return 'Fresh < 90m';
  if (minutes < 1440) return `Updated ${Math.round(minutes / 60)}h ago`;
  return `Updated ${Math.round(minutes / 1440)}d ago`;
};

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
    // Ignore cache errors
  }
};

export default function DiscoverPage() {
  const [wallets, setWallets] = useState<DiscoverWallet[]>([]);
  const [sort, setSort] = useState<string>('interesting');
  const [minTradeCount, setMinTradeCount] = useState<number | ''>('');
  const [minFreshnessHours, setMinFreshnessHours] = useState<number | ''>('');
  const [style, setStyle] = useState<string>('');
  const [minUniqueTokens, setMinUniqueTokens] = useState<number | ''>('');
  const [holdBias, setHoldBias] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = useMemo(
    () =>
      `discover:${sort}:${page}:${minTradeCount || 'any'}:${minFreshnessHours || 'any'}:${style || 'any'}:${minUniqueTokens || 'any'}:${holdBias || 'any'}:${PAGE_SIZE}`,
    [sort, page, minTradeCount, minFreshnessHours, style, minUniqueTokens, holdBias],
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

      if (minTradeCount !== '' && minTradeCount > 0) {
        params.set('minTradeCount', String(minTradeCount));
      }
      if (minFreshnessHours !== '' && minFreshnessHours > 0) {
        params.set('minFreshnessHours', String(minFreshnessHours));
      }
      if (style) {
        params.set('style', style);
      }
      if (minUniqueTokens !== '' && minUniqueTokens > 0) {
        params.set('minUniqueTokens', String(minUniqueTokens));
      }
      if (holdBias) {
        params.set('holdBias', holdBias);
      }

      const data = (await fetcher(`/discover/wallets?${params.toString()}`)) as DiscoverWalletsResponse;
      setWallets(data.items || []);
      setTotal(data.total || 0);
      writeCache(cacheKey, data);
    } catch (err: unknown) {
      const fallback = 'Failed to load discover wallets. Please try again.';
      const errorMessage =
        (err as { payload?: { message?: string } })?.payload?.message ||
        (err as Error).message ||
        fallback;
      setError(errorMessage || fallback);
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, [cacheKey, minFreshnessHours, minTradeCount, page, sort]);

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
    toast.success('Wallet copied', {
      description: 'Wallet address copied to clipboard.',
    });
  };

  const handleRetry = () => fetchWallets();

  const applyPreset = (preset: 'hyper-flipper' | 'balanced-fast' | 'patient-holder') => {
    if (preset === 'hyper-flipper') {
      setStyle('flipper');
      setHoldBias('short');
      setMinTradeCount(20);
      setMinUniqueTokens(5);
      setMinFreshnessHours(72);
    } else if (preset === 'balanced-fast') {
      setStyle('swing');
      setHoldBias('medium');
      setMinTradeCount(30);
      setMinUniqueTokens(8);
      setMinFreshnessHours('');
    } else if (preset === 'patient-holder') {
      setStyle('holder');
      setHoldBias('long');
      setMinTradeCount(10);
      setMinUniqueTokens(3);
      setMinFreshnessHours(168); // one week
    }
    setPage(1);
    fetchWallets();
  };

  return (
    <AppShell>
      <div className="container max-w-6xl mx-auto px-6 py-10 space-y-8">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-cyan-500/20 flex items-center justify-center">
              <Compass className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Discover wallets</h1>
              <p className="text-sm text-muted-foreground">
                Rotating, explainable picks sourced from cached PnL and behavior snapshots. No rescans, no heavy
                queries.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-800">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span>Fast first paint with cached results</span>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-800">
              <LineChart className="h-4 w-4 text-blue-500" />
              <span>Ranking uses precomputed summaries only</span>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-800">
              <Clock className="h-4 w-4 text-purple-500" />
              <span>Stable order · ties by address</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="secondary" onClick={() => applyPreset('hyper-flipper')}>
                    Hyper flipper
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold">Hyper flipper</p>
                  <p className="text-xs text-muted-foreground">
                    Targets very short holds with flipper-style behavior, 20+ trades, 5+ tokens, recent updates.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="secondary" onClick={() => applyPreset('balanced-fast')}>
                    Balanced fast
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold">Balanced fast</p>
                  <p className="text-xs text-muted-foreground">
                    Medium holds (hours), higher trade count, and broader token mix for consistent fast actors.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="secondary" onClick={() => applyPreset('patient-holder')}>
                    Patient holder
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold">Patient holder</p>
                  <p className="text-xs text-muted-foreground">
                    Long-bias styles (>72h holds) with some history and multiple tokens; good for position takers.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>

        <section className="rounded-xl border bg-card">
          <div className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span>Filters & ordering</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[200px]">
                <Select
                  value={sort}
                  onValueChange={(value) => {
                    setSort(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex flex-col text-left">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.hint}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[160px]">
                <Input
                  type="number"
                  value={minTradeCount}
                  min={0}
                  onChange={(e) => {
                    const value = e.target.value === '' ? '' : Number(e.target.value);
                    setMinTradeCount(value);
                    setPage(1);
                  }}
                  placeholder="Min trades"
                />
              </div>

              <div className="min-w-[160px]">
                <Input
                  type="number"
                  value={minUniqueTokens}
                  min={0}
                  onChange={(e) => {
                    const value = e.target.value === '' ? '' : Number(e.target.value);
                    setMinUniqueTokens(value);
                    setPage(1);
                  }}
                  placeholder="Min unique tokens"
                />
              </div>

              <div className="min-w-[180px]">
                <Select
                  value={style}
                  onValueChange={(value) => {
                    setStyle(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Style" />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((option) => (
                      <SelectItem key={option.value || 'any-style'} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[180px]">
                <Select
                  value={holdBias}
                  onValueChange={(value) => {
                    setHoldBias(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Hold bias" />
                  </SelectTrigger>
                  <SelectContent>
                    {holdBiasOptions.map((option) => (
                      <SelectItem key={option.value || 'any-hold'} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[180px]">
                <Select
                  value={minFreshnessHours === '' ? '' : String(minFreshnessHours)}
                  onValueChange={(value) => {
                    setMinFreshnessHours(value === '' ? '' : Number(value));
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Freshness" />
                  </SelectTrigger>
                  <SelectContent>
                    {freshnessOptions.map((option) => (
                      <SelectItem key={option.value || 'any'} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="outline" size="sm" onClick={fetchWallets} disabled={isUpdating}>
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing
                  </>
                ) : (
                  <>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
          <div className="p-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Ranking contract:</span>{' '}
            Behavioral patterns first (flipper score, hold bias, token breadth), then activity, mild PnL tie-break, then recency, tie-breaker by address. Cached summaries only.
          </div>
        </section>

        {error && (
          <Card className="p-6 border-red-200 bg-red-50 text-red-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">Could not load wallets</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
              <Button onClick={handleRetry} variant="outline">
                Try again
              </Button>
            </div>
          </Card>
        )}

        <section className="grid gap-4">
          {loading && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Card key={idx} className="p-5 h-full">
                  <div className="flex justify-between mb-4">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-40" />
                    <div className="grid grid-cols-2 gap-3">
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-5 w-full" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!loading && wallets.length === 0 && (
            <Card className="p-8 text-center">
              <div className="flex flex-col items-center gap-3">
                <Zap className="h-8 w-8 text-muted-foreground" />
                <p className="text-lg font-semibold">No wallets match these filters yet.</p>
                <p className="text-sm text-muted-foreground">
                  Loosen filters or refresh to pull the latest cached list.
                </p>
                <Button onClick={handleRetry} variant="secondary">
                  Reset filters
                </Button>
              </div>
            </Card>
          )}

          {!loading && wallets.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {wallets.map((wallet) => (
                <WalletCard key={wallet.walletAddress} wallet={wallet} onCopy={handleCopy} />
              ))}
            </div>
          )}
        </section>

        {!loading && wallets.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Page {page} of {pageCount} · {total || wallets.length} wallets
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  icon,
  help,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  help?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
        {help && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{help}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

function WalletCard({ wallet, onCopy }: { wallet: DiscoverWallet; onCopy: (address: string) => void }) {
  const staleness = stalenessLabel(wallet.metrics.stalenessMinutes);
  const lastActive = wallet.metrics.lastActiveAt ? timeAgo(wallet.metrics.lastActiveAt) : 'No recent trades';

  const reasonClass = reasonClassMap[wallet.reasonCode] || reasonClassMap.INTERESTING;
  const tradingStyleLabel = wallet.metrics.tradingStyle
    ? wallet.metrics.tradingStyle.toUpperCase()
    : null;

  return (
    <Card className="p-5 h-full flex flex-col gap-4 border border-slate-200 shadow-sm hover:shadow-lg transition-shadow duration-150">
      <div className="flex items-start justify-between gap-2">
        <Badge className={cn('text-xs border', reasonClass)}>{wallet.reason}</Badge>
        <div className="text-[11px] text-muted-foreground">{staleness}</div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-lg text-foreground">{shortAddress(wallet.walletAddress)}</p>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onCopy(wallet.walletAddress)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {wallet.metrics.totalTrades ? `${wallet.metrics.totalTrades.toLocaleString()} trades` : 'Trades unavailable'}
          </p>
          {tradingStyleLabel && (
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Style: {tradingStyleLabel}
            </p>
          )}
        </div>
        <Button asChild size="sm" variant="secondary" className="gap-1">
          <Link href={`/wallets/${wallet.walletAddress}`}>
            View
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Realized PnL"
          value={formatPnL(wallet.metrics.realizedPnl)}
          help="Completed trades only; cached snapshot."
        />
        <Metric
          label="Win rate"
          value={formatWinRate(wallet.metrics.winRatePercent)}
          help="Percent of tokens with positive PnL in the snapshot window."
        />
        <Metric
          label="Unique tokens"
          value={formatNumber(wallet.metrics.uniqueTokensTraded)}
          help="Distinct tokens this wallet traded."
        />
        <Metric
          label="Avg hold"
          value={formatHours(wallet.metrics.averageHoldHours ?? wallet.metrics.medianHoldHours)}
          help="Median/average time between buy and sell; shorter = faster flips."
        />
        <Metric
          label="Trades (cached)"
          value={formatNumber(wallet.metrics.totalExecutedSwaps ?? wallet.metrics.totalTrades)}
          help="Trade count from cached summaries (not live)."
        />
        <Metric
          label="Last active"
          value={lastActive}
          icon={<Clock className="h-3.5 w-3.5" />}
          help="Most recent transaction time in cached behavior profile."
        />
      </div>
    </Card>
  );
}
