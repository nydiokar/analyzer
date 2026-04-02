import type { HolderProfile } from '../types';
import type { WalletHudDto, KnownWalletType } from '@/types/api';

type CohortBucket = {
  id: string;
  label: string;
  rangeLabel: string;
  walletCount: number;
  supplyPercent: number;
  averageTokensPerDay: number | null;
  color: string;
  walletAddresses: string[];
};

interface Props {
  profiles: HolderProfile[];
  hudData?: Record<string, WalletHudDto>;
  selectedCohortId?: string | null;
  onCohortSelect?: (cohortId: string | null, walletAddresses: string[]) => void;
}

const SYSTEM_WALLET_TYPES: Set<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'EXCHANGE',
  'SYSTEM',
]);

const COHORTS: Array<{
  id: string;
  label: string;
  min: number;
  max: number | null;
  color: string;
}> = [
  { id: '0-5', label: '0-5', min: 0, max: 5, color: '#4ade80' },
  { id: '6-10', label: '6-10', min: 5, max: 10, color: '#84cc16' },
  { id: '11-20', label: '11-20', min: 10, max: 20, color: '#eab308' },
  { id: '21-35', label: '21-35', min: 20, max: 35, color: '#f59e0b' },
  { id: '36-60', label: '36-60', min: 35, max: 60, color: '#f97316' },
  { id: '60+', label: '60+', min: 60, max: null, color: '#ef4444' },
];

function getCohortId(tokensPerDay: number): string {
  const cohort = COHORTS.find(({ min, max }) => tokensPerDay > min && (max === null || tokensPerDay <= max))
    ?? COHORTS[0];
  return cohort.id;
}

function buildDistribution(
  profiles: HolderProfile[],
  hudData?: Record<string, WalletHudDto>
): CohortBucket[] {
  const buckets = new Map<string, {
    walletCount: number;
    supplyPercent: number;
    weightedTokensPerDay: number;
    weight: number;
    walletAddresses: string[];
  }>();

  COHORTS.forEach((cohort) => {
    buckets.set(cohort.id, {
      walletCount: 0,
      supplyPercent: 0,
      weightedTokensPerDay: 0,
      weight: 0,
      walletAddresses: [],
    });
  });

  profiles.forEach((profile) => {
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType as KnownWalletType)) {
      return;
    }

    const hud = hudData?.[profile.walletAddress];
    const tokensPerDay = hud?.uniqueTokensPerDay;
    if (tokensPerDay == null || !Number.isFinite(tokensPerDay) || tokensPerDay < 0) {
      return;
    }

    const cohortId = getCohortId(tokensPerDay);
    const bucket = buckets.get(cohortId);
    if (!bucket) return;

    const supplyPercent = profile.supplyPercent ?? 0;
    bucket.walletCount += 1;
    bucket.supplyPercent += supplyPercent;
    bucket.weightedTokensPerDay += tokensPerDay * Math.max(supplyPercent, 0.0001);
    bucket.weight += Math.max(supplyPercent, 0.0001);
    bucket.walletAddresses.push(profile.walletAddress);
  });

  return COHORTS.map((cohort) => {
    const bucket = buckets.get(cohort.id)!;
    return {
      id: cohort.id,
      label: cohort.label,
      rangeLabel: cohort.max === null ? 'Bot threshold+' : 'tokens/day',
      walletCount: bucket.walletCount,
      supplyPercent: bucket.supplyPercent,
      averageTokensPerDay: bucket.weight > 0 ? bucket.weightedTokensPerDay / bucket.weight : null,
      color: cohort.color,
      walletAddresses: bucket.walletAddresses,
    };
  });
}

