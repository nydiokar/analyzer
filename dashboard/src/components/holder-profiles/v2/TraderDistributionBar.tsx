import type { HolderProfile } from '../types';
import { SPEED_CATEGORY_COLORS } from '@/lib/strategy-colors';

type DistributionBucket = {
  id: keyof NonNullable<HolderProfile['holdTimeDistribution']>;
  label: string;
  count: number;
  color: string;
};

const BUCKETS: Array<Omit<DistributionBucket, 'count'>> = [
  { id: 'instant', label: '1s-1m', color: SPEED_CATEGORY_COLORS.SNIPER.hex },
  { id: 'ultraFast', label: '1m-5m', color: SPEED_CATEGORY_COLORS.SCALPER.hex },
  { id: 'fast', label: '5m-30m', color: SPEED_CATEGORY_COLORS.MOMENTUM.hex },
  { id: 'momentum', label: '30m-4h', color: SPEED_CATEGORY_COLORS.INTRADAY.hex },
  { id: 'intraday', label: '4h-24h', color: SPEED_CATEGORY_COLORS.DAY_TRADER.hex },
  { id: 'day', label: '1-7d', color: SPEED_CATEGORY_COLORS.SWING.hex },
  { id: 'swing', label: '7-30d', color: SPEED_CATEGORY_COLORS.POSITION.hex },
  { id: 'position', label: '30d+', color: SPEED_CATEGORY_COLORS.HODLER.hex },
];

function buildDistribution(profiles: HolderProfile[]): DistributionBucket[] {
  const totals = BUCKETS.map((bucket) => ({ ...bucket, count: 0 }));
  profiles.forEach((profile) => {
    const enriched = profile.enrichedHoldTimeDistribution;
    const raw = profile.holdTimeDistribution;
    totals.forEach((bucket) => {
      if (enriched && typeof enriched[bucket.id] === 'object') {
        bucket.count += enriched[bucket.id]?.count ?? 0;
      } else if (raw) {
        bucket.count += raw[bucket.id] ?? 0;
      }
    });
  });
  return totals;
}

interface Props {
  profiles: HolderProfile[];
}

export function TraderDistributionBar({ profiles }: Props) {
  const distribution = buildDistribution(profiles);
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const maxCount = distribution.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const axisSteps = maxCount > 0
    ? [
        maxCount,
        Math.round(maxCount * 0.75),
        Math.round(maxCount * 0.5),
        Math.round(maxCount * 0.25),
        0,
      ]
    : [0, 0, 0, 0, 0];

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
        <div className="grid grid-cols-[28px_1fr] gap-3">
          <div className="flex flex-col justify-between text-[10px] text-white h-40">
            {axisSteps.map((value, index) => (
              <span key={`${value}-${index}`}>{value}</span>
            ))}
          </div>
          <div className="flex items-end gap-2 h-40">
            {distribution.map((bucket) => {
              const height = maxCount > 0 ? Math.round((bucket.count / maxCount) * 100) : 0;
              return (
                <div key={bucket.id} className="flex flex-col items-center flex-1 min-w-0">
                  <div className="relative w-full flex items-end h-32">
                    <div
                      className="relative w-full rounded-md"
                      style={{ height: `${height}%`, backgroundColor: bucket.color }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-white text-center">
                    {bucket.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
