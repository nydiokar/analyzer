'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetcher } from '@/lib/fetcher';
import { RotateCw, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface JobHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserJob {
  id: string;
  name: string;
  queue: string;
  status: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused';
  createdAt: string;
  finishedAt?: string;
  processingTime: number;
  mode?: 'token' | 'wallet';
  tokenMint?: string;
  walletAddress?: string;
  walletAddresses?: string[];
  topN?: number;
  requestId?: string;
  similarityConfig?: { vectorType?: 'capital' | 'binary' };
  totalHolders: number;
}

const DEFAULT_PAGE_SIZE = 20;

export function JobHistoryModal({ open, onOpenChange }: JobHistoryModalProps) {
  const [page, setPage] = useState(0);
  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null);

  const offset = page * DEFAULT_PAGE_SIZE;

  const swrKey = open
    ? `/users/me/jobs?limit=${DEFAULT_PAGE_SIZE}&offset=${offset}`
    : null;

  const { data: jobs, error, isLoading, mutate } = useSWR<UserJob[]>(
    swrKey,
    fetcher,
    {
      refreshInterval: open ? 5000 : 0,
    }
  );

  const hasNextPage = useMemo(() => {
    return (jobs?.length || 0) >= DEFAULT_PAGE_SIZE;
  }, [jobs]);

  const getStatusBadge = (status: UserJob['status']) => {
    const config: Record<UserJob['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      waiting: { variant: 'secondary', label: 'Queued' },
      active: { variant: 'secondary', label: 'Running' },
      delayed: { variant: 'outline', label: 'Delayed' },
      completed: { variant: 'default', label: 'Done' },
      failed: { variant: 'destructive', label: 'Failed' },
      paused: { variant: 'outline', label: 'Paused' },
    };

    const { variant, label } = config[status];
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getJobName = (job: UserJob) => {
    if (job.name === 'similarity-analysis-flow') {
      return `Similarity: ${job.walletAddresses?.length ?? 0} wallets`;
    }
    if (job.mode === 'token' && job.tokenMint) {
      return `Holder Profiles: ${job.tokenMint.slice(0, 8)}...`;
    }
    if (job.mode === 'wallet' && job.walletAddress) {
      return `Holder Profile: ${job.walletAddress.slice(0, 8)}...`;
    }
    return 'Holder Profile Analysis';
  };

  const handleRerun = async (job: UserJob) => {
    if (rerunningJobId) {
      return;
    }

    setRerunningJobId(job.id);

    try {
      const isSimilarity = job.name === 'similarity-analysis-flow';
      if (isSimilarity) {
        if (!job.walletAddresses || job.walletAddresses.length < 2) {
          toast.error('Missing wallet list for similarity rerun.');
          return;
        }

        await fetcher('/analyses/similarity/queue', {
          method: 'POST',
          body: JSON.stringify({
            walletAddresses: job.walletAddresses,
            vectorType: job.similarityConfig?.vectorType,
          }),
        });
      } else if (job.mode === 'token') {
        if (!job.tokenMint) {
          toast.error('Missing token mint for rerun.');
          return;
        }

        await fetcher('/analyses/holder-profiles/token', {
          method: 'POST',
          body: JSON.stringify({
            tokenMint: job.tokenMint,
            topN: job.topN,
          }),
        });
      } else if (job.mode === 'wallet') {
        if (!job.walletAddress) {
          toast.error('Missing wallet address for rerun.');
          return;
        }

        await fetcher('/analyses/holder-profiles/wallet', {
          method: 'POST',
          body: JSON.stringify({
            walletAddress: job.walletAddress,
          }),
        });
      } else {
        toast.error('Unsupported job type for rerun.');
        return;
      }

      toast.success('Job queued successfully!');
      await mutate();
    } catch (err) {
      console.error('Failed to rerun job:', err);
      toast.error('Failed to queue job. Please try again.');
    } finally {
      setRerunningJobId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job History</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <p className="text-destructive mb-2">Failed to load jobs</p>
            <Button variant="outline" onClick={() => mutate()}>
              Retry
            </Button>
          </div>
        )}

        {jobs && jobs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              No jobs found yet. Run a holder profile analysis or similarity job to see it here!
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[320px]">Job</TableHead>
                  <TableHead>Token / Wallets</TableHead>
                  <TableHead>Holders</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">{getJobName(job)}</span>
                        <span className="text-xs text-muted-foreground">
                          {job.name === 'similarity-analysis-flow'
                            ? 'Similarity'
                            : job.mode === 'token'
                              ? 'Token Mode'
                              : 'Wallet Mode'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {job.mode === 'token' && job.tokenMint && (
                        <TokenBadge mint={job.tokenMint} layout="inline" />
                      )}
                      {job.name === 'similarity-analysis-flow' && (
                        <span className="text-muted-foreground">
                          {job.walletAddresses?.length ?? 0} wallets
                        </span>
                      )}
                      {job.mode === 'wallet' && job.name !== 'similarity-analysis-flow' && (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.totalHolders > 0 ? (
                        <span className="text-sm">{job.totalHolders}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                        </span>
                        {job.processingTime > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({(job.processingTime / 1000).toFixed(1)}s)
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRerun(job)}
                        disabled={rerunningJobId === job.id || job.status === 'active'}
                      >
                        {rerunningJobId === job.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <RotateCw className="w-4 h-4 mr-1" />
                            Rerun
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="flex justify-end gap-2 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={!hasNextPage}
            >
              Next
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