export function TokensPerDayCohortBar({
  profiles,
  hudData,
  selectedCohortId = null,
  onCohortSelect,
}: Props) {
  const distribution = buildDistribution(profiles, hudData);
  const totalWallets = distribution.reduce((sum, bucket) => sum + bucket.walletCount, 0);
  const totalSupply = distribution.reduce((sum, bucket) => sum + bucket.supplyPercent, 0);
  const eligibleWallets = profiles.filter((profile) => {
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType as KnownWalletType)) {
      return false;
    }
    return true;
  }).length;
  const maxSupply = distribution.reduce((max, bucket) => Math.max(max, bucket.supplyPercent), 0);
  const axisSteps = (() => {
    if (maxSupply <= 0) return [0];
    const raw = [maxSupply, maxSupply * 0.75, maxSupply * 0.5, maxSupply * 0.25, 0];
    const unique = Array.from(new Set(raw)).sort((a, b) => b - a);
    return unique[unique.length - 1] === 0 ? unique : [...unique, 0];
  })();

  const selectedBucket = selectedCohortId
    ? distribution.find((bucket) => bucket.id === selectedCohortId) ?? null
    : null;

  return (
    <div className="rounded-xl border p-3 space-y-3 bg-gradient-to-br from-card via-card to-amber-500/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Portfolio Breadth
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            Supply held by wallets grouped by avg unique tokens/day
          </p>
        </div>
        {selectedBucket ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => onCohortSelect?.(null, [])}
          >
            Clear
          </button>
        ) : null}
      </div>

      {totalWallets === 0 || totalSupply === 0 ? (
        <p className="text-xs text-muted-foreground">
          {eligibleWallets === 0
            ? 'No eligible wallets for breadth distribution.'
            : 'Waiting for wallet HUD activity data.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[34px_1fr] gap-3">
            <div className="flex flex-col justify-between text-[11px] text-muted-foreground h-32 leading-none">
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
                      className="w-full border-t border-muted-foreground/20"
                    />
                  ))}
                </div>
                <div
                  className="grid gap-2 h-full items-stretch relative z-10"
                  style={{ gridTemplateColumns: `repeat(${distribution.length}, minmax(0, 1fr))` }}
                >
                  {distribution.map((bucket) => {
                    const height = maxSupply > 0 ? Math.round((bucket.supplyPercent / maxSupply) * 100) : 0;
                    const isSelected = selectedCohortId === bucket.id;
                    const hasSelection = selectedCohortId !== null;
                    const supplyPercentFormatted = bucket.supplyPercent.toFixed(2);
                    const avgTokensLabel = bucket.averageTokensPerDay != null
                      ? `${bucket.averageTokensPerDay.toFixed(1)} avg`
                      : 'No data';
                    return (
                      <button
                        key={bucket.id}
                        type="button"
                        className="relative group h-full flex items-end focus:outline-none"
                        title={`${bucket.label}: ${bucket.walletCount} wallets • ${supplyPercentFormatted}% of supply • ${avgTokensLabel}`}
                        onClick={() => {
                          if (!onCohortSelect) return;
                          if (isSelected) {
                            onCohortSelect(null, []);
                            return;
                          }
                          onCohortSelect(bucket.id, bucket.walletAddresses);
                        }}
                      >
                        <div className="relative w-full h-full flex items-end">
                          <div
                            className="w-full rounded-md transition-all duration-200 group-hover:opacity-90 group-hover:ring-2 group-hover:ring-white/40"
                            style={{
                              height: `${height}%`,
                              background: `linear-gradient(180deg, ${bucket.color} 0%, rgba(255,255,255,0.18) 0%, ${bucket.color} 100%)`,
                              opacity: hasSelection && !isSelected ? 0.35 : 1,
                              boxShadow: isSelected ? `0 0 18px ${bucket.color}55` : 'none',
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <span className="text-[11px] font-semibold text-white drop-shadow-lg">
                              {supplyPercentFormatted}%
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className="mt-1 grid gap-2 text-center"
                style={{ gridTemplateColumns: `repeat(${distribution.length}, minmax(0, 1fr))` }}
              >
                {distribution.map((bucket) => {
                  const isSelected = selectedCohortId === bucket.id;
                  const hasSelection = selectedCohortId !== null;
                  return (
                    <div
                      key={`${bucket.id}-label`}
                      className="min-w-0 transition-opacity"
                      style={{ opacity: hasSelection && !isSelected ? 0.45 : 1 }}
                    >
                      <div className="text-[11px] text-white font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                        {bucket.label}
                      </div>
                      <div className="text-[10px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                        {bucket.rangeLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-2">
            {selectedBucket ? (
              <p className="text-xs text-foreground/85">
                <span className="font-semibold text-foreground">{selectedBucket.label}</span> controls{' '}
                <span className="font-semibold text-amber-300">{selectedBucket.supplyPercent.toFixed(1)}%</span> of supply
                across {selectedBucket.walletCount} wallet{selectedBucket.walletCount === 1 ? '' : 's'}.
              </p>
            ) : (
              <p className="text-xs text-foreground/75">
                Click a cohort to spotlight those wallets in the evidence table.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
