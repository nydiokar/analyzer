import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SharedHolderProfilesView } from '@/components/holder-profiles/v2/SharedHolderProfilesView';
import {
  expandShareSimilaritySnapshot,
  mapShareSnapshotToHolderProfilesResult,
  type ShareRecord,
} from '@/lib/holder-profile-share';

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
  const holderCount = snapshot.profiles.length;
  const behaviorCounts: Record<string, number> = {};

  for (const profile of snapshot.profiles) {
    if (profile.behaviorType && !profile.analysisSkipped) {
      behaviorCounts[profile.behaviorType] = (behaviorCounts[profile.behaviorType] ?? 0) + 1;
    }
  }

  const topBehaviors = Object.entries(behaviorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count} ${formatBehaviorLabel(type)}`)
    .join(' · ');

  const description = topBehaviors
    ? `${holderCount} holders - ${topBehaviors}`
    : `${holderCount} holders analyzed`;
  const ogImageUrl = `/api/og/hp/${shareId}`;

  return {
    title: `Holder Profiles: ${tokenLabel} - Sova Intel`,
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
