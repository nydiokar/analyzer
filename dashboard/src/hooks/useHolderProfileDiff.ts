import { useState, useCallback } from 'react';
import { fetcher } from '@/lib/fetcher';

export interface HolderDiffEntry {
  walletAddress: string;
  rank: number;
  behaviorType: string | null;
  supplyPercent: number;
}

export interface TierMigration {
  walletAddress: string;
  rank: number;
  from: string | null;
  to: string | null;
}

export interface HolderProfileDiff {
  tokenMint: string;
  jobIdA: string;
  jobIdB: string;
  newHolders: HolderDiffEntry[];
  departedHolders: HolderDiffEntry[];
  tierMigrations: TierMigration[];
  supplyConcentrationDelta: number;
  holderCountDelta: number;
}

interface UseHolderProfileDiffResult {
  diff: HolderProfileDiff | null;
  isLoading: boolean;
  error: string | null;
  fetchDiff: (tokenMint: string, jobIdA: string, jobIdB: string) => Promise<void>;
  clear: () => void;
}

export function useHolderProfileDiff(): UseHolderProfileDiffResult {
  const [diff, setDiff] = useState<HolderProfileDiff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async (tokenMint: string, jobIdA: string, jobIdB: string) => {
    setIsLoading(true);
    setError(null);
    setDiff(null);
    try {
      const params = new URLSearchParams({ tokenMint, jobIdA, jobIdB });
      const data = await fetcher(`/analyses/holder-profiles/diff?${params.toString()}`);
      setDiff(data as HolderProfileDiff);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load diff');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setDiff(null);
    setError(null);
  }, []);

  return { diff, isLoading, error, fetchDiff, clear };
}
