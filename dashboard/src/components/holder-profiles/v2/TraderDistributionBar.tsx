import type { HolderProfile } from '../types';
import { SPEED_CATEGORY_COLORS } from '@/lib/strategy-colors';
import { getBehaviorMeta } from './utils/behavior';
import type { KnownWalletType } from '@/types/api';

type DistributionBucket = {
  id: string;
  label: string;
  timeframe: string;
  count: number;
  supplyPercent: number;
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

// System wallet types to exclude from distribution
const SYSTEM_WALLET_TYPES: Set<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'EXCHANGE',
  'SYSTEM',
]);

function buildDistribution(profiles: HolderProfile[]): DistributionBucket[] {
  // Count wallets and sum supply by behavior type (excluding system wallets)
  const counts: Record<string, number> = {};
  const supplyPercents: Record<string, number> = {};

  profiles.forEach((profile) => {
    // Skip system wallets and LP pools
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType as KnownWalletType)) {
      return;
    }

    let behaviorType = profile.behaviorType;
    // Normalize HOLDER to HODLER for consistency
    if (behaviorType === 'HOLDER') {
      behaviorType = 'HODLER';
    }
    if (!behaviorType) {
      const isHolderOnly = (profile.currentHoldingsCount ?? 0) > 0;
      const hasNoExits = (profile.completedCycleCount ?? 0) === 0;
      if (isHolderOnly && hasNoExits) {
        behaviorType = 'HODLER';
      }
    }
    if (behaviorType) {
      counts[behaviorType] = (counts[behaviorType] || 0) + 1;
      const supply = profile.supplyPercent ?? 0;
      supplyPercents[behaviorType] = (supplyPercents[behaviorType] || 0) + supply;
    }
  });

  // Build distribution buckets in order
  return BEHAVIOR_ORDER.map((behaviorType) => {
    const meta = getBehaviorMeta(behaviorType === 'HODLER' ? 'HOLDER' : behaviorType);
    const count = counts[behaviorType] || 0;
    const supplyPercent = supplyPercents[behaviorType] || 0;
    return {
      id: behaviorType,
      label: behaviorType === 'HODLER' ? 'Holder (no exits yet)' : (meta?.label || behaviorType),
      timeframe: meta?.timeframe || '',
      count,
      supplyPercent,
      color: SPEED_CATEGORY_COLORS[behaviorType]?.hex || '#9ca3af',
    };
  });
}

interface Props {
  profiles: HolderProfile[];
}

export function TraderDistributionBar({ profiles }: Props) {
  const distribution = buildDistribution(profiles);
  const totalWallets = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const totalSupply = distribution.reduce((sum, bucket) => sum + bucket.supplyPercent, 0);
  const maxSupply = distribution.reduce((max, bucket) => Math.max(max, bucket.supplyPercent), 0);
  const displayBuckets = distribution;
  const axisSteps = (() => {
    if (maxSupply <= 0) return [0];
    const raw = [
      maxSupply,
      maxSupply * 0.75,
      maxSupply * 0.5,
      maxSupply * 0.25,
      0,
    ];
    const unique = Array.from(new Set(raw)).sort((a, b) => b - a);
    return unique[unique.length - 1] === 0 ? unique : [...unique, 0];
  })();

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Trader Distribution
        </p>
      </div>
      {totalWallets === 0 ? (
        <p className="text-xs text-muted-foreground">
          No completed hold history yet.
        </p>
      ) : (
        <div className="grid grid-cols-[28px_1fr] gap-3">
          <div className="flex flex-col justify-between text-[10px] text-muted-foreground h-32 leading-none">
            {axisSteps.map((value, index) => (
              <span key={`${value}-${index}`}>{value.toFixed(1)}%</span>
            ))}
          </div>
          <div className="flex flex-col">
            <div className="relative h-32 overflow-hidden">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {axisSteps.map((value, index) => (
                  <div
                    key={`grid-${value}-${index}`}
                    className="w-full border-t border-muted-foreground/25"
                  />
                ))}
              </div>
              <div
                className="grid gap-2 h-full items-stretch relative z-10"
                style={{ gridTemplateColumns: `repeat(${displayBuckets.length}, minmax(0, 1fr))` }}
              >
                {displayBuckets.map((bucket) => {
                  const height = maxSupply > 0 ? Math.round((bucket.supplyPercent / maxSupply) * 100) : 0;
                  const supplyPercentFormatted = bucket.supplyPercent.toFixed(2);
                  return (
                    <div
                      key={bucket.id}
                      className="relative group cursor-pointer h-full flex items-end"
                      title={`${bucket.label}: ${bucket.count} wallets • ${supplyPercentFormatted}% of supply`}
                    >
                      <div className="relative w-full h-full flex items-end">
                        <div
                          className="w-full rounded-md transition-all group-hover:opacity-80 group-hover:ring-2 group-hover:ring-white/50"
                          style={{ height: `${height}%`, backgroundColor: bucket.color }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[10px] font-semibold text-white drop-shadow-lg">
                            {supplyPercentFormatted}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="mt-1 grid gap-2 text-center"
              style={{ gridTemplateColumns: `repeat(${displayBuckets.length}, minmax(0, 1fr))` }}
            >
              {displayBuckets.map((bucket) => (
                <div key={`${bucket.id}-label`} className="min-w-0">
                  <div className="text-[10px] text-white font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {bucket.label}
                  </div>
                  <div className="text-[9px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {bucket.id === 'HODLER' || bucket.timeframe === 'Holds until it is not'
                      ? ''
                      : bucket.timeframe || '-'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
