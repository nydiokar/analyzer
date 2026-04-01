export const MCAP_BUCKET_RANGE_LABELS: Record<string, string> = {
  '0-10k': '$0-$10k',
  '10-20k': '$10k-$20k',
  '20-30k': '$20k-$30k',
  '30-50k': '$30k-$50k',
  '50-100k': '$50k-$100k',
  '100-200k': '$100k-$200k',
  '200-500k': '$200k-$500k',
  '500k-1m': '$500k-$1m',
  '1m+': '$1m+',
};

export const MCAP_BUCKET_SEMANTIC_LABELS: Record<string, string> = {
  '0-10k': 'Seed',
  '10-20k': 'Early Seed',
  '20-30k': 'Late Seed',
  '30-50k': 'Pre-Growth',
  '50-100k': 'Early Growth',
  '100-200k': 'Growth',
  '200-500k': 'Late Growth',
  '500k-1m': 'Expansion',
  '1m+': 'Established',
};

export const MCAP_BUCKET_ORDER: string[] = [
  '0-10k',
  '10-20k',
  '20-30k',
  '30-50k',
  '50-100k',
  '100-200k',
  '200-500k',
  '500k-1m',
  '1m+',
];

export function getMcapBucketDisplayLabel(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  return MCAP_BUCKET_RANGE_LABELS[bucket] ?? bucket;
}

export function getMcapBucketSemanticLabel(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  return MCAP_BUCKET_SEMANTIC_LABELS[bucket] ?? null;
}

export function formatMcapCompact(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '-';
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

export function classifyMcapBucket(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined || usd < 0) return null;
  if (usd < 10_000) return '0-10k';
  if (usd < 20_000) return '10-20k';
  if (usd < 30_000) return '20-30k';
  if (usd < 50_000) return '30-50k';
  if (usd < 100_000) return '50-100k';
  if (usd < 200_000) return '100-200k';
  if (usd < 500_000) return '200-500k';
  if (usd < 1_000_000) return '500k-1m';
  return '1m+';
}

export function compareMcapBuckets(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const indexA = MCAP_BUCKET_ORDER.indexOf(a);
  const indexB = MCAP_BUCKET_ORDER.indexOf(b);
  if (indexA === -1 || indexB === -1) return null;
  return indexA - indexB;
}
