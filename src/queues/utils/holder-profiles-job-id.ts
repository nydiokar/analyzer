import { AnalyzeHolderProfilesJobData } from '../jobs/types';

export function buildHolderProfilesJobId(data: AnalyzeHolderProfilesJobData): string {
  if (data.mode === 'wallet') {
    const wallet = data.walletAddress || 'unknown';
    return `holder-profile-wallet-${wallet}-${data.requestId}`;
  }

  const mint = data.tokenMint || 'unknown';
  const count = data.topN ?? 10;
  return `holder-profiles-${mint}-${count}-${data.requestId}`;
}
