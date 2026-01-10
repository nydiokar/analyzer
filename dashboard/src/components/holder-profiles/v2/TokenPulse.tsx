import type { HolderProfilesResult } from '../types';
import { getSpeedPrimitive } from './utils/cognitive-primitives';
import { getMeanBehaviorSimilarity } from './utils/behavior-similarity';
import { TraderDistributionBar } from './TraderDistributionBar';
import { ApproachingHoldTimePanel } from './ApproachingHoldTimePanel';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome } from './utils/outcome-logic';
import { useEffect, useState } from 'react';
import { WalletBaseballCard } from './WalletBaseballCard';
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { SimilaritySidebar } from './SimilaritySidebar';
import { InfoIcon } from 'lucide-react';
import { formatSol, formatUsd } from './utils/formatters';

interface Props {
  result: HolderProfilesResult;
}

export function TokenPulse({ result }: Props) {
  const outcome = getTokenOutcome(result.profiles);
  const speed = getSpeedPrimitive(result.profiles);
  const meanBehaviorSimilarity = getMeanBehaviorSimilarity(result.profiles);
  const qualityCount = result.profiles.filter((profile) => profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER').length;
  const totalHolders = result.metadata.totalHoldersRequested || result.profiles.length;
  const outcomePnlUsd = result.profiles.reduce((sum, profile) => sum + (profile.tokenPnlUsd ?? 0), 0);
  const outcomePnlSol = result.profiles.reduce((sum, profile) => sum + (profile.tokenPnlSol ?? 0), 0);
  const hasOutcomePnlUsd = result.profiles.some((profile) => typeof profile.tokenPnlUsd === 'number');
  const hasOutcomePnlSol = result.profiles.some((profile) => typeof profile.tokenPnlSol === 'number');
  const outcomeValue = hasOutcomePnlUsd
    ? formatUsd(outcomePnlUsd)
    : hasOutcomePnlSol
      ? formatSol(outcomePnlSol)
      : outcome.verdict;
  const [selectedProfile, setSelectedProfile] = useState<HolderProfilesResult['profiles'][number] | null>(null);

  useEffect(() => {
    if (!selectedProfile) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProfile(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProfile]);

  if (!result?.profiles?.length) return null;

  return (
    <section className="space-y-4 max-w-7xl mx-auto">
      <div className="rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-4">
          {result.tokenMint && <TokenBadge mint={result.tokenMint} size="lg" />}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Outcome</span>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm text-xs">
                      <p className="text-muted-foreground">
                        Outcome is derived from holder behavior speed, conviction, and data quality patterns.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="font-medium">{outcomeValue}</div>
            </div>
            <div className="space-y-0.5">
              <span className="text-xs text-muted-foreground">Speed</span>
              <div className="font-medium">{speed.category}</div>
            </div>
            <div className="space-y-0.5">
              <span className="text-xs text-muted-foreground">Quality</span>
              <div className="font-medium">{qualityCount}/{totalHolders}</div>
            </div>
            <div className="space-y-0.5">
              <span className="text-xs text-muted-foreground">Mean Behavior Similarity</span>
              <div className="font-medium">
                {meanBehaviorSimilarity === null ? '—' : `${Math.round(meanBehaviorSimilarity)}%`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
            <TraderDistributionBar profiles={result.profiles} />
            <ApproachingHoldTimePanel profiles={result.profiles} />
          </div>
          <div>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-sm font-medium mb-3 cursor-help w-fit">Supporting evidence</p>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm text-xs">
                  <p className="text-muted-foreground">
                    Individual holder profiles that make up this analysis. Click any row to see detailed trading patterns for that wallet.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <MinimalHoldersTable
              profiles={result.profiles}
              mode="token"
              onSelect={(profile) => setSelectedProfile(profile)}
            />
          </div>
        </div>
        <SimilaritySidebar summaries={result.similaritySummaries} />
      </div>

      {selectedProfile && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-background/20 backdrop-blur-sm overflow-y-auto">
          <div className="flex min-h-full items-start justify-center py-10 px-4">
            <div className="relative w-full max-w-4xl">
              <button
                className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-card border shadow hover:bg-muted transition-colors"
                onClick={() => setSelectedProfile(null)}
                aria-label="Close"
              >
                ×
              </button>
              <WalletBaseballCard
                profile={selectedProfile}
                walletAddress={selectedProfile.walletAddress}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
