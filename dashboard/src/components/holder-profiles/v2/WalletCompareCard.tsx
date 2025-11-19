import type { HolderProfilesResult } from '../types';
import { WalletBaseballCard } from './WalletBaseballCard';

interface Props {
  result: HolderProfilesResult;
  highlight?: boolean;
}

export function WalletCompareCard({ result, highlight }: Props) {
  const profile = result.profiles[0];
  if (!profile) return null;

  return (
    <div className={highlight ? 'ring-2 ring-primary/40 rounded-lg' : ''}>
      <WalletBaseballCard
        profile={profile}
        walletAddress={result.targetWallet || profile.walletAddress}
      />
    </div>
  );
}
