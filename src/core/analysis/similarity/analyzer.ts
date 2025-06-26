import { SimilarityAnalysisConfig } from '@/types/analysis';
import { TokenVector, SingleSimilarityResult, CorePairwiseResult } from '@/types/similarity';
import { TransactionData } from '@/types/correlation';
import { createLogger } from 'core/utils/logger';
import cosineSimilarity from 'compute-cosine-similarity';

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
      for (const address in walletTransactions) {
          const txs = walletTransactions[address] || [];
          for (const tx of txs) {
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
      logger.debug('[createCapitalAllocationVectors] Creating vectors based on % capital allocation...');

      for (const walletAddress in walletData) {
          vectors[walletAddress] = {};
          const buysForWallet = walletData[walletAddress]?.filter(tx => tx.direction === 'in') || [];

          let totalSolInvestedByWallet = 0;
          const solInvestedPerToken: Record<string, number> = {};

          for (const token of allUniqueBoughtTokens) {
              vectors[walletAddress][token] = 0;
              solInvestedPerToken[token] = 0;
          }

          if (buysForWallet.length === 0) {
              logger.debug(`- Wallet ${walletAddress}: No 'in' transactions for capital allocation vector.`);
              continue;
          }

          for (const tx of buysForWallet) {
              if (allUniqueBoughtTokens.includes(tx.mint)) {
                  solInvestedPerToken[tx.mint] = (solInvestedPerToken[tx.mint] || 0) + tx.associatedSolValue;
                  totalSolInvestedByWallet += tx.associatedSolValue;
              }
          }
          
          if (totalSolInvestedByWallet > 0) {
              for (const token of allUniqueBoughtTokens) {
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
      logger.debug('[createBinaryTokenVectors] Creating vectors based on token presence (1/0)...');

      for (const walletAddress in walletData) {
          vectors[walletAddress] = {};
          const tradedTokensByWallet = new Set(walletData[walletAddress]?.map(tx => tx.mint) || []);
          
          for (const token of allUniqueTradedTokens) {
              vectors[walletAddress][token] = tradedTokensByWallet.has(token) ? 1 : 0;
          }
      }
      return vectors;
  }

  private calculateCosineSimilarityMatrix(
      walletVectors: Record<string, TokenVector>,
      walletOrder: string[]
  ): Record<string, Record<string, number>> {
      const similarityMatrix: Record<string, Record<string, number>> = {};
      const allTokensInDimension = Object.keys(walletVectors[walletOrder[0]] || {});

      if (allTokensInDimension.length === 0) {
          logger.warn('Cannot calculate cosine similarity matrix with zero dimensions.');
          for (const addr of walletOrder) { similarityMatrix[addr] = {}; }
          return similarityMatrix;
      }

      for (let i = 0; i < walletOrder.length; i++) {
          const walletA_address = walletOrder[i];
          similarityMatrix[walletA_address] = {};
          const vectorA_raw = walletVectors[walletA_address];

          for (let j = 0; j < walletOrder.length; j++) {
              const walletB_address = walletOrder[j];
              if (i === j) {
                  similarityMatrix[walletA_address][walletB_address] = 1.0;
                  continue;
              }
              
              const vectorB_raw = walletVectors[walletB_address];

              const vectorA: number[] = [];
              const vectorB: number[] = [];
              for (const token of allTokensInDimension) {
                  vectorA.push(vectorA_raw[token] || 0);
                  vectorB.push(vectorB_raw[token] || 0);
              }

              const isVectorANotZero = vectorA.some(val => val !== 0);
              const isVectorBNotZero = vectorB.some(val => val !== 0);

              if (isVectorANotZero && isVectorBNotZero) {
                  const sim = cosineSimilarity(vectorA, vectorB);
                  similarityMatrix[walletA_address][walletB_address] = sim === null || isNaN(sim) ? 0 : sim;
              } else {
                  similarityMatrix[walletA_address][walletB_address] = 0;
              }
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

      for (let i = 0; i < walletOrder.length; i++) {
          for (let j = i + 1; j < walletOrder.length; j++) {
              const walletA = walletOrder[i];
              const walletB = walletOrder[j];
              const score = similarityMatrix[walletA]?.[walletB] ?? 0;
              const sharedTokensForPair = this.getSharedTokensForPair(walletVectors[walletA], walletVectors[walletB]);

              pairwiseSimilarities.push({
                  walletA,
                  walletB,
                  similarityScore: score,
                  sharedTokens: sharedTokensForPair,
              });
              totalSimilarity += score;
              pairCount++;
          }
      }

      pairwiseSimilarities.sort((a, b) => b.similarityScore - a.similarityScore);

      const averageSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;
      const mostSimilarPairs = pairwiseSimilarities.slice(0, 5);

      return {
          pairwiseSimilarities,
          globalMetrics: {
              averageSimilarity,
              mostSimilarPairs,
          },
          clusters: [],
      };
  }

  private getSharedTokensForPair(
      vectorA: TokenVector,
      vectorB: TokenVector
  ): { mint: string; weightA: number; weightB: number }[] {
      const shared = [];
      const allTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
      for (const token of allTokens) {
          const weightA = vectorA[token] || 0;
          const weightB = vectorB[token] || 0;
          if (weightA > 0 && weightB > 0) {
              shared.push({ mint: token, weightA, weightB });
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
        
        for (const tokenMint of allUniqueHeldTokens) {
            vectors[walletAddress][tokenMint] = heldTokensByWallet.has(tokenMint) ? 1 : 0;
        }
    }
    return vectors;
  }
  // ---- END NEW Method ----

  // Potential private helper methods:
  // private buildTokenVectors(...)? -> Might belong in a service layer
  // private computeCosineSimilarity(...)
  // private identifySimilarityClusters(...)?
} 