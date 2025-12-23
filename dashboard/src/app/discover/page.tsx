'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from '@/components/layout/AppShell';
import { fetcher } from '@/lib/fetcher';
import { DiscoverWallet, DiscoverWalletsResponse } from '@/types/discover';
import { toast } from 'sonner';
import {
  ArrowRight,
  Copy,
  Check,
  RefreshCcw,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

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
  const [filtersExpanded, setFiltersExpanded] = useState(false);

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Discover Wallets</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Explainable picks from cached snapshots
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

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Filters</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiltersExpanded(!filtersExpanded)}
              >
                {filtersExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    More
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[200px]">
                <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue />
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
              </div>

              {filtersExpanded && (
                <>
                  <div className="min-w-[150px]">
                    <Select value={style} onValueChange={(v) => { setStyle(v); setPage(1); }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {styleOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-[150px]">
                    <Select value={holdBias} onValueChange={(v) => { setHoldBias(v); setPage(1); }}>
                      <SelectTrigger>
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
                    placeholder="Min trades"
                    className="w-32"
                    value={minTradeCount}
                    onChange={(e) => {
                      setMinTradeCount(e.target.value === '' ? '' : Number(e.target.value));
                      setPage(1);
                    }}
                  />

                  <Input
                    type="number"
                    placeholder="Min tokens"
                    className="w-32"
                    value={minUniqueTokens}
                    onChange={(e) => {
                      setMinUniqueTokens(e.target.value === '' ? '' : Number(e.target.value));
                      setPage(1);
                    }}
                  />
                </>
              )}

              <Button variant="outline" size="default" onClick={fetchWallets} disabled={isUpdating}>
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

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
                      <th className="text-left p-3 font-medium text-sm">Reason</th>
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
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">No wallets found. Try adjusting filters.</p>
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
  const shortAddress = `${wallet.walletAddress.slice(0, 6)}...${wallet.walletAddress.slice(-4)}`;
  const reasonColor = reasonColorMap[wallet.reasonCode] || reasonColorMap.INTERESTING;

  const handleCopy = () => {
    onCopy(wallet.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatPnL = (val?: number | null) => {
    if (val === null || val === undefined) return '—';
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}`;
  };

  const formatHours = (val?: number | null) => {
    if (!val) return '—';
    if (val < 1) return `${Math.round(val * 60)}m`;
    if (val < 24) return `${Math.round(val)}h`;
    return `${Math.round(val / 24)}d`;
  };

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono">{shortAddress}</code>
          <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground">
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
      <td className="p-3">
        <Badge variant="outline" className={`text-xs ${reasonColor}`}>
          {wallet.reason}
        </Badge>
      </td>
      <td className="p-3">
        <span className="text-sm">{wallet.metrics.tradingStyle || '—'}</span>
      </td>
      <td className="p-3 text-right text-sm">{wallet.metrics.totalTrades?.toLocaleString() || '—'}</td>
      <td className="p-3 text-right text-sm">{wallet.metrics.uniqueTokensTraded || '—'}</td>
      <td className="p-3 text-right text-sm">
        {formatHours(wallet.metrics.medianHoldHours || wallet.metrics.averageHoldHours)}
      </td>
      <td className="p-3 text-right text-sm">
        <span className={wallet.metrics.realizedPnl && wallet.metrics.realizedPnl > 0 ? 'text-green-600' : wallet.metrics.realizedPnl && wallet.metrics.realizedPnl < 0 ? 'text-red-600' : ''}>
          {formatPnL(wallet.metrics.realizedPnl)} SOL
        </span>
      </td>
      <td className="p-3 text-right text-sm">
        {wallet.metrics.winRatePercent ? `${Math.round(wallet.metrics.winRatePercent)}%` : '—'}
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
