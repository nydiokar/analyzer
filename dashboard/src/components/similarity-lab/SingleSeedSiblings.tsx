'use client';

/**
 * Surface B (SURFACE-1): single-seed instant sibling lookup inside the Similarity
 * Lab — the pivot destination for a Holder Profiles chip.
 *
 * Reuses the proven vector-first path (GET /intel/wallet/:addr/similar, 11–46ms,
 * same as /wallet-siblings) but lives in the Lab the analyst already uses. The
 * ?rerank toggle flips behavioral-cosine vs coordination (shared-token) view in
 * one click (the SPEC001_T06 delta). Each neighbor is clickable to re-seed —
 * iterative wallet→wallet pivoting without a new page.
 *
 * This is additive: it does NOT touch the existing ≥2-wallet queue-backed flow.
 * Honest labels only — "behavioral fingerprint" / "coordinated", never "same person".
 */

import { useState, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, Crosshair } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { toast } from 'sonner';

interface SimilarNeighbor {
  walletAddress: string;
  distance: number;
  builtAt: string;
  cosineSimilarity?: number;
  sharedTokenCount?: number;
  sharedTokenJaccard?: number;
  blendedScore?: number;
  strategyType?: string | null;
  speedCategory?: string | null;
  winRate?: number | null;
}

interface SimilarResponse {
  status: 'ok';
  walletAddress: string;
  schemaVersion: number;
  builtAt: string;
  neighbors: SimilarNeighbor[];
}

function formatWin(win?: number | null): string {
  if (win == null) return '—';
  return `${win.toFixed(1)}%`;
}

function formatNum(n?: number | null, digits = 4): string {
  if (n == null) return '—';
  return n.toFixed(digits);
}

export function SingleSeedSiblings({ initialSeed }: { initialSeed?: string | null }) {
  const [addr, setAddr] = useState(initialSeed ?? '');
  const [rerank, setRerank] = useState(true);
  const [k] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimilarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState<string | null>(null);

  const run = useCallback(
    async (seedOverride?: string, rerankOverride?: boolean) => {
      const seed = (seedOverride ?? addr).trim();
      const useRerank = rerankOverride ?? rerank;
      if (!isValidSolanaAddress(seed)) {
        setError('Enter a valid Solana wallet address');
        return;
      }
      setLoading(true);
      setError(null);
      setActiveSeed(seed);
      try {
        const params = new URLSearchParams({ k: String(k) });
        if (useRerank) params.set('rerank', 'true');
        const data = (await fetcher(
          `/intel/wallet/${seed}/similar?${params.toString()}`,
        )) as SimilarResponse;
        setResult(data);
        if (data.neighbors.length === 0) {
          toast.info('No behavioral neighbors found for this wallet.');
        }
      } catch (e: unknown) {
        const status = (e as { status?: number })?.status;
        const message =
          status === 404
            ? 'No representation yet — this wallet has no behavioral vector (needs a completed analysis first).'
            : e instanceof Error
              ? e.message
              : 'Failed to load siblings';
        setError(message);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [addr, rerank, k],
  );

  // Auto-run when deep-linked with a seed.
  useEffect(() => {
    if (initialSeed && isValidSolanaAddress(initialSeed.trim())) {
      setAddr(initialSeed.trim());
      run(initialSeed.trim());
    }
    // Only on initialSeed change (deep-link), not on every run identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeed]);

  const reseed = useCallback(
    (neighbor: string) => {
      setAddr(neighbor);
      run(neighbor);
    },
    [run],
  );

  const onToggleRerank = useCallback(
    (next: boolean) => {
      setRerank(next);
      if (activeSeed) run(activeSeed, next);
    },
    [activeSeed, run],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') run();
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-sky-500" />
        <h3 className="text-sm font-semibold">Instant siblings (single seed)</h3>
        <Badge variant="secondary" className="text-[10px]">vector-first · no queue</Badge>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="seed-lab">Seed wallet</Label>
          <Input
            id="seed-lab"
            placeholder="Solana wallet address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="rerank-lab" checked={rerank} onCheckedChange={onToggleRerank} />
          <Label htmlFor="rerank-lab" className="cursor-pointer">
            Coordination view
          </Label>
        </div>
        <Button onClick={() => run()} disabled={loading} className="gap-2">
          <Search className="h-4 w-4" />
          {loading ? 'Finding…' : 'Find siblings'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reads the persisted behavioral fingerprint via the HNSW index — DB-wide, instant, no
        analysis job.
        {rerank
          ? ' Coordination view blends behavioral cosine with shared-token overlap so coordinated wallets surface.'
          : ' Pure behavioral-fingerprint ordering.'}{' '}
        Click any neighbor to re-seed.
      </p>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {result && !loading && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="text-sm text-muted-foreground">
              Seed <span className="font-mono text-foreground">{result.walletAddress.slice(0, 8)}…</span>
              {' · '}
              {result.neighbors.length} neighbor{result.neighbors.length === 1 ? '' : 's'}
              {' · '}fingerprint v{result.schemaVersion}
            </div>
            {rerank && <Badge variant="secondary">coordination view</Badge>}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Behavior</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">Cosine dist</TableHead>
                  {rerank && <TableHead className="text-right">Shared tokens</TableHead>}
                  {rerank && <TableHead className="text-right">Blended</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.neighbors.map((n) => (
                  <TableRow
                    key={n.walletAddress}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => reseed(n.walletAddress)}
                    title="Click to re-seed from this wallet"
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <WalletBadge address={n.walletAddress} variant="inline" size="s" />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {n.strategyType ? (
                          <Badge variant="outline">{n.strategyType}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                        {n.speedCategory && <Badge variant="secondary">{n.speedCategory}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatWin(n.winRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNum(n.distance)}</TableCell>
                    {rerank && (
                      <TableCell className="text-right tabular-nums">
                        {n.sharedTokenCount != null && n.sharedTokenCount > 0 ? (
                          <Badge variant="default">{n.sharedTokenCount}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    )}
                    {rerank && (
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatNum(n.blendedScore)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}
