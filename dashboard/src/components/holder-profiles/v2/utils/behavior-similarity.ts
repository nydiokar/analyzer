import type { HolderProfile } from '../../../holder-profiles/types';

export function getMeanBehaviorSimilarity(profiles: HolderProfile[]): number | null {
  if (!profiles.length) return null;
  const counts = new Map<string, number>();
  let total = 0;
  profiles.forEach((profile) => {
    const key = profile.behaviorType ?? 'UNCLASSIFIED';
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  });
  if (!total) return null;
  const similarity = Array.from(counts.values()).reduce((sum, count) => {
    const ratio = count / total;
    return sum + ratio * ratio;
  }, 0);
  return similarity * 100;
}
