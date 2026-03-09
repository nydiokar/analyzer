'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { fetcher } from '@/lib/fetcher';
import { isValidSolanaAddress, shortenAddress } from '@/lib/solana-utils';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/layout/AppShell';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

// Fix #13: module-level, not inside component
type View = 'feed' | 'holdings';
type HoldingSort = 'usdValue' | 'firstSeenAt' | 'uiBalance';

interface RadarWallet {
  wallet: string;
  label: string | null;
  addedAt: string;
  isActive: boolean;
}

interface RadarHolding {
  id: string;
  wallet: string;
  tokenMint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  uiBalance: number;
  usdValue: number | null;
  isActiveHolding: boolean;
  reviewStatus: 'unreviewed' | 'reviewed' | 'ignored';
  reviewedAt: string | null;
  note: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// 30 minutes — aligns with BalanceCacheService default TTL. Below this threshold
// a snapshot would return cached data with no new information.
const STALE_MS = 30 * 60 * 1000;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatBalance(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Build max lastSeenAt (ms) per wallet from a feed snapshot.
// Used both at init and after manual refresh to determine staleness.
function buildLastSeenMap(feedData: RadarHolding[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of feedData) {
    const t = new Date(h.lastSeenAt).getTime();
    if (t > (map.get(h.wallet) ?? 0)) map.set(h.wallet, t);
  }
  return map;
}

function getEventType(h: RadarHolding): 'new' | 'sold' | null {
  if (!h.isActiveHolding) return 'sold';
  if (h.reviewStatus === 'unreviewed') return 'new';
  return null;
}

function sortHoldingItems(items: RadarHolding[], sort: HoldingSort): RadarHolding[] {
  return [...items].sort((a, b) => {
    if (sort === 'usdValue') return (b.usdValue ?? 0) - (a.usdValue ?? 0);
    if (sort === 'firstSeenAt') return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
    if (sort === 'uiBalance') return b.uiBalance - a.uiBalance;
    return 0;
  });
}

// ─── Module-level sub-components ──────────────────────────────────────────────

// Fix #7: EventTypeBadge covers the "new/sold" signal. ReviewBadge only renders
// when there is no EventTypeBadge (i.e. reviewed/ignored active holdings) to
// avoid showing two badges that say the same thing.
function EventTypeBadge({ holding }: { holding: RadarHolding }) {
  const type = getEventType(holding);
  if (type === 'new') {
    return (
      <Badge variant="outline" className="text-blue-400 border-blue-400/40 text-[10px] px-1.5 py-0 shrink-0">
        New
      </Badge>
    );
  }
  if (type === 'sold') {
    return (
      <Badge variant="outline" className="text-red-400 border-red-400/40 text-[10px] px-1.5 py-0 shrink-0">
        Sold
      </Badge>
    );
  }
  return null;
}

// Only shown when EventTypeBadge returns null (active + reviewed/ignored)
function ReviewBadge({ status }: { status: RadarHolding['reviewStatus'] }) {
  if (status === 'reviewed') {
    return <Badge variant="outline" className="text-green-500 border-green-500/40 text-[10px] px-1.5 py-0">reviewed</Badge>;
  }
  if (status === 'ignored') {
    return <Badge variant="outline" className="text-muted-foreground border-border text-[10px] px-1.5 py-0">ignored</Badge>;
  }
  // unreviewed is handled by EventTypeBadge — should not reach here
  return null;
}

// Fix #2: moved to module level. Fix #6: sold tokens only get "Dismiss" (→ignored).
function ReviewActions({
  holding,
  busy,
  onReview,
}: {
  holding: RadarHolding;
  busy: boolean;
  onReview: (id: string, status: RadarHolding['reviewStatus']) => void;
}) {
  // Sold token: the only meaningful action is dismissing it from the feed
  if (!holding.isActiveHolding) {
    return holding.reviewStatus !== 'ignored' ? (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
        disabled={busy}
        onClick={() => onReview(holding.id, 'ignored')}
      >
        <EyeOff className="h-3 w-3 mr-1" />
        Dismiss
      </Button>
    ) : null;
  }

  // Active token: full review actions
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {holding.reviewStatus !== 'reviewed' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-green-500 hover:text-green-400 hover:bg-green-500/10"
          disabled={busy}
          onClick={() => onReview(holding.id, 'reviewed')}
        >
          <Eye className="h-3 w-3 mr-1" />
          Mark reviewed
        </Button>
      )}
      {holding.reviewStatus !== 'ignored' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
          disabled={busy}
          onClick={() => onReview(holding.id, 'ignored')}
        >
          <EyeOff className="h-3 w-3 mr-1" />
          Ignore
        </Button>
      )}
      {holding.reviewStatus !== 'unreviewed' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
          disabled={busy}
          onClick={() => onReview(holding.id, 'unreviewed')}
        >
          Reset
        </Button>
      )}
    </div>
  );
}

