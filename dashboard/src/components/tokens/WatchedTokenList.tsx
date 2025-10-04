"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWatchedTokens, type WatchedTokenRow } from '@/hooks/useWatchedTokens';
import { useMessagesSocket } from '@/hooks/useMessagesSocket';
import { TokenBadge } from '@/components/shared/TokenBadge';
import Sparkline from '@/components/shared/Sparkline';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Star, ArrowUpDown, Filter, TrendingUp, Droplet, BarChart3 } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

const PIN_STORAGE_KEY = 'tokens:pinned';

type SortOption = 'activity' | 'marketCap' | 'liquidity' | 'alphabetical';

interface WatchedTokenListProps {
  onSelect?: (tokenAddress: string) => void;
  selectedToken?: string;
}

type SparklineEntry = { series: number[]; trend: number };

function readPinnedFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((addr) => typeof addr === 'string');
  } catch {
    return [];
  }
}

function writePinnedToStorage(addrs: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(addrs));
  } catch {
    // noop
  }
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompactNumber(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return `$${compactFormatter.format(value)}`;
}

function formatPrice(value?: string | number | null) {
  if (value == null) return null;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return null;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(6)}`;
}

function extractChange(row: WatchedTokenRow): number | null {
  const raw =
    (row as any).change24hPct ??
    (row as any).change24hPercent ??
    (row as any).priceChange24hPct ??
    (row as any).priceChange24Percent ??
    (row as any).priceChange24h ??
    null;
  if (raw == null) return null;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(num)) return null;
  return num;
}

function formatChange(change: number) {
  const abs = Math.abs(change);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = change > 0 ? '+' : '';
  return `${prefix}${change.toFixed(decimals)}%`;
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return '--';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '--';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'now';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export default function WatchedTokenList({ onSelect, selectedToken }: WatchedTokenListProps) {
  const { data, isLoading, error, mutate } = useWatchedTokens('FAVORITES');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('activity');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [pinnedAddresses, setPinnedAddresses] = useState<string[]>(() => readPinnedFromStorage());
  const [, setSparklineVersion] = useState(0);
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, number>>({});
  const sparklineCacheRef = useRef<Record<string, SparklineEntry>>({});
  const inflightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useMessagesSocket({
    onMessageCreated: () => {
      mutate();
      setTimeout(() => mutate(), 1200);
    },
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next: Record<string, number> = {};
    for (const token of data) {
      const stored = window.localStorage.getItem(`lastSeen:token:${token.tokenAddress}`);
      if (!stored) continue;
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) next[token.tokenAddress] = parsed;
    }
    setLastSeenMap((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every((key) => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    writePinnedToStorage(pinnedAddresses);
  }, [pinnedAddresses]);

  useEffect(() => {
    if (!selectedToken) return;
    if (typeof window === 'undefined') return;
    const now = Date.now();
    try {
      window.localStorage.setItem(`lastSeen:token:${selectedToken}`, String(now));
    } catch {
      // ignore
    }
    setLastSeenMap((prev) => {
      if (prev[selectedToken] === now) return prev;
      return { ...prev, [selectedToken]: now };
    });
  }, [selectedToken]);

  const fetchSparkline = useCallback(async (addr: string) => {
    if (!addr) return;
    if (sparklineCacheRef.current[addr] || inflightRef.current.has(addr)) return;
    inflightRef.current.add(addr);
    try {
      const res = await fetcher(`/token-info/${encodeURIComponent(addr)}/sparkline?points=24`);
      const points = (res?.points as Array<[number, number]> | undefined) || [];
      const series = points
        .map(([, price]) => Number(price))
        .filter((value) => Number.isFinite(value));
      const trend = series.length >= 2 ? Math.sign(series[series.length - 1] - series[0]) : 0;
      sparklineCacheRef.current[addr] = { series, trend };
      if (mountedRef.current) {
        setSparklineVersion((version) => version + 1);
      }
    } catch {
      // allow retry later
    } finally {
      inflightRef.current.delete(addr);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (data.length === 0) return;
    const timers: number[] = [];
    const seeds = data.slice(0, Math.min(6, data.length));
    seeds.forEach((token, index) => {
      const timer = window.setTimeout(() => {
        fetchSparkline(token.tokenAddress);
      }, index * 120);
      timers.push(timer);
    });
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [data, fetchSparkline]);

  const handlePinToggle = useCallback((addr: string) => {
    setPinnedAddresses((prev) => {
      const has = prev.includes(addr);
      const next = has ? prev.filter((item) => item !== addr) : [addr, ...prev];
      return Array.from(new Set(next));
    });
  }, []);

  const pinnedSet = useMemo(() => new Set(pinnedAddresses), [pinnedAddresses]);

  const unreadMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const token of data) {
      const latest = token.latestMessageAt ? Date.parse(token.latestMessageAt) : 0;
      const seen = lastSeenMap[token.tokenAddress] ?? 0;
      map[token.tokenAddress] = Boolean(latest && latest > seen);
    }
    return map;
  }, [data, lastSeenMap]);

  const filteredTokens = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const matches = data.filter((token) => {
      if (!term) return true;
      const symbol = token.symbol?.toLowerCase() ?? '';
      const name = token.name?.toLowerCase() ?? '';
      const address = token.tokenAddress.toLowerCase();
      const tags = (token.tags || []).some((tag) => tag.name.toLowerCase().includes(term));
      return symbol.includes(term) || name.includes(term) || address.includes(term) || tags;
    });

    const subset = showUnreadOnly ? matches.filter((token) => unreadMap[token.tokenAddress]) : matches;

    const sorted = subset.slice().sort((a, b) => {
      switch (sortBy) {
        case 'marketCap': {
          const aVal = a.marketCapUsd ?? 0;
          const bVal = b.marketCapUsd ?? 0;
          return bVal - aVal;
        }
        case 'liquidity': {
          const aVal = a.liquidityUsd ?? 0;
          const bVal = b.liquidityUsd ?? 0;
          return bVal - aVal;
        }
        case 'alphabetical': {
          const aLabel = (a.symbol || a.name || '').toLowerCase();
          const bLabel = (b.symbol || b.name || '').toLowerCase();
          return aLabel.localeCompare(bLabel);
        }
        case 'activity':
        default: {
          const aTs = a.latestMessageAt ? Date.parse(a.latestMessageAt) : 0;
          const bTs = b.latestMessageAt ? Date.parse(b.latestMessageAt) : 0;
          return bTs - aTs;
        }
      }
    });

    if (pinnedSet.size === 0) return sorted;

    const pinned: WatchedTokenRow[] = [];
    const rest: WatchedTokenRow[] = [];
    for (const token of sorted) {
      if (pinnedSet.has(token.tokenAddress)) pinned.push(token);
      else rest.push(token);
    }
    return [...pinned, ...rest];
  }, [data, searchTerm, sortBy, showUnreadOnly, unreadMap, pinnedSet]);

  const sparklineCache = sparklineCacheRef.current;
  const hasError = Boolean(error);
  const visibleCount = filteredTokens.length;

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 space-y-3 border-b border-white/5 bg-[#14141B] px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search tokens or tags"
              className="h-9 w-full rounded-md border-none bg-[#1B1B24] pl-9 text-sm text-white/80 placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/30"
              aria-label="Search watched tokens"
            />
          </div>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="h-9 w-[180px] rounded-md border-none bg-[#1B1B24] px-3 text-xs text-white/70 focus-visible:ring-1 focus-visible:ring-white/30">
              <SelectValue placeholder="Sort tokens" />
            </SelectTrigger>
            <SelectContent className="border border-border bg-[#1F1F29] text-xs text-foreground">
              <SelectItem value="activity">Recent activity</SelectItem>
              <SelectItem value="marketCap">Market cap</SelectItem>
              <SelectItem value="liquidity">Liquidity</SelectItem>
              <SelectItem value="alphabetical">Alphabetical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/50">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowUnreadOnly((prev) => !prev)}
            className={cn(
              'h-8 rounded-md bg-transparent px-2 text-xs text-white/60 hover:bg-white/10 hover:text-white',
              showUnreadOnly && 'bg-white/10 text-white'
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Unread only
          </Button>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-white/40" />
            <span>{visibleCount} tokens</span>
          </div>
        </div>
      </div>

      {hasError ? (
        <div className="px-4 py-6 text-sm text-rose-400">Failed to load tokens</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {filteredTokens.length === 0 ? (
            <div className="px-4 py-12 text-sm text-white/60">
              {isLoading ? 'Loading tokens...' : searchTerm ? 'No tokens match your search yet.' : 'No watched tokens yet.'}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredTokens.map((token) => {
                const pinned = pinnedSet.has(token.tokenAddress);
                const change = extractChange(token);
                const changeLabel = change != null ? formatChange(change) : null;
                const changeColor =
                  change == null ? 'text-white/60' : change > 0 ? 'text-emerald-400' : change < 0 ? 'text-rose-400' : 'text-white/60';
                const priceLabel = formatPrice(token.priceUsd);
                const marketCapLabel = formatCompactNumber(token.marketCapUsd);
                const liquidityLabel = formatCompactNumber(token.liquidityUsd);
                const volumeLabel = formatCompactNumber(token.volume24h ?? null);
                const unread = unreadMap[token.tokenAddress];
                const sparkline = sparklineCache[token.tokenAddress];
                const trendColor =
                  sparkline && sparkline.trend !== 0
                    ? sparkline.trend > 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                    : 'text-white/30';

                return (
                  <div
                    key={token.tokenAddress}
                    className={cn(
                      'group relative mx-3 my-2 flex flex-col gap-3 rounded-xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selectedToken === token.tokenAddress
                        ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05] hover:shadow-md'
                    )}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect?.(token.tokenAddress)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect?.(token.tokenAddress);
                      }
                    }}
                    onMouseEnter={() => fetchSparkline(token.tokenAddress)}
                    onFocusCapture={() => fetchSparkline(token.tokenAddress)}
                    aria-label={`Open thread for ${token.symbol || token.name || token.tokenAddress}`}
                  >
                    {/* Top Row: Badge + Pin */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <TokenBadge
                          mint={token.tokenAddress}
                          metadata={{
                            name: token.name ?? undefined,
                            symbol: token.symbol ?? undefined,
                            imageUrl: token.imageUrl ?? undefined,
                          }}
                          size="md"
                        />
                        {unread && (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" aria-label="Unread messages" />
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePinToggle(token.tokenAddress);
                        }}
                        className={cn(
                          'h-8 w-8 rounded-lg bg-transparent text-white/30 transition-all hover:bg-white/10 hover:text-amber-400',
                          pinned && 'text-amber-400 shadow-sm'
                        )}
                        aria-label={pinned ? 'Unpin token' : 'Pin token'}
                      >
                        <Star className={cn('h-4 w-4', pinned && 'fill-amber-400')} />
                      </Button>
                    </div>

                    {/* Market Cap + Price Row */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[9px] uppercase tracking-wider text-white/50">MC</span>
                        {marketCapLabel ? (
                          <span className="text-lg font-bold text-white">{marketCapLabel}</span>
                        ) : (
                          <span className="text-lg font-bold text-white/30">--</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {priceLabel && <span className="text-base font-semibold text-white/80">{priceLabel}</span>}
                        {changeLabel && (
                          <span className={cn('rounded-md px-2 py-0.5 text-xs font-bold', changeColor)}>
                            {changeLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Sparkline */}
                    {sparkline && sparkline.series.length > 1 && (
                      <div className={cn('rounded-lg bg-black/20 p-2 -mx-1', trendColor)}>
                        <Sparkline values={sparkline.series} width={240} height={40} stroke="currentColor" />
                      </div>
                    )}

                    {/* Tags */}
                    {token.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {token.tags.slice(0, 4).map((tag, idx) => (
                          <span
                            key={`${token.tokenAddress}-tag-${idx}`}
                            className="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/75 shadow-sm ring-1 ring-white/10"
                          >
                            {tag.name}
                          </span>
                        ))}
                        {token.tags.length > 4 && (
                          <span className="rounded-md bg-white/8 px-2 py-1 text-[10px] font-medium text-white/50">
                            +{token.tags.length - 4}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Footer: Activity */}
                    <div className="flex items-center gap-2 border-t border-white/5 pt-2 text-xs text-white/50">
                      <span>Activity</span>
                      <span className="font-medium text-white/70">{formatRelativeTime(token.latestMessageAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
