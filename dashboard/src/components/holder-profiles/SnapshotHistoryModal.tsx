'use client';

import { useState, useCallback } from 'react';
import { History, ChevronDown, Loader2, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TokenPulse } from '@/components/holder-profiles/v2/TokenPulse';
import { fetcher } from '@/lib/fetcher';
import type { HolderProfileRun } from '@/hooks/useHolderProfileHistory';
import type { HolderProfilesResult } from '@/components/holder-profiles/types';

interface Props {
  runs: HolderProfileRun[];
  tokenMint: string;
}

function formatRunLabel(run: HolderProfileRun): string {
  const date = new Date(run.runAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let datePart: string;
  if (diffDays === 0) {
    datePart = 'Today';
  } else if (diffDays === 1) {
    datePart = 'Yesterday';
  } else if (diffDays < 7) {
    datePart = `${diffDays}d ago`;
  } else {
    datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart} at ${timePart} — Top ${run.topN ?? '?'} (${run.profileCount})`;
}

export function SnapshotHistoryModal({ runs, tokenMint }: Props) {
  const [open, setOpen] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [snapshotResult, setSnapshotResult] = useState<HolderProfilesResult | null>(null);
  const [snapshotRun, setSnapshotRun] = useState<HolderProfileRun | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (run: HolderProfileRun) => {
    // Open dialog immediately so the user sees feedback right away
    setLoadingJobId(run.jobId);
    setSnapshotRun(run);
    setSnapshotResult(null);
    setFetchError(null);
    setOpen(true);
    try {
      const params = new URLSearchParams({ tokenMint, jobId: run.jobId });
      const data = await fetcher(`/analyses/holder-profiles/snapshot?${params.toString()}`);
      setSnapshotResult(data as HolderProfilesResult);
    } catch (err: any) {
      setFetchError(err?.message ?? 'Failed to load snapshot');
    } finally {
      setLoadingJobId(null);
    }
  }, [tokenMint]);

  if (runs.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              History
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {runs.map((run) => (
              <DropdownMenuItem
                key={run.jobId}
                onClick={() => loadSnapshot(run)}
                disabled={loadingJobId === run.jobId}
                className="flex items-center gap-2 cursor-pointer"
              >
                {loadingJobId === run.jobId ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Clock className="h-3.5 w-3.5 shrink-0 opacity-50" />
                )}
                <span className="truncate">{formatRunLabel(run)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {fetchError && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            {fetchError}
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Historical Snapshot
              {snapshotRun && (
                <span className="text-muted-foreground font-normal text-sm">
                  — {formatRunLabel(snapshotRun)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {loadingJobId ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading snapshot…</span>
            </div>
          ) : fetchError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{fetchError}</AlertDescription>
            </Alert>
          ) : snapshotResult ? (
            <TokenPulse
              result={snapshotResult}
              notice={{
                title: 'Past snapshot',
                description: snapshotRun
                  ? `Frozen snapshot from ${new Date(snapshotRun.runAt).toLocaleString()}. Similarity analysis is not available for historical snapshots.`
                  : 'This is a frozen historical snapshot.',
                variant: 'default',
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
