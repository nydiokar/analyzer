import type { HolderProfilesResult } from '../types';
import { OutcomeStrip } from './OutcomeStrip';
import { CognitivePrimitivesRow } from './CognitivePrimitivesRow';
import { BehaviorCompositionBar } from './BehaviorCompositionBar';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome } from './utils/outcome-logic';
import { useEffect, useState } from 'react';
import { WalletBaseballCard } from './WalletBaseballCard';
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenBadge } from '@/components/shared/TokenBadge';

interface Props {
  result: HolderProfilesResult;
}

export function TokenPulse({ result }: Props) {
  const outcome = getTokenOutcome(result.profiles);
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
      {/* Token Badge */}
      {result.tokenMint && (
        <div className="flex justify-start">
          <TokenBadge mint={result.tokenMint} size="lg" />
        </div>
      )}

      {/* Outcome + Cognitive Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        <OutcomeStrip {...outcome} holdersCount={result.metadata.totalHoldersAnalyzed} />
        <CognitivePrimitivesRow profiles={result.profiles} />
      </div>

      <div className="space-y-4">
        <div>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm font-medium mb-3 cursor-help w-fit">Behavior composition</p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                <p className="text-muted-foreground">
                  Distribution of trading behaviors among token holders. Shows the proportion of different trader types (scalpers, day traders, swing traders, etc.) holding this token.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <BehaviorCompositionBar profiles={result.profiles} />
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
