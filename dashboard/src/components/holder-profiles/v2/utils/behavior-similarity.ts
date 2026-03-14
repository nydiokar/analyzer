import type { HolderProfile } from '../../../holder-profiles/types';

export function getMeanBehaviorSimilarity(profiles: HolderProfile[]): number | null {
  const classified = profiles.filter((p) => p.behaviorType);
  const N = classified.length;
  if (N < 2) return null;
  const counts = new Map<string, number>();
  classified.forEach((profile) => {
    const key = profile.behaviorType as string;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  // Largest cluster share: % of classified holders in the dominant behavior type.
  // Surfaces the strongest signal subgroup rather than being diluted by noise wallets.
  const dominantCount = Math.max(...counts.values());
  return (dominantCount / N) * 100;
}
