'use client';

/**
 * Wallet Siblings — first consumer of the SPEC-001 vector-first similarity
 * endpoint (GET /intel/wallet/:addr/similar).
 *
 * Unlike Similarity Lab (queue-backed, needs >=2 wallets, re-fetches tx per
 * request), this answers "wallets like X across the DB" from the persisted
 * WalletVector HNSW index in interactive time for a SINGLE seed. The rerank
 * toggle blends behavioral cosine with shared-token overlap so coordination
 * siblings float up; the enriched columns (strategy/speed/win%) are what make
 * the neighbor list actionable rather than a bare address+distance dump.
 */

import { useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageTitle } from '@/components/shared/PageTitle';
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
import { Users, Search } from 'lucide-react';
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

export default function WalletSiblingsPage() {
  const [addr, setAddr] = useState('');
  const [rerank, setRerank] = useState(true);
  const [k, setK] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimilarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    const seed = addr.trim();
    if (!isValidSolanaAddress(seed)) {
      setError('Enter a valid Solana wallet address');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ k: String(k) });
      if (rerank) params.set('rerank', 'true');
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
          ? 'No stored vector for this wallet yet — it needs a behavior profile + vector backfill first.'
          : e instanceof Error
            ? e.message
            : 'Failed to load siblings';
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [addr, rerank, k]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') run();
  };

  return (
    <AppShell>
      <div className="space-y-6 p-4 md:p-6">
        <PageTitle title="Wallet Siblings" icon={Users} />

        <Card className="p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="seed">Seed wallet</Label>
              <Input
                id="seed"
                placeholder="Solana wallet address"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="k">Neighbors</Label>
              <Input
                id="k"
                type="number"
                min={1}
                max={100}
                value={k}
                onChange={(e) => setK(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
                className="w-24"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="rerank" checked={rerank} onCheckedChange={setRerank} />
              <Label htmlFor="rerank" className="cursor-pointer">
                Shared-token re-rank
              </Label>
            </div>
            <Button onClick={run} disabled={loading} className="gap-2">
              <Search className="h-4 w-4" />
              {loading ? 'Finding…' : 'Find siblings'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Reads the persisted behavioral vector via the HNSW index — instant, no analysis job.
            {rerank
              ? ' Re-rank blends behavioral cosine with shared-token overlap so coordination siblings surface.'
              : ' Pure behavioral cosine ordering.'}
          </p>
        </Card>

        {error && (
          <Card className="p-4 border-red-500/40 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
            {error}
          </Card>
        )}

        {loading && (
          <Card className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </Card>
        )}

        {result && !loading && (
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm text-muted-foreground">
                Seed <span className="font-mono text-foreground">{result.walletAddress.slice(0, 8)}…</span>
                {' · '}
                {result.neighbors.length} neighbor{result.neighbors.length === 1 ? '' : 's'}
                {' · '}vector v{result.schemaVersion}
              </div>
              {rerank && <Badge variant="secondary">re-ranked</Badge>}
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
                    <TableRow key={n.walletAddress}>
                      <TableCell>
                        <WalletBadge address={n.walletAddress} variant="inline" size="s" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {n.strategyType ? (
                            <Badge variant="outline">{n.strategyType}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                          {n.speedCategory && (
                            <Badge variant="secondary">{n.speedCategory}</Badge>
                          )}
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
          </Card>
        )}
      </div>
    </AppShell>
  );
}
