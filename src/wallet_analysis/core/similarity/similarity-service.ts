import { SimilarityAnalyzer } from './analyzer';
import { DatabaseService } from '../../services/database-service'; 
import { SimilarityAnalysisConfig } from '../../../types/analysis'; 
import { SimilarityMetrics, WalletSimilarity, TokenVector } from '../../../types/similarity'; 
import { TransactionData } from '../../../types/correlation'; 
import { createLogger } from '../../../utils/logger';

const logger = createLogger('SimilarityService');

/**
 * Information about a token shared by multiple wallets (internal to service).
 */
interface SharedTokenInfoInternal {
  mint: string;
  sharedByWallets: Set<string>; // Use Set for efficiency
  count: number;
}

// Define a more comprehensive return type for the service method
export interface ComprehensiveSimilarityResult extends SimilarityMetrics {
  sharedTokenCountsMatrix: Record<string, Record<string, number>>;
  jaccardSimilarityMatrix: Record<string, Record<string, number>>;
  fullSharedTokenList: { mint: string; sharedByWallets: string[]; count: number }[]; // For reporting
  walletVectorsUsed: Record<string, TokenVector>; // Include the vectors used for primary calc
  vectorTypeUsed: 'capital' | 'binary';
}

export class SimilarityService {
  private similarityAnalyzer: SimilarityAnalyzer;
  private config: SimilarityAnalysisConfig; // Store specific config

  constructor(
    private databaseService: DatabaseService,
    config: SimilarityAnalysisConfig // Update constructor signature
  ) {
    this.config = config; // Store config
    this.similarityAnalyzer = new SimilarityAnalyzer(config); // Pass specific config
    logger.info('SimilarityService instantiated with similarity-specific config.'); // Update log
  }

