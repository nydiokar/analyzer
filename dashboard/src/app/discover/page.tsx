"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Info,
  Loader2,
  RefreshCcw,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { WalletBadge } from "@/components/shared/WalletBadge";
import { useFavorites } from "@/hooks/useFavorites";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { buildSpeedNarrative, buildFlowNarrative } from "@/lib/behavior-narratives";
import { DiscoverWallet, DiscoverWalletsResponse } from "@/types/discover";
import { FavoriteWallet } from "@/types/api";
import QuickAddForm from "@/components/layout/QuickAddForm";
import { getSpeedColor, getFlowColor } from "@/lib/strategy-colors";
import EmptyState from "@/components/shared/EmptyState";
import { ErrorMessage, getErrorMessage } from "@/lib/error-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;

const sortOptions = [
  { value: 'interesting', label: 'Interesting', hint: 'Activity + PnL + recency' },
  { value: 'most_active', label: 'Most active', hint: 'Trade count first' },
  { value: 'best_pnl', label: 'Best PnL', hint: 'Realized PnL focus' },
  { value: 'longest_holders', label: 'Longest holders', hint: 'Hold time' },
  { value: 'recently_updated', label: 'Recently updated', hint: 'Fresh data' },
] as const;

// NEW: Separate Speed and Flow filters (2025-12-26)
const speedOptions = [
  { value: 'any', label: 'Any Speed', hint: '' },
  { value: 'SNIPER', label: 'Sniper', hint: '< 5 min exits' },
  { value: 'SCALPER', label: 'Scalper', hint: '5-30 min exits' },
  { value: 'MOMENTUM', label: 'Momentum', hint: '30min-6h exits' },
  { value: 'INTRADAY', label: 'Intraday', hint: '6-12h exits' },
  { value: 'DAY_TRADER', label: 'Day Trader', hint: '12-24h exits' },
  { value: 'SWING', label: 'Swing', hint: '1-7 day holds' },
  { value: 'POSITION', label: 'Position', hint: '7-30 day holds' },
  { value: 'HODLER', label: 'Hodler', hint: '30+ day holds' },
] as const;

const flowOptions = [
  { value: 'any', label: 'Any Flow', hint: '' },
  { value: 'BUY_ONLY', label: 'Buy-Only', hint: 'Never sells, pure accumulation' },
  { value: 'ACCUMULATOR', label: 'Accumulator', hint: 'Heavy buy bias (buys >> sells)' },
  { value: 'BALANCED', label: 'Balanced', hint: 'Equal buy/sell activity' },
  { value: 'DISTRIBUTOR', label: 'Distributor', hint: 'Heavy sell bias (sells >> buys)' },
  { value: 'SELL_ONLY', label: 'Sell-Only', hint: 'Only sells, no buys' },
  { value: 'MIXED', label: 'Mixed', hint: 'Chaotic, no clear pattern' },
] as const;


const holdBiasOptions = [
  { value: 'any', label: 'Any' },
  { value: 'short', label: 'Short (<12h)' },
  { value: 'medium', label: 'Medium (12–72h)' },
  { value: 'long', label: 'Long (>72h)' },
] as const;

const speedLegend = speedOptions.filter((option) => option.value !== "any");
const flowLegend = flowOptions.filter((option) => option.value !== "any");

const formatSOL = (val: number): string => {
  const absVal = Math.abs(val);
  const sign = val >= 0 ? "+" : "-";

  if (absVal >= 1000000) {
    return `${sign}${(absVal / 1000000).toFixed(1)}M`;
  } else if (absVal >= 1000) {
    return `${sign}${(absVal / 1000).toFixed(1)}k`;
  } else if (absVal >= 100) {
    return `${sign}${absVal.toFixed(0)}`;
  } else {
    return `${sign}${absVal.toFixed(2)}`;
  }
};

