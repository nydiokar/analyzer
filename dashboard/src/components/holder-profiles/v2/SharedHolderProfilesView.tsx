'use client';

import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';

import { TokenPulse } from '@/components/holder-profiles/v2/TokenPulse';
import { AppShell } from '@/components/layout/AppShell';
import { PageTitle } from '@/components/shared/PageTitle';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HolderProfilesResult } from '@/components/holder-profiles/types';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import type { ShareRecord } from '@/lib/holder-profile-share';

interface SharedHolderProfilesViewProps {
  share: ShareRecord;
  result: HolderProfilesResult;
  similarityResult?: CombinedSimilarityResult | null;
}

function formatShareDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function SharedHolderProfilesView({
  share,
  result,
  similarityResult = null,
}: SharedHolderProfilesViewProps) {
  const tokenMint: string | undefined = result.tokenMint ?? share.tokenMint ?? undefined;
  const topNLabel = share.topN ?? share.snapshot.topN ?? result.metadata.totalHoldersRequested;
  const similarityStatus = similarityResult ? 'completed' : 'idle';

  return (
    <AppShell>
      <div className="w-full mx-auto px-4 md:px-6 lg:px-10 space-y-8 pb-8">
        <div className="max-w-[88rem] mx-auto space-y-1 pt-8">
          <PageTitle
            title="Holder Profiles"
            subtitle="Shared public snapshot rendered with the same holder-profiles surface as Sova Intel."
            icon={Users}
            titleExtra={
              <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Shared
              </span>
            }
          />
        </div>

        <Card className="max-w-[88rem] mx-auto p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Published Snapshot
              </p>
              <p className="font-mono text-sm text-foreground break-all">
                {tokenMint ?? 'Unknown token'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Holder Set</p>
                <p className="font-medium">Top {topNLabel}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Views</p>
                <p className="font-medium">{share.viewCount}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Published</p>
                <p className="font-medium">{formatShareDate(share.createdAt)} UTC</p>
              </div>
              {tokenMint ? (
                <Button asChild size="sm" className="h-9 px-4">
                  <Link href={`/tools/holder-profiles?mode=token&token=${encodeURIComponent(tokenMint)}`}>
                    Open live page
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <TokenPulse
          result={result}
          similarityResult={similarityResult}
          similarityStatus={similarityStatus}
          isFinalAnalysis={Boolean(similarityResult)}
          isSnapshot
        />
      </div>
    </AppShell>
  );
}
