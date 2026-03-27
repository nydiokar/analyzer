import { useState, useEffect, useCallback } from 'react';
import { fetcher } from '@/lib/fetcher';

export interface HolderProfileRun {
  jobId: string;
  runAt: string;
  profileCount: number;
  topN: number | null;
}

interface UseHolderProfileHistoryOptions {
  tokenMint: string | null;
  topN: number;
  /** Only fetch when true — caller controls when to trigger (e.g. after job completes) */
  enabled: boolean;
}

interface UseHolderProfileHistoryResult {
  runs: HolderProfileRun[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useHolderProfileHistory({
  tokenMint,
  topN,
  enabled,
}: UseHolderProfileHistoryOptions): UseHolderProfileHistoryResult {
  const [runs, setRuns] = useState<HolderProfileRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!enabled || !tokenMint) {
      return;
    }

    let cancelled = false;

    // Small delay to let the DB write settle after job completion
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ tokenMint, topN: String(topN), limit: '10' });
        const data = await fetcher(`/analyses/holder-profiles/history?${params.toString()}`);
        if (!cancelled) {
          setRuns((data?.runs ?? []) as HolderProfileRun[]);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load history');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tokenMint, topN, enabled, version]);

  return { runs, isLoading, error, refetch };
}
