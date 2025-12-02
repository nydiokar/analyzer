import type { HolderProfilesResult } from '../types';
import { WalletBaseballCard } from './WalletBaseballCard';

interface Props {
  result: HolderProfilesResult;
}

export function WalletHeroCard({ result }: Props) {
  const profile = result.profiles[0];
  if (!profile) {
    return <div className="rounded-lg border p-4 text-sm text-muted-foreground">No wallet profile available.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <WalletBaseballCard
        profile={profile}
        walletAddress={result.targetWallet || profile.walletAddress}
      />
    </div>
  );
}