const formatPnLValue = (val?: number | null) => {
  if (val === null || val === undefined) return "—";
  return formatSOL(val);
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

export default function DiscoverPage() {
  const [wallets, setWallets] = useState<DiscoverWallet[]>([]);
  const [sort, setSort] = useState<string>('interesting');
  const [minTradeCount, setMinTradeCount] = useState<number | ''>('');
  const [minUniqueTokens, setMinUniqueTokens] = useState<number | ''>('');
  const [speedCategory, setSpeedCategory] = useState<string>('any');
  const [flowPattern, setFlowPattern] = useState<string>('any');
  const [holdBias, setHoldBias] = useState<string>('any');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [velocityRange, setVelocityRange] = useState<[number, number]>([0, 100]);

  // Get user's favorite wallets
  const { favorites, mutate: mutateFavorites } = useFavorites();
  const favoriteAddresses = useMemo(() => new Set(favorites.map(f => f.walletAddress)), [favorites]);
  const favoritesMap = useMemo(() => {
    const map = new Map();
    favorites.forEach(fav => map.set(fav.walletAddress, fav));
    return map;
  }, [favorites]);

  // Favorite management modals
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentWallet, setCurrentWallet] = useState<{ address: string; nickname?: string } | null>(null);

  const cacheKey = useMemo(
    () =>
      `discover:${sort}:${page}:${minTradeCount || 'any'}:${speedCategory !== 'any' ? speedCategory : 'any'}:${flowPattern !== 'any' ? flowPattern : 'any'}:${minUniqueTokens || 'any'}:${holdBias !== 'any' ? holdBias : 'any'}:${velocityRange[0]}-${velocityRange[1]}:${PAGE_SIZE}`,
    [sort, page, minTradeCount, speedCategory, flowPattern, minUniqueTokens, holdBias, velocityRange],
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
      if (speedCategory && speedCategory !== 'any') params.set('speedCategory', speedCategory);
      if (flowPattern && flowPattern !== 'any') params.set('flowPattern', flowPattern);
      if (holdBias && holdBias !== 'any') params.set('holdBias', holdBias);
      if (velocityRange[0] > 0) params.set('minVelocity', String(velocityRange[0]));
      if (velocityRange[1] < 100) params.set('maxVelocity', String(velocityRange[1]));

      const data = (await fetcher(`/discover/wallets?${params.toString()}`)) as DiscoverWalletsResponse;
      setWallets(data.items || []);
      setTotal(data.total || 0);
      writeCache(cacheKey, data);
    } catch (err: unknown) {
      setError(getErrorMessage("discover-wallets", err));
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, [cacheKey, holdBias, minTradeCount, minUniqueTokens, page, sort, speedCategory, flowPattern, velocityRange]);

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

  // Handle favorite add - opens modal
  const handleAddFavorite = (address: string) => {
    setCurrentWallet({ address });
    setShowQuickAddModal(true);
  };

  // Handle favorite remove - opens confirmation dialog
  const handleRemoveFavorite = (address: string, nickname?: string) => {
    setCurrentWallet({ address, nickname });
    setShowDeleteConfirm(true);
  };

  // Quick add save handler
  const handleQuickAddSave = async (formData: { walletAddress: string; nickname: string; collections: string[] }) => {
    try {
      await fetcher('/users/me/favorites', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: formData.walletAddress,
          nickname: formData.nickname.trim() || undefined,
          collections: formData.collections,
        }),
      });
      await mutateFavorites();
      toast.success("Added to favorites", {
        description: `${formData.nickname || 'Wallet'} added to your favorites.`,
      });
      // Close modal and clear state
      setShowQuickAddModal(false);
      setCurrentWallet(null);
    } catch (err: unknown) {
      const message = getErrorMessage("discover-add-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  // Confirm remove handler
  const confirmRemoveFavorite = async () => {
    if (!currentWallet) return;
    try {
      await fetcher(`/users/me/favorites/${currentWallet.address}`, { method: 'DELETE' });
      await mutateFavorites();
      toast.success("Removed from favorites", {
        description: `${currentWallet.nickname || 'Wallet'} removed from favorites.`,
      });
      // Close dialog and clear state
      setShowDeleteConfirm(false);
      setCurrentWallet(null);
    } catch (err: unknown) {
      const message = getErrorMessage("discover-remove-favorite", err);
      toast.error(message.title, {
        description: message.description,
      });
    }
  };

  const resetFilters = () => {
    setSort('interesting');
    setSpeedCategory('any');
    setFlowPattern('any');
    setHoldBias('any');
    setMinTradeCount('');
    setMinUniqueTokens('');
    setVelocityRange([0, 100]);
    setPage(1);
    setActivePreset(null);
  };

  const applyPreset = (preset: 'fast-traders' | 'balanced-fast' | 'patient-holder') => {
    setActivePreset(preset);
    if (preset === 'fast-traders') {
      // Fast traders: Sniper/Scalper/Momentum speed + any flow pattern
      setSpeedCategory('SNIPER'); // Could also be SCALPER or MOMENTUM
      setFlowPattern('any'); // Fast traders can have any flow pattern
      setHoldBias('short');
      setMinTradeCount(20);
      setMinUniqueTokens(5);
    } else if (preset === 'balanced-fast') {
      // Balanced fast: Swing/Day trader speed + balanced flow
      setSpeedCategory('SWING'); // 1-7 day holds
      setFlowPattern('BALANCED'); // Equal buy/sell activity
      setHoldBias('medium');
      setMinTradeCount(30);
      setMinUniqueTokens(8);
    } else if (preset === 'patient-holder') {
      // Patient holders: Long holds + buy-only/accumulator flow
      setSpeedCategory('HODLER'); // 30+ day holds
      setFlowPattern('BUY_ONLY'); // Pure accumulation
      setHoldBias('long');
      setMinTradeCount(10);
      setMinUniqueTokens(3);
    }
    setPage(1);
  };

  const speedDistribution = useMemo(() => {
    if (!wallets.length) return [];
    const totalWallets = wallets.length;
    const counts = new Map<string, number>();
    wallets.forEach((wallet) => {
      const category = wallet.metrics.speedCategory || "UNCLASSIFIED";
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
      percentage: totalWallets > 0 ? (count / totalWallets) * 100 : 0,
    }));
  }, [wallets]);

  const flowDistribution = useMemo(() => {
    if (!wallets.length) return [];
    const totalWallets = wallets.length;
    const counts = new Map<string, number>();
    wallets.forEach((wallet) => {
      const pattern = wallet.metrics.flowPattern || "UNCLASSIFIED";
      counts.set(pattern, (counts.get(pattern) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([pattern, count]) => ({
      pattern,
      count,
      percentage: totalWallets > 0 ? (count / totalWallets) * 100 : 0,
    }));
  }, [wallets]);

  const getCategoryStat = (category: string) =>
    speedDistribution.find((item) => item.category === category) || { count: 0, percentage: 0 };

  const getFlowStat = (pattern: string) =>
    flowDistribution.find((item) => item.pattern === pattern) || { count: 0, percentage: 0 };

  const velocityMin = velocityRange[0];
  const velocityMax = velocityRange[1];
  const velocityFillLeft = `${velocityMin}%`;
  const velocityFillRight = `${100 - velocityMax}%`;
  const toBgClass = (colorClass: string) => colorClass.replace("text-", "bg-");

  const showTableSkeleton = (loading || isUpdating) && !error;
  const showSidebarSkeleton = showTableSkeleton && wallets.length === 0;

  const tableHeader = (
    <thead className="border-b bg-gradient-to-r from-muted/60 to-muted/40">
      <tr className="align-bottom">
        <th className="text-left px-3 py-2 font-medium text-sm whitespace-nowrap">
          <div className="inline-flex items-center gap-1">
            Wallet
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Shows wallet address with key metrics: trades (buy↑/sell↓), win rate and last activity.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </th>
        <th className="text-left px-3 py-2 font-medium text-sm whitespace-nowrap">
          <div className="inline-flex items-center gap-1">
            PnL
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Total PNL, broken down to realized and unrealized profit/loss in SOL.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </th>
        <th className="text-left px-3 py-2 font-medium text-sm">
          <div className="inline-flex items-center gap-1">
            Speed
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Narrative description of exit timing patterns and current holdings. Checkout Holder profiles for details on this wallet
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </th>
        <th className="text-left px-3 py-2 font-medium text-sm">
          <div className="inline-flex items-center gap-1">
            Flow
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Narrative description of buy/sell behavior and exit patterns.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </th>
        <th className="text-right px-3 py-2 font-medium text-sm whitespace-nowrap">
          <div className="inline-flex items-center gap-1 justify-end">
            Unpaired
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Percentage of tokens with incomplete buy/sell cycles. High values may indicate spam/dust.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </th>
      </tr>
    </thead>
  );

  return (
    <AppShell>
      <div className="w-full px-6 py-4 space-y-3">
        {/* Compact header + filters in one line */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <h1 className="text-xl font-semibold">Discover</h1>

          {/* Preset filters as distinct pills */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/50 border border-border/50">
            <Button
              size="sm"
              variant={activePreset === 'fast-traders' ? 'default' : 'ghost'}
              onClick={() => applyPreset('fast-traders')}
              className={cn(
                "h-7 text-xs font-medium transition-all",
                activePreset === 'fast-traders' && "bg-primary text-primary-foreground shadow-sm"
              )}
            >
              Fast Traders
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground inline-flex items-center gap-1 cursor-help">
                    Sort: <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Order results by different criteria</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[130px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <TooltipProvider>
                  {sortOptions.map((o) => (
                    <Tooltip key={o.value}>
                      <TooltipTrigger asChild>
                        <SelectItem value={o.value}>
                          {o.label}
                        </SelectItem>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs font-semibold">{o.label}</p>
                        <p className="text-xs text-muted-foreground">{o.hint}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </SelectContent>
            </Select>
          </div>

          {/* NEW: Speed filter */}
          <div className="flex items-center gap-2 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground inline-flex items-center gap-1 cursor-help">
                    Speed: <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Filter by exit timing (how fast they exit positions)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Select value={speedCategory} onValueChange={(v) => { setSpeedCategory(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[100px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <TooltipProvider>
                  {speedOptions.map((o) => (
                    <Tooltip key={o.value}>
                      <TooltipTrigger asChild>
                        <SelectItem value={o.value}>
                          {o.label}
                        </SelectItem>
                      </TooltipTrigger>
                      {o.hint && (
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs font-semibold">{o.label}</p>
                          <p className="text-xs text-muted-foreground">{o.hint}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </SelectContent>
            </Select>
          </div>

          {/* NEW: Flow filter */}
          <div className="flex items-center gap-2 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground inline-flex items-center gap-1 cursor-help">
                    Flow: <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Filter by buy/sell behavior (trading flow pattern)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Select value={flowPattern} onValueChange={(v) => { setFlowPattern(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[100px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <TooltipProvider>
                  {flowOptions.map((o) => (
                    <Tooltip key={o.value}>
                      <TooltipTrigger asChild>
                        <SelectItem value={o.value}>
                          {o.label}
                        </SelectItem>
                      </TooltipTrigger>
                      {o.hint && (
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs font-semibold">{o.label}</p>
                          <p className="text-xs text-muted-foreground">{o.hint}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground inline-flex items-center gap-1 cursor-help">
                    Hold: <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Filter by median hold time duration</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Select value={holdBias} onValueChange={(v) => { setHoldBias(v); setPage(1); setActivePreset(null); }}>
              <SelectTrigger className="w-[100px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {holdBiasOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Min trades"
                  className="w-[80px] h-7 text-xs"
                  value={minTradeCount === '' ? '' : String(minTradeCount)}
                  onChange={(e) => {
                    setMinTradeCount(e.target.value === '' ? '' : Number(e.target.value));
                    setPage(1);
                    setActivePreset(null);
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Filter by minimum total trades (buys + sells)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Min tokens"
                  className="w-[80px] h-7 text-xs"
                  value={minUniqueTokens === '' ? '' : String(minUniqueTokens)}
                  onChange={(e) => {
                    setMinUniqueTokens(e.target.value === '' ? '' : Number(e.target.value));
                    setPage(1);
                    setActivePreset(null);
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Filter by minimum unique tokens traded</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Reset + Refresh combined */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={resetFilters} className="h-7 px-2 text-xs">
                  Reset
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Reset all filters to default</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={fetchWallets} disabled={isUpdating} className="h-7 px-2">
                  {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Refresh results</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex gap-6">
          <div className="flex-1 space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error.title}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{error.description}</span>
                  <Button size="sm" variant="secondary" onClick={fetchWallets} disabled={isUpdating}>
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    <span className="ml-2">Retry</span>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {showTableSkeleton && (
              <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    {tableHeader}
                    <tbody>
                      {Array.from({ length: 8 }).map((_, index) => (
                        <tr key={`skeleton-row-${index}`} className="border-b last:border-0">
                          <td className="px-3 py-2.5">
                            <Skeleton className="h-5 w-40" />
                            <Skeleton className="h-3 w-24 mt-2" />
                          </td>
                          <td className="px-3 py-2.5">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-3 w-20 mt-2" />
                          </td>
                          <td className="px-3 py-2.5">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-56 mt-2" />
                          </td>
                          <td className="px-3 py-2.5">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-56 mt-2" />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Skeleton className="h-4 w-14 ml-auto" />
                            <Skeleton className="h-3 w-16 mt-2 ml-auto" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!showTableSkeleton && wallets.length > 0 && (
              <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    {tableHeader}
                    <tbody>
                      {wallets.map((wallet) => (
                        <WalletRow
                          key={wallet.walletAddress}
                          wallet={wallet}
                          isFavorite={favoriteAddresses.has(wallet.walletAddress)}
                          favoriteData={favoritesMap.get(wallet.walletAddress)}
                          onFavoriteAdd={handleAddFavorite}
                          onFavoriteRemove={handleRemoveFavorite}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!showTableSkeleton && !error && wallets.length === 0 && (
              <div className="space-y-4">
                <EmptyState
                  variant="info"
                  icon={SearchX}
                  title="No wallets found"
                  description="No wallets match your current filters. Try widening the criteria or reset filters to start fresh."
                  actionText="Reset filters"
                  onActionClick={resetFilters}
                />
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => applyPreset('balanced-fast')}>
                    Try Balanced Fast
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => applyPreset('fast-traders')}>
                    Try Fast Traders
                  </Button>
                </div>
              </div>
            )}

            {!showTableSkeleton && wallets.length > 0 && (
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

          <div className="w-80 flex-shrink-0 space-y-4">
            {showSidebarSkeleton ? (
              <>
                <Card>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-2 w-5/6" />
                    <Skeleton className="h-2 w-2/3" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <Skeleton className="h-5 w-36" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Velocity Filter</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>0</span>
                      <span>100</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 rounded-full bg-primary/60"
                        style={{ left: velocityFillLeft, right: velocityFillRight }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={velocityMin}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setVelocityRange(([_, max]) => [Math.min(value, max - 1), max]);
                          setPage(1);
                          setActivePreset(null);
                        }}
                        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto z-20 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary/60 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
                        aria-label="Minimum velocity"
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={velocityMax}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setVelocityRange(([min]) => [min, Math.max(value, min + 1)]);
                          setPage(1);
                          setActivePreset(null);
                        }}
                        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto z-10 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary/60 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
                        aria-label="Maximum velocity"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Min <span className="font-semibold text-foreground">{velocityMin}</span>
                      </span>
                      <span>
                        Max <span className="font-semibold text-foreground">{velocityMax}</span>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Trading velocity scores measure rotation speed. Higher values = faster exits.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Speed Categories</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {speedLegend.map((option) => {
                      const stat = getCategoryStat(option.value);
                      const textClass = getSpeedColor(option.value);
                      const barClass = toBgClass(textClass);
                      return (
                        <div key={option.value} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Badge className={cn("border border-current/30 bg-transparent text-xs", textClass)}>
                              {option.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {stat.count} · {stat.percentage.toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted">
                              <div
                                className={cn("h-1.5 rounded-full", barClass)}
                                style={{ width: `${stat.percentage}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{option.hint}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!!getCategoryStat("UNCLASSIFIED").count && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Unclassified</span>
                        <span>{getCategoryStat("UNCLASSIFIED").count}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Flow Patterns</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {flowLegend.map((option) => {
                      const stat = getFlowStat(option.value);
                      const textClass = getFlowColor(option.value);
                      const barClass = toBgClass(textClass);
                      return (
                        <div key={option.value} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Badge className={cn("border border-current/30 bg-transparent text-xs", textClass)}>
                              {option.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {stat.count} · {stat.percentage.toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted">
                              <div
                                className={cn("h-1.5 rounded-full", barClass)}
                                style={{ width: `${stat.percentage}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{option.hint}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!!getFlowStat("UNCLASSIFIED").count && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Unclassified</span>
                        <span>{getFlowStat("UNCLASSIFIED").count}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Add Modal */}
      {currentWallet && (
        <QuickAddForm
          isOpen={showQuickAddModal}
          onClose={() => setShowQuickAddModal(false)}
          onSave={handleQuickAddSave}
          walletAddress={currentWallet.address}
          title="Add to Tracked"
        />
      )}

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Tracked?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-medium">{currentWallet?.nickname || 'this wallet'}</span>{' '}
              from your favorites? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveFavorite}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function WalletRow({
  wallet,
  isFavorite,
  favoriteData,
  onFavoriteAdd,
  onFavoriteRemove
}: {
  wallet: DiscoverWallet;
  isFavorite: boolean;
  favoriteData?: FavoriteWallet;
  onFavoriteAdd: (address: string) => void;
  onFavoriteRemove: (address: string, nickname?: string) => void;
}) {
  // PnL - show BOTH realized and unrealized
  const realizedPnl = wallet.metrics.realizedPnl;
  const unrealizedPnl = wallet.metrics.unrealizedPnl;

  const hasRealized = realizedPnl !== null && realizedPnl !== undefined;
  const hasUnrealized = unrealizedPnl !== null && unrealizedPnl !== undefined;

  // Calculate total
  const totalPnl = (hasRealized ? realizedPnl : 0) + (hasUnrealized ? unrealizedPnl : 0);
  const hasPnl = hasRealized || hasUnrealized;

  const totalPnlClass = hasPnl && totalPnl > 0
    ? "text-green-600 dark:text-green-500"
    : hasPnl && totalPnl < 0
      ? "text-red-600 dark:text-red-500"
      : "";

  const totalPnlBgClass = hasPnl && totalPnl > 0
    ? "bg-green-50 dark:bg-green-950/20"
    : hasPnl && totalPnl < 0
      ? "bg-red-50 dark:bg-red-950/20"
      : "";

  // Handle favorite toggle - call appropriate handler based on current state
  const handleFavoriteToggle = () => {
    if (isFavorite) {
      onFavoriteRemove(wallet.walletAddress, favoriteData?.nickname);
    } else {
      onFavoriteAdd(wallet.walletAddress);
    }
  };

  // Build DATA-DRIVEN narratives from backend classifications + metrics using templates
  const totalBuys = wallet.metrics.totalBuys ?? 0;
  const totalSells = wallet.metrics.totalSells ?? 0;
  const valueHeldPct = wallet.metrics.percentOfValueInCurrentHoldings?.toFixed(0) ?? null;

  // SPEED NARRATIVE: Use template-based storytelling with emphasized numbers
  const speedNarrative = buildSpeedNarrative(wallet.metrics.speedCategory, {
    medianHoldHours: wallet.metrics.medianHoldHours,
    avgHoldHours: wallet.metrics.averageHoldHours,
    currentHoldHours: wallet.metrics.medianCurrentHoldingDurationHours,
    totalBuys,
    totalSells,
    unrealizedPnl,
    reasonCode: wallet.reasonCode,
    uniqueTokensTraded: wallet.metrics.uniqueTokensTraded,
    velocityScore: wallet.metrics.velocityScore, // 0-100 trading velocity
  });

  // FLOW NARRATIVE: Use template-based storytelling with emphasized numbers
  // NEW: Include current holdings data (% value held, duration) - belongs in FLOW not SPEED!
  const flowNarrative = buildFlowNarrative(wallet.metrics.flowPattern, {
    totalBuys,
    totalSells,
    buySellRatio: wallet.metrics.buySellRatio,
    buySellSymmetry: wallet.metrics.buySellSymmetry,
    sequenceConsistency: wallet.metrics.sequenceConsistency,
    exitPattern: wallet.metrics.exitPattern,
    unrealizedPnl,
    uniqueTokensTraded: wallet.metrics.uniqueTokensTraded,
    // NEW: Current holdings context (accumulation/distribution indicator)
    valueHeldPct: valueHeldPct ? parseFloat(valueHeldPct) : null,
    currentHoldHours: wallet.metrics.medianCurrentHoldingDurationHours,
    avgCurrentHoldHours: wallet.metrics.averageHoldHours, // Show both if available
  });

  const unpairedPct = wallet.metrics.percentageOfUnpairedTokens?.toFixed(0) ?? null;
  const isHighUnpaired = wallet.metrics.percentageOfUnpairedTokens && wallet.metrics.percentageOfUnpairedTokens > 50;

  // Staleness indicator
  const stalenessMinutes = wallet.metrics.stalenessMinutes;
  const isStale = stalenessMinutes && stalenessMinutes > 1440; // > 24 hours
  const stalenessHours = stalenessMinutes ? Math.floor(stalenessMinutes / 60) : null;

  return (
    <tr className="border-b last:border-0 hover:bg-accent/30 transition-all duration-150 align-top group">
      {/* Column 1: Wallet */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <WalletBadge
            address={wallet.walletAddress}
            variant="inline"
            size="s"
            isFavorite={isFavorite}
            favoriteData={favoriteData}
            onFavoriteToggle={handleFavoriteToggle}
            metrics={{
              totalBuys: wallet.metrics.totalBuys,
              totalSells: wallet.metrics.totalSells,
              winRatePercent: wallet.metrics.winRatePercent,
              lastActiveAt: wallet.metrics.lastActiveAt,
            }}
          />
          {isStale && stalenessHours !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[0.65rem] text-amber-600 dark:text-amber-500 cursor-help inline-flex items-center gap-0.5">
                    ⚠️ Data {stalenessHours}h old
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Analysis was last updated {stalenessHours} hours ago. Metrics may not reflect recent activity.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </td>

      {/* Column 2: PnL (left-aligned, close to wallet) */}
      <td className="px-3 py-2.5 align-top min-w-[140px]">
        {hasPnl ? (
          <div className={cn("inline-flex flex-col gap-0.5 px-2.5 py-1 rounded-md transition-all", totalPnlBgClass)}>
            <div className={cn("text-sm font-bold tabular-nums", totalPnlClass)}>
              {formatSOL(totalPnl)} SOL
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {hasRealized && hasUnrealized ? (
                <>{formatPnLValue(realizedPnl)}R / {formatPnLValue(unrealizedPnl)}U</>
              ) : hasRealized ? (
                <>realized</>
              ) : (
                <>unrealized</>
              )}
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* Column 3: Speed (narrative with range) */}
      <td className="px-3 py-2.5 align-top max-w-[380px]">
        <div className="space-y-1">
          <div className="text-sm font-semibold">
            <span className={getSpeedColor(wallet.metrics.speedCategory)}>
              {speedNarrative.label}
            </span>
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({speedNarrative.range})</span>
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {speedNarrative.story}
          </div>
        </div>
      </td>

      {/* Column 4: Flow (narrative) */}
      <td className="px-3 py-2.5 align-top max-w-[480px]">
        {flowNarrative ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold">
              <span className={getFlowColor(wallet.metrics.flowPattern)}>
                {flowNarrative.label}
              </span>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {flowNarrative.story}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Limited data - flow pattern developing.</div>
        )}
      </td>

      {/* Column 5: Unpaired % (spam/dust indicator) */}
      <td className="px-3 py-2.5 text-right align-top">
        {unpairedPct !== null ? (
          <div className="inline-flex flex-col items-end gap-0.5">
            <div className={cn("text-sm font-medium tabular-nums", isHighUnpaired ? "text-amber-600 dark:text-amber-500" : "")}>
              {unpairedPct}%{isHighUnpaired ? " ⚠️" : ""}
            </div>
            {isHighUnpaired && (
              <div className="text-xs text-muted-foreground">airdrop scam</div>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
