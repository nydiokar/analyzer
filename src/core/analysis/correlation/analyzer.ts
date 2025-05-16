import { CLUSTERING_CONFIG } from '../../../config/constants';
import { WalletCluster, WalletInfo } from '@/types/wallet';
import { TransactionData, CorrelatedPairData, GlobalTokenStats } from '@/types/correlation';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('CorrelationAnalyzer');

export class CorrelationAnalyzer {
  constructor(private config: typeof CLUSTERING_CONFIG) {}

  /**
   * Public wrapper to calculate global token frequency statistics.
   * @param transactions - Transaction data for all wallets.
   * @returns An object containing global token stats.
   */
  public getGlobalTokenStats(
    transactions: Record<string, TransactionData[]>   
  ): GlobalTokenStats {
      const { globalStats } = this.calculateGlobalTokenStatsInternal(transactions);
      return globalStats;
  }

  /**
   * Internal method to calculate global token frequency statistics.
   * @param transactions - Transaction data for all wallets.
   * @returns An object containing global token stats and the set of popular tokens.
   */
  private calculateGlobalTokenStatsInternal(
    transactions: Record<string, TransactionData[]>   
  ): { globalStats: GlobalTokenStats, popularTokens: Set<string> } {
    const globalTokenFrequency: Record<string, number> = {};
    let totalTransactionCountForStats = 0;
    const walletAddresses = Object.keys(transactions);

    for (const walletAddress of walletAddresses) {
      const txs = transactions[walletAddress] || [];
      totalTransactionCountForStats += txs.length;
      for (const tx of txs) {
        if (tx.mint) globalTokenFrequency[tx.mint] = (globalTokenFrequency[tx.mint] || 0) + 1;
      }
    }

    if (totalTransactionCountForStats === 0) {
      logger.warn("No transactions provided for global token stats calculation.");
      return { 
        globalStats: { totalUniqueTokens: 0, totalPopularTokens: 0, totalNonObviousTokens: 0 }, 
        popularTokens: new Set<string>() 
      };
    }

    const sortedGlobalTokens = Object.entries(globalTokenFrequency).sort(([, countA], [, countB]) => countB - countA);
    const popularTokens = new Set<string>();
    const thresholdIndex = Math.floor(sortedGlobalTokens.length * this.config.nonObviousTokenThresholdPercent);
    
    for (let i = 0; i < sortedGlobalTokens.length; i++) {
      const [mint, count] = sortedGlobalTokens[i];
      // Consider token popular if it's in the top % OR exceeds the absolute occurrence count
      if (i < thresholdIndex || count > this.config.minOccurrencesForPopular) {
          popularTokens.add(mint);
      }
    }
    
    const globalStats: GlobalTokenStats = {
        totalUniqueTokens: sortedGlobalTokens.length,
        totalPopularTokens: popularTokens.size,
        totalNonObviousTokens: sortedGlobalTokens.length - popularTokens.size
    };
    logger.info(`Global token analysis: ${globalStats.totalUniqueTokens} unique, ${globalStats.totalPopularTokens} popular, ${globalStats.totalNonObviousTokens} non-obvious.`);
    if (globalStats.totalUniqueTokens > 0 && globalStats.totalPopularTokens === globalStats.totalUniqueTokens) {
        logger.warn("All tokens identified as popular. Correlation based on non-obvious tokens might not yield results. Consider adjusting thresholds.");
    }

    return { globalStats, popularTokens };
  }