  /**
   * Fetches transaction data and calculates comprehensive similarity metrics.
   * @param walletAddresses - An array of wallet addresses to analyze.
   * @param vectorType - Type of vector to use for the primary cosine similarity calculation.
   * @returns A promise resolving to ComprehensiveSimilarityResult or null.
   */
  async calculateWalletSimilarity(
    walletAddresses: string[],
    vectorType: 'capital' | 'binary' = 'capital'
  ): Promise<ComprehensiveSimilarityResult | null> {
    logger.info(`Calculating comprehensive similarity for ${walletAddresses.length} wallets using primary vector type: ${vectorType}.`);

    if (walletAddresses.length < 2) {
      logger.warn('Similarity calculation requires at least 2 wallets.');
      return null; // Return null for failure/skip
    }

    // 1. Fetch transaction data
    let transactionData: Record<string, TransactionData[]> = {};
    try {
      transactionData = await this.databaseService.getTransactionsForAnalysis(walletAddresses, this.config);
      logger.debug(`Fetched transaction data for ${Object.keys(transactionData).length} wallets.`);
    } catch (error) {
        logger.error(`Error fetching transaction data for similarity analysis:`, { error });
        return null;
    }
    
    // Get wallets that actually have data after fetching
    const walletsWithFetchedData = Object.keys(transactionData).filter(addr => transactionData[addr]?.length > 0);
    if (walletsWithFetchedData.length < 2) {
        logger.warn('Less than 2 wallets have transaction data after fetching. Skipping similarity.');
        return null;
    }

    // 2. Analyze Shared Tokens (used for counts matrix and report list)
    const sharedTokenDetailsInternal = this.analyzeSharedTokensInternal(transactionData);
    const fullSharedTokenListForReport = sharedTokenDetailsInternal.map(info => ({
        mint: info.mint,
        sharedByWallets: Array.from(info.sharedByWallets).sort(),
        count: info.count,
    }));

    // 3. Calculate Shared Token Pair Counts Matrix
    const sharedTokenCountsMatrix = this.calculateWalletPairCounts(sharedTokenDetailsInternal, walletsWithFetchedData);

    // 4. Calculate Primary Similarity (Cosine) based on vectorType
    const primaryRelevantMints = this.similarityAnalyzer['getAllRelevantMints'](transactionData, vectorType);
    let primaryVectors: Record<string, TokenVector> = {};
    let cosineSimilarityMatrix: Record<string, Record<string, number>> = {};

    if (primaryRelevantMints.length > 0) {
        if (vectorType === 'capital') {
            primaryVectors = this.similarityAnalyzer['createCapitalAllocationVectors'](transactionData, primaryRelevantMints);
        } else { // binary
            primaryVectors = this.similarityAnalyzer['createBinaryTokenVectors'](transactionData, primaryRelevantMints);
        }
        // Filter wallets again based on those having vectors for the primary calculation
        const walletsWithPrimaryVectors = walletsWithFetchedData.filter(addr => primaryVectors[addr]);
        if (walletsWithPrimaryVectors.length >= 2) {
            cosineSimilarityMatrix = this.similarityAnalyzer['calculateCosineSimilarityMatrix'](primaryVectors, walletsWithPrimaryVectors);
        } else {
             logger.warn(`Less than 2 wallets have data for primary vector type ${vectorType}. Cosine matrix will be empty.`);
        }
    } else {
        logger.warn(`No relevant mints for primary vector type ${vectorType}. Cosine matrix will be empty.`);
         // Initialize empty matrix structure
        for (const addr of walletsWithFetchedData) { cosineSimilarityMatrix[addr] = {}; }
    }
    
    // Aggregate cosine results into SimilarityMetrics structure
    const coreMetrics = this.similarityAnalyzer['aggregateSimilarityMetrics'](cosineSimilarityMatrix, primaryVectors, walletsWithFetchedData.filter(addr => primaryVectors[addr]));

    // 5. Calculate Jaccard Similarity Matrix (always uses binary vectors)
    const binaryRelevantMints = this.similarityAnalyzer['getAllRelevantMints'](transactionData, 'binary');
    let jaccardSimilarityMatrix: Record<string, Record<string, number>> = {};
    if (binaryRelevantMints.length > 0) {
        const binaryVectors = this.similarityAnalyzer['createBinaryTokenVectors'](transactionData, binaryRelevantMints);
        const walletsWithBinaryVectors = walletsWithFetchedData.filter(addr => binaryVectors[addr]);
        
        if (walletsWithBinaryVectors.length >= 2) {
            // Need a generic matrix calculator or adapt analyzer method
             jaccardSimilarityMatrix = this.calculateGenericSimilarityMatrixInternal(
                 binaryVectors, 
                 walletsWithBinaryVectors, 
                 this.similarityAnalyzer['calculateJaccardSimilarity'] // Pass Jaccard function
             );
        } else {
            logger.warn('Less than 2 wallets have data for binary vectors. Jaccard matrix will be empty.');
        }

    } else {
        logger.warn('No relevant mints for binary vectors. Jaccard matrix will be empty.');
        // Initialize empty matrix structure
        for (const addr of walletsWithFetchedData) { jaccardSimilarityMatrix[addr] = {}; }
    }

    // 6. Combine all results
    const finalResult: ComprehensiveSimilarityResult = {
        ...coreMetrics, // Includes pairwiseSimilarities (Cosine), clusters (empty), globalMetrics (Cosine)
        sharedTokenCountsMatrix: sharedTokenCountsMatrix,
        jaccardSimilarityMatrix: jaccardSimilarityMatrix,
        fullSharedTokenList: fullSharedTokenListForReport,
        walletVectorsUsed: primaryVectors, // Vectors used for the main cosine calculation
        vectorTypeUsed: vectorType,
    };

    logger.info(`Comprehensive similarity analysis completed for ${walletsWithFetchedData.length} wallets.`);
    return finalResult;
  }

