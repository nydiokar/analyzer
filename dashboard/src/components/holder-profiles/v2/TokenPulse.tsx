import type { HolderProfilesResult } from '../types';
import { getSpeedPrimitive, getConsistencyPrimitive } from './utils/cognitive-primitives';
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
import { OutcomeStrip } from './OutcomeStrip';
import { CognitiveMetricCard } from './CognitiveMetricCard';

interface Props {
  result: HolderProfilesResult;
}

export function TokenPulse({ result }: Props) {
  const outcome = getTokenOutcome(result.profiles);
  const speed = getSpeedPrimitive(result.profiles);
  const consistency = getConsistencyPrimitive(result.profiles);
  const meanBehaviorSimilarity = getMeanBehaviorSimilarity(result.profiles);
  const qualityCount = result.profiles.filter((profile) => profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER').length;
  const totalHolders = result.metadata.totalHoldersRequested || result.profiles.length;
  const qualityValue = `${qualityCount}/${totalHolders || result.profiles.length}`;
  const similarityValue = meanBehaviorSimilarity === null ? '—' : `${Math.round(meanBehaviorSimilarity)}%`;
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
      <div className="grid grid-cols-1 xl:grid-cols-[auto_2fr_repeat(3,minmax(0,1fr))] gap-3 items-start">
        {result.tokenMint && (
          <div className="flex items-start">
            <TokenBadge mint={result.tokenMint} size="lg" />
          </div>
        )}
        <OutcomeStrip {...outcome} holdersCount={result.metadata.totalHoldersAnalyzed} />
        <CognitiveMetricCard primitive={speed} />
        <CognitiveMetricCard
          primitive={{
            id: 'quality',
            label: 'Quality',
            value: qualityValue,
            category: consistency.category,
            description: consistency.description,
            color: consistency.color,
          }}
        />
        <CognitiveMetricCard
          primitive={{
            id: 'similarity',
            label: 'Mean Similarity',
            value: similarityValue,
            category: 'Behavior',
            description: 'Behavior similarity across holders',
            color: 'text-sky-500',
          }}
        />
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
