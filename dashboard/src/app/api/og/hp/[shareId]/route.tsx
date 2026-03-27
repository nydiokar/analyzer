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
  SWING_TRADER: 'Swing Trader',
  POSITION_TRADER: 'Position',
  HODLER: 'Hodler',
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
  if (hours == null) return '—';
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

async function fetchLogoDataUri(): Promise<string | null> {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.sova-intel.com').replace(/\/$/, '');
  try {
    const res = await fetch(`${siteUrl}/sova_badge_primary.svg`);
    if (!res.ok) return null;
    const svg = await res.text();
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${b64}`;
  } catch {
    return null;
  }
}

// Brand colors matching the app dark theme
const BG = '#06111f';
const CARD_BG = '#0d1f35';
const BORDER = '#1e3352';
const TEXT_PRIMARY = '#f1f5f9';
const TEXT_MUTED = '#64748b';
const VIOLET = '#a78bfa';
const VIOLET_BG = 'rgba(167,139,250,0.12)';
const BLUE = '#3b82f6';
const BLUE_BG = 'rgba(59,130,246,0.15)';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  const [share, logoDataUri] = await Promise.all([fetchShare(shareId), fetchLogoDataUri()]);

  if (!share) {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            background: BG,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: TEXT_MUTED,
            fontSize: 28,
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
    (p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER',
  ).length;

  const orderedBehaviorBuckets = BEHAVIOR_ORDER
    .map((type) => ({
      type,
      label: BEHAVIOR_LABELS[type],
      count: behaviorCounts.get(type) ?? 0,
      color: getBehaviorColor(type),
    }))
    .filter((b) => b.count > 0);

  const totalBehaviorCount = orderedBehaviorBuckets.reduce((s, b) => s + b.count, 0);

  const similarityPairs = snapshot.similaritySnapshot?.pairs ?? [];
  const highSimilarityPairs = similarityPairs.filter(
    (pair) => calculateOverallScore(pair.binaryScore, pair.capitalScore) >= 0.5,
  ).length;

  const totalHolders = snapshot.profiles.length;

  const metrics = [
    { label: 'Holders', value: String(totalHolders) },
    { label: 'High Quality', value: `${qualityCount}/${totalHolders}` },
    { label: 'Median Hold', value: formatHoldTime(medianHold) },
    { label: 'Similar Pairs', value: snapshot.similaritySnapshot ? String(highSimilarityPairs) : '—' },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          color: TEXT_PRIMARY,
          fontFamily: 'sans-serif',
          padding: '48px 52px',
          gap: 0,
        }}
      >
        {/* Header: logo + branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 36,
          }}
        >
          {/* Left: Sova logo + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUri} width={44} height={44} alt="Sova Intel" style={{ borderRadius: 12 }} />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: '#0A1A2F',
                  border: `1px solid ${BORDER}`,
                }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: '-0.02em' }}>
                Sova Intel
              </span>
              <span style={{ fontSize: 13, color: TEXT_MUTED, letterSpacing: '0.04em' }}>
                HOLDER PROFILES
              </span>
            </div>
          </div>

          {/* Right: token + Shared badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
                background: CARD_BG,
                fontSize: 13,
                color: TEXT_MUTED,
                letterSpacing: '0.06em',
              }}
            >
              SHARED SNAPSHOT
            </div>
          </div>
        </div>

        {/* Token name */}
        <div style={{ marginBottom: 28 }}>
          <span
            style={{
              fontSize: 62,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: TEXT_PRIMARY,
              lineHeight: 1,
            }}
          >
            {tokenLabel}
          </span>
          {snapshot.tokenMint ? (
            <div style={{ marginTop: 8, fontSize: 15, color: TEXT_MUTED, fontFamily: 'monospace' }}>
              {snapshot.tokenMint}
            </div>
          ) : null}
        </div>

        {/* Metric tiles */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
          {metrics.map((m) => (
            <div
              key={m.label}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '18px 20px',
                borderRadius: 14,
                border: `1px solid ${BORDER}`,
                background: CARD_BG,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: TEXT_MUTED,
                }}
              >
                {m.label}
              </span>
              <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: TEXT_PRIMARY }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* Trader distribution */}
        {orderedBehaviorBuckets.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              padding: '20px 22px',
              borderRadius: 14,
              border: `1px solid ${BORDER}`,
              background: CARD_BG,
              flex: 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: TEXT_MUTED,
                }}
              >
                Trader Distribution
              </span>
              <span style={{ fontSize: 12, color: TEXT_MUTED }}>
                {totalBehaviorCount} of {totalHolders} classified
              </span>
            </div>

            {/* Behavior pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {orderedBehaviorBuckets.map((b) => (
                <div
                  key={b.type}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: `${b.color}18`,
                    border: `1px solid ${b.color}35`,
                    color: b.color,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  <span>{b.count}</span>
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>{b.label}</span>
                </div>
              ))}
            </div>

            {/* Stacked bar */}
            <div style={{ display: 'flex', gap: 4, height: 8, borderRadius: 999, overflow: 'hidden' }}>
              {orderedBehaviorBuckets.map((b) => (
                <div
                  key={b.type}
                  style={{
                    height: 8,
                    flex: b.count,
                    background: b.color,
                    minWidth: 12,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 20,
            paddingTop: 18,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <span style={{ fontSize: 14, color: TEXT_MUTED }}>sova-intel.com</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 999,
              background: BLUE_BG,
              border: `1px solid rgba(59,130,246,0.3)`,
              color: '#93c5fd',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            View Full Snapshot →
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
