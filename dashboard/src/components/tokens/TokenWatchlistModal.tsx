"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Star, Trash2, ExternalLink, Waves, MessageSquare, BarChart3 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import { useUserWatchedTokens } from '@/hooks/useUserWatchedTokens';
import type { WatchedTokenRow } from '@/hooks/useWatchedTokens';
import { toast } from 'sonner';

interface TokenValidationResult {
  valid: boolean;
  error?: string;
  token?: {
    address: string;
    symbol: string | null;
    name: string | null;
    hasLiquidity: boolean;
  };
}

interface TokenWatchlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canOpenWorkspace: boolean;
}

type CandidateState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | {
      kind: 'valid';
      tokenAddress: string;
      name?: string | null;
      symbol?: string | null;
      hasLiquidity: boolean;
    };

function looksLikeSolanaAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

function formatCompactUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return 'No thread activity';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'No thread activity';
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes <= 1) return 'Active now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function candidateFromValidation(result: TokenValidationResult, fallbackAddress: string): CandidateState {
  if (!result.valid || !result.token) {
    return {
      kind: 'invalid',
      message: result.error || 'Token validation failed.',
    };
  }

  return {
    kind: 'valid',
    tokenAddress: result.token.address || fallbackAddress,
    name: result.token.name,
    symbol: result.token.symbol,
    hasLiquidity: result.token.hasLiquidity,
  };
}

