import { ImageResponse } from 'next/og';

export const runtime = 'edge';

type ShareProfile = {
  walletAddress: string;
  rank: number;
  behaviorType: string | null;
  medianHoldTimeHours: number | null;
  dataQualityTier: string;
  analysisSkipped?: boolean;
};

type ShareSimilaritySnapshot = {
  version: 1;
  walletCount: number;
  pairs: Array<{
    walletA: string;
    walletB: string;
    binaryScore: number;
    capitalScore: number;
    binarySharedTokenCount: number;
    binaryUniqueTokenCountA: number;
    binaryUniqueTokenCountB: number;
  }>;
};

type ShareSnapshot = {
  tokenMint?: string;
  tokenSymbol?: string | null;
  tokenSnapshot?: {
    name?: string | null;
    symbol?: string | null;
  } | null;
  similaritySnapshot?: ShareSimilaritySnapshot | null;
  profiles: ShareProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
  };
};

type ShareRecord = {
  snapshot: ShareSnapshot;
  tokenMint: string | null;
  tokenSymbol: string | null;
};

const BEHAVIOR_ORDER = [
  'SNIPER',
  'SCALPER',
  'MOMENTUM',
  'INTRADAY',
  'DAY_TRADER',
  'SWING_TRADER',
  'POSITION_TRADER',
  'HODLER',
] as const;

const BEHAVIOR_LABELS: Record<string, string> = {
  SNIPER: 'Sniper',
  SCALPER: 'Scalper',
  MOMENTUM: 'Momentum',
  INTRADAY: 'Intraday',
  DAY_TRADER: 'Day Trader',
  SWING_TRADER: 'Swing',
  POSITION_TRADER: 'Position',
  HODLER: 'Fresh',
};

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

function getBehaviorColor(type: string): string {
  return BEHAVIOR_COLORS[type] ?? '#6b7280';
}

function formatHoldTime(hours: number | null | undefined): string {
  if (hours == null) return '-';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function calculateOverallScore(binaryScore: number, capitalScore: number): number {
  return binaryScore * 0.6 + capitalScore * 0.4;
}

async function fetchShare(shareId: string): Promise<ShareRecord | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1';

  try {
    const res = await fetch(`${base}/share/hp/${shareId}/raw`);
    if (!res.ok) {
      return null;
    }

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
  const tokenLabel = snapshot.tokenSnapshot?.symbol
    ? `$${snapshot.tokenSnapshot.symbol}`
    : snapshot.tokenSymbol
      ? `$${snapshot.tokenSymbol}`
      : snapshot.tokenMint
        ? `${snapshot.tokenMint.slice(0, 8)}...`
        : 'Token';

  const behaviorCounts = new Map<string, number>();
  const holdTimes: number[] = [];

  for (const profile of snapshot.profiles) {
    if (profile.medianHoldTimeHours != null && !profile.analysisSkipped) {
      holdTimes.push(profile.medianHoldTimeHours);
    }

    if (profile.behaviorType && !profile.analysisSkipped) {
      behaviorCounts.set(profile.behaviorType, (behaviorCounts.get(profile.behaviorType) ?? 0) + 1);
    }
  }

  const medianHold = holdTimes.length > 0
    ? holdTimes.sort((a, b) => a - b)[Math.floor(holdTimes.length / 2)]
    : null;
  const qualityCount = snapshot.profiles.filter(
    (profile) => profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER',
  ).length;

  const orderedBehaviorBuckets = BEHAVIOR_ORDER
    .map((type) => ({
      type,
      label: BEHAVIOR_LABELS[type],
      count: behaviorCounts.get(type) ?? 0,
      color: getBehaviorColor(type),
    }))
    .filter((bucket) => bucket.count > 0);

  const similarityPairs = snapshot.similaritySnapshot?.pairs ?? [];
  const highSimilarityPairs = similarityPairs.filter(
    (pair) => calculateOverallScore(pair.binaryScore, pair.capitalScore) >= 0.5,
  ).length;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #040a14 0%, #08101d 100%)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          padding: '40px 44px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at top right, rgba(37, 99, 235, 0.14), transparent 36%), radial-gradient(circle at top left, rgba(14, 165, 233, 0.08), transparent 28%)',
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 28,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 16,
                color: 'rgba(226,232,240,0.72)',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
              }}
            >
              <span>Holder Profiles</span>
              <span
                style={{
                  border: '1px solid rgba(148,163,184,0.24)',
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  color: 'rgba(226,232,240,0.56)',
                }}
              >
                Shared
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 54, fontWeight: 700, letterSpacing: '-0.03em' }}>{tokenLabel}</span>
              {snapshot.tokenMint ? (
                <span style={{ fontSize: 18, color: 'rgba(148,163,184,0.72)' }}>{snapshot.tokenMint}</span>
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              borderRadius: 22,
              border: '1px solid rgba(148,163,184,0.14)',
              background: 'rgba(15, 23, 42, 0.72)',
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: 'rgba(59,130,246,0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#bfdbfe',
                fontSize: 22,
              }}
            >
              S
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, color: 'rgba(148,163,184,0.72)' }}>Sova Intel</span>
              <span style={{ fontSize: 18, fontWeight: 600 }}>Shared Snapshot</span>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', display: 'flex', gap: 16, marginBottom: 28 }}>
          {[
            { label: 'Holders', value: String(snapshot.profiles.length) },
            { label: 'High Quality', value: `${qualityCount}/${snapshot.profiles.length}` },
            { label: 'Median Hold', value: formatHoldTime(medianHold) },
            {
              label: 'Similar Pairs',
              value: snapshot.similaritySnapshot ? String(highSimilarityPairs) : '-',
            },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '16px 18px',
                borderRadius: 18,
                border: '1px solid rgba(148,163,184,0.14)',
                background: 'rgba(15, 23, 42, 0.78)',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: 'rgba(148,163,184,0.76)',
                }}
              >
                {metric.label}
              </span>
              <span style={{ fontSize: 34, fontWeight: 700 }}>{metric.value}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: '24px 26px',
            borderRadius: 24,
            border: '1px solid rgba(148,163,184,0.12)',
            background: 'rgba(15, 23, 42, 0.72)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'rgba(226,232,240,0.86)',
              }}
            >
              Trader Distribution
            </span>
            <span style={{ fontSize: 16, color: 'rgba(148,163,184,0.72)' }}>
              Canonical holder-profiles layout
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {orderedBehaviorBuckets.map((bucket) => (
              <div
                key={bucket.type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: `${bucket.color}20`,
                  border: `1px solid ${bucket.color}40`,
                  color: bucket.color,
                  fontSize: 16,
                }}
              >
                <span style={{ fontWeight: 700 }}>{bucket.count}</span>
                <span>{bucket.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, height: 10 }}>
            {orderedBehaviorBuckets.map((bucket) => (
              <div
                key={bucket.type}
                style={{
                  height: 10,
                  flex: bucket.count,
                  minWidth: 16,
                  borderRadius: 999,
                  background: bucket.color,
                }}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
            paddingTop: 20,
            borderTop: '1px solid rgba(148,163,184,0.12)',
            color: 'rgba(148,163,184,0.76)',
            fontSize: 18,
          }}
        >
          <span>sova-intel.com</span>
          <span>View full holder profile snapshot</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
