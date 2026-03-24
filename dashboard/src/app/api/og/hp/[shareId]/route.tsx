import { ImageResponse } from 'next/og';

export const runtime = 'edge';

interface ShareProfile {
  walletAddress: string;
  rank: number;
  behaviorType: string | null;
  medianHoldTimeHours: number | null;
  dataQualityTier: string;
  tokenHoldingValueSol?: number | null;
  analysisSkipped?: boolean;
}

interface ShareSnapshot {
  tokenMint?: string;
  tokenSymbol?: string;
  topN?: number;
  profiles: ShareProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
  };
}

interface ShareRecord {
  snapshot: ShareSnapshot;
  tokenMint: string | null;
  tokenSymbol: string | null;
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

const BEHAVIOR_LABELS: Record<string, string> = {
  SNIPER: 'Snipers',
  SCALPER: 'Scalpers',
  MOMENTUM: 'Momentum',
  INTRADAY: 'Intraday',
  DAY_TRADER: 'Day Traders',
  SWING_TRADER: 'Swing Traders',
  POSITION_TRADER: 'Position Traders',
  HODLER: 'Holders',
};

function getBehaviorColor(type: string | null): string {
  if (!type) return '#6b7280';
  return BEHAVIOR_COLORS[type] ?? '#6b7280';
}

function formatHoldTime(hours: number | null | undefined): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

async function fetchShare(shareId: string): Promise<ShareRecord | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1';
  try {
    const res = await fetch(`${base}/share/hp/${shareId}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  const share = await fetchShare(shareId);

  if (!share) {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            background: '#040a14',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontSize: 32,
            fontFamily: 'sans-serif',
          }}
        >
          Analysis not found
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }

  const { snapshot } = share;
  const tokenLabel = snapshot.tokenSymbol
    ? `$${snapshot.tokenSymbol}`
    : snapshot.tokenMint
      ? `${snapshot.tokenMint.slice(0, 8)}…`
      : 'Token';

  // Build behavior distribution
  const behaviorCounts: Record<string, number> = {};
  for (const p of snapshot.profiles) {
    if (p.behaviorType && !p.analysisSkipped) {
      behaviorCounts[p.behaviorType] = (behaviorCounts[p.behaviorType] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(behaviorCounts).sort((a, b) => b[1] - a[1]);
  const total = snapshot.profiles.filter((p) => !p.analysisSkipped).length || 1;

  // Median hold time across all classified profiles
  const holdTimes = snapshot.profiles
    .filter((p) => p.medianHoldTimeHours != null && !p.analysisSkipped)
    .map((p) => p.medianHoldTimeHours as number);
  const medianHold = holdTimes.length > 0
    ? holdTimes.sort((a, b) => a - b)[Math.floor(holdTimes.length / 2)]
    : null;

  // Quality count
  const qualityCount = snapshot.profiles.filter(
    (p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER',
  ).length;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: '#040a14',
          display: 'flex',
          flexDirection: 'column',
          padding: '48px 56px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Background accent */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 400,
            height: 400,
            background: 'radial-gradient(circle at top right, rgba(59,130,246,0.12), transparent 70%)',
          }}
        />

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Holder Profiles
            </span>
            <span style={{ fontSize: 48, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
              {tokenLabel}
            </span>
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>
            Sova Intel
          </span>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Holders', value: String(snapshot.profiles.length) },
            { label: 'High Quality', value: `${qualityCount}/${snapshot.profiles.length}` },
            { label: 'Median Hold', value: formatHoldTime(medianHold) },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
                padding: '14px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 150,
              }}
            >
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {label}
              </span>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#ffffff' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Behavior pills */}
        {sorted.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
            {sorted.slice(0, 6).map(([type, count]) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 100,
                  background: `${getBehaviorColor(type)}22`,
                  border: `1px solid ${getBehaviorColor(type)}55`,
                  color: getBehaviorColor(type),
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <span>{count}</span>
                <span style={{ opacity: 0.85, fontWeight: 400 }}>{BEHAVIOR_LABELS[type] ?? type}</span>
              </div>
            ))}
          </div>
        )}

        {/* Behavior bar */}
        {sorted.length > 0 && (
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 28 }}>
            {sorted.map(([type, count]) => (
              <div
                key={type}
                style={{
                  width: `${(count / total) * 100}%`,
                  background: getBehaviorColor(type),
                }}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
            sova.intel
          </span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
            View full analysis →
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
