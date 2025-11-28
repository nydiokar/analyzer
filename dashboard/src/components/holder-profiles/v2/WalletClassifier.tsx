import { Loader2, AlertTriangle } from 'lucide-react';
import type { HolderProfilesResult } from '../types';
import { WalletHeroCard } from './WalletHeroCard';
import { WalletCompareCard } from './WalletCompareCard';
import { WalletGroupInsights } from './WalletGroupInsights';

export type WalletEntryStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface WalletClassifierEntry {
  jobId?: string;
  walletAddress: string;
  status: WalletEntryStatus;
  progress: number;
  message?: string;
  error?: string;
  result?: HolderProfilesResult;
}

interface Props {
  entries: WalletClassifierEntry[];
}

export function WalletClassifier({ entries }: Props) {
  if (!entries.length) return null;
  const completed = entries.filter((entry) => entry.status === 'completed' && entry.result);
  const pending = entries.filter((entry) => entry.status === 'running');
  const failed = entries.filter((entry) => entry.status === 'failed');

  return (
    <section className="space-y-4">
      {pending.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pending.map((entry) => (
            <div key={entry.walletAddress} className="rounded-xl border p-4 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <div>
                <p className="font-medium">Analyzing {entry.walletAddress}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.message || 'Crunching holder history...'} - {Math.round(entry.progress)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {failed.map((entry) => (
            <div key={entry.walletAddress} className="rounded-xl border border-red-500/30 p-4 flex items-center gap-3 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <p className="font-medium">Failed: {entry.walletAddress}</p>
                <p className="text-xs">{entry.error || 'Unknown error'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {completed.length === 1 && <WalletHeroCard result={completed[0].result!} />}

      {completed.length > 1 && (
        <div className="space-y-4">
          <WalletGroupInsights profiles={completed.flatMap((entry) => entry.result?.profiles || [])} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-4">
            {completed.map((entry) => (
              <WalletCompareCard key={entry.walletAddress} result={entry.result!} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}



