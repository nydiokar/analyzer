import type { HolderProfilesResult } from '../types';
import { OutcomeStrip } from './OutcomeStrip';
import { CognitivePrimitivesRow } from './CognitivePrimitivesRow';
import { getWalletOutcome } from './utils/outcome-logic';
import { formatAddress } from './utils/formatters';
import { getBehaviorColor, getQualityColor } from './utils/behavior';

interface Props {
  result: HolderProfilesResult;
}

export function WalletHeroCard({ result }: Props) {
  const profile = result.profiles[0];
  if (!profile) {
    return <div className="rounded-2xl border p-6 text-sm text-muted-foreground">No wallet profile available.</div>;
  }

  const outcome = getWalletOutcome(profile);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Wallet classifier</p>
          <p className="text-lg font-semibold">{formatAddress(result.targetWallet || profile.walletAddress)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getQualityColor(profile.dataQualityTier)}`}>
          {profile.dataQualityTier} quality
        </span>
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getBehaviorColor(profile.behaviorType)}`}>
            {profile.behaviorType ?? 'Unclassified'}
          </span>
          <span className="text-sm text-muted-foreground">{Math.round(profile.confidence * 100)}% confidence</span>
        </div>
        <OutcomeStrip {...outcome} />
        <CognitivePrimitivesRow profiles={[profile]} />
      </div>
    </section>
  );
}