export function TokenWatchlistModal({ open, onOpenChange, canOpenWorkspace }: TokenWatchlistModalProps) {
  const router = useRouter();
  const { data, isLoading, mutate } = useUserWatchedTokens(open);
  const [filterText, setFilterText] = useState('');
  const [candidateInput, setCandidateInput] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidateState>({ kind: 'idle' });
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingCandidate, setIsSubmittingCandidate] = useState(false);

  useEffect(() => {
    if (!open) {
      setFilterText('');
      setCandidateInput('');
      setCandidate({ kind: 'idle' });
      setIsSaving(false);
      setIsSubmittingCandidate(false);
      return;
    }

    if (!selectedAddress && data.length > 0) {
      setSelectedAddress(data[0].tokenAddress);
    }
  }, [open, data, selectedAddress]);

  const filteredTokens = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    if (!term) return data;
    return data.filter((token) => {
      const fields = [
        token.symbol?.toLowerCase() ?? '',
        token.name?.toLowerCase() ?? '',
        token.tokenAddress.toLowerCase(),
        ...(token.tags || []).map((tag) => tag.name.toLowerCase()),
      ];
      return fields.some((field) => field.includes(term));
    });
  }, [data, filterText]);

  const selectedToken = useMemo<WatchedTokenRow | null>(() => {
    if (!selectedAddress) return null;
    return data.find((token) => token.tokenAddress === selectedAddress) ?? null;
  }, [data, selectedAddress]);

  const inspectedAddress = candidate.kind === 'valid' ? candidate.tokenAddress : selectedToken?.tokenAddress ?? null;
  const inspectedMetadata =
    candidate.kind === 'valid'
      ? {
          name: candidate.name ?? undefined,
          symbol: candidate.symbol ?? undefined,
        }
      : selectedToken
        ? {
            name: selectedToken.name ?? undefined,
            symbol: selectedToken.symbol ?? undefined,
            imageUrl: selectedToken.imageUrl ?? undefined,
            marketCapUsd: selectedToken.marketCapUsd ?? undefined,
            priceUsd: selectedToken.priceUsd ?? undefined,
          }
        : undefined;

  const selectWatchedToken = (tokenAddress: string) => {
    setSelectedAddress(tokenAddress);
    setCandidate({ kind: 'idle' });
    setCandidateInput('');
  };

  const addCandidateToWatchlist = async () => {
    const trimmed = candidateInput.trim();
    if (!trimmed) {
      setCandidate({ kind: 'invalid', message: 'Paste a token address first.' });
      return;
    }
    if (!looksLikeSolanaAddress(trimmed)) {
      setCandidate({ kind: 'invalid', message: 'Paste a valid Solana token address.' });
      return;
    }

    setIsSubmittingCandidate(true);
    setCandidate({ kind: 'idle' });
    try {
      const result = await fetcher(`/token-validation/${encodeURIComponent(trimmed)}`) as TokenValidationResult;
      const nextCandidate = candidateFromValidation(result, trimmed);
      setCandidate(nextCandidate);

      if (nextCandidate.kind !== 'valid') {
        return;
      }

      await fetcher(`/users/me/watched-tokens/${encodeURIComponent(nextCandidate.tokenAddress)}/watch`, {
        method: 'POST',
        body: JSON.stringify({ on: true }),
      });
      await mutate();
      setSelectedAddress(nextCandidate.tokenAddress);
      setCandidateInput('');
      setCandidate({ kind: 'idle' });
      toast.success('Token added to your watchlist');
    } catch (error) {
      setCandidate({ kind: 'invalid', message: 'Failed to add token. Please try again.' });
      toast.error('Failed to add token');
    } finally {
      setIsSubmittingCandidate(false);
    }
  };

  const removeWatchedToken = async (tokenAddress: string) => {
    setIsSaving(true);
    try {
      await fetcher(`/users/me/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, {
        method: 'POST',
        body: JSON.stringify({ on: false }),
      });
      await mutate();
      const next = data.find((token) => token.tokenAddress !== tokenAddress);
      setSelectedAddress(next?.tokenAddress ?? null);
      toast.success('Token removed from your watchlist');
    } catch (error) {
      toast.error('Failed to remove token');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden border-white/10 bg-[#111218] p-0 text-white sm:rounded-2xl">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-white">Favorite Tokens</DialogTitle>
          <DialogDescription className="text-white/60">
            Left: your personal watchlist. Right: inspect the selected token or add a new one by contract address.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[70vh] grid-cols-1 lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.05fr)]">
          <section className="border-b border-white/10 bg-[#14151d] lg:border-b-0 lg:border-r">
            <div className="space-y-3 border-b border-white/10 px-5 py-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder="Search your watchlist"
                  className="h-10 border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/35"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>{data.length} watched</span>
                <span>Filter only</span>
              </div>
            </div>

            <div className="max-h-[56vh] overflow-auto px-3 py-3 lg:max-h-[calc(70vh-102px)]">
              {isLoading ? (
                <div className="px-3 py-10 text-sm text-white/55">Loading watchlist...</div>
              ) : filteredTokens.length === 0 ? (
                <div className="px-3 py-10 text-sm text-white/55">
                  {data.length === 0
                    ? 'No watched tokens yet. Add one on the right.'
                    : 'No watched tokens match this filter.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTokens.map((token) => {
                    const isSelected = token.tokenAddress === selectedToken?.tokenAddress && candidate.kind === 'idle';
                    return (
                      <div
                        key={token.tokenAddress}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectWatchedToken(token.tokenAddress)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectWatchedToken(token.tokenAddress);
                          }
                        }}
                        className={cn(
                          'rounded-2xl border px-3 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/60',
                          isSelected
                            ? 'border-blue-500/60 bg-blue-500/10'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <TokenBadge
                            mint={token.tokenAddress}
                            size="sm"
                            variant="inline"
                            metadata={{
                              name: token.name ?? undefined,
                              symbol: token.symbol ?? undefined,
                              imageUrl: token.imageUrl ?? undefined,
                              marketCapUsd: token.marketCapUsd ?? undefined,
                              priceUsd: token.priceUsd ?? undefined,
                            }}
                            className="min-w-0 flex-1"
                          />
                          <Star className="mt-1 h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-white/55">
                          <span>{formatRelativeTime(token.latestMessageAt)}</span>
                          <span>{formatCompactUsd(token.marketCapUsd)} mcap</span>
                        </div>
                        {token.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {token.tags.slice(0, 3).map((tag) => (
                              <span
                                key={`${token.tokenAddress}-${tag.name}`}
                                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60"
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-[#101118]">
            <div className="border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <Input
                  value={candidateInput}
                  onChange={(event) => setCandidateInput(event.target.value)}
                  placeholder="Paste token address to add"
                  className="h-10 border-white/10 bg-white/5 text-white placeholder:text-white/35"
                />
                <Button
                  type="button"
                  onClick={addCandidateToWatchlist}
                  disabled={isSubmittingCandidate || isSaving}
                  className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  {isSubmittingCandidate ? 'Adding...' : 'Add To Watchlist'}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-6">
              {candidate.kind === 'invalid' ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {candidate.message}
                </div>
              ) : inspectedAddress ? (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                        {candidate.kind === 'valid' ? 'New Token' : 'Watched Token'}
                      </div>
                      {candidate.kind === 'valid' && (
                        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                          Validated and added
                        </span>
                      )}
                    </div>

                    <TokenBadge
                      mint={inspectedAddress}
                      size="lg"
                      metadata={inspectedMetadata}
                    />

                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/45">
                          <Waves className="h-3.5 w-3.5" />
                          Liquidity
                        </div>
                        <div className="font-medium text-white">
                          {selectedToken
                            ? formatCompactUsd(selectedToken.liquidityUsd)
                            : candidate.kind === 'valid'
                              ? (candidate.hasLiquidity ? 'Available' : 'No liquidity detected')
                              : '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/45">
                          <BarChart3 className="h-3.5 w-3.5" />
                          24h Volume
                        </div>
                        <div className="font-medium text-white">
                          {selectedToken ? formatCompactUsd(selectedToken.volume24h) : '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/45">
                          <MessageSquare className="h-3.5 w-3.5" />
                          Thread Activity
                        </div>
                        <div className="font-medium text-white">
                          {selectedToken ? formatRelativeTime(selectedToken.latestMessageAt) : 'No thread activity yet'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {selectedToken?.tags.length ? (
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Tags</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedToken.tags.map((tag) => (
                          <span
                            key={`${selectedToken.tokenAddress}-${tag.name}-detail`}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {candidate.kind === 'idle' && selectedToken ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSaving}
                        onClick={() => removeWatchedToken(selectedToken.tokenAddress)}
                        className="gap-2 border-white/15 bg-transparent text-white hover:bg-white/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove From Watchlist
                      </Button>
                      {canOpenWorkspace && (
                        <Button
                          type="button"
                          onClick={() => {
                            router.push(`/tokens?view=token&addr=${encodeURIComponent(selectedToken.tokenAddress)}`, { scroll: false });
                            onOpenChange(false);
                          }}
                          className="gap-2 bg-white text-black hover:bg-white/90"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open In Analyst Workspace
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-sm text-white/55">
                  Select a watched token on the left, or paste a contract address above to add a new one directly to your watchlist.
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
