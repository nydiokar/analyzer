import type { HolderProfilesResult, TokenMetadata } from '../types/holder-profiles';
import { buildDistributionBuckets, calculateFreshSupplyPercent, type DistributionBucket } from './distribution';

export type HolderDistributionSummary = {
  mint: string;
  tokenSymbol: string;
  tokenName: string | null;
  tokenImageUrl: string | null;
  freshSupplyPercent: number;
  buckets: DistributionBucket[];
  topN: number;
  generatedAtIso: string;
};

export function buildHolderDistributionSummary(
  result: HolderProfilesResult,
  metadata: TokenMetadata,
  topN: number,
): HolderDistributionSummary {
  const mint: string = result.tokenMint ?? metadata.mint;
  const symbol: string = metadata.symbol ?? shortenMint(mint);
  return {
    mint,
    tokenSymbol: symbol,
    tokenName: metadata.name,
    tokenImageUrl: metadata.imageUrl,
    freshSupplyPercent: calculateFreshSupplyPercent(result.profiles),
    buckets: buildDistributionBuckets(result.profiles),
    topN,
    generatedAtIso: new Date().toISOString(),
  };
}

export function buildReplyText(summary: HolderDistributionSummary): string {
  return [
    'Holder Profiles',
    `Top ${summary.topN} holder holding patterns`,
    `Fresh supply: ${Math.round(summary.freshSupplyPercent)}%`,
    `Generated: ${formatUtcTimestamp(summary.generatedAtIso)}`,
    'Powered by Sova Intel',
  ].join('\n');
}

export function formatUtcTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function shortenMint(mint: string): string {
  if (mint.length <= 12) {
    return mint;
  }
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}
