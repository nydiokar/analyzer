import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface ShareProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  behaviorType: string | null;
  medianHoldTimeHours: number | null;
  walletRealizedPnlSol?: number | null;
  solBalance?: number | null;
  dataQualityTier: string;
  completedCycleCount: number;
  tokenHoldingValueSol?: number | null;
  knownType?: string;
  analysisSkipped?: boolean;
}

interface ShareSnapshot {
  mode: string;
  tokenMint?: string;
  tokenSymbol?: string;
  topN?: number;
  profiles: ShareProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

interface ShareRecord {
  id: string;
  snapshot: ShareSnapshot;
  tokenMint: string | null;
  tokenSymbol: string | null;
  topN: number | null;
  createdAt: string;
  viewCount: number;
}

async function fetchShare(shareId: string): Promise<ShareRecord | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1';
  try {
    const res = await fetch(`${base}/share/hp/${shareId}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const share = await fetchShare(shareId);

  if (!share) {
    return { title: 'Analysis Not Found — Sova Intel' };
  }

  const { snapshot } = share;
  const tokenLabel = snapshot.tokenSymbol ? `$${snapshot.tokenSymbol}` : (snapshot.tokenMint ? `${snapshot.tokenMint.slice(0, 6)}…` : 'Token');
  const holderCount = snapshot.profiles.length;

  // Build behavior breakdown string
  const behaviorCounts: Record<string, number> = {};
  for (const p of snapshot.profiles) {
    if (p.behaviorType && !p.analysisSkipped) {
      behaviorCounts[p.behaviorType] = (behaviorCounts[p.behaviorType] ?? 0) + 1;
    }
  }
  const topBehaviors = Object.entries(behaviorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count} ${formatBehaviorLabel(type)}`)
    .join(' · ');

  const description = topBehaviors
    ? `${holderCount} holders — ${topBehaviors}`
    : `${holderCount} holders analyzed`;

  const ogImageUrl = `/api/og/hp/${shareId}`;

  return {
    title: `Holder Profiles: ${tokenLabel} — Sova Intel`,
    description,
    openGraph: {
      title: `Holder Profiles: ${tokenLabel}`,
      description,
      url: `/share/hp/${shareId}`,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `Holder Profiles: ${tokenLabel}`,
      description,
      images: [ogImageUrl],
    },
  };
}

function formatBehaviorLabel(type: string): string {
  const map: Record<string, string> = {
    SNIPER: 'Snipers',
    SCALPER: 'Scalpers',
    MOMENTUM: 'Momentum',
    INTRADAY: 'Intraday',
    DAY_TRADER: 'Day Traders',
    SWING_TRADER: 'Swing Traders',
    POSITION_TRADER: 'Position Traders',
    HODLER: 'Holders',
  };
  return map[type] ?? type;
}

function formatSol(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k SOL`;
  if (abs >= 1) return `${value.toFixed(2)} SOL`;
  return `${value.toFixed(3)} SOL`;
}

function formatHoldTime(hours: number | null | undefined): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatPercent(value: number): string {
  if (value < 0.01) return '<0.01%';
  return `${value.toFixed(2)}%`;
}

const BEHAVIOR_COLORS: Record<string, string> = {
  SNIPER: '#ef4444',
  SCALPER: '#f97316',
  MOMENTUM: '#eab308',
  INTRADAY: '#84cc16',
  DAY_TRADER: '#22c55e',
  SWING_TRADER: '#14b8a6',
  POSITION_TRADER: '#3b82f6',
  HODLER: '#8b5cf6',
};

function getBehaviorColor(type: string | null): string {
  if (!type) return '#6b7280';
  return BEHAVIOR_COLORS[type] ?? '#6b7280';
}

export default async function ShareHolderProfilesPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const share = await fetchShare(shareId);

  if (!share) {
    notFound();
  }

  const { snapshot } = share!;
  const tokenLabel = snapshot.tokenSymbol
    ? `$${snapshot.tokenSymbol}`
    : snapshot.tokenMint
      ? `${snapshot.tokenMint.slice(0, 8)}…${snapshot.tokenMint.slice(-4)}`
      : 'Token';

  // Behavior distribution
  const behaviorCounts: Record<string, number> = {};
  for (const p of snapshot.profiles) {
    if (p.behaviorType && !p.analysisSkipped) {
      behaviorCounts[p.behaviorType] = (behaviorCounts[p.behaviorType] ?? 0) + 1;
    }
  }
  const sortedBehaviors = Object.entries(behaviorCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-[#040a14] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#040a14]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-white/80 hover:text-white transition-colors">
            Sova Intel
          </Link>
          <span className="text-xs text-white/40">Shared Analysis</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-white/40 uppercase tracking-widest">Holder Profiles</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{tokenLabel}</h1>
          {snapshot.tokenMint && (
            <p className="text-xs text-white/30 mt-0.5 font-mono">{snapshot.tokenMint}</p>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Holders Analyzed', value: String(snapshot.profiles.length) },
            { label: 'Requested', value: String(snapshot.metadata.totalHoldersRequested) },
            { label: 'Avg Analysis Time', value: `${Math.round(snapshot.metadata.avgProcessingTimePerWalletMs)}ms` },
            { label: 'Views', value: String(share.viewCount + 1) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] text-white/40 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Behavior breakdown */}
        {sortedBehaviors.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
            <p className="text-xs text-white/40 uppercase tracking-wide mb-3">Behavior Breakdown</p>
            <div className="flex flex-wrap gap-2">
              {sortedBehaviors.map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                  style={{
                    background: `${getBehaviorColor(type)}22`,
                    border: `1px solid ${getBehaviorColor(type)}44`,
                    color: getBehaviorColor(type),
                  }}
                >
                  <span>{count}</span>
                  <span className="opacity-80">{formatBehaviorLabel(type)}</span>
                </div>
              ))}
            </div>
            {/* Bar */}
            <div className="mt-3 h-2 rounded-full overflow-hidden flex">
              {sortedBehaviors.map(([type, count]) => (
                <div
                  key={type}
                  title={`${formatBehaviorLabel(type)}: ${count}`}
                  style={{
                    width: `${(count / snapshot.profiles.length) * 100}%`,
                    background: getBehaviorColor(type),
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Holders table */}
        <div className="rounded-xl border border-white/10 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium w-12">#</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Wallet</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Behavior</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Holdings</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Supply</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Realized PnL</th>
                <th className="text-left px-4 py-2.5 text-xs text-white/40 font-medium">Med. Hold</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.profiles.map((profile) => {
                const pnl = profile.walletRealizedPnlSol ?? null;
                const addr = profile.walletAddress;
                const shortAddr = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
                return (
                  <tr key={addr} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-2.5 text-white/30 tabular-nums">{profile.rank}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-white/70 text-xs">{shortAddr}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {profile.analysisSkipped ? (
                        <span className="text-white/30 text-xs">{profile.knownType ?? 'Skipped'}</span>
                      ) : profile.behaviorType ? (
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: `${getBehaviorColor(profile.behaviorType)}22`,
                            color: getBehaviorColor(profile.behaviorType),
                          }}
                        >
                          {formatBehaviorLabel(profile.behaviorType)}
                        </span>
                      ) : (
                        <span className="text-white/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-white/80 tabular-nums text-xs">
                      {formatSol(profile.tokenHoldingValueSol)}
                    </td>
                    <td className="px-4 py-2.5 text-white/50 tabular-nums text-xs">
                      {formatPercent(profile.supplyPercent)}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums text-xs font-medium ${
                        pnl == null ? 'text-white/30' : pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {pnl != null ? (pnl >= 0 ? '+' : '') + formatSol(pnl) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-white/50 tabular-nums text-xs">
                      {formatHoldTime(profile.medianHoldTimeHours)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer CTA */}
        <div className="text-center py-6 border-t border-white/10">
          <p className="text-white/40 text-sm mb-3">
            Run your own analysis on Sova Intel
          </p>
          <Link
            href="/tools/holder-profiles"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 transition-colors rounded-full px-5 py-2 text-sm font-medium"
          >
            Analyze any token →
          </Link>
        </div>
      </div>
    </div>
  );
}