  /**
   * Analyzes and identifies tokens shared by two or more wallets.
   * Moved from walletSimilarity.ts script logic.
   * @param walletData - A record where keys are wallet addresses and values are their transaction data.
   * @returns An array of SharedTokenInfoInternal objects, sorted by count.
   */
  private analyzeSharedTokensInternal(walletData: Record<string, TransactionData[]>): SharedTokenInfoInternal[] {
    const tokenToWalletsMap: Record<string, Set<string>> = {};
    const walletAddresses = Object.keys(walletData);

    if (walletAddresses.length < 2) {
        logger.debug('[analyzeSharedTokensInternal] Less than 2 wallets, skipping.');
        return [];
    }

    logger.debug('[analyzeSharedTokensInternal] Identifying shared tokens...');
    for (const walletAddress of walletAddresses) {
        const txData = walletData[walletAddress];
        if (!txData || txData.length === 0) continue;
        
        const uniqueMintsForWallet = new Set(txData.map(tx => tx.mint));
        for (const mint of uniqueMintsForWallet) {
            if (!tokenToWalletsMap[mint]) {
                tokenToWalletsMap[mint] = new Set();
            }
            tokenToWalletsMap[mint].add(walletAddress);
        }
    }

    const sharedTokensResult: SharedTokenInfoInternal[] = [];
    for (const mint in tokenToWalletsMap) {
        const wallets = tokenToWalletsMap[mint];
        if (wallets.size >= 2) { 
            sharedTokensResult.push({
                mint: mint,
                sharedByWallets: wallets, // Keep as Set internally
                count: wallets.size,
            });
        }
    }
    // Sort by count descending, then mint ascending
    sharedTokensResult.sort((a, b) => b.count - a.count || a.mint.localeCompare(b.mint));
    logger.debug(`[analyzeSharedTokensInternal] Found ${sharedTokensResult.length} shared tokens.`);
    return sharedTokensResult;
  }

  /** Calculates raw shared token counts between pairs. */
  private calculateWalletPairCounts(
      sharedTokenDetails: SharedTokenInfoInternal[], 
      targetWalletAddresses: string[]
  ): Record<string, Record<string, number>> {
      const pairCounts: Record<string, Record<string, number>> = {};
      targetWalletAddresses.forEach(addrA => {
          pairCounts[addrA] = {};
          targetWalletAddresses.forEach(addrB => {
              if (addrA !== addrB) pairCounts[addrA][addrB] = 0;
          });
      });

      for (const info of sharedTokenDetails) {
          const targetSharingWallets = Array.from(info.sharedByWallets).filter(addr => targetWalletAddresses.includes(addr));
          for (let i = 0; i < targetSharingWallets.length; i++) {
              for (let j = i + 1; j < targetSharingWallets.length; j++) {
                  const walletA = targetSharingWallets[i];
                  const walletB = targetSharingWallets[j];
                  pairCounts[walletA][walletB]++;
                  pairCounts[walletB][walletA]++;
              }
          }
      }
      logger.debug(`[calculateWalletPairCounts] Calculated shared token counts between ${targetWalletAddresses.length} wallets.`);
      return pairCounts;
  }
  
  /** Calculates a similarity matrix using a provided similarity function. */
  private calculateGenericSimilarityMatrixInternal(
      walletVectors: Record<string, TokenVector>, 
      walletOrder: string[], // Addresses with vectors
      similarityFn: (vecA: TokenVector, vecB: TokenVector) => number
  ): Record<string, Record<string, number>> {
      const similarityMatrix: Record<string, Record<string, number>> = {};
      for (let i = 0; i < walletOrder.length; i++) {
          const walletA_address = walletOrder[i];
          similarityMatrix[walletA_address] = {};
          const vectorA = walletVectors[walletA_address]; 
          for (let j = 0; j < walletOrder.length; j++) {
              const walletB_address = walletOrder[j];
              if (i === j) {
                  similarityMatrix[walletA_address][walletB_address] = 1.0;
                  continue;
              }
              const vectorB = walletVectors[walletB_address];
              // Vectors presence already checked by walletOrder filtering
              similarityMatrix[walletA_address][walletB_address] = similarityFn(vectorA, vectorB);
          }
      }
      return similarityMatrix;
  }
} 