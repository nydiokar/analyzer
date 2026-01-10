import type { HolderProfile } from '../types';
import { SPEED_CATEGORY_COLORS } from '@/lib/strategy-colors';
import { getBehaviorMeta } from './utils/behavior';

type DistributionBucket = {
  id: string;
  label: string;
  timeframe: string;
  count: number;
  color: string;
};

const BEHAVIOR_ORDER = [
  'SNIPER',
  'SCALPER',
  'MOMENTUM',
  'INTRADAY',
  'DAY_TRADER',
  'SWING',
  'POSITION',
  'HODLER',
] as const;

function buildDistribution(profiles: HolderProfile[]): DistributionBucket[] {
  // Count wallets by behavior type
  const counts: Record<string, number> = {};
  
  profiles.forEach((profile) => {
    let behaviorType = profile.behaviorType;
    // Normalize HOLDER to HODLER for consistency
    if (behaviorType === 'HOLDER') {
      behaviorType = 'HODLER';
    }
    if (behaviorType) {
      counts[behaviorType] = (counts[behaviorType] || 0) + 1;
    }
  });

  // Build distribution buckets in order
  return BEHAVIOR_ORDER.map((behaviorType) => {
    const meta = getBehaviorMeta(behaviorType);
    const count = counts[behaviorType] || 0;
    return {
      id: behaviorType,
      label: meta?.label || behaviorType,
      timeframe: meta?.timeframe || '',
      count,
      color: SPEED_CATEGORY_COLORS[behaviorType]?.hex || '#9ca3af',
    };
  });
}

interface Props {
  profiles: HolderProfile[];
}

export function TraderDistributionBar({ profiles }: Props) {
  const distribution = buildDistribution(profiles);
  // Filter out buckets with 0 count
  const nonZeroDistribution = distribution.filter((bucket) => bucket.count > 0);
  const total = nonZeroDistribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const maxCount = nonZeroDistribution.reduce((max, bucket) => Math.max(max, bucket.count), 0);
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
      </div>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No completed hold history yet.
        </p>
      ) : (
        <div className="grid grid-cols-[28px_1fr] gap-3">
          <div className="flex flex-col justify-between text-[10px] text-muted-foreground h-40">
            {axisSteps.map((value, index) => (
              <span key={`${value}-${index}`}>{value}</span>
            ))}
          </div>
          <div className="flex items-end gap-2 h-40">
            {nonZeroDistribution.map((bucket) => {
              const height = maxCount > 0 ? Math.round((bucket.count / maxCount) * 100) : 0;
              const percentage = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
              return (
                <div 
                  key={bucket.id} 
                  className="flex flex-col items-center flex-1 min-w-0 group cursor-pointer"
                  title={`${bucket.label}: ${bucket.count} wallets (${percentage}%)`}
                >
                  <div className="relative w-full flex items-end h-32">
                    <div
                      className="relative w-full rounded-md transition-all group-hover:opacity-80 group-hover:ring-2 group-hover:ring-white/50"
                      style={{ height: `${height}%`, backgroundColor: bucket.color }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] font-semibold text-white drop-shadow-lg">
                        {percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-white font-medium text-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {bucket.label}
                  </div>
                  <div className="mt-0.5 text-[9px] text-white/90 text-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] min-h-[11px]">
                    {bucket.id === 'HODLER' || bucket.timeframe === 'Holds until it is not' 
                      ? 'No exits yet' 
                      : bucket.timeframe || '—'}
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
