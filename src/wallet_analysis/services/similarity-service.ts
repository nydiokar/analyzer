import { SimilarityAnalyzer } from '../core/similarity/analyzer';
import { DatabaseService } from './database-service'; // Assuming export will be fixed
import { SimilarityAnalysisConfig } from '../../types/analysis'; // Updated import
import { SimilarityMetrics, WalletSimilarity } from '../../types/similarity'; // Import WalletSimilarity
import { TransactionData } from '../../types/correlation'; // Using the shared transaction type
import { createLogger } from '../../utils/logger';

const logger = createLogger('SimilarityService');

/**
 * Information about a token shared by multiple wallets (internal to service).
 */
interface SharedTokenInfoInternal {
  mint: string;
  sharedByWallets: Set<string>; // Use Set for efficiency
  count: number;
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
   * Fetches transaction data for multiple wallets and calculates similarity.
   * Also includes analysis of shared tokens.
   * @param walletAddresses - An array of wallet addresses to analyze.
   * @param vectorType - Type of vector to use ('capital' or 'binary'). Defaults to 'capital'.
   * @returns A promise resolving to SimilarityMetrics (potentially extended) or null.
   */
  async calculateWalletSimilarity(
    walletAddresses: string[],
    vectorType: 'capital' | 'binary' = 'capital'
    // Extend return type if SharedTokenInfo should be exposed
  ): Promise<SimilarityMetrics | null> {
    logger.info(`Calculating similarity for ${walletAddresses.length} wallets using ${vectorType} vectors.`);

    if (walletAddresses.length < 2) {
      logger.warn('Similarity calculation requires at least 2 wallets.');
      return this.getEmptyMetrics();
    }

    // 1. Fetch transaction data
    let transactionData: Record<string, TransactionData[]> = {};
    try {
      // Fetch transactions using SimilarityAnalysisConfig
      transactionData = await this.databaseService.getTransactionsForAnalysis(walletAddresses, this.config);
      logger.debug(`Fetched transaction data for ${Object.keys(transactionData).length} wallets.`);
    } catch (error) {
        logger.error(`Error fetching transaction data for similarity analysis:`, { error });
        return null;
    }

    // 2. Analyze Shared Tokens (using fetched data)
    const sharedTokenDetails = this.analyzeSharedTokensInternal(transactionData);

    // 3. Run Core Similarity Analysis (using the analyzer)
    try {
      // The analyzer calculates the core similarity metrics
      const coreMetrics = await this.similarityAnalyzer.calculateSimilarity(transactionData, vectorType);

      // Add shared token context to the result (if needed)
      // Option 1: Directly add to the returned object
      // Option 2: Include in globalMetrics (less standard for SimilarityMetrics type)
      // For now, let's log it and assume coreMetrics is sufficient, unless requested otherwise
      logger.info(`Shared token analysis complete: Found ${sharedTokenDetails.length} tokens shared by >= 2 wallets.`);
      
      // Potential future step: Use sharedTokenDetails to enrich pairwiseSimilarities
      // e.g., add raw shared count to WalletSimilarity type?

      logger.info(`Similarity analysis completed for ${walletAddresses.length} wallets.`);
      return coreMetrics;
    } catch (error) {
        logger.error(`Error during similarity analysis:`, { error });
        return null;
    }
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

  private getEmptyMetrics(): SimilarityMetrics {
    return {
        pairwiseSimilarities: [],
        clusters: [],
        globalMetrics: { averageSimilarity: 0, mostSimilarPairs: [] }
    };
  }
} 