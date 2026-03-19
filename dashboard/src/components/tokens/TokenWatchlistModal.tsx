"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Clock3, Trash2, ExternalLink, MessageSquare, BarChart3, Waves, Tag, X } from 'lucide-react';
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

const TAG_PRESETS = ['meme', 'ai', 'utility', 'news', 'high-conviction', 'watch-later', 'trading'] as const;

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function looksLikeSolanaAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

function formatCompactUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
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

function formatAgeFromUnix(timestampSeconds?: number | null) {
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) return 'Age unknown';
  const timestampMs = timestampSeconds > 1_000_000_000_000 ? timestampSeconds : timestampSeconds * 1000;
  const elapsedMs = Date.now() - timestampMs;
  if (elapsedMs <= 0) return 'Just launched';
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d old`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo old`;
  const years = Math.floor(months / 12);
  return `${years}y old`;
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    if (!/^[a-z0-9_-]+$/.test(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 10) break;
  }
  return out;
}

function candidateFromValidation(result: TokenValidationResult, fallbackAddress: string) {
  if (!result.valid || !result.token) {
    return {
      valid: false as const,
      message: result.error || 'Token validation failed.',
    };
  }

  return {
    valid: true as const,
    tokenAddress: result.token.address || fallbackAddress,
  };
}

