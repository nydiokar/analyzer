import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SharedHolderProfilesView } from '@/components/holder-profiles/v2/SharedHolderProfilesView';
import {
  expandShareSimilaritySnapshot,
  mapShareSnapshotToHolderProfilesResult,
  type ShareRecord,
} from '@/lib/holder-profile-share';

function getPublicSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.sova-intel.com').replace(/\/$/, '');
}

async function fetchShare(shareId: string): Promise<ShareRecord | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1';

  try {
    const res = await fetch(`${base}/share/hp/${shareId}`, { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch {
    return null;
  }
}

async function fetchShareRaw(shareId: string): Promise<ShareRecord | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1';

  try {
    const res = await fetch(`${base}/share/hp/${shareId}/raw`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch {
    return null;
  }
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

function buildShareDescription(share: ShareRecord): string {
  const { snapshot } = share;
  const holderCount = snapshot.profiles.length;
  const behaviorCounts: Record<string, number> = {};
  const holdTimes: number[] = [];

  for (const profile of snapshot.profiles) {
    if (profile.behaviorType && !profile.analysisSkipped) {
      behaviorCounts[profile.behaviorType] = (behaviorCounts[profile.behaviorType] ?? 0) + 1;
    }
    if (profile.medianHoldTimeHours != null && !profile.analysisSkipped) {
      holdTimes.push(profile.medianHoldTimeHours);
    }
  }

  const topBehaviors = Object.entries(behaviorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count} ${formatBehaviorLabel(type)}`)
    .join(', ');

  const qualityCount = snapshot.profiles.filter(
    (p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER',
  ).length;

  const medianHold = holdTimes.length > 0
    ? holdTimes.sort((a, b) => a - b)[Math.floor(holdTimes.length / 2)]
    : null;

  const holdStr = medianHold != null
    ? medianHold < 1
      ? `${Math.round(medianHold * 60)}m median hold`
      : medianHold < 24
        ? `${medianHold.toFixed(1)}h median hold`
        : `${(medianHold / 24).toFixed(1)}d median hold`
    : null;

  const parts: string[] = [];
  if (topBehaviors) parts.push(topBehaviors);
  if (holdStr) parts.push(holdStr);
  if (qualityCount > 0) parts.push(`${qualityCount}/${holderCount} high-quality wallets`);

  const detail = parts.join(' · ');

  return detail
    ? `${holderCount} holders analyzed — ${detail}. View the full breakdown on Sova Intel.`
    : `${holderCount} holders analyzed. View the full breakdown on Sova Intel.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const share = await fetchShareRaw(shareId);

  if (!share) {
    return { title: 'Analysis Not Found - Sova Intel' };
  }

  const { snapshot } = share;
  const tokenLabel = snapshot.tokenSymbol
    ? `$${snapshot.tokenSymbol}`
    : snapshot.tokenMint
      ? `${snapshot.tokenMint.slice(0, 6)}...`
      : 'Token';
  const description = buildShareDescription(share);
  const siteUrl = getPublicSiteUrl();
  const pageUrl = `${siteUrl}/share/hp/${shareId}`;
  const ogImageUrl = `${siteUrl}/api/og/hp/${shareId}?v=4`;
  const pageTitle = `${tokenLabel} Holder Profiles — Trader Distribution & Behavior Analysis`;

  return {
    title: pageTitle,
    description,
    openGraph: {
      title: pageTitle,
      description,
      url: pageUrl,
      siteName: 'Sova Intel',
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description,
      images: [ogImageUrl],
    },
    alternates: {
      canonical: pageUrl,
    },
  };
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

  return (
    <SharedHolderProfilesView
      share={share}
      result={mapShareSnapshotToHolderProfilesResult(share.snapshot)}
      similarityResult={expandShareSimilaritySnapshot(share.snapshot.similaritySnapshot)}
    />
  );
}
