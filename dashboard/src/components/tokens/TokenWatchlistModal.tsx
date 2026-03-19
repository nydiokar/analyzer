"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Star, Trash2, ExternalLink } from 'lucide-react';
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

export function TokenWatchlistModal({ open, onOpenChange, canOpenWorkspace }: TokenWatchlistModalProps) {
  const router = useRouter();
  const { data, isLoading, mutate } = useUserWatchedTokens(open);
  const [query, setQuery] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [validation, setValidation] = useState<TokenValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setValidation(null);
      setIsValidating(false);
      setIsSaving(false);
      return;
    }
    if (!selectedAddress && data.length > 0) {
      setSelectedAddress(data[0].tokenAddress);
    }
  }, [open, data, selectedAddress]);

  const filteredTokens = useMemo(() => {
    const term = query.trim().toLowerCase();
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
  }, [data, query]);

  const selectedToken = useMemo<WatchedTokenRow | null>(() => {
    if (!selectedAddress) return null;
    return data.find((token) => token.tokenAddress === selectedAddress) ?? null;
  }, [data, selectedAddress]);

  const validateInput = async () => {
    const trimmed = query.trim();
    setSelectedAddress(null);
    if (!looksLikeSolanaAddress(trimmed)) {
      setValidation({
        valid: false,
        error: 'Paste a valid Solana token address to add a token.',
      });
      return;
    }

    setIsValidating(true);
    setValidation(null);
    try {
      const result = await fetcher(`/token-validation/${encodeURIComponent(trimmed)}`) as TokenValidationResult;
      setValidation(result);
      if (result.valid) {
        setSelectedAddress(trimmed);
      }
    } catch (error) {
      setValidation({
        valid: false,
        error: 'Validation failed. Please try again.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const setWatched = async (tokenAddress: string, on: boolean) => {
    setIsSaving(true);
    try {
      await fetcher(`/users/me/watched-tokens/${encodeURIComponent(tokenAddress)}/watch`, {
        method: 'POST',
        body: JSON.stringify({ on }),
      });
      await mutate();
      if (on) {
        toast.success('Token added to your watchlist');
        setSelectedAddress(tokenAddress);
        setValidation(null);
      } else {
        toast.success('Token removed from your watchlist');
        if (selectedAddress === tokenAddress) {
          const next = data.find((token) => token.tokenAddress !== tokenAddress);
          setSelectedAddress(next?.tokenAddress ?? null);
        }
      }
    } catch (error) {
      toast.error(on ? 'Failed to watch token' : 'Failed to remove token');
    } finally {
      setIsSaving(false);
    }
  };

  const previewAddress = validation ? (validation.token?.address ?? null) : (selectedToken?.tokenAddress ?? null);
  const previewMetadata = validation?.token
    ? {
        name: validation.token.name ?? undefined,
        symbol: validation.token.symbol ?? undefined,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden border-white/10 bg-[#111218] p-0 text-white sm:rounded-2xl">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-white">Favorite Tokens</DialogTitle>
          <DialogDescription className="text-white/60">
            Your personal token shortlist. Analysts can jump from here into the shared `/tokens` workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[70vh] grid-cols-1 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <section className="border-b border-white/10 bg-[#14151d] lg:border-b-0 lg:border-r">
            <div className="space-y-3 border-b border-white/10 px-5 py-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search watched tokens or paste CA"
                  className="h-10 border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/35"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>{filteredTokens.length} watched</span>
                <span>Paste CA to add new token</span>
              </div>
            </div>

            <div className="max-h-[56vh] overflow-auto px-3 py-3 lg:max-h-[calc(70vh-102px)]">
              {isLoading ? (
                <div className="px-3 py-10 text-sm text-white/55">Loading watchlist...</div>
              ) : filteredTokens.length === 0 ? (
                <div className="px-3 py-10 text-sm text-white/55">
                  {query.trim() ? 'No watched tokens match this search.' : 'No watched tokens yet.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTokens.map((token) => {
                    const isSelected = token.tokenAddress === selectedToken?.tokenAddress;
                    return (
                      <button
                        key={token.tokenAddress}
                        type="button"
                        onClick={() => {
                          setSelectedAddress(token.tokenAddress);
                          setValidation(null);
                        }}
                        className={cn(
                          'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
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
                          <span>MCap {formatCompactUsd(token.marketCapUsd)}</span>
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
                      </button>
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
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Paste token address to add"
                  className="h-10 border-white/10 bg-white/5 text-white placeholder:text-white/35"
                />
                <Button
                  type="button"
                  onClick={validateInput}
                  disabled={isValidating || isSaving}
                  className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  {isValidating ? 'Checking...' : 'Add Token'}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-6">
              {previewAddress ? (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <TokenBadge
                      mint={previewAddress}
                      size="lg"
                      metadata={previewMetadata}
                    />
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] uppercase tracking-wide text-white/45">Market Cap</div>
                        <div className="mt-1 font-medium text-white">
                          {selectedToken ? formatCompactUsd(selectedToken.marketCapUsd) : '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] uppercase tracking-wide text-white/45">Liquidity</div>
                        <div className="mt-1 font-medium text-white">
                          {selectedToken ? formatCompactUsd(selectedToken.liquidityUsd) : validation?.token?.hasLiquidity ? 'Available' : 'Unknown'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] uppercase tracking-wide text-white/45">Thread Activity</div>
                        <div className="mt-1 font-medium text-white">
                          {selectedToken ? formatRelativeTime(selectedToken.latestMessageAt) : 'No thread activity yet'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {validation?.valid ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                        Token validated via DexScreener. Add it to your personal watchlist.
                      </div>
                      <Button
                        type="button"
                        disabled={isSaving || !validation.token?.address}
                        onClick={() => validation.token?.address && setWatched(validation.token.address, true)}
                        className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                      >
                        <Star className="h-4 w-4" />
                        Watch Token
                      </Button>
                    </div>
                  ) : validation ? (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      {validation.error || 'Token validation failed.'}
                    </div>
                  ) : selectedToken ? (
                    <div className="space-y-4">
                      {selectedToken.tags.length > 0 && (
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
                      )}

                      <div className="flex flex-wrap gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isSaving}
                          onClick={() => setWatched(selectedToken.tokenAddress, false)}
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
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-sm text-white/55">
                      Paste a token address to validate and add it, or select a watched token from the list.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-sm text-white/55">
                  Paste a token address to validate and add it, or select a watched token from the list.
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
