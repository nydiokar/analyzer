import { SimilarityAnalysisConfig } from '@/types/analysis';
import { TokenVector, SingleSimilarityResult, CorePairwiseResult } from '@/types/similarity';
import { TransactionData } from '@/types/correlation';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('SimilarityAnalyzer');

export class SimilarityAnalyzer {
  private config: SimilarityAnalysisConfig;

  constructor(config: SimilarityAnalysisConfig) {
    this.config = config;
  }

  async calculateSimilarity(
    walletTransactions: Record<string, TransactionData[]>,
    vectorType: 'capital' | 'binary' = 'capital'
  ): Promise<SingleSimilarityResult> {
    const walletAddresses = Object.keys(walletTransactions).sort();
    logger.info(`Starting similarity analysis for ${walletAddresses.length} wallets using ${vectorType} vectors.`);

    if (walletAddresses.length < 2) {
        logger.warn('Less than 2 wallets provided, skipping similarity calculation.');
        return this.getEmptyMetrics(vectorType);
    }

    const allRelevantMints = this.getAllRelevantMints(walletTransactions, vectorType);

    if (allRelevantMints.length === 0) {
        logger.warn(`No relevant tokens found for vector type ${vectorType}. Skipping similarity.`);
        return this.getEmptyMetrics(vectorType);
    }

    let walletVectors: Record<string, TokenVector> = {};
    if (vectorType === 'capital') {
        walletVectors = this.createCapitalAllocationVectors(walletTransactions, allRelevantMints);
    } else {
        walletVectors = this.createBinaryTokenVectors(walletTransactions, allRelevantMints);
    }

    const walletsWithData = walletAddresses.filter(addr => walletVectors[addr]);
    if (walletsWithData.length < 2) {
        logger.warn('Less than 2 wallets have valid vector data after creation. Skipping similarity matrix calculation.');
        return this.getEmptyMetrics(vectorType, walletVectors);
    }

    const similarityMatrix = this.calculateCosineSimilarityMatrix(walletVectors, walletsWithData);
    const uniqueTokensPerWallet = this.calculateUniqueTokensPerWallet(walletVectors);
    const aggregatedMetrics = this.aggregateSimilarityMetrics(similarityMatrix, walletVectors, walletsWithData, uniqueTokensPerWallet, vectorType);

    logger.info('Similarity analysis completed.');
    return {
        ...aggregatedMetrics,
        walletVectorsUsed: walletVectors,
        uniqueTokensPerWallet: uniqueTokensPerWallet,
        vectorTypeUsed: vectorType,
    };
  }

  private getEmptyMetrics(vectorType: 'capital' | 'binary', vectors: Record<string, TokenVector> = {}): SingleSimilarityResult {
      return {
          pairwiseSimilarities: [],
          clusters: [],
          globalMetrics: {
              averageSimilarity: 0,
              mostSimilarPairs: [],
          },
          walletVectorsUsed: vectors,
          uniqueTokensPerWallet: this.calculateUniqueTokensPerWallet(vectors),
          vectorTypeUsed: vectorType,
      };
  }

  private getAllRelevantMints(walletTransactions: Record<string, TransactionData[]>, vectorType: 'capital' | 'binary'): string[] {
      const mintsSet = new Set<string>();
      const excluded = new Set(this.config.excludedMints || []);

      for (const address in walletTransactions) {
          const txs = walletTransactions[address] || [];
          for (const tx of txs) {
              if (excluded.has(tx.mint)) {
                  continue;
              }
              if (vectorType === 'capital' && tx.direction !== 'in') {
                  continue;
              }
              mintsSet.add(tx.mint);
          }
      }
      return Array.from(mintsSet).sort();
  }

  private createCapitalAllocationVectors(
      walletData: Record<string, TransactionData[]>,
      allUniqueBoughtTokens: string[]
  ): Record<string, TokenVector> {
      const vectors: Record<string, TokenVector> = {};
      const tokenUniverse = new Set(allUniqueBoughtTokens);
      logger.debug('[createCapitalAllocationVectors] Creating vectors based on % capital allocation...');

      for (const walletAddress in walletData) {
          vectors[walletAddress] = {};
          const buysForWallet = walletData[walletAddress]?.filter(tx => tx.direction === 'in') || [];

          let totalSolInvestedByWallet = 0;
          const solInvestedPerToken: Record<string, number> = {};

          if (buysForWallet.length === 0) {
              logger.debug(`- Wallet ${walletAddress}: No 'in' transactions for capital allocation vector.`);
              continue;
          }

          for (const tx of buysForWallet) {
              if (tokenUniverse.has(tx.mint)) {
                  solInvestedPerToken[tx.mint] = (solInvestedPerToken[tx.mint] || 0) + tx.associatedSolValue;
                  totalSolInvestedByWallet += tx.associatedSolValue;
              }
          }
          
          if (totalSolInvestedByWallet > 0) {
              for (const token in solInvestedPerToken) {
                  if (solInvestedPerToken[token] > 0) {
                      vectors[walletAddress][token] = solInvestedPerToken[token] / totalSolInvestedByWallet;
                  }
              }
          } else {
              logger.debug(`- Wallet ${walletAddress}: Total SOL invested is 0, capital allocation vector remains zeros.`);
          }
      }
      return vectors;
  }

