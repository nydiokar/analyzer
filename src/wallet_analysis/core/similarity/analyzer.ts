import { SimilarityAnalysisConfig } from '../../../types/analysis';
import { TokenVector, WalletSimilarity, SimilarityMetrics } from '../../../types/similarity';
import { TransactionData } from '../../../types/correlation'; // Import the shared type
import { SwapAnalysisInput } from '@prisma/client'; // Or potentially another transaction type
import { createLogger } from '../../../utils/logger';
import cosineSimilarity from 'compute-cosine-similarity'; // External dependency
// May need cosine similarity function, check where it's defined
// import { computeCosineSimilarity } from '...'; 

const logger = createLogger('SimilarityAnalyzer');


export class SimilarityAnalyzer {
  private config: SimilarityAnalysisConfig;

  constructor(config: SimilarityAnalysisConfig) {
    this.config = config;
  }

  /**
   * Calculates similarity metrics based on provided transaction data.
   * This orchestrates vector creation and similarity calculation.
   * @param walletTransactions - A record mapping wallet addresses to their transaction data.
   * @param vectorType - The type of vector to create ('capital' or 'binary').
   * @returns A promise resolving to a SimilarityMetrics object.
   */
  async calculateSimilarity(
    walletTransactions: Record<string, TransactionData[]>, // Use imported type    
    vectorType: 'capital' | 'binary' = 'capital' // Default to capital allocation
  ): Promise<SimilarityMetrics> {
    const walletAddresses = Object.keys(walletTransactions).sort();
    logger.info(`Starting similarity analysis for ${walletAddresses.length} wallets using ${vectorType} vectors.`);

    if (walletAddresses.length < 2) {
        logger.warn('Less than 2 wallets provided, skipping similarity calculation.');
        return this.getEmptyMetrics();
    }

    // Determine unique tokens based on the vector type
    const allRelevantMints = this.getAllRelevantMints(walletTransactions, vectorType);

    if (allRelevantMints.length === 0) {
        logger.warn(`No relevant tokens found for vector type ${vectorType}. Skipping similarity.`);
        return this.getEmptyMetrics();
    }

    // 1. Create Vectors
    let walletVectors: Record<string, TokenVector> = {};
    if (vectorType === 'capital') {
        walletVectors = this.createCapitalAllocationVectors(walletTransactions, allRelevantMints);
    } else { // binary
        walletVectors = this.createBinaryTokenVectors(walletTransactions, allRelevantMints);
    }

    // Filter out wallets that ended up with no vector data
    const walletsWithData = walletAddresses.filter(addr => walletVectors[addr]);
    if (walletsWithData.length < 2) {
        logger.warn('Less than 2 wallets have valid vector data after creation. Skipping similarity matrix calculation.');
        return this.getEmptyMetrics(walletVectors); // Pass vectors for potential partial metrics
    }

    // 2. Calculate Pairwise Similarity Matrix
    const similarityMatrix = this.calculateCosineSimilarityMatrix(walletVectors, walletsWithData);

    // 3. Aggregate Metrics
    const metrics = this.aggregateSimilarityMetrics(similarityMatrix, walletVectors, walletsWithData);

    logger.info('Similarity analysis completed.');
    return metrics;
  }

  // --- Private Helper Methods (Extracted Logic) ---

  private getEmptyMetrics(vectors?: Record<string, TokenVector>): SimilarityMetrics {
      return {
          pairwiseSimilarities: [],
          clusters: [], // Clustering logic not implemented here yet
          globalMetrics: {
              averageSimilarity: 0,
              mostSimilarPairs: [],
              // Add vector count if vectors are provided?
          },
          // Could add metadata about skipped calculations
      };
  }

  private getAllRelevantMints(walletTransactions: Record<string, TransactionData[]>, vectorType: 'capital' | 'binary'): string[] { // Use imported type
      const mintsSet = new Set<string>();
      for (const address in walletTransactions) {
          const txs = walletTransactions[address] || [];
          for (const tx of txs) {
              // For capital, only consider 'in' transactions for the dimension set
              if (vectorType === 'capital' && tx.direction !== 'in') {
                  continue;
              }
              // Add mint if it's relevant to the chosen vector type
              mintsSet.add(tx.mint);
          }
      }
      return Array.from(mintsSet).sort();
  }