  /**
   * Analyzes correlations between wallets based on shared non-obvious tokens and synchronized trading activity.
   * @param transactions - A record mapping wallet addresses to their transaction data.
   * @param wallets - An array of WalletInfo objects for context (needed for pairing).
   * @returns A promise resolving to an array of correlated pair data.
   */
  async analyzeCorrelations(
    transactions: Record<string, TransactionData[]>,
    wallets: WalletInfo[] // Wallets are needed to iterate through pairs
  ): Promise<CorrelatedPairData[]> {
    logger.info(`Starting correlation analysis for ${wallets.length} wallets. Sync window: ${this.config.syncTimeWindowSeconds}s.`);

    const { popularTokens } = this.calculateGlobalTokenStatsInternal(transactions);

    const correlatedPairs: CorrelatedPairData[] = [];
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const walletA = wallets[i];
        const walletB = wallets[j];
        const txsA = transactions[walletA.address] || [];
        const txsB = transactions[walletB.address] || [];
        if (txsA.length === 0 || txsB.length === 0) continue;

        // Find shared non-obvious tokens
        const nonObviousTradedByA = new Map<string, number>();
        txsA.forEach(tx => { 
          if (tx.mint && !popularTokens.has(tx.mint) && !this.config.excludedMints.includes(tx.mint)) { 
            nonObviousTradedByA.set(tx.mint, (nonObviousTradedByA.get(tx.mint) || 0) + 1); 
          }
        });
        const nonObviousTradedByB = new Map<string, number>();
        txsB.forEach(tx => { 
          if (tx.mint && !popularTokens.has(tx.mint) && !this.config.excludedMints.includes(tx.mint)) {
             nonObviousTradedByB.set(tx.mint, (nonObviousTradedByB.get(tx.mint) || 0) + 1);
          }
        });

        const currentSharedNonObvious: CorrelatedPairData['sharedNonObviousTokens'] = [];
        nonObviousTradedByA.forEach((countA, mint) => {
          if (nonObviousTradedByB.has(mint)) {
            currentSharedNonObvious.push({ mint, countA, countB: nonObviousTradedByB.get(mint)! });
          }
        });

        // Find synchronized events for shared tokens
        const currentSyncEvents: CorrelatedPairData['synchronizedEvents'] = [];
        if (currentSharedNonObvious.length > 0) { // Optimization: only check sync if shared tokens exist
          for (const shared of currentSharedNonObvious) {
            const mintToAnalyze = shared.mint;
            const eventsA = txsA.filter(tx => tx.mint === mintToAnalyze);
            const eventsB = txsB.filter(tx => tx.mint === mintToAnalyze);

            for (const eventA of eventsA) {
              for (const eventB of eventsB) {
                // Check for same direction and within time window
                if (eventA.direction === eventB.direction) {
                   const timeDiff = Math.abs(eventA.timestamp - eventB.timestamp);
                   if (timeDiff <= this.config.syncTimeWindowSeconds) {
                     currentSyncEvents.push({
                       mint: mintToAnalyze,
                       direction: eventA.direction, // 'in' or 'out'
                       timestampA: eventA.timestamp,
                       timestampB: eventB.timestamp,
                       timeDiffSeconds: timeDiff
                     });
                   }
                }
              }
            }
          }
          currentSyncEvents.sort((a, b) => a.timeDiffSeconds - b.timeDiffSeconds || a.timestampA - b.timestampA);
        }

        // Score the pair
        if (currentSharedNonObvious.length >= this.config.minSharedNonObviousTokens || currentSyncEvents.length >= this.config.minSyncEvents) {
          let score = (currentSharedNonObvious.length * this.config.weightSharedNonObvious) + 
                      (currentSyncEvents.length * this.config.weightSyncEvents);
          
          if (score > 0) {
            correlatedPairs.push({
              walletA_address: walletA.address,
              walletB_address: walletB.address,
              score: parseFloat(score.toFixed(2)), // Keep score precision reasonable
              sharedNonObviousTokens: currentSharedNonObvious,
              synchronizedEvents: currentSyncEvents
            });
          }
        }
      }
    }
    
    correlatedPairs.sort((a, b) => b.score - a.score); // Sort pairs by score descending
    logger.info(`Pairwise analysis completed. Found ${correlatedPairs.length} pairs meeting score > 0 threshold.`);
    return correlatedPairs;
  }

  /**
   * Identifies clusters of wallets based on the correlated pairs using DFS.
   * Uses the logic from bot/commands.ts which seems more refined.
   * @param correlatedPairs - An array of wallet pairs with their correlation scores.
   * @returns A promise resolving to an array of identified wallet clusters.
   */
  async identifyClusters(
    correlatedPairs: CorrelatedPairData[]
  ): Promise<WalletCluster[]> { // Removed WalletInfo[] argument as it's not used in the refined logic
    const clusters: WalletCluster[] = [];
    const adj: Map<string, string[]> = new Map();
    const visited: Set<string> = new Set();
    const allWalletsInPairs: Set<string> = new Set();
    const pairDetailsMap: Map<string, CorrelatedPairData> = new Map(); // To calculate avg score and shared tokens later

    // Build adjacency list and gather details for pairs meeting the cluster score threshold
    for (const pair of correlatedPairs) {
      if (pair.score >= this.config.minClusterScoreThreshold) {
        // Add edges for both directions
        const neighborsA = adj.get(pair.walletA_address) || [];
        adj.set(pair.walletA_address, [...neighborsA, pair.walletB_address]);
        const neighborsB = adj.get(pair.walletB_address) || [];
        adj.set(pair.walletB_address, [...neighborsB, pair.walletA_address]);
        
        // Track all wallets involved in potential clusters
        allWalletsInPairs.add(pair.walletA_address);
        allWalletsInPairs.add(pair.walletB_address);
        
        // Store pair details for later cluster calculation (avg score, shared tokens)
        const pairKey = [pair.walletA_address, pair.walletB_address].sort().join('--'); // Consistent key
        pairDetailsMap.set(pairKey, pair);
      }
    }

    // DFS function to find connected components
    function dfs(wallet: string, currentClusterMembers: Set<string>) {
      visited.add(wallet);
      currentClusterMembers.add(wallet);
      const neighbors = adj.get(wallet) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, currentClusterMembers);
        }
      }
    }

    // Iterate through all wallets involved in high-scoring pairs
    for (const wallet of allWalletsInPairs) {
      if (!visited.has(wallet)) {
        const currentClusterMembersSet: Set<string> = new Set();
        dfs(wallet, currentClusterMembersSet);
        const currentClusterMembers = Array.from(currentClusterMembersSet).sort(); // Get sorted array

        // Check if the component is large enough to be a cluster (>= 3 members)
        if (currentClusterMembers.length >= 3) {
          let totalScore = 0;
          let contributingPairsCount = 0;
          const clusterSharedTokensMap: Map<string, number> = new Map(); // Count occurrences of shared tokens within the cluster

          // Iterate through all pairs within the identified cluster
          for (let i = 0; i < currentClusterMembers.length; i++) {
            for (let j = i + 1; j < currentClusterMembers.length; j++) {
              const pairKey = [currentClusterMembers[i], currentClusterMembers[j]].sort().join('--');
              const pairData = pairDetailsMap.get(pairKey);
              if (pairData) { // Ensure the pair existed and met the threshold
                totalScore += pairData.score;
                contributingPairsCount++;
                // Aggregate shared non-obvious tokens across the cluster
                pairData.sharedNonObviousTokens.forEach(token => {
                  clusterSharedTokensMap.set(token.mint, (clusterSharedTokensMap.get(token.mint) || 0) + 1);
                });
              }
            }
          }
          
          // Calculate representative score and final list of shared tokens for the cluster
          const representativeScore = contributingPairsCount > 0 ? totalScore / contributingPairsCount : 0;
          // For now, just list the mints shared by at least one pair within the cluster
          const finalSharedTokens = Array.from(clusterSharedTokensMap.keys()).map(mint => ({ mint })); 

          clusters.push({
            id: currentClusterMembers.join('-'), // Simple ID based on sorted members
            wallets: currentClusterMembers,
            score: parseFloat(representativeScore.toFixed(2)), // Keep score precision reasonable
            sharedNonObviousTokens: finalSharedTokens,
          });
        }
      }
    }
    
    logger.info(`Built ${clusters.length} wallet clusters (>= 3 members, min pair score: ${this.config.minClusterScoreThreshold}).`);
    // Sort clusters by score or size? For now, by score descending.
    clusters.sort((a, b) => b.score - a.score);
    return clusters;
  }
} 