  private createBinaryTokenVectors(
      walletData: Record<string, TransactionData[]>,
      allUniqueTradedTokens: string[]
  ): Record<string, TokenVector> {
      const vectors: Record<string, TokenVector> = {};
      const tokenUniverse = new Set(allUniqueTradedTokens);
      logger.debug('[createBinaryTokenVectors] Creating vectors based on token presence (1/0)...');

      for (const walletAddress in walletData) {
          vectors[walletAddress] = {};
          const tradedTokensByWallet = new Set(walletData[walletAddress]?.map(tx => tx.mint) || []);
          
          for (const token of tradedTokensByWallet) {
              if (tokenUniverse.has(token)) {
                  vectors[walletAddress][token] = 1;
              }
          }
      }
      return vectors;
  }

  private calculateCosineSimilarityMatrix(
      walletVectors: Record<string, TokenVector>,
      walletOrder: string[]
  ): Record<string, Record<string, number>> {
      const similarityMatrix: Record<string, Record<string, number>> = {};
      const norms: Record<string, number> = {};
      for (const walletAddress of walletOrder) {
          norms[walletAddress] = this.calculateVectorNorm(walletVectors[walletAddress] || {});
      }

      for (let i = 0; i < walletOrder.length; i++) {
          const walletA_address = walletOrder[i];
          similarityMatrix[walletA_address] = {};
          const vectorA_raw = walletVectors[walletA_address];
          const normA = norms[walletA_address];

          for (let j = 0; j < walletOrder.length; j++) {
              const walletB_address = walletOrder[j];
              if (i === j) {
                  similarityMatrix[walletA_address][walletB_address] = 1.0;
                  continue;
              }
              
              const vectorB_raw = walletVectors[walletB_address];
              const normB = norms[walletB_address];

              if (normA === 0 || normB === 0) {
                  similarityMatrix[walletA_address][walletB_address] = 0;
                  continue;
              }

              const sim = this.calculateSparseCosineSimilarity(vectorA_raw, vectorB_raw, normA, normB);
              similarityMatrix[walletA_address][walletB_address] = Number.isFinite(sim) ? sim : 0;
          }
      }
      return similarityMatrix;
  }

  private calculateJaccardSimilarity(vectorA: TokenVector, vectorB: TokenVector): number {
    let intersectionSize = 0;
    let unionSize = 0;
    const allKeys = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);

