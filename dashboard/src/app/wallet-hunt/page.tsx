'use client';

import { AppShell } from '@/components/layout/AppShell';
import { PageTitle } from '@/components/shared/PageTitle';
import EmptyState from '@/components/shared/EmptyState';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Crosshair,
  Plus,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  UserPlus,
  Check,
  Camera,
} from 'lucide-react';
import { useHuntList, useHuntDetail } from '@/hooks/useWalletHunts';
import { useFavorites } from '@/hooks/useFavorites';
import { useFavoriteActions } from '@/providers/FavoriteModalProvider';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { fetcher } from '@/lib/fetcher';
import { getErrorMessage } from '@/lib/error-messages';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useState, useCallback, useMemo, memo } from 'react';
import { HuntListItem, HuntSnapshot, HuntCandidate } from '@/types/api';

const MAX_HUNTS = 5;
const MAX_SNAPSHOTS = 10;

// ── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

function truncateMint(mint: string): string {
  return mint.length <= 11 ? mint : `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function sanitizeHuntLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'hunt';
}

function buildHuntNickname(huntName: string, rank: number): string {
  return `${sanitizeHuntLabel(huntName)}_hunt_${rank}`;
}

// ── MiniTokenAvatar — overlapping token chips in candidate rows ──

const MiniTokenAvatar = memo(({ mint }: { mint: string }) => {
  const { metadata, isLoading } = useTokenMetadata(mint);
  const symbol = metadata?.onchainSymbol || metadata?.symbol;
  const image = metadata?.imageUrl || metadata?.onchainImageUrl;

  if (isLoading) return <Skeleton className="h-4 w-4 rounded-full" />;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Avatar className="h-4 w-4 shrink-0 ring-1 ring-background">
            <AvatarImage src={image ?? undefined} alt={symbol ?? mint} />
            <AvatarFallback className="text-[6px]">{(symbol ?? '?').charAt(0)}</AvatarFallback>
          </Avatar>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{symbol ? symbol.toUpperCase() : truncateMint(mint)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
MiniTokenAvatar.displayName = 'MiniTokenAvatar';

// ── Memoized Row Components ───────────────────────────────────────

interface HuntListRowProps {
  hunt: HuntListItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (hunt: HuntListItem) => void;
}

const HuntListRow = memo(({ hunt, isSelected, onSelect, onDelete }: HuntListRowProps) => (
  <div
    role="button"
    tabIndex={0}
    onClick={() => onSelect(hunt.id)}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(hunt.id); }}
    className={cn(
      'w-full group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors',
      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
    )}
  >
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium truncate">{hunt.name}</p>
      <p className="text-[11px] text-muted-foreground">{timeAgo(hunt.lastVisitedAt)}</p>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 tabular-nums">
        {hunt.snapshotCount}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); onDelete(hunt); }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  </div>
));
HuntListRow.displayName = 'HuntListRow';

interface SnapshotRowProps {
  snapshot: HuntSnapshot;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

const SnapshotRow = memo(({ snapshot, onRemove, isRemoving }: SnapshotRowProps) => (
  <div className="flex items-start gap-2 py-2 px-1 rounded-md hover:bg-accent/30 group">
    <div className="flex-1 min-w-0">
      <TokenBadge mint={snapshot.tokenMint} size="s" variant="inline" />
    </div>
    <div className="flex flex-col items-end gap-0.5 shrink-0 pt-1">
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {snapshot.holderCount} holders
      </span>
      <span className="text-[10px] text-muted-foreground/50">
        {timeAgo(snapshot.capturedAt)}
      </span>
      {snapshot.note && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground/40 italic truncate max-w-[80px]">
                {snapshot.note}
              </span>
            </TooltipTrigger>
            <TooltipContent><p>{snapshot.note}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
      onClick={() => onRemove(snapshot.id)}
      disabled={isRemoving}
    >
      {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
    </Button>
  </div>
));
SnapshotRow.displayName = 'SnapshotRow';

interface CandidateRowProps {
  candidate: HuntCandidate;
  rank: number;
  totalSnapshots: number;
  isTracked: boolean;
  onTrack: (addr: string, rank: number) => void;
  isTracking: boolean;
}

const CandidateRow = memo(({ candidate, rank, totalSnapshots, isTracked, onTrack, isTracking }: CandidateRowProps) => {
  const confidencePct = Math.round(candidate.confidence * 100);

  return (
    <div className="flex flex-col gap-1.5 py-2 px-2.5 rounded-md hover:bg-accent/30">
      {/* Row 1: wallet + confidence bar + track button */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <WalletBadge
            address={candidate.walletAddress}
            size="s"
            variant="minimal"
            showHud={true}
            hudDisplay="tooltip"
            showActions={true}
            visibleActions={{ copy: true, solscan: true, profile: true }}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Progress value={confidencePct} className="h-1.5 w-16" />
          <span className="text-[11px] font-semibold tabular-nums w-8 text-right">{confidencePct}%</span>
          <Button
            variant={isTracked ? 'ghost' : 'outline'}
            size="sm"
            className={cn('h-6 px-2', isTracked && 'text-muted-foreground')}
            onClick={() => onTrack(candidate.walletAddress, rank)}
            disabled={isTracked || isTracking}
          >
            {isTracking ? <Loader2 className="h-3 w-3 animate-spin" /> : isTracked ? <Check className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      {/* Row 2: which tokens this wallet was found in */}
      <div className="flex items-center gap-1.5 pl-1">
        <span className="text-[10px] text-muted-foreground/60">
          in {candidate.appearanceCount}/{totalSnapshots} tokens:
        </span>
        <div className="flex items-center -space-x-1">
          {candidate.tokenMints.map((mint) => (
            <MiniTokenAvatar key={mint} mint={mint} />
          ))}
        </div>
      </div>
    </div>
  );
});
CandidateRow.displayName = 'CandidateRow';

// ── Main Page ─────────────────────────────────────────────────────

export default function WalletHuntPage() {
  const { hunts, mutate: mutateHunts, isLoading: isLoadingHunts } = useHuntList();
  const [selectedHuntId, setSelectedHuntId] = useState<string | null>(null);
  const { detail, mutate: mutateDetail, isLoading: isLoadingDetail } = useHuntDetail(selectedHuntId);
  const { favorites } = useFavorites();
  const { openFavoriteDialog } = useFavoriteActions();

  const [isCreating, setIsCreating] = useState(false);
  const [newHuntName, setNewHuntName] = useState('');
  const [isSubmittingHunt, setIsSubmittingHunt] = useState(false);

  const [mintInput, setMintInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [isAddingSnapshot, setIsAddingSnapshot] = useState(false);

  const [deletingHunt, setDeletingHunt] = useState<HuntListItem | null>(null);
  const [removingSnapshotId, setRemovingSnapshotId] = useState<string | null>(null);

  const atHuntLimit = hunts.length >= MAX_HUNTS;
  const snapshots = detail?.snapshots ?? [];
  const candidates = detail?.candidates ?? [];
  const atSnapshotLimit = snapshots.length >= MAX_SNAPSHOTS;
  const mintValid = mintInput.length > 0 && isValidSolanaAddress(mintInput);
  const mintTouched = mintInput.length > 0;
  const huntSelected = !!selectedHuntId;

  const favoriteAddresses = useMemo(
    () => new Set(favorites.map((f) => f.walletAddress)),
    [favorites]
  );

  const isWalletTracked = useCallback(
    (addr: string) => favoriteAddresses.has(addr),
    [favoriteAddresses]
  );

  const showInactivityWarning = detail?.hunt ? daysSince(detail.hunt.lastVisitedAt) > 14 : false;

  const handleCreateHunt = useCallback(async () => {
    const name = newHuntName.trim();
    if (!name || isSubmittingHunt) return;
    setIsSubmittingHunt(true);
    try {
      const created = await fetcher('/wallet-hunts', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await mutateHunts();
      setSelectedHuntId(created.id);
      setNewHuntName('');
      setIsCreating(false);
      toast.success('Hunt created');
    } catch (err) {
      const msg = getErrorMessage('hunt-create', err);
      toast.error(msg.title, { description: msg.description });
    } finally {
      setIsSubmittingHunt(false);
    }
  }, [newHuntName, isSubmittingHunt, mutateHunts]);

  const handleDeleteHunt = useCallback(async () => {
    if (!deletingHunt) return;
    const id = deletingHunt.id;
    try {
      await fetcher(`/wallet-hunts/${id}`, { method: 'DELETE' });
      await mutateHunts();
      if (selectedHuntId === id) setSelectedHuntId(null);
      toast.success('Hunt deleted');
    } catch (err) {
      const msg = getErrorMessage('hunt-delete', err);
      toast.error(msg.title, { description: msg.description });
    } finally {
      setDeletingHunt(null);
    }
  }, [deletingHunt, selectedHuntId, mutateHunts]);

  const handleAddSnapshot = useCallback(async () => {
    if (!selectedHuntId || !mintValid || isAddingSnapshot) return;
    setIsAddingSnapshot(true);
    try {
      const result = await fetcher(`/wallet-hunts/${selectedHuntId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({
          tokenMint: mintInput.trim(),
          sourceType: 'TOP_HOLDERS',
          ...(noteInput.trim() ? { note: noteInput.trim() } : {}),
        }),
      });
      if (detail) {
        mutateDetail({ ...detail, snapshots: [...detail.snapshots, result.snapshot], candidates: result.candidates }, false);
      } else {
        await mutateDetail();
      }
      await mutateHunts();
      setMintInput('');
      setNoteInput('');
      setShowNoteInput(false);
      toast.success(`Captured ${result.snapshot.holderCount} wallets`);
    } catch (err) {
      const msg = getErrorMessage('hunt-add-snapshot', err);
      toast.error(msg.title, { description: msg.description });
    } finally {
      setIsAddingSnapshot(false);
    }
  }, [selectedHuntId, mintValid, isAddingSnapshot, mintInput, noteInput, detail, mutateDetail, mutateHunts]);

  const handleRemoveSnapshot = useCallback(async (snapshotId: string) => {
    if (!selectedHuntId || removingSnapshotId) return;
    setRemovingSnapshotId(snapshotId);
    const prevDetail = detail;
    if (detail) {
      mutateDetail({ ...detail, snapshots: detail.snapshots.filter((s) => s.id !== snapshotId), candidates: detail.candidates }, false);
    }
    try {
      await fetcher(`/wallet-hunts/${selectedHuntId}/snapshots/${snapshotId}`, { method: 'DELETE' });
      await mutateDetail();
      await mutateHunts();
    } catch (err) {
      if (prevDetail) mutateDetail(prevDetail, false);
      const msg = getErrorMessage('hunt-remove-snapshot', err);
      toast.error(msg.title, { description: msg.description });
    } finally {
      setRemovingSnapshotId(null);
    }
  }, [selectedHuntId, removingSnapshotId, detail, mutateDetail, mutateHunts]);

  const handleTrackCandidate = useCallback((walletAddress: string, rank: number) => {
    if (!selectedHuntId) return;
    const huntName = detail?.hunt?.name ?? hunts.find((h) => h.id === selectedHuntId)?.name ?? 'hunt';
    const nickname = buildHuntNickname(huntName, rank);
    openFavoriteDialog(walletAddress, nickname);
  }, [selectedHuntId, detail, hunts, openFavoriteDialog]);

  const handleSelectHunt = useCallback((id: string) => setSelectedHuntId(id), []);
  const handleRequestDeleteHunt = useCallback((hunt: HuntListItem) => setDeletingHunt(hunt), []);

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-3 shrink-0">
          <PageTitle
            title="Wallet Hunt"
            icon={Crosshair}
            subtitle="Find recurring wallets across token launches"
          />
        </div>

        {/* 3-Column Layout: Hunts | Snapshots | Candidates */}
        <div className="flex flex-1 overflow-hidden gap-3 px-6 pb-6">

          {/* ── Col 1: Hunts (220px) ── */}
          <Card className="w-[220px] shrink-0 flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Hunts
                </CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => { if (!atHuntLimit) { setIsCreating(true); setNewHuntName(''); } }}
                          disabled={atHuntLimit}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {atHuntLimit && (
                      <TooltipContent>
                        <p>Limit reached ({MAX_HUNTS}/{MAX_HUNTS})</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 px-2 pb-2">
              {isCreating && (
                <div className="mb-1.5 px-1">
                  <Input
                    autoFocus
                    placeholder="Hunt name..."
                    value={newHuntName}
                    onChange={(e) => setNewHuntName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateHunt();
                      if (e.key === 'Escape') { setIsCreating(false); setNewHuntName(''); }
                    }}
                    onBlur={() => setTimeout(() => {
                      if (!newHuntName.trim()) { setIsCreating(false); setNewHuntName(''); }
                    }, 150)}
                    disabled={isSubmittingHunt}
                    className="h-7 text-xs"
                  />
                  {isSubmittingHunt && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground px-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      Creating...
                    </div>
                  )}
                </div>
              )}
              <ScrollArea className="h-full">
                {isLoadingHunts ? (
                  <div className="space-y-1.5 p-1">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
                  </div>
                ) : hunts.length === 0 && !isCreating ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center px-3">
                    <Crosshair className="h-6 w-6 text-muted-foreground/30 mb-2" strokeWidth={1.5} />
                    <p className="text-[11px] text-muted-foreground mb-3">No hunts yet</p>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setIsCreating(true); setNewHuntName(''); }}>
                      <Plus className="h-3 w-3 mr-1" />New hunt
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {hunts.map((hunt) => (
                      <HuntListRow
                        key={hunt.id}
                        hunt={hunt}
                        isSelected={hunt.id === selectedHuntId}
                        onSelect={handleSelectHunt}
                        onDelete={handleRequestDeleteHunt}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* ── Col 2: Snapshots (420px) ── */}
          <Card className={cn(
            'w-[420px] shrink-0 flex flex-col overflow-hidden transition-opacity',
            !huntSelected && 'opacity-40 pointer-events-none'
          )}>
            <CardHeader className="py-3 px-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Snapshots
                </CardTitle>
                {snapshots.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 tabular-nums">
                    {snapshots.length}/{MAX_SNAPSHOTS}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden px-3 pb-3 pt-0 flex flex-col gap-2">
              {/* Add Snapshot Form */}
              <div className="space-y-1.5 shrink-0">
                <div className="flex items-center gap-1.5">
                  <Input
                    placeholder="Paste token mint..."
                    value={mintInput}
                    onChange={(e) => setMintInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && mintValid && !atSnapshotLimit) handleAddSnapshot(); }}
                    className={cn(
                      'h-7 text-xs font-mono flex-1',
                      mintTouched && !mintValid && 'border-destructive focus-visible:ring-destructive'
                    )}
                    disabled={isAddingSnapshot || !huntSelected}
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            className="h-7 px-2.5"
                            onClick={handleAddSnapshot}
                            disabled={!mintValid || isAddingSnapshot || atSnapshotLimit}
                          >
                            {isAddingSnapshot ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {atSnapshotLimit ? <p>Max {MAX_SNAPSHOTS} snapshots</p> : <p>Capture top holders</p>}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2 min-h-[16px]">
                  {mintTouched && !mintValid && (
                    <p className="text-[10px] text-destructive">Invalid address</p>
                  )}
                  {!showNoteInput ? (
                    <button
                      type="button"
                      onClick={() => setShowNoteInput(true)}
                      className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      + note
                    </button>
                  ) : (
                    <Input
                      autoFocus
                      placeholder="Note..."
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setShowNoteInput(false); setNoteInput(''); } }}
                      className="h-5 text-[10px] flex-1"
                      maxLength={500}
                    />
                  )}
                </div>
              </div>

              {/* Snapshot List */}
              <ScrollArea className="flex-1">
                {isLoadingDetail && !detail ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
                  </div>
                ) : snapshots.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/40 text-center py-6">
                    Paste a token mint to capture holders
                  </p>
                ) : (
                  <div className="space-y-0 divide-y divide-border/30">
                    {snapshots.map((snapshot) => (
                      <SnapshotRow
                        key={snapshot.id}
                        snapshot={snapshot}
                        onRemove={handleRemoveSnapshot}
                        isRemoving={removingSnapshotId === snapshot.id}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Inactivity warning — sits at the bottom of the column */}
              {showInactivityWarning && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 shrink-0">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Inactive &gt;2 weeks — auto-deletes at 21 days.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Col 3: Candidates (flex fill) ── */}
          <Card className={cn(
            'flex-1 flex flex-col overflow-hidden transition-opacity',
            !huntSelected && 'opacity-40 pointer-events-none'
          )}>
            <CardHeader className="py-3 px-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Candidates
                </CardTitle>
                {candidates.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 tabular-nums">
                    {candidates.length}
                  </Badge>
                )}
                {snapshots.length === 1 && candidates.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/50 ml-auto">
                    all holders — add another token to intersect
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden px-3 pb-3 pt-0">
              <ScrollArea className="h-full">
                {!huntSelected ? (
                  <EmptyState
                    icon={Crosshair}
                    title="Select a hunt"
                    description="Choose or create a hunt, then add token snapshots to find recurring wallets."
                    className="border-0 bg-transparent min-h-0 py-8"
                  />
                ) : isLoadingDetail && !detail ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
                  </div>
                ) : snapshots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Camera className="h-6 w-6 text-muted-foreground/20 mb-2" strokeWidth={1.5} />
                    <p className="text-xs text-muted-foreground/50">Capture token snapshots to see wallet candidates</p>
                  </div>
                ) : candidates.length === 0 && snapshots.length >= 2 ? (
                  <EmptyState
                    title="No overlapping wallets"
                    description="None of the captured wallets appear across multiple tokens."
                    className="border-0 bg-transparent min-h-0 py-8"
                  />
                ) : candidates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Plus className="h-6 w-6 text-muted-foreground/20 mb-2" strokeWidth={1.5} />
                    <p className="text-xs text-muted-foreground/50">Add another token snapshot to find intersecting wallets</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {candidates.map((c, i) => (
                      <CandidateRow
                        key={c.walletAddress}
                        candidate={c}
                        rank={i + 1}
                        totalSnapshots={snapshots.length}
                        isTracked={isWalletTracked(c.walletAddress)}
                        onTrack={handleTrackCandidate}
                        isTracking={false}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Delete Hunt Confirmation */}
        <AlertDialog open={!!deletingHunt} onOpenChange={(open) => !open && setDeletingHunt(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete hunt?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{deletingHunt?.name}&quot; and all its snapshots.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteHunt}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
