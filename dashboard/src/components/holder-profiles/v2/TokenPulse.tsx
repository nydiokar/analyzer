import type { HolderProfilesResult } from '../types';
import { OutcomeStrip } from './OutcomeStrip';
import { CognitivePrimitivesRow } from './CognitivePrimitivesRow';
import { BehaviorCompositionBar } from './BehaviorCompositionBar';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome } from './utils/outcome-logic';
import { formatAddress } from './utils/formatters';
import { useState } from 'react';
import { WalletBaseballCard } from './WalletBaseballCard';
import { createPortal } from 'react-dom';

interface Props {
  result: HolderProfilesResult;
}

export function TokenPulse({ result }: Props) {
  const outcome = getTokenOutcome(result.profiles);
  const [selectedProfile, setSelectedProfile] = useState<HolderProfilesResult['profiles'][number] | null>(null);

  if (!result?.profiles?.length) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Token Pulse</p>
        <div className="text-sm text-muted-foreground">Token {formatAddress(result.tokenMint)}</div>
      </div>

      <OutcomeStrip {...outcome} badge={`${result.metadata.totalHoldersAnalyzed} holders analyzed`} />

      <CognitivePrimitivesRow profiles={result.profiles} />

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Behavior composition</p>
          <BehaviorCompositionBar profiles={result.profiles} />
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Supporting evidence</p>
          <MinimalHoldersTable
            profiles={result.profiles}
            mode="token"
            onSelect={(profile) => setSelectedProfile(profile)}
          />
        </div>
      </div>

      {selectedProfile && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-sm">
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
        </div>,
        document.body
      )}
    </section>
  );
}