    for (const key of allKeys) {
        const valA = vectorA[key] || 0;
        const valB = vectorB[key] || 0;

        if (valA === 1 && valB === 1) {
            intersectionSize++;
            unionSize++;
        } else if (valA === 1 || valB === 1) {
            unionSize++;
        }
    }
    return unionSize === 0 ? 1 : intersectionSize / unionSize; 
  }

  private calculateUniqueTokensPerWallet(walletVectors: Record<string, TokenVector>): Record<string, number> {
    const uniqueTokens: Record<string, number> = {};
    for (const walletAddress in walletVectors) {
        const vector = walletVectors[walletAddress];
        if (vector) {
            uniqueTokens[walletAddress] = Object.values(vector).filter(v => v > 0).length;
        } else {
            uniqueTokens[walletAddress] = 0;
        }
    }
    return uniqueTokens;
  }

  private aggregateSimilarityMetrics(
      similarityMatrix: Record<string, Record<string, number>>,
      walletVectors: Record<string, TokenVector>,
      walletOrder: string[],
      uniqueTokensPerWallet: Record<string, number>,
      vectorType: 'capital' | 'binary'
  ): Pick<SingleSimilarityResult, 'pairwiseSimilarities' | 'globalMetrics' | 'clusters'> {
      const pairwiseSimilarities: CorePairwiseResult[] = [];
      let totalSimilarity = 0;
      let pairCount = 0;
      const allScores: number[] = [];

      for (let i = 0; i < walletOrder.length; i++) {
          for (let j = i + 1; j < walletOrder.length; j++) {
              const walletA = walletOrder[i];
              const walletB = walletOrder[j];
              const score = similarityMatrix[walletA]?.[walletB] ?? 0;
              
              const vectorA = walletVectors[walletA];
              const vectorB = walletVectors[walletB];

              if (!vectorA || !vectorB) continue;

              const sharedTokensForPair = this.getSharedTokensForPair(vectorA, vectorB);

              pairwiseSimilarities.push({
                  walletA,
                  walletB,
                  similarityScore: score,
                  sharedTokens: sharedTokensForPair,
                  uniqueTokenCountA: uniqueTokensPerWallet[walletA] || 0,
                  uniqueTokenCountB: uniqueTokensPerWallet[walletB] || 0,
                  sharedTokenCount: sharedTokensForPair.length,
              });
              totalSimilarity += score;
              pairCount++;
              allScores.push(score);
          }
      }

      pairwiseSimilarities.sort((a, b) => b.similarityScore - a.similarityScore);

      // Calculate both mean and median for better representation
      const averageSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;
      
      // Calculate median (more representative when there are outliers)
      allScores.sort((a, b) => a - b);
      const medianSimilarity = allScores.length > 0 
        ? allScores.length % 2 === 0 
          ? (allScores[allScores.length / 2 - 1] + allScores[allScores.length / 2]) / 2
          : allScores[Math.floor(allScores.length / 2)]
        : 0;

      const mostSimilarPairs = pairwiseSimilarities.slice(0, 5);

      return {
          pairwiseSimilarities,
          globalMetrics: {
              averageSimilarity: medianSimilarity, // Use median instead of mean for better representation
              mostSimilarPairs,
          },
          clusters: [],
      };
  }

  private getSharedTokensForPair(
      vectorA: TokenVector,
      vectorB: TokenVector
  ): { mint: string; weightA: number; weightB: number }[] {
      const shared = [] as { mint: string; weightA: number; weightB: number }[];
      const [smaller, larger] = Object.keys(vectorA).length <= Object.keys(vectorB).length
        ? [vectorA, vectorB]
        : [vectorB, vectorA];

      for (const token in smaller) {
          const a = vectorA[token] || 0;
          const b = vectorB[token] || 0;
          if (a > 0 && b > 0) {
              shared.push({ mint: token, weightA: a, weightB: b });
          }
      }
      return shared;
  }

  public createHoldingsPresenceVectors(
    walletBalances: Map<string, import('@/types/wallet').WalletBalance>,
    allUniqueHeldTokens: string[]
  ): Record<string, TokenVector> {
    const vectors: Record<string, TokenVector> = {};
    logger.debug('[createHoldingsPresenceVectors] Creating binary vectors based on current token holdings...');
    const tokenUniverse = new Set(allUniqueHeldTokens);

    for (const [walletAddress, balanceData] of walletBalances.entries()) {
        vectors[walletAddress] = {};
        const heldTokensByWallet = new Set<string>();
        if (balanceData && balanceData.tokenBalances) {
            balanceData.tokenBalances.forEach(tb => {
                if (tb.uiBalance !== undefined && tb.uiBalance > 0) {
                    heldTokensByWallet.add(tb.mint);
                }
            });
        }
        
        for (const tokenMint of heldTokensByWallet) {
            if (tokenUniverse.has(tokenMint)) {
                vectors[walletAddress][tokenMint] = 1;
            }
        }
    }
    return vectors;
  }
  // ---- END NEW Method ----

  private calculateVectorNorm(vector: TokenVector): number {
      let sumSquares = 0;
      for (const key in vector) {
          const value = vector[key] || 0;
          if (value !== 0) {
              sumSquares += value * value;
          }
      }
      return Math.sqrt(sumSquares);
  }

  private calculateSparseCosineSimilarity(
      vectorA: TokenVector,
      vectorB: TokenVector,
      normA: number,
      normB: number
  ): number {
      if (normA === 0 || normB === 0) return 0;
      const keysA = Object.keys(vectorA);
      const keysB = Object.keys(vectorB);
      const iterateA = keysA.length <= keysB.length;
      const smaller = iterateA ? vectorA : vectorB;
      const larger = iterateA ? vectorB : vectorA;

      let dotProduct = 0;
      for (const key in smaller) {
          const valueA = smaller[key] || 0;
          if (valueA === 0) continue;
          const valueB = larger[key] || 0;
          if (valueB !== 0) {
              dotProduct += valueA * valueB;
          }
      }

      return dotProduct / (normA * normB);
  }

  // Potential private helper methods:
  // private buildTokenVectors(...)? -> Might belong in a service layer
  // private computeCosineSimilarity(...)
  // private identifySimilarityClusters(...)?
} 
