import { SimilarityAnalyzer } from './analyzer';
import { DatabaseService } from 'core/services/database-service'; 
import { SimilarityAnalysisConfig } from '@/types/analysis'; 
import { SingleSimilarityResult, TokenVector } from '@/types/similarity';
import { TransactionData } from '@/types/correlation'; 
import { createLogger } from 'core/utils/logger';
import { WalletBalance } from '@/types/wallet';

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
    // logger.info('SimilarityService instantiated with similarity-specific config.'); // Update log
  }

  /**
   * Fetches transaction data and calculates comprehensive similarity metrics.
   * @param walletAddresses - An array of wallet addresses to analyze.
   * @param vectorType - Type of vector to use for the primary cosine similarity calculation.
   * @param walletBalances - Optional pre-fetched wallet balances.
   * @returns A promise resolving to SingleSimilarityResult or null.
   */
  async calculateWalletSimilarity(
    walletAddresses: string[],
    vectorType: 'capital' | 'binary' = 'capital',
    walletBalances?: Map<string, WalletBalance> 
  ): Promise<SingleSimilarityResult | null> {
    // logger.info(`Calculating comprehensive similarity for ${walletAddresses.length} wallets using primary vectorType: ${vectorType}.`);
    if (walletBalances && walletBalances.size > 0) {
      // logger.info(`Received pre-fetched wallet balances for ${walletBalances.size} wallets.`);
    }

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
    
    // ENHANCED: Apply fee-based filtering to primary similarity calculations
    // Get actively traded tokens for each wallet (same logic as historical filtering)
    const activelyTradedTokensByWalletPrimary = new Map<string, Set<string>>();
    
    for (const walletAddr of walletsWithFetchedData) {
        const analysisResults = await this.databaseService.getAnalysisResults({
            where: { 
                walletAddress: walletAddr,
                totalFeesPaidInSol: { gt: 0 } // Only tokens where wallet paid fees
            }
        });
        
        const activeTokens = new Set(analysisResults.map(result => result.tokenAddress));
        activelyTradedTokensByWalletPrimary.set(walletAddr, activeTokens);
        logger.debug(`[Primary Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${analysisResults.length} actively traded tokens (paid fees)`);
    }
    
    // Filter primaryRelevantMints to only include tokens actively traded by at least one wallet
    const filteredPrimaryMints = primaryRelevantMints.filter(mint => {
        return Array.from(activelyTradedTokensByWalletPrimary.values()).some(tokenSet => tokenSet.has(mint));
    });
    
    logger.debug(`[Primary Filtered] Filtered from ${primaryRelevantMints.length} to ${filteredPrimaryMints.length} tokens for ${vectorType} similarity (excluding passive interactions)`);

    if (filteredPrimaryMints.length > 0) {
        // Create filtered transaction data that only includes actively traded tokens
        const filteredTransactionData: Record<string, TransactionData[]> = {};
        
        for (const walletAddr of walletsWithFetchedData) {
            const activeTokens = activelyTradedTokensByWalletPrimary.get(walletAddr) || new Set();
            filteredTransactionData[walletAddr] = (transactionData[walletAddr] || []).filter(tx => 
                activeTokens.has(tx.mint)
            );
            
            const originalCount = transactionData[walletAddr]?.length || 0;
            const filteredCount = filteredTransactionData[walletAddr].length;
            logger.debug(`[Primary Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${filteredCount}/${originalCount} transactions (actively traded only)`);
        }
        
        if (vectorType === 'capital') {
            primaryVectors = this.similarityAnalyzer['createCapitalAllocationVectors'](filteredTransactionData, filteredPrimaryMints);
        } else { // binary
            primaryVectors = this.similarityAnalyzer['createBinaryTokenVectors'](filteredTransactionData, filteredPrimaryMints);
        }
        
        // Filter wallets again based on those having vectors for the primary calculation
        const walletsWithPrimaryVectors = walletsWithFetchedData.filter(addr => primaryVectors[addr]);
        if (walletsWithPrimaryVectors.length >= 2) {
            cosineSimilarityMatrix = this.similarityAnalyzer['calculateCosineSimilarityMatrix'](primaryVectors, walletsWithPrimaryVectors);
            
            logger.info(`[Primary Filtered Similarity] Calculated ${vectorType} similarity for ${walletsWithPrimaryVectors.length} wallets using ${filteredPrimaryMints.length} actively traded tokens`);
        } else {
             logger.warn(`Less than 2 wallets have data for filtered primary vector type ${vectorType}. Cosine matrix will be empty.`);
        }
    } else {
        logger.warn(`No actively traded tokens found for primary vector type ${vectorType}. Cosine matrix will be empty.`);
         // Initialize empty matrix structure
        for (const addr of walletsWithFetchedData) { cosineSimilarityMatrix[addr] = {}; }
    }
    
    // Aggregate cosine results into SimilarityMetrics structure
    const coreMetrics = this.similarityAnalyzer['aggregateSimilarityMetrics'](
        cosineSimilarityMatrix,
        primaryVectors,
        walletsWithFetchedData.filter(addr => primaryVectors[addr]),
        this.similarityAnalyzer['calculateUniqueTokensPerWallet'](primaryVectors),
        vectorType
    );

    // 5. Calculate Jaccard Similarity Matrix (always uses binary vectors)
    const binaryRelevantMints = this.similarityAnalyzer['getAllRelevantMints'](transactionData, 'binary');
    let jaccardSimilarityMatrix: Record<string, Record<string, number>> = {};
    logger.debug(`[Historical Similarity] Found ${binaryRelevantMints.length} relevant mints from transaction data`);
    
    if (binaryRelevantMints.length > 0) {
        const binaryVectors = this.similarityAnalyzer['createBinaryTokenVectors'](transactionData, binaryRelevantMints);
        const walletsWithBinaryVectors = walletsWithFetchedData.filter(addr => binaryVectors[addr]);
        
        // ENHANCED: Apply same fee-based filter to historical data
        // Only include tokens where wallets actively paid fees to trade them
        const activelyTradedTokensByWallet = new Map<string, Set<string>>();
        
        for (const walletAddr of walletsWithBinaryVectors) {
            const analysisResults = await this.databaseService.getAnalysisResults({
                where: { 
                    walletAddress: walletAddr,
                    totalFeesPaidInSol: { gt: 0 } // Only tokens where wallet paid fees
                }
            });
            
            const activeTokens = new Set(analysisResults.map(result => result.tokenAddress));
            activelyTradedTokensByWallet.set(walletAddr, activeTokens);
            // logger.debug(`[Historical Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${analysisResults.length} actively traded tokens (paid fees)`);
        }
        
        // Filter binaryRelevantMints to only include tokens actively traded by at least one wallet
        const filteredHistoricalMints = binaryRelevantMints.filter(mint => {
            return Array.from(activelyTradedTokensByWallet.values()).some(tokenSet => tokenSet.has(mint));
        });
        
        // logger.debug(`[Historical Filtered] Filtered from ${binaryRelevantMints.length} to ${filteredHistoricalMints.length} tokens (excluding passive interactions)`);
        
        if (filteredHistoricalMints.length > 0) {
            // Create filtered binary vectors using only actively traded tokens
            const filteredBinaryVectors: Record<string, TokenVector> = {};
            for (const walletAddr of walletsWithBinaryVectors) {
                filteredBinaryVectors[walletAddr] = {};
                const activeTokens = activelyTradedTokensByWallet.get(walletAddr) || new Set();
                
                for (const mint of filteredHistoricalMints) {
                    // Token = 1 if wallet actively traded it (paid fees), 0 otherwise
                    filteredBinaryVectors[walletAddr][mint] = activeTokens.has(mint) ? 1 : 0;
                }
                
                const activeCount = Object.values(filteredBinaryVectors[walletAddr]).filter(v => v === 1).length;
               //  logger.debug(`[Historical Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${activeCount} actively traded out of ${filteredHistoricalMints.length} total`);
            }
            
            // Calculate Jaccard similarity matrix manually since the method is private
            jaccardSimilarityMatrix = this.calculateJaccardSimilarityMatrix(filteredBinaryVectors, walletsWithBinaryVectors);
            
            // DEBUG: Log the actual similarity calculation
            for (const wallet1 of walletsWithBinaryVectors) {
                for (const wallet2 of walletsWithBinaryVectors) {
                    if (wallet1 !== wallet2 && jaccardSimilarityMatrix[wallet1] && jaccardSimilarityMatrix[wallet1][wallet2] !== undefined) {
                        const similarity = jaccardSimilarityMatrix[wallet1][wallet2];
                        const wallet1Tokens = Object.values(filteredBinaryVectors[wallet1]).filter(v => v === 1).length;
                        const wallet2Tokens = Object.values(filteredBinaryVectors[wallet2]).filter(v => v === 1).length;
                       //  logger.info(`[Historical Filtered Similarity] ${wallet1.slice(0, 8)}...${wallet1.slice(-4)} ↔ ${wallet2.slice(0, 8)}...${wallet2.slice(-4)}: ${(similarity * 100).toFixed(1)}% (actively traded tokens)`);
                    }
                }
            }
        } else {
            logger.warn('[Historical Filtered] No actively traded tokens found after filtering. Skipping historical similarity.');
        }
        
        // DEBUG: Log the actual vectors for historical trading
        // logger.debug(`[Historical Debug] Wallets with binary vectors: ${walletsWithBinaryVectors.length}`);
    } else {
        logger.warn('No relevant mints for binary vectors. Jaccard matrix will be empty.');
        // Initialize empty matrix structure
        for (const addr of walletsWithFetchedData) { jaccardSimilarityMatrix[addr] = {}; }
    }

    // 6. Combine all results
    const finalResult: SingleSimilarityResult = {
        ...coreMetrics, 
        sharedTokenCountsMatrix: sharedTokenCountsMatrix,
        jaccardSimilarityMatrix: jaccardSimilarityMatrix, 
        walletVectorsUsed: primaryVectors,
        vectorTypeUsed: vectorType,
        uniqueTokensPerWallet: this.similarityAnalyzer['calculateUniqueTokensPerWallet'](primaryVectors),
    };

    // ---- NEW: Calculate Similarity based on Current Holdings ----
    if (walletBalances && walletBalances.size >= 2) {
        const walletsWithBalanceData = Array.from(walletBalances.keys());
        if (walletsWithBalanceData.length >= 2) {
            // logger.info(`Calculating similarity based on current holdings for ${walletsWithBalanceData.length} wallets.`);

            // 1. Get all unique tokens currently held across these wallets
            const allUniqueHeldTokensSet = new Set<string>();
            const allTokensIncludingZeroSet = new Set<string>();
            const allTokensWithMeaningfulBalanceSet = new Set<string>(); // Track tokens with meaningful balance amounts
            
            // Balance-based filtering to exclude dust/spam tokens
            const MIN_MEANINGFUL_BALANCE = 0.001; // Minimum UI balance to be considered meaningful
            
            walletBalances.forEach(balanceData => {
                balanceData.tokenBalances?.forEach(tb => {
                    allTokensIncludingZeroSet.add(tb.mint); // Track all tokens including zero balance
                    if (tb.uiBalance !== undefined && tb.uiBalance > 0) {
                        allUniqueHeldTokensSet.add(tb.mint);
                        
                        // Check if token has meaningful balance amount (to filter out dust/spam)
                        if (tb.uiBalance >= MIN_MEANINGFUL_BALANCE) {
                            allTokensWithMeaningfulBalanceSet.add(tb.mint);
                        }
                    }
                });
            });
            
            // Use meaningful-balance-filtered tokens if we have enough, otherwise fall back to positive balance
            const useMeaningfulFiltering = allTokensWithMeaningfulBalanceSet.size >= 5; // Need at least 5 meaningful tokens
            const tokensToUse = useMeaningfulFiltering ? Array.from(allTokensWithMeaningfulBalanceSet) : Array.from(allUniqueHeldTokensSet);
            const allUniqueHeldTokens = tokensToUse.sort();
            
            // logger.debug(`[Holdings Similarity] Total tokens (including zero balance): ${allTokensIncludingZeroSet.size}`);
            // logger.debug(`[Holdings Similarity] Tokens with positive balance: ${allUniqueHeldTokensSet.size}`);
            // logger.debug(`[Holdings Similarity] Tokens with balance >= ${MIN_MEANINGFUL_BALANCE}: ${allTokensWithMeaningfulBalanceSet.size}`);
            // logger.debug(`[Holdings Similarity] Using ${useMeaningfulFiltering ? 'meaningful-balance-filtered' : 'balance-filtered'} tokens: ${allUniqueHeldTokens.length}`);
            // logger.debug(`[Holdings Similarity] Filtered out ${allTokensIncludingZeroSet.size - allUniqueHeldTokens.length} tokens`);

            if (allUniqueHeldTokens.length > 0) {
                // 2. Create Holdings Presence Vectors
                const holdingsPresenceVectors = this.similarityAnalyzer.createHoldingsPresenceVectors(
                    walletBalances, 
                    allUniqueHeldTokens
                );

                const walletsWithHoldingsVectors = walletsWithBalanceData.filter(addr => holdingsPresenceVectors[addr]);
                
                // DEBUG: Log the actual vectors for current holdings
                // logger.info(`[Holdings Debug] Wallets with holdings vectors: ${walletsWithHoldingsVectors.length}`);
                for (const walletAddr of walletsWithHoldingsVectors) {
                    const vector = holdingsPresenceVectors[walletAddr];
                    const tokensHeld = Object.entries(vector).filter(([_, value]) => value === 1).map(([token, _]) => token);
                    
                    // Also log meaningful vs total tokens for debugging
                    const walletBalance = walletBalances.get(walletAddr);
                    const meaningfulTokens = walletBalance?.tokenBalances?.filter(tb => 
                        tokensHeld.includes(tb.mint) && tb.uiBalance >= MIN_MEANINGFUL_BALANCE
                    ).length || 0;
                    
                   //  logger.info(`[Holdings Debug] Wallet ${walletAddr.slice(0,8)}...${walletAddr.slice(-4)}: ${tokensHeld.length} tokens held out of ${allUniqueHeldTokens.length} total (${meaningfulTokens} meaningful)`);
                }

                if (walletsWithHoldingsVectors.length >= 2) {
                    // 3. Calculate Jaccard Similarity on Holdings Presence Vectors (ALL TOKENS - may include spam)
                    finalResult.holdingsPresenceJaccardMatrix = this.calculateGenericSimilarityMatrixInternal(
                        holdingsPresenceVectors,
                        walletsWithHoldingsVectors,
                        this.similarityAnalyzer['calculateJaccardSimilarity']
                    );
                    logger.debug('Calculated Jaccard similarity for current holdings presence (all tokens).');

                    // 4. Calculate Cosine Similarity on Holdings Presence Vectors
                    finalResult.holdingsPresenceCosineMatrix = this.similarityAnalyzer['calculateCosineSimilarityMatrix'](
                        holdingsPresenceVectors, 
                        walletsWithHoldingsVectors
                    );
                    logger.debug('Calculated Cosine similarity for current holdings presence.');
                    
                    // Log the actual similarity values for debugging
                    for (const walletA of walletsWithHoldingsVectors) {
                        for (const walletB of walletsWithHoldingsVectors) {
                            if (walletA < walletB) { // Only log each pair once
                                const similarity = finalResult.holdingsPresenceJaccardMatrix?.[walletA]?.[walletB];
                                const vectorA = holdingsPresenceVectors[walletA];
                                const vectorB = holdingsPresenceVectors[walletB];
                                
                                // Calculate intersection and union manually for debugging
                                let intersection = 0;
                                let union = 0;
                                const allTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
                                for (const token of allTokens) {
                                    const valA = vectorA[token] || 0;
                                    const valB = vectorB[token] || 0;
                                    if (valA === 1 && valB === 1) {
                                        intersection++;
                                        union++;
                                    } else if (valA === 1 || valB === 1) {
                                        union++;
                                    }
                                }
                                
                                // logger.info(`[Holdings Similarity - All Tokens] ${walletA.slice(0,8)}...${walletA.slice(-4)} ↔ ${walletB.slice(0,8)}...${walletB.slice(-4)}: ${(similarity * 100).toFixed(1)}% (${intersection}/${union} tokens)`);
                            }
                        }
                    }
                    
                    // NEW: Calculate FILTERED holdings similarity (only tokens actually traded)
                    try {
                        logger// .debug('[Holdings Filtered] Starting filtered holdings similarity calculation...');
                        
                        // Get tokens that each wallet has actually traded from AnalysisResult table
                        const tradedTokensByWallet = new Map<string, Set<string>>();
                        
                        for (const walletAddr of walletsWithHoldingsVectors) {
                            const analysisResults = await this.databaseService.getAnalysisResults({
                                where: { walletAddress: walletAddr }
                            });
                            
                            // ENHANCED FILTER: Only include tokens where wallet paid fees (actively traded, not just received)
                            const activelyTradedTokens = new Set(
                                analysisResults
                                    .filter(ar => ar.totalFeesPaidInSol > 0) // Only tokens where wallet paid trading fees
                                    .map(ar => ar.tokenAddress)
                            );
                            
                            tradedTokensByWallet.set(walletAddr, activelyTradedTokens);
                            logger.debug(`[Holdings Filtered] Wallet ${walletAddr.slice(0,8)}...${walletAddr.slice(-4)}: ${analysisResults.length} total tokens in DB, ${activelyTradedTokens.size} actively traded (paid fees)`);
                        }
                        
                        // Filter held tokens to only include those that were actually traded
                        const filteredHeldTokensSet = new Set<string>();
                        allUniqueHeldTokens.forEach(token => {
                            // Include token only if at least one wallet both holds it AND has traded it
                            const hasHolderWhoTraded = walletsWithHoldingsVectors.some(walletAddr => {
                                const holdsToken = holdingsPresenceVectors[walletAddr][token] === 1;
                                const tradedToken = tradedTokensByWallet.get(walletAddr)?.has(token) || false;
                                return holdsToken && tradedToken;
                            });
                            
                            if (hasHolderWhoTraded) {
                                filteredHeldTokensSet.add(token);
                            }
                        });
                        
                        const filteredHeldTokens = Array.from(filteredHeldTokensSet).sort();
                        logger.debug(`[Holdings Filtered] Filtered from ${allUniqueHeldTokens.length} to ${filteredHeldTokens.length} tokens (excluding spam/airdrops)`);
                        
                        if (filteredHeldTokens.length > 0) {
                            // Create new vectors with only traded tokens
                            const filteredHoldingsVectors: Record<string, TokenVector> = {};
                            
                            for (const walletAddr of walletsWithHoldingsVectors) {
                                filteredHoldingsVectors[walletAddr] = {};
                                const tradedTokens = tradedTokensByWallet.get(walletAddr);
                                
                                for (const token of filteredHeldTokens) {
                                    const holdsToken = holdingsPresenceVectors[walletAddr][token] === 1;
                                    const tradedToken = tradedTokens?.has(token) || false;
                                    
                                    // Only count as 1 if wallet both holds AND has traded this token
                                    filteredHoldingsVectors[walletAddr][token] = (holdsToken && tradedToken) ? 1 : 0;
                                }
                                
                                const filteredTokensHeld = Object.values(filteredHoldingsVectors[walletAddr]).filter(v => v === 1).length;
                                logger.debug(`[Holdings Filtered] Wallet ${walletAddr.slice(0,8)}...${walletAddr.slice(-4)}: ${filteredTokensHeld} filtered tokens held out of ${filteredHeldTokens.length} total`);
                            }
                            
                            // Calculate similarity on filtered vectors
                            const filteredSimilarityMatrix = this.calculateGenericSimilarityMatrixInternal(
                                filteredHoldingsVectors,
                                walletsWithHoldingsVectors,
                                this.similarityAnalyzer['calculateJaccardSimilarity']
                            );
                            
                            // Store as additional field
                            finalResult['holdingsPresenceFilteredJaccardMatrix'] = filteredSimilarityMatrix;
                            
                            // Log filtered similarity values
                            for (const walletA of walletsWithHoldingsVectors) {
                                for (const walletB of walletsWithHoldingsVectors) {
                                    if (walletA < walletB) {
                                        const filteredSimilarity = filteredSimilarityMatrix?.[walletA]?.[walletB];
                                        const vectorA = filteredHoldingsVectors[walletA];
                                        const vectorB = filteredHoldingsVectors[walletB];
                                        
                                        // Calculate intersection and union for filtered tokens
                                        let intersection = 0;
                                        let union = 0;
                                        const allTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
                                        for (const token of allTokens) {
                                            const valA = vectorA[token] || 0;
                                            const valB = vectorB[token] || 0;
                                            if (valA === 1 && valB === 1) {
                                                intersection++;
                                                union++;
                                            } else if (valA === 1 || valB === 1) {
                                                union++;
                                            }
                                        }
                                        
                                        // logger.info(`[Holdings Similarity - Filtered] ${walletA.slice(0,8)}...${walletA.slice(-4)} ↔ ${walletB.slice(0,8)}...${walletB.slice(-4)}: ${(filteredSimilarity * 100).toFixed(1)}% (${intersection}/${union} actually traded tokens)`);
                                    }
                                }
                            }
                            
                        } else {
                            logger.warn('[Holdings Filtered] No tokens found that are both held and traded. Skipping filtered similarity.');
                        }
                        
                    } catch (error) {
                        logger.error('[Holdings Filtered] Error calculating filtered holdings similarity:', error);
                    }
                    
                } else {
                    logger.warn('Less than 2 wallets have valid holdings presence vectors. Skipping holdings similarity.');
                }
            } else {
                logger.warn('No unique tokens found in current holdings. Skipping holdings similarity.');
            }
        } else {
             logger.warn('Less than 2 wallets have balance data provided. Skipping holdings similarity.');
        }
    } else if (walletBalances && walletBalances.size > 0 && walletBalances.size < 2) {
        logger.warn('Only 1 wallet has balance data; cannot calculate holdings-based similarity.');
    }
    // ---- END NEW Current Holdings Similarity Calculation ----

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

  private calculateJaccardSimilarityMatrix(
    vectors: Record<string, TokenVector>,
    walletAddresses: string[]
  ): Record<string, Record<string, number>> {
    const matrix: Record<string, Record<string, number>> = {};
    
    for (const walletA of walletAddresses) {
        matrix[walletA] = {};
        const vectorA = vectors[walletA];
        
        for (const walletB of walletAddresses) {
            if (walletA === walletB) {
                matrix[walletA][walletB] = 1.0;
            } else {
                const vectorB = vectors[walletB];
                matrix[walletA][walletB] = this.calculateJaccardSimilarityForPair(vectorA, vectorB);
            }
        }
    }
    
    return matrix;
  }
  
  private calculateJaccardSimilarityForPair(vectorA: TokenVector, vectorB: TokenVector): number {
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
}
