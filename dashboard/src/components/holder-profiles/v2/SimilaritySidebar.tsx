import type { HolderProfilesResult } from '../types';
import { formatPercentage, formatUsd } from './utils/formatters';

interface Props {
  summaries?: HolderProfilesResult['similaritySummaries'];
}

export function SimilaritySidebar({ summaries }: Props) {
  if (!summaries || summaries.length === 0) {
    return (
      <aside className="rounded-xl border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Similarity</p>
        <p className="text-xs text-muted-foreground">No similarity results yet.</p>
      </aside>
    );
  }

  return (
    <aside className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Similarity</p>
      {summaries.map((summary, index) => (
        <div key={`${summary.overallSimilarityPercent}-${index}`} className="rounded-xl border p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Overall</span>
            <span className="font-semibold">{formatPercentage(summary.overallSimilarityPercent, 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Capital</span>
            <span>{formatPercentage(summary.capitalSimilarityPercent, 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Behavior</span>
            <span>{formatPercentage(summary.behavioralSimilarityPercent, 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Shared tokens</span>
            <span>{summary.sharedTokensCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Shared value</span>
            <span>
              {summary.sharedTokensValueUsd !== null && summary.sharedTokensValueUsd !== undefined
                ? formatUsd(summary.sharedTokensValueUsd)
                : '—'}
              {summary.sharedTokensValuePercent !== null && summary.sharedTokensValuePercent !== undefined
                ? ` (${formatPercentage(summary.sharedTokensValuePercent, 0)})`
                : ''}
            </span>
          </div>
        </div>
      ))}
    </aside>
  );
}