  /**
   * Creates token vectors based on the percentage of capital allocated to each token.
   * Capital allocation is determined by the SOL value of 'buy' (in) transactions.
   */
  private createCapitalAllocationVectors(
      walletData: Record<string, TransactionData[]>,
      allUniqueBoughtTokens: string[] // Should only contain tokens that were actually bought by at least one wallet
  ): Record<string, TokenVector> { // Use imported type
      const vectors: Record<string, TokenVector> = {};
      logger.debug('[createCapitalAllocationVectors] Creating vectors based on % capital allocation...');

      for (const walletAddress in walletData) {
          vectors[walletAddress] = {};
          const buysForWallet = walletData[walletAddress]?.filter(tx => tx.direction === 'in') || [];

          let totalSolInvestedByWallet = 0;
          const solInvestedPerToken: Record<string, number> = {};

          // Initialize vector dimensions
          for (const token of allUniqueBoughtTokens) {
              vectors[walletAddress][token] = 0;
              solInvestedPerToken[token] = 0;
          }

          if (buysForWallet.length === 0) {
              logger.debug(`- Wallet ${walletAddress}: No 'in' transactions for capital allocation vector.`);
              continue; // Vector remains all zeros
          }

          // Calculate SOL invested per token and total SOL invested for this wallet
          for (const tx of buysForWallet) {
              if (allUniqueBoughtTokens.includes(tx.mint)) { // Ensure token is part of our defined dimensions
                  solInvestedPerToken[tx.mint] = (solInvestedPerToken[tx.mint] || 0) + tx.associatedSolValue;
                  totalSolInvestedByWallet += tx.associatedSolValue;
              }
          }
          
          // Calculate percentages
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

  /**
   * Creates binary token vectors indicating token presence (1 if traded, 0 otherwise).
   */
  private createBinaryTokenVectors(
      walletData: Record<string, TransactionData[]>,
      allUniqueTradedTokens: string[] 
  ): Record<string, TokenVector> { // Use imported type
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

  /**
   * Calculates a cosine similarity matrix between wallets based on their token vectors.
   */
  private calculateCosineSimilarityMatrix(
      walletVectors: Record<string, TokenVector>,
      walletOrder: string[] // Addresses of wallets with vectors
  ): Record<string, Record<string, number>> {
      const similarityMatrix: Record<string, Record<string, number>> = {};
      const allTokensInDimension = Object.keys(walletVectors[walletOrder[0]] || {}); // Get dimensions from first vector

      if (allTokensInDimension.length === 0) {
          logger.warn('Cannot calculate cosine similarity matrix with zero dimensions.');
          // Return empty matrix structure
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

              // Ensure vectors have the same dimensions
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
                  // Handle potential null/NaN from library
                  similarityMatrix[walletA_address][walletB_address] = sim === null || isNaN(sim) ? 0 : sim;
              } else {
                  // If one or both vectors are all zeros, similarity is 0
                  similarityMatrix[walletA_address][walletB_address] = 0;
              }
          }
      }
      return similarityMatrix;
  }

  /**
   * Calculates Jaccard Similarity between two binary token vectors.
   */
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

  /**
   * Aggregates pairwise similarities into the final SimilarityMetrics structure.
   */
  private aggregateSimilarityMetrics(
      similarityMatrix: Record<string, Record<string, number>>,
      walletVectors: Record<string, TokenVector>,
      walletOrder: string[] // Addresses of wallets included in the matrix
  ): SimilarityMetrics {
      const pairwiseSimilarities: WalletSimilarity[] = [];
      let totalSimilaritySum = 0;
      let pairCount = 0;

      for (let i = 0; i < walletOrder.length; i++) {
          const walletA = walletOrder[i];
          for (let j = i + 1; j < walletOrder.length; j++) {
              const walletB = walletOrder[j];
              const similarityScore = similarityMatrix[walletA]?.[walletB] ?? 0;

              // Extract shared tokens/weights (example for capital allocation)
              // This part might need adjustment depending on how sharedTokens should be defined
              const sharedTokens: WalletSimilarity['sharedTokens'] = [];
              const vectorA = walletVectors[walletA] || {};
              const vectorB = walletVectors[walletB] || {};
              const allTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
              for(const token of allTokens) {
                  const weightA = vectorA[token] || 0;
                  const weightB = vectorB[token] || 0;
                  // Include token if present in either vector (adjust threshold if needed)
                  if (weightA > 0 || weightB > 0) { 
                      sharedTokens.push({ mint: token, weightA, weightB });
                  }
              }
              sharedTokens.sort((a, b) => (b.weightA + b.weightB) - (a.weightA + a.weightB)); // Sort by combined weight

              pairwiseSimilarities.push({
                  walletA,
                  walletB,
                  similarityScore,
                  sharedTokens: sharedTokens.slice(0, 10) // Limit displayed shared tokens for brevity?
              });

              totalSimilaritySum += similarityScore;
              pairCount++;
          }
      }

      pairwiseSimilarities.sort((a, b) => b.similarityScore - a.similarityScore);

      const averageSimilarity = pairCount > 0 ? totalSimilaritySum / pairCount : 0;
      const mostSimilarPairs = pairwiseSimilarities.slice(0, 10); // Top 10 most similar

      return {
          pairwiseSimilarities,
          clusters: [], // Clustering is a separate step
          globalMetrics: {
              averageSimilarity,
              mostSimilarPairs,
          }
      };
  }

  // Potential private helper methods:
  // private buildTokenVectors(...)? -> Might belong in a service layer
  // private computeCosineSimilarity(...)
  // private identifySimilarityClusters(...)?
} 