// Fix #2: SortHeader at module level, takes holdingsSort + setter as props
function SortHeader({
  col,
  label,
  current,
  onChange,
}: {
  col: HoldingSort;
  label: string;
  current: HoldingSort;
  onChange: (col: HoldingSort) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(col)}
      className={cn(
        'inline-flex items-center gap-1 hover:text-foreground transition-colors',
        current === col ? 'text-foreground font-semibold' : 'text-muted-foreground',
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

// ─── Live-price row components ────────────────────────────────────────────────
// These components call useTokenMetadata so USD value is computed from the live
// price fetched by the batcher (same data TokenBadge already uses), not from the
// stale snapshot-time usdValue stored in the DB.

function useLiveUsdValue(mint: string, uiBalance: number): number | null {
  const { metadata } = useTokenMetadata(mint);
  if (!metadata?.priceUsd) return null;
  const price = typeof metadata.priceUsd === 'string' ? parseFloat(metadata.priceUsd) : metadata.priceUsd;
  if (!Number.isFinite(price) || price <= 0) return null;
  return uiBalance * price;
}

function FeedRow({
  holding,
  walletLabel,
  reviewingIds,
  onReview,
  onCopy,
}: {
  holding: RadarHolding;
  walletLabel: string | null | undefined;
  reviewingIds: Set<string>;
  onReview: (id: string, status: RadarHolding['reviewStatus']) => void;
  onCopy: (address: string) => void;
}) {
  const liveUsd = useLiveUsdValue(holding.tokenMint, holding.uiBalance);
  const eventType = getEventType(holding);
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-start gap-3 rounded-lg border bg-card p-3',
        holding.reviewStatus === 'ignored' && 'opacity-50',
        !holding.isActiveHolding && 'border-red-400/20',
      )}
    >
      <div className="min-w-0 flex-1 max-w-xs">
        <TokenBadge mint={holding.tokenMint} variant="inline" size="s" />
      </div>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <EventTypeBadge holding={holding} />
          <a
            href={`/wallets/${holding.wallet}`}
            className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
            title={holding.wallet}
          >
            {shortenAddress(holding.wallet, 6)}
          </a>
          <button
            type="button"
            onClick={() => onCopy(holding.wallet)}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Copy address"
          >
            <Copy className="h-3 w-3" />
          </button>
          {walletLabel && (
            <span className="text-[10px] text-muted-foreground border border-border rounded px-1 truncate">
              {walletLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {holding.isActiveHolding
            ? <span>{formatBalance(holding.uiBalance)} tokens</span>
            : <span className="text-red-400/70 line-through">{formatBalance(holding.uiBalance)} tokens</span>
          }
          {liveUsd != null && <span>{formatUsd(liveUsd)}</span>}
          <span title={new Date(holding.firstSeenAt).toLocaleString()}>
            first seen {formatRelativeTime(holding.firstSeenAt)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {eventType === null && <ReviewBadge status={holding.reviewStatus} />}
        <ReviewActions holding={holding} busy={reviewingIds.has(holding.id)} onReview={onReview} />
      </div>
    </div>
  );
}

function HoldingRow({
  holding,
  reviewingIds,
  onReview,
}: {
  holding: RadarHolding;
  reviewingIds: Set<string>;
  onReview: (id: string, status: RadarHolding['reviewStatus']) => void;
}) {
  const liveUsd = useLiveUsdValue(holding.tokenMint, holding.uiBalance);
  const eventType = getEventType(holding);
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-accent/10 transition-colors">
      <td className="px-3 py-2">
        <TokenBadge mint={holding.tokenMint} variant="inline" size="s" />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {formatBalance(holding.uiBalance)}
      </td>
      <td className="px-3 py-2 text-right text-xs">
        {formatUsd(liveUsd)}
      </td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground" title={new Date(holding.firstSeenAt).toLocaleString()}>
        {formatRelativeTime(holding.firstSeenAt)}
      </td>
      <td className="px-3 py-2">
        {eventType !== null ? <EventTypeBadge holding={holding} /> : <ReviewBadge status={holding.reviewStatus} />}
      </td>
      <td className="px-3 py-2">
        <ReviewActions holding={holding} busy={reviewingIds.has(holding.id)} onReview={onReview} />
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RadarPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized } = useAuth();

  // ── Access gate — derived synchronously, redirect once known unauthorized ──
  const isAuthorized = isInitialized && isAuthenticated && (!!user?.isAnalyst || !!user?.isAdmin);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthorized) router.replace('/');
  }, [isInitialized, isAuthorized, router]);

  // ── View + sort state ──
  const [view, setView] = useState<View>('feed');
  const [showIgnored, setShowIgnored] = useState(false);
  const [holdingsSort, setHoldingsSort] = useState<HoldingSort>('usdValue');

  // ── Data state ──
  const [wallets, setWallets] = useState<RadarWallet[]>([]);
  const [feed, setFeed] = useState<RadarHolding[]>([]);
  const [holdingsMap, setHoldingsMap] = useState<Record<string, RadarHolding[]>>({});
  const [expandedWallets, setExpandedWallets] = useState<Set<string>>(new Set());

  // ── Loading state ──
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [snapshotting, setSnapshotting] = useState<Set<string>>(new Set());

  // ── Add wallet ──
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAddress, setAddAddress] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // ── Reviewing ──
  const [reviewingIds, setReviewingIds] = useState<Set<string>>(new Set());

  // ── Fix #12: remove confirmation — tracks which wallet address is pending confirm ──
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // ─── Wallet lookup map ─────────────────────────────────────────────────────

  const walletMap = useMemo(
    () => new Map(wallets.map(w => [w.wallet, w])),
    [wallets],
  );

  // ─── Fix #9 + #10: derive per-wallet stats from feed (always loaded) ────────
  // Wallet header shows correct holding count and last-snapshot time without
  // requiring the lazy-loaded holdings to be expanded first.

  const feedStatsByWallet = useMemo(() => {
    const map = new Map<string, { count: number; lastSeenAt: number; unreviewedCount: number }>();
    for (const h of feed) {
      if (!h.isActiveHolding) continue;
      const existing = map.get(h.wallet);
      const t = new Date(h.lastSeenAt).getTime();
      if (!existing) {
        map.set(h.wallet, { count: 1, lastSeenAt: t, unreviewedCount: h.reviewStatus === 'unreviewed' ? 1 : 0 });
      } else {
        existing.count += 1;
        if (t > existing.lastSeenAt) existing.lastSeenAt = t;
        if (h.reviewStatus === 'unreviewed') existing.unreviewedCount += 1;
      }
    }
    return map;
  }, [feed]);

  // ─── Fix #1 + #3 + #5: snapshot runner (silent flag for auto-triggers) ─────

  const fetchHoldingsForWallet = useCallback(async (address: string) => {
    try {
      const data: RadarHolding[] = await fetcher(`/analyst/radar/${address}/holdings`);
      setHoldingsMap(prev => ({ ...prev, [address]: data }));
    } catch {
      toast.error(`Failed to load holdings for ${shortenAddress(address)}`);
    }
  }, []);

  // ─── Fetch feed ────────────────────────────────────────────────────────────

  const fetchFeed = useCallback(async (): Promise<RadarHolding[]> => {
    setLoadingFeed(true);
    try {
      const data: RadarHolding[] = await fetcher('/analyst/radar/feed');
      setFeed(data);
      return data;
    } catch {
      toast.error('Failed to load radar feed');
      return [];
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  // Fix #4: `silent` flag suppresses the "Snapshot complete" toast for
  // auto-triggered snapshots on page load so the analyst isn't spammed.
  const runSnapshot = useCallback(async (address: string, silent = false) => {
    setSnapshotting(prev => new Set(prev).add(address));
    try {
      await fetcher(`/analyst/radar/${address}/snapshot`, { method: 'POST' });
      if (!silent) {
        // Refresh both the feed (so feed tab reflects new data) and the
        // expanded holdings table for this wallet if it was already opened.
        await Promise.all([fetchFeed(), fetchHoldingsForWallet(address)]);
        toast.success('Snapshot complete');
      }
    } catch {
      if (!silent) toast.error('Snapshot failed');
    } finally {
      setSnapshotting(prev => {
        const next = new Set(prev);
        next.delete(address);
        return next;
      });
    }
  }, [fetchFeed, fetchHoldingsForWallet]);

  // Fix #1 + #3: feedData is a required parameter — no stale closure on feed state.
  // Callers always pass the fresh data they just fetched.
  const triggerStaleSnapshots = useCallback((walletList: RadarWallet[], feedData: RadarHolding[]) => {
    const lastSeenMap = buildLastSeenMap(feedData);
    const now = Date.now();
    for (const w of walletList) {
      const lastSeen = lastSeenMap.get(w.wallet);
      if (lastSeen === undefined || now - lastSeen > STALE_MS) {
        runSnapshot(w.wallet, true); // silent — no toast per wallet
      }
    }
  }, [runSnapshot]);

  // ─── Fetch wallets ─────────────────────────────────────────────────────────

  const fetchWallets = useCallback(async (): Promise<RadarWallet[]> => {
    setLoadingWallets(true);
    try {
      const data: RadarWallet[] = await fetcher('/analyst/radar');
      setWallets(data);
      return data;
    } catch {
      toast.error('Failed to load radar wallets');
      return [];
    } finally {
      setLoadingWallets(false);
    }
  }, []);

  // ─── Manual refresh — correct sequence ────────────────────────────────────
  // Fix #3: feed fetched first, fresh data passed directly to triggerStaleSnapshots.

  const handleRefresh = useCallback(async () => {
    const [freshFeed, freshWallets] = await Promise.all([fetchFeed(), fetchWallets()]);
    triggerStaleSnapshots(freshWallets, freshFeed);
  }, [fetchFeed, fetchWallets, triggerStaleSnapshots]);

  // ─── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthorized) return;

    const init = async () => {
      const [freshFeed, freshWallets] = await Promise.all([fetchFeed(), fetchWallets()]);
      triggerStaleSnapshots(freshWallets, freshFeed);
    };

    init();
  // fetchFeed, fetchWallets, triggerStaleSnapshots are all stable (no state deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized]);

  // ─── Add wallet ────────────────────────────────────────────────────────────

  const handleAddWallet = useCallback(async () => {
    const address = addAddress.trim();
    if (!isValidSolanaAddress(address)) {
      toast.error('Invalid Solana address');
      addInputRef.current?.focus();
      return;
    }

    setAdding(true);
    try {
      await fetcher('/analyst/radar', {
        method: 'POST',
        body: JSON.stringify({ address, label: addLabel.trim() || undefined }),
      });
      setAddAddress('');
      setAddLabel('');
      setShowAddForm(false);
      toast.success('Wallet added — running snapshot…');
      await fetchWallets();
      // Snapshot not silent — analyst just added this wallet, wants to see result
      await runSnapshot(address, false);
      // Refresh feed after snapshot so new holdings appear
      await fetchFeed();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add wallet';
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  }, [addAddress, addLabel, fetchWallets, fetchFeed, runSnapshot]);

  // ─── Remove wallet ─────────────────────────────────────────────────────────

  const handleRemoveWallet = useCallback(async (address: string) => {
    setConfirmRemove(null);
    try {
      await fetcher(`/analyst/radar/${address}`, { method: 'DELETE' });
      await fetchWallets();
      setFeed(prev => prev.filter(h => h.wallet !== address));
      setHoldingsMap(prev => {
        const next = { ...prev };
        delete next[address];
        return next;
      });
      toast.success('Wallet removed from radar');
    } catch {
      toast.error('Failed to remove wallet');
    }
  }, [fetchWallets]);

  // ─── Review action ─────────────────────────────────────────────────────────

  const handleReview = useCallback(async (id: string, status: RadarHolding['reviewStatus']) => {
    const applyUpdate = (items: RadarHolding[]) =>
      items.map(h => h.id === id
        ? { ...h, reviewStatus: status, reviewedAt: status !== 'unreviewed' ? new Date().toISOString() : null }
        : h,
      );

    // Capture wallet address before optimistic update for targeted revert
    const walletAddress = feed.find(h => h.id === id)?.wallet ?? null;

    // Optimistic update in both views
    setFeed(prev => applyUpdate(prev));
    setHoldingsMap(prev => {
      const next: Record<string, RadarHolding[]> = {};
      for (const [addr, items] of Object.entries(prev)) {
        next[addr] = applyUpdate(items);
      }
      return next;
    });

    setReviewingIds(prev => new Set(prev).add(id));
    try {
      await fetcher(`/analyst/radar/holdings/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch {
      toast.error('Failed to update review status');
      // Revert both views to server state
      fetchFeed();
      if (walletAddress) fetchHoldingsForWallet(walletAddress);
    } finally {
      setReviewingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [feed, fetchFeed, fetchHoldingsForWallet]);

  // ─── Toggle wallet section ─────────────────────────────────────────────────

  const toggleWallet = useCallback((address: string) => {
    setExpandedWallets(prev => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
        if (!holdingsMap[address]) fetchHoldingsForWallet(address);
      }
      return next;
    });
  }, [holdingsMap, fetchHoldingsForWallet]);

  // ─── Copy to clipboard ─────────────────────────────────────────────────────

  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Address copied', { duration: 1500 });
    } catch {
      toast.error('Copy failed');
    }
  }, []);

  // ─── Fix #11: sort memoized per wallet, not computed in render loop ─────────

  const sortedHoldingsMap = useMemo(() => {
    const result: Record<string, RadarHolding[]> = {};
    for (const [addr, items] of Object.entries(holdingsMap)) {
      result[addr] = sortHoldingItems(items, holdingsSort);
    }
    return result;
  }, [holdingsMap, holdingsSort]);

  // ─── Derived stats (from feed — always loaded) ─────────────────────────────

  const unreviewedCount = useMemo(
    () => feed.filter(h => h.reviewStatus === 'unreviewed' && h.isActiveHolding).length,
    [feed],
  );

  const last24hCount = useMemo(
    () => feed.filter(h => Date.now() - new Date(h.firstSeenAt).getTime() < 86_400_000 && h.isActiveHolding).length,
    [feed],
  );

  // ─── Visible feed ──────────────────────────────────────────────────────────

  const visibleFeed = useMemo(
    () => showIgnored ? feed : feed.filter(h => h.reviewStatus !== 'ignored'),
    [feed, showIgnored],
  );

  // ─── Guard ────────────────────────────────────────────────────────────────

  if (!isAuthorized) return null;

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <AppShell>
    <div className="p-6 max-w-6xl mx-auto space-y-3">

      {/* ── Toolbar: title + stats + add + refresh ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-sm font-semibold shrink-0">Holdings Radar</h1>
        <div className="w-px h-4 bg-border shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <span className="text-muted-foreground">Wallets:</span>
            <span className="font-semibold">{wallets.length}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-card px-3 py-1 text-xs">
            <span className="text-muted-foreground">Unreviewed:</span>
            <span className="font-semibold text-amber-400">{unreviewedCount}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <span className="text-muted-foreground">New 24h:</span>
            <span className="font-semibold">{last24hCount}</span>
          </div>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1"
          onClick={() => { setShowAddForm(prev => !prev); }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Wallet
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRefresh}
          disabled={loadingFeed || loadingWallets}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (loadingFeed || loadingWallets) && 'animate-spin')} />
        </Button>
      </div>

      {/* ── Collapsible add-wallet panel ── */}
      {showAddForm && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center border border-border rounded-lg p-3 bg-card">
          <Input
            ref={addInputRef}
            placeholder="Solana wallet address"
            value={addAddress}
            onChange={e => setAddAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !adding && handleAddWallet()}
            className="font-mono text-sm"
            disabled={adding}
          />
          <Input
            placeholder="Label (optional)"
            value={addLabel}
            onChange={e => setAddLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !adding && handleAddWallet()}
            className="text-sm sm:max-w-40"
            disabled={adding}
          />
          <div className="flex gap-2 shrink-0">
            <Button onClick={handleAddWallet} disabled={adding || !addAddress.trim()} size="sm" className="h-8">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Add
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── View toggle ── */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setView('feed')}
          className={cn(
            'text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
            view === 'feed' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          Event Feed
          {unreviewedCount > 0 && (
            <span className="ml-2 rounded-full bg-amber-400/20 text-amber-400 text-[10px] px-1.5 py-0.5 font-semibold">
              {unreviewedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setView('holdings')}
          className={cn(
            'text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
            view === 'holdings' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          Holdings by Wallet
        </button>
        {view === 'feed' && (
          <button
            onClick={() => setShowIgnored(prev => !prev)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showIgnored ? 'Hide ignored' : 'Show ignored'}
          </button>
        )}
      </div>

      {/* ══ FEED VIEW ══════════════════════════════════════════════════════════ */}
      {view === 'feed' && (
        <div className="space-y-2">
          {loadingFeed && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feed…
            </div>
          )}

          {!loadingFeed && visibleFeed.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              {feed.length === 0
                ? 'No holdings detected yet. Add a wallet and run a snapshot.'
                : 'All items reviewed or ignored.'}
            </div>
          )}

          {!loadingFeed && visibleFeed.map(holding => (
            <FeedRow
              key={holding.id}
              holding={holding}
              walletLabel={walletMap.get(holding.wallet)?.label}
              reviewingIds={reviewingIds}
              onReview={handleReview}
              onCopy={copyAddress}
            />
          ))}
        </div>
      )}

      {/* ══ HOLDINGS BY WALLET VIEW ════════════════════════════════════════════ */}
      {view === 'holdings' && (
        <div className="space-y-2">
          {loadingWallets && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading wallets…
            </div>
          )}

          {!loadingWallets && wallets.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No wallets on radar. Add one above.
            </div>
          )}

          {wallets.map(w => {
            const isExpanded = expandedWallets.has(w.wallet);
            const sortedHoldings = sortedHoldingsMap[w.wallet] ?? [];
            const rawHoldings = holdingsMap[w.wallet];
            const isSnapshotting = snapshotting.has(w.wallet);

            // All three derived from feed — accurate before and after expand
            const feedStats = feedStatsByWallet.get(w.wallet);
            const holdingCount = feedStats?.count ?? 0;
            const lastSeenMs = feedStats?.lastSeenAt;
            const lastSnapshotLabel = lastSeenMs ? formatRelativeTime(new Date(lastSeenMs).toISOString()) : null;
            const walletUnreviewed = feedStats?.unreviewedCount ?? 0;

            const isPendingConfirm = confirmRemove === w.wallet;

            return (
              <div key={w.wallet} className="rounded-lg border bg-card overflow-hidden">
                {/* Wallet header row */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => toggleWallet(w.wallet)}
                >
                  <span className="text-muted-foreground flex-shrink-0">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/wallets/${w.wallet}`}
                        onClick={e => e.stopPropagation()}
                        className="font-mono text-sm hover:text-primary transition-colors"
                        title={w.wallet}
                      >
                        {shortenAddress(w.wallet, 6)}
                      </a>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); copyAddress(w.wallet); }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      {w.label && (
                        <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                          {w.label}
                        </span>
                      )}
                      {walletUnreviewed > 0 && (
                        <span className="rounded-full bg-amber-400/20 text-amber-400 text-[10px] px-1.5 py-0.5 font-semibold">
                          {walletUnreviewed} unreviewed
                        </span>
                      )}
                    </div>
                    {/* Fix #9 + #10: counts and last snapshot from feed data, always accurate */}
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                      <span>{holdingCount} active holdings</span>
                      {lastSnapshotLabel && <span>last snapshot {lastSnapshotLabel}</span>}
                      <span>added {formatRelativeTime(w.addedAt)}</span>
                    </div>
                  </div>

                  {/* Fix #12: two-step remove with inline confirm */}
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => runSnapshot(w.wallet, false)}
                      disabled={isSnapshotting}
                      title="Run snapshot"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', isSnapshotting && 'animate-spin')} />
                    </Button>

                    {isPendingConfirm ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveWallet(w.wallet)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirmRemove(w.wallet)}
                        title="Remove from radar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded holdings table */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {rawHoldings === undefined ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading holdings…
                      </div>
                    ) : sortedHoldings.length === 0 ? (
                      <div className="text-sm text-muted-foreground p-4 text-center">
                        No active holdings detected. Run a snapshot to refresh.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-accent/10 text-xs">
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                              <th className="text-right px-3 py-2">
                                <SortHeader col="uiBalance" label="Balance" current={holdingsSort} onChange={setHoldingsSort} />
                              </th>
                              <th className="text-right px-3 py-2">
                                <SortHeader col="usdValue" label="USD Value" current={holdingsSort} onChange={setHoldingsSort} />
                              </th>
                              <th className="text-right px-3 py-2">
                                <SortHeader col="firstSeenAt" label="First Seen" current={holdingsSort} onChange={setHoldingsSort} />
                              </th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {sortedHoldings.map(h => (
                              <HoldingRow
                                key={h.id}
                                holding={h}
                                reviewingIds={reviewingIds}
                                onReview={handleReview}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </AppShell>
  );
}