export function TokenWatchlistModal({ open, onOpenChange, canOpenWorkspace }: TokenWatchlistModalProps) {
  const router = useRouter();
  const { data, isLoading, mutate } = useUserWatchedTokens(open);

  const [filterText, setFilterText] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [candidateInput, setCandidateInput] = useState('');
  const [candidateTags, setCandidateTags] = useState<string[]>([]);
  const [candidateTagInput, setCandidateTagInput] = useState('');
  const [showCandidateTagEditor, setShowCandidateTagEditor] = useState(false);
  const [expandedTokenAddress, setExpandedTokenAddress] = useState<string | null>(null);
  const [editTagInput, setEditTagInput] = useState('');
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingCandidate, setIsSubmittingCandidate] = useState(false);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (!open) {
      if (!wasOpen) return;
      setFilterText('');
      setActiveTagFilter(null);
      setCandidateInput('');
      setCandidateTags([]);
      setCandidateTagInput('');
      setShowCandidateTagEditor(false);
      setExpandedTokenAddress(null);
      setEditTagInput('');
      setCandidateError(null);
      setIsSaving(false);
      setIsSubmittingCandidate(false);
    }
  }, [open]);

  const filteredTokens = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    return data.filter((token) => {
      const userTags = token.userTags ?? [];
      const matchesTag = !activeTagFilter
        ? true
        : activeTagFilter === '__untagged__'
          ? userTags.length === 0
          : userTags.includes(activeTagFilter);
      if (!matchesTag) return false;
      if (!term) return true;

      return [
        token.symbol?.toLowerCase() ?? '',
        token.name?.toLowerCase() ?? '',
        token.tokenAddress.toLowerCase(),
        ...userTags,
      ].some((field) => field.includes(term));
    });
  }, [data, filterText, activeTagFilter]);

  const availableUserTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of data) {
      for (const tag of token.userTags ?? []) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
      }
    }
    return out.sort();
  }, [data]);

  const expandedToken = useMemo<WatchedTokenRow | null>(() => {
    if (!expandedTokenAddress) return null;
    return data.find((token) => token.tokenAddress === expandedTokenAddress) ?? null;
  }, [data, expandedTokenAddress]);

  const expandedTags = expandedToken?.userTags ?? [];
  const addPresetOptions = TAG_PRESETS.filter((tag) => !candidateTags.includes(tag));
  const editPresetOptions = TAG_PRESETS.filter((tag) => !expandedTags.includes(tag));

  const toggleCandidateTag = (tag: string) => {
    setCandidateTags((prev) => (
      prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag]
    ));
  };

  const addCandidateCustomTag = () => {
    setCandidateTags((prev) => normalizeTags([...prev, candidateTagInput]));
    setCandidateTagInput('');
  };

  const addCandidateToWatchlist = async () => {
    const trimmed = candidateInput.trim();
    if (!trimmed) {
      setCandidateError('Paste a token address first.');
      return;
    }
    if (!looksLikeSolanaAddress(trimmed)) {
      setCandidateError('Paste a valid Solana token address.');
      return;
    }

    setIsSubmittingCandidate(true);
    setCandidateError(null);
    try {
      const result = await fetcher(`/token-validation/${encodeURIComponent(trimmed)}`) as TokenValidationResult;
      const validation = candidateFromValidation(result, trimmed);
      if (!validation.valid) {
        setCandidateError(validation.message);
        return;
      }

      await fetcher(`/users/me/watched-tokens/${encodeURIComponent(validation.tokenAddress)}/watch`, {
        method: 'POST',
        body: JSON.stringify({ on: true, tags: candidateTags }),
      });

      await mutate();
      setExpandedTokenAddress(validation.tokenAddress);
      setCandidateInput('');
      setCandidateTags([]);
      setCandidateTagInput('');
      setShowCandidateTagEditor(false);
      toast.success('Token added to your watchlist');
    } catch {
      setCandidateError('Failed to add token. Please try again.');
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
      if (expandedTokenAddress === tokenAddress) {
        setExpandedTokenAddress(null);
        setEditTagInput('');
      }
      toast.success('Token removed from your watchlist');
    } catch {
      toast.error('Failed to remove token');
    } finally {
      setIsSaving(false);
    }
  };

  const updateExpandedTags = async (nextTags: string[]) => {
    if (!expandedToken) return;
    setIsSaving(true);
    try {
      await fetcher(`/users/me/watched-tokens/${encodeURIComponent(expandedToken.tokenAddress)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: normalizeTags(nextTags) }),
      });
      await mutate();
      toast.success('Tags updated');
    } catch {
      toast.error('Failed to update tags');
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
            Keep a personal shortlist here. Add fast and cluster with your own tags when needed.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-white/10 px-6 py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <Input
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Search by name, symbol, address, or tag"
                className="h-10 border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/35"
              />
            </div>

            <div className="flex gap-3">
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
                {isSubmittingCandidate ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTagFilter(null)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors',
                activeTagFilter === null
                  ? 'border-blue-500/50 bg-blue-500/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]'
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setActiveTagFilter('__untagged__')}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors',
                activeTagFilter === '__untagged__'
                  ? 'border-blue-500/50 bg-blue-500/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]'
              )}
            >
              Untagged
            </button>
            {availableUserTags.map((tag) => (
              <button
                key={`filter-${tag}`}
                type="button"
                onClick={() => setActiveTagFilter(tag)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors',
                  activeTagFilter === tag
                    ? 'border-blue-500/50 bg-blue-500/10 text-white'
                    : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]'
                )}
              >
                {tag}
              </button>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCandidateTagEditor((prev) => !prev)}
              className="ml-auto h-8 border-white/10 bg-transparent px-3 text-xs text-white/65 hover:bg-white/10"
            >
              <Tag className="mr-1.5 h-3.5 w-3.5" />
              {candidateTags.length > 0 ? `New Token Tags (${candidateTags.length})` : 'Tag New Token'}
            </Button>
          </div>

          {showCandidateTagEditor && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {candidateTags.map((tag) => (
                  <button
                    key={`candidate-tag-${tag}`}
                    type="button"
                    onClick={() => toggleCandidateTag(tag)}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-wide text-white"
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {addPresetOptions.map((tag) => (
                  <button
                    key={`preset-${tag}`}
                    type="button"
                    onClick={() => toggleCandidateTag(tag)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] uppercase tracking-wide text-white/55 transition-colors hover:bg-white/[0.06]"
                  >
                    + {tag}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <Input
                  value={candidateTagInput}
                  onChange={(event) => setCandidateTagInput(event.target.value)}
                  placeholder="Custom tag"
                  className="h-8 min-w-0 border-white/10 bg-white/5 text-white placeholder:text-white/35"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCandidateCustomTag}
                  className="h-8 border-white/10 bg-transparent px-3 text-white hover:bg-white/10"
                >
                  Add
                </Button>
              </div>
            </div>
          )}

          {candidateError && (
            <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {candidateError}
            </div>
          )}
        </div>

        <div className="max-h-[70vh] overflow-auto px-4 py-4">
          <div className="mb-3 flex items-center justify-between px-2 text-xs text-white/50">
            <span>{data.length} watched</span>
            <span>{filteredTokens.length} shown</span>
          </div>

          {isLoading ? (
            <div className="px-3 py-10 text-sm text-white/55">Loading watchlist...</div>
          ) : filteredTokens.length === 0 ? (
            <div className="px-3 py-10 text-sm text-white/55">
              {data.length === 0 ? 'No watched tokens yet.' : 'No watched tokens match this filter.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTokens.map((token) => {
                const isExpanded = token.tokenAddress === expandedTokenAddress;
                const userTags = token.userTags ?? [];

                return (
                  <div
                    key={token.tokenAddress}
                    className={cn(
                      'rounded-2xl border bg-white/[0.03] transition-colors',
                      isExpanded ? 'border-blue-500/50 bg-blue-500/[0.05]' : 'border-white/10'
                    )}
                  >
                    <div className="flex flex-col gap-2 px-3.5 py-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
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

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setExpandedTokenAddress((prev) => prev === token.tokenAddress ? null : token.tokenAddress);
                              setEditTagInput('');
                            }}
                            className="h-7 border-white/10 bg-transparent px-2.5 text-[11px] text-white/70 hover:bg-white/10"
                          >
                            <Tag className="mr-1.5 h-3.5 w-3.5" />
                            Tags
                          </Button>
                          {canOpenWorkspace && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                router.push(`/tokens?view=token&addr=${encodeURIComponent(token.tokenAddress)}`, { scroll: false });
                                onOpenChange(false);
                              }}
                              className="h-7 border-white/10 bg-transparent px-2.5 text-[11px] text-white/70 hover:bg-white/10"
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Open
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => removeWatchedToken(token.tokenAddress)}
                            className="h-7 border-white/10 bg-transparent px-2.5 text-[11px] text-white/70 hover:bg-white/10"
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/50">
                        <span className="inline-flex items-center gap-1.5">
                          <Waves className="h-3.5 w-3.5" />
                          Liquidity {formatCompactUsd(token.liquidityUsd)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5" />
                          24h {formatCompactUsd(token.volume24h)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5" />
                          {formatRelativeTime(token.latestMessageAt)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3 w-3" />
                          {formatAgeFromUnix(token.pairCreatedAt)}
                        </span>
                      </div>

                      {userTags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {userTags.slice(0, 3).map((tag) => (
                            <span
                              key={`${token.tokenAddress}-${tag}`}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50"
                            >
                              {tag}
                            </span>
                          ))}
                          {userTags.length > 3 && (
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                              +{userTags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {isExpanded && expandedToken && (
                      <div className="border-t border-white/10 bg-black/10 px-3.5 py-3">
                        <div className="mb-2">
                          <div className="text-sm font-medium text-white">Personal Tags</div>
                          <div className="text-xs text-white/45">Used only for your own filtering and clustering.</div>
                        </div>

                        <div className="mb-2.5 flex flex-wrap gap-2">
                          {expandedTags.length > 0 ? expandedTags.map((tag) => (
                            <button
                              key={`${expandedToken.tokenAddress}-${tag}-edit`}
                              type="button"
                              disabled={isSaving}
                              onClick={() => updateExpandedTags(expandedTags.filter((item) => item !== tag))}
                              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75 hover:bg-white/[0.08]"
                            >
                              {tag}
                              <X className="h-3 w-3" />
                            </button>
                          )) : (
                            <span className="text-sm text-white/45">No personal tags yet.</span>
                          )}
                        </div>

                        <div className="mb-2.5 flex flex-wrap gap-2">
                          {editPresetOptions.map((tag) => (
                            <button
                              key={`edit-preset-${expandedToken.tokenAddress}-${tag}`}
                              type="button"
                              disabled={isSaving}
                              onClick={() => updateExpandedTags([...expandedTags, tag])}
                              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] uppercase tracking-wide text-white/60 transition-colors hover:bg-white/[0.06]"
                            >
                              + {tag}
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <Input
                            value={editTagInput}
                            onChange={(event) => setEditTagInput(event.target.value)}
                            placeholder="Add custom tag"
                            className="h-8 border-white/10 bg-white/5 text-white placeholder:text-white/35"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => {
                              updateExpandedTags([...expandedTags, editTagInput]);
                              setEditTagInput('');
                            }}
                            className="h-8 border-white/10 bg-transparent px-3 text-white hover:bg-white/10"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
