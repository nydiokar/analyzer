import {
  HOLDER_PROFILES_CLUSTER_CONFIG,
  analyzeSimilarityGraph as analyzeSharedSimilarityGraph,
  getClusterBgColor,
  getClusterStrengthColor,
  getClusterStrengthLabel,
  type SimilarityGraphAnalysis,
  type WalletCluster,
} from '@/lib/similarity-clusters';
import type { SimilarityPairData } from '../SimilarityPairRibbon';

export type { SimilarityGraphAnalysis, WalletCluster };
export {
  HOLDER_PROFILES_CLUSTER_CONFIG,
  getClusterBgColor,
  getClusterStrengthColor,
  getClusterStrengthLabel,
};

export function analyzeSimilarityGraph(pairs: SimilarityPairData[]): SimilarityGraphAnalysis {
  return analyzeSharedSimilarityGraph(pairs, HOLDER_PROFILES_CLUSTER_CONFIG);
}
