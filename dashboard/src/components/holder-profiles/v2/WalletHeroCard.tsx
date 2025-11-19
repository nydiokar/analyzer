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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <WalletBaseballCard
        profile={profile}
        walletAddress={result.targetWallet || profile.walletAddress}
      />
    </div>
  );
}
