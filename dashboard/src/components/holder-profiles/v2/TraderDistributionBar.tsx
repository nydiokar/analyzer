import type { HolderProfile } from '../types';

type DistributionBucket = {
  id: string;
  label: string;
  count: number;
};

const BUCKETS = [
  { id: 'ultra', label: '1s-1m' },
  { id: 'short', label: '1m-1h' },
  { id: 'mid', label: '1h-6h' },
  { id: 'long', label: '6h-24h' },
  { id: 'extended', label: '24h+' },
];

function getBucketCount(profile: HolderProfile, key: string) {
  const enriched = profile.enrichedHoldTimeDistribution;
  const raw = profile.holdTimeDistribution;
  const read = (bucket: keyof NonNullable<HolderProfile['holdTimeDistribution']>) => {
    if (enriched && typeof enriched[bucket] === 'object') {
      return enriched[bucket]?.count ?? 0;
    }
    return raw?.[bucket] ?? 0;
  };

  switch (key) {
    case 'ultra':
      return read('instant') + read('ultraFast');
    case 'short':
      return read('fast') + read('momentum');
    case 'mid':
      return read('intraday');
    case 'long':
      return read('day');
    case 'extended':
      return read('swing') + read('position');
    default:
      return 0;
  }
}

function buildDistribution(profiles: HolderProfile[]): DistributionBucket[] {
  const totals = BUCKETS.map((bucket) => ({
    ...bucket,
    count: profiles.reduce((sum, profile) => sum + getBucketCount(profile, bucket.id), 0),
  }));
  return totals;
}

interface Props {
  profiles: HolderProfile[];
}

export function TraderDistributionBar({ profiles }: Props) {
  const distribution = buildDistribution(profiles);
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Trader Distribution
        </p>
        <p className="text-xs text-muted-foreground">Holding time</p>
      </div>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No completed hold history yet.
        </p>
      ) : (
        <div className="space-y-2">
          {distribution.map((bucket) => {
            const percent = total ? Math.round((bucket.count / total) * 100) : 0;
            return (
              <div key={bucket.id} className="flex items-center gap-3 text-xs">
                <div className="w-14 text-muted-foreground">{bucket.label}</div>
                <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="w-16 text-right text-muted-foreground tabular-nums">
                  {percent}% (n={bucket.count})
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
