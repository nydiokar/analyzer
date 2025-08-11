import { createLogger } from 'core/utils/logger';
import { HeliusApiClient } from './helius-api-client';
import { HeliusTransaction } from '@/types/helius-api';
import { Injectable } from '@nestjs/common';
import { PnlAnalysisService } from './pnl-analysis-service';
import { DatabaseService } from './database-service';
import { SwapAnalysisSummary } from '@/types/helius-api';
import { mapHeliusTransactionsToIntermediateRecords } from './helius-transaction-mapper';

const logger = createLogger('TokenFirstBuyersService');

export interface FirstBuyerResult {
  walletAddress: string;
  firstBuyTimestamp: number;
  firstBuySignature: string;
  tokenAmount: number;
}

export interface TopTraderResult extends FirstBuyerResult {
  rank: number;
  realizedPnl: number;
  netPnl: number;
  totalVolume: number;
  profitableTokensCount: number;
  unprofitableTokensCount: number;
  tokenWinRate: number;
  analysisSuccess: boolean;
  errorMessage?: string;
}

export interface TokenFirstBuyersOptions {
  /** Maximum number of unique first buyers to return */
  maxBuyers?: number;
  /** Maximum signatures to process (safety limit) */
  maxSignatures?: number;
  /** Batch size for processing signatures */
  batchSize?: number;
  /** Skip buyers with tokenAmount below this threshold (applies in top-trader analysis) */
  minTokenAmount?: number;
  /** 
   * Address type to search for transactions:
   * - 'bonding-curve': Search bonding curve address (for pump.fun pre-migration buyers)
   * - 'mint': Search mint address directly (for post-migration or non-pump.fun tokens)
   * - 'auto': Try to detect the right address automatically
   */
  addressType?: 'bonding-curve' | 'mint' | 'auto';
  /** 
   * Custom bonding curve address (for pump.fun tokens).
   * If not provided and addressType is 'bonding-curve', will try to detect automatically.
   */
  bondingCurveAddress?: string;
}

/**
 * Service to fetch the first buyers of a specific token mint.
 * Processes token mint transaction history chronologically to identify
 * the earliest wallets that received the token (indicating purchases).
 */
@Injectable()
export class TokenFirstBuyersService {
  private pnlAnalysisService: PnlAnalysisService | null = null;

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly databaseService?: DatabaseService
  ) {
    // Initialize PnL service only if database service is available
    if (this.databaseService) {
      this.pnlAnalysisService = new PnlAnalysisService(
        this.databaseService,
        this.heliusClient,
        null // tokenInfoService not needed for this use case
      );
    }
  }

  /**
   * Fetches the first buyers of a specific token mint.
   * Processes transactions chronologically from oldest to newest.
   * 
   * IMPORTANT: For pump.fun tokens, use addressType: 'bonding-curve' to get the actual first buyers
   * from the bonding curve period before migration to AMM.
   * 
   * @param mintAddress The token mint address to analyze
   * @param options Configuration options for the fetch operation
   * @returns Array of first buyer information sorted by purchase timestamp
   */
  async getFirstBuyers(
    mintAddress: string,
    options: TokenFirstBuyersOptions = {}
  ): Promise<FirstBuyerResult[]> {
    const {
      maxBuyers = 200,
      maxSignatures = 3000,
      batchSize = 100,
      addressType = 'auto',
      bondingCurveAddress
    } = options;

         logger.info(`Starting first buyers analysis for token mint: ${mintAddress}`);
     logger.debug(`Target: ${maxBuyers} buyers, Max signatures: ${maxSignatures}, Batch size: ${batchSize}`);
     logger.debug(`Address type: ${addressType}`);

    // Step 1: Determine which address to use for fetching signatures
    const fetchAddress = await this.determineFetchAddress(mintAddress, addressType, bondingCurveAddress);
         logger.debug(`Using address for transaction fetch: ${fetchAddress.address} (${fetchAddress.type})`);

    // Step 2: Fetch all signatures for the determined address
    const allSignatures = await this.fetchAllSignaturesForAddress(
      fetchAddress.address, 
      maxSignatures, 
      fetchAddress.type
    );
    
    if (allSignatures.length === 0) {
      logger.warn(`No signatures found for address: ${fetchAddress.address}`);
      return [];
    }

    // Step 2: Reverse to process oldest first (RPC returns newest first)
    const oldestFirst = allSignatures.reverse();
    logger.info(`Processing ${oldestFirst.length} signatures chronologically from oldest to newest`);

    // Step 3: Process signatures in batches to find first buyers
    const uniqueBuyers = new Map<string, FirstBuyerResult>();
    let processedSignatures = 0;

    for (let i = 0; i < oldestFirst.length; i += batchSize) {
      if (uniqueBuyers.size >= maxBuyers) {
        logger.info(`Reached target of ${maxBuyers} unique buyers, stopping processing`);
        break;
      }

      const batch = oldestFirst.slice(i, i + batchSize);
               // Only log every few batches to reduce verbosity
         if (i % (batchSize * 5) === 0) {
           logger.info(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} signatures (${uniqueBuyers.size} buyers found)`);
         }

      try {
        // Fetch transaction details for this batch
        const transactions = await this.heliusClient['getTransactionsBySignatures'](batch);
        processedSignatures += batch.length;

                 // Extract buyers from each transaction
         for (const tx of transactions) {
           if (!tx || !tx.tokenTransfers) continue;

           // Find token transfers where wallets received this specific token
           const tokenReceives = tx.tokenTransfers.filter(transfer => 
             transfer.mint === mintAddress && 
             transfer.toUserAccount && 
             transfer.tokenAmount > 0
           );

           

                      for (const transfer of tokenReceives) {
              const walletAddress = transfer.toUserAccount;
              
                            // Skip bonding curve addresses and other program addresses
               if (walletAddress === bondingCurveAddress || walletAddress === mintAddress) {
                 continue; // Remove excessive logging
               }
              
              // Only skip obvious program addresses (bonding curve and mint itself)
              // Don't filter out valid wallets based on length or patterns
              
              // Remove misleading debug logs that show wallets multiple times
             
             // Only add if this wallet hasn't been seen before (first buy)
             if (!uniqueBuyers.has(walletAddress)) {
               uniqueBuyers.set(walletAddress, {
                 walletAddress,
                 firstBuyTimestamp: tx.timestamp,
                 firstBuySignature: tx.signature,
                 tokenAmount: transfer.tokenAmount
               });

                              // Minimal logging - only first few and milestones
                              if (uniqueBuyers.size <= 3 || uniqueBuyers.size % 100 === 0) {
                                logger.info(`👤 Found buyer #${uniqueBuyers.size}: ${walletAddress}`);
                              }
               
               if (uniqueBuyers.size >= maxBuyers) {
                 logger.info(`Reached target of ${maxBuyers} unique buyers`);
                 break;
               }
             }
           }

          if (uniqueBuyers.size >= maxBuyers) break;
        }

        // Progress logging
        if (processedSignatures % 500 === 0 || i + batchSize >= oldestFirst.length) {
          const progress = Math.round((processedSignatures / oldestFirst.length) * 100);
          logger.info(`Progress: ${progress}% (${processedSignatures}/${oldestFirst.length} signatures) - Found ${uniqueBuyers.size} unique buyers`);
        }

             } catch (error) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         logger.error(`Error processing batch starting at index ${i}: ${errorMessage}`);
         // Continue with next batch instead of failing completely
         continue;
       }
    }

    // Convert to array and sort by timestamp (oldest first)
    const firstBuyers = Array.from(uniqueBuyers.values())
      .sort((a, b) => a.firstBuyTimestamp - b.firstBuyTimestamp);

    logger.info(`Completed analysis for ${mintAddress}:`);
    logger.info(`- Processed ${processedSignatures} signatures`);
    logger.info(`- Found ${firstBuyers.length} unique first buyers`);
    
    if (firstBuyers.length > 0) {
      const firstBuy = new Date(firstBuyers[0].firstBuyTimestamp * 1000);
      const lastBuy = new Date(firstBuyers[firstBuyers.length - 1].firstBuyTimestamp * 1000);
      logger.info(`- Time range: ${firstBuy.toISOString()} to ${lastBuy.toISOString()}`);
    }

    return firstBuyers;
  }



  /**
   * Determines which address to use for fetching transaction signatures.
   * 
   * @param mintAddress The token mint address
   * @param addressType The desired address type
   * @param bondingCurveAddress Optional custom bonding curve address
   * @returns Object with address and type to use for fetching
   */
  private async determineFetchAddress(
    mintAddress: string,
    addressType: 'bonding-curve' | 'mint' | 'auto',
    bondingCurveAddress?: string
  ): Promise<{ address: string; type: string }> {
    switch (addressType) {
      case 'mint':
        logger.info(`📍 Using mint address directly (may miss bonding curve period)`);
        return { address: mintAddress, type: 'mint address' };
        
      case 'bonding-curve':
        if (bondingCurveAddress) {
          logger.info(`📍 Using provided bonding curve address`);
          return { address: bondingCurveAddress, type: 'bonding curve (provided)' };
        } else {
          logger.warn(`⚠️ Bonding curve requested but no address provided. Using mint address.`);
          return { address: mintAddress, type: 'mint address (fallback)' };
        }
        
      case 'auto':
      default:
        // For auto mode, we could try to detect if it's a pump.fun token
        // For now, default to mint address with warning
        logger.warn(`🤖 Auto mode: Using mint address. For pump.fun tokens, specify bonding curve address.`);
        return { address: mintAddress, type: 'mint address (auto)' };
    }
  }

  /**
   * Fetches all transaction signatures for a given address.
   * 
   * @param address The address to fetch signatures from
   * @param maxSignatures Maximum number of signatures to fetch
   * @param addressType Description of the address type for logging
   * @returns Array of signature strings
   */
  private async fetchAllSignaturesForAddress(
    address: string, 
    maxSignatures: number,
    addressType: string
  ): Promise<string[]> {
           logger.debug(`📡 Fetching signatures for ${addressType}: ${address}`);
     logger.debug(`Fetching signatures for address: ${address}, max: ${maxSignatures}`);
     
     const allSignatures: string[] = [];
     let lastSignature: string | null = null;
     const rpcLimit = 1000; // Max per RPC call

     try {
       while (allSignatures.length < maxSignatures) {
         const remainingSignatures = maxSignatures - allSignatures.length;
         const currentLimit = Math.min(rpcLimit, remainingSignatures);

          // Use the private method from HeliusApiClient (we'll access it via bracket notation)
         const signatureInfos = await this.heliusClient['getSignaturesViaRpcPage'](
           address,
           currentLimit,
           lastSignature
         );

         if (signatureInfos.length === 0) {
           break;
         }

         // Extract just the signature strings
         const signatures = signatureInfos.map(info => info.signature);
         allSignatures.push(...signatures);
         
         // Set cursor for next page
         lastSignature = signatureInfos[signatureInfos.length - 1].signature;
         
                   // Only log every 1000 signatures to reduce verbosity
          if (allSignatures.length % 1000 === 0 || signatures.length < currentLimit) {
            logger.debug(`📄 Fetched ${allSignatures.length} signatures so far...`);
          }

         // If we got fewer signatures than requested, we've reached the end
         if (signatureInfos.length < currentLimit) {
           logger.debug('Reached end of available signatures');
           break;
         }
       }

               // Log the time range of signatures we collected
        if (allSignatures.length > 0) {
          logger.debug(`Collected ${allSignatures.length} total signatures for ${addressType}: ${address}`);
         
         // Get first and last signature timestamps for debugging
         try {
           const firstSigInfo = await this.heliusClient['getSignaturesViaRpcPage'](address, 1, null);
           const lastSigInfo = await this.heliusClient['getSignaturesViaRpcPage'](address, 1, allSignatures[allSignatures.length - 1]);
           
                       if (firstSigInfo[0]?.blockTime && lastSigInfo[0]?.blockTime) {
              const firstDate = new Date(firstSigInfo[0].blockTime * 1000);
              const lastDate = new Date(lastSigInfo[0].blockTime * 1000);
              logger.debug(`📅 Time range: ${lastDate.toISOString()} to ${firstDate.toISOString()}`);
            }
         } catch (debugError) {
           logger.debug('Could not fetch timestamp debug info:', debugError);
         }
       }
       
       return allSignatures;

           } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error fetching signatures for ${addressType} ${address}: ${errorMessage}`);
        throw new Error(`Failed to fetch signatures for ${addressType} ${address}: ${errorMessage}`);
      }
   }

  /**
   * Convenience method to get first buyers and save results to a file.
   * Useful for debugging and manual analysis.
   * 
   * @param mintAddress The token mint address
   * @param outputPath Optional file path to save results
   * @param options Fetch options
   */
  async getFirstBuyersAndSave(
    mintAddress: string,
    outputPath?: string,
    options: TokenFirstBuyersOptions = {}
  ): Promise<FirstBuyerResult[]> {
    const firstBuyers = await this.getFirstBuyers(mintAddress, options);
    
    if (outputPath && firstBuyers.length > 0) {
      const fs = await import('fs');
      const path = await import('path');
      
      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Prepare data for export
      const exportData = firstBuyers.map((buyer, index) => ({
        rank: index + 1,
        walletAddress: buyer.walletAddress,
        firstBuyTimestamp: buyer.firstBuyTimestamp,
        firstBuyDate: new Date(buyer.firstBuyTimestamp * 1000).toISOString(),
        firstBuySignature: buyer.firstBuySignature,
        tokenAmount: buyer.tokenAmount
      }));

      // Write to file
      const content = JSON.stringify(exportData, null, 2);
      fs.writeFileSync(outputPath, content, 'utf8');
      
      logger.info(`Results saved to: ${outputPath}`);
    }

    return firstBuyers;
  }

  /**
   * Analyzes the first buyers of a token and ranks them by their trading performance (PnL).
   * This method first fetches the first buyers, then analyzes their trading history to determine
   * who were the most successful traders among the early adopters.
   * 
   * @param mintAddress The token mint address to analyze
   * @param options Configuration options for fetching first buyers
   * @param topCount Maximum number of top traders to return (default: 50)
   * @returns Object containing both the simple wallet list and detailed top traders analysis
   */
  async getTopTradersFromFirstBuyers(
    mintAddress: string,
    options: TokenFirstBuyersOptions = {},
    topCount: number = 50,
    precomputedFirstBuyers?: FirstBuyerResult[]
  ): Promise<{
    walletAddresses: string[];
    topTraders: TopTraderResult[];
    summary: {
      totalAnalyzed: number;
      successfulAnalyses: number;
      failedAnalyses: number;
      averagePnl: number;
      totalVolume: number;
    };
  }> {
    if (!this.pnlAnalysisService || !this.databaseService) {
      throw new Error('PnL analysis service and database service are required for top traders analysis.');
    }

    logger.info(`Starting top traders analysis for token: ${mintAddress}`);

    // Step 1: Get first buyers (reuse if provided to avoid duplicate work)
    let firstBuyers = precomputedFirstBuyers && precomputedFirstBuyers.length > 0
      ? precomputedFirstBuyers
      : await this.getFirstBuyers(mintAddress, options);

    // Optional: filter out small buyers to speed up subsequent analysis
    if (options.minTokenAmount && options.minTokenAmount > 0) {
      const beforeCount = firstBuyers.length;
      firstBuyers = firstBuyers.filter(b => b.tokenAmount >= options.minTokenAmount!);
      const afterCount = firstBuyers.length;
      logger.info(`Filtered first buyers by minTokenAmount=${options.minTokenAmount}. Kept ${afterCount}/${beforeCount}.`);
    }
    
    if (firstBuyers.length === 0) {
      logger.warn('No first buyers found, cannot analyze top traders');
      return {
        walletAddresses: [],
        topTraders: [],
        summary: {
          totalAnalyzed: 0,
          successfulAnalyses: 0,
          failedAnalyses: 0,
          averagePnl: 0,
          totalVolume: 0
        }
      };
    }

    const walletAddresses = firstBuyers.map(buyer => buyer.walletAddress);
    logger.info(`Using database infrastructure for PnL analysis of ${firstBuyers.length} first buyers...`);

    // Step 2: Ensure all wallets exist in database
    logger.info(`Ensuring ${walletAddresses.length} wallets exist in database...`);
    for (const walletAddress of walletAddresses) {
      try {
        await this.databaseService.ensureWalletExists(walletAddress);
      } catch (error) {
        logger.warn(`Failed to ensure wallet exists: ${walletAddress}`, error);
      }
    }

    // Step 3: Check for existing analysis results for this mint
    logger.info(`Checking for existing analysis results for mint ${mintAddress}...`);
    let existingResults: any[] = [];
    try {
      existingResults = await this.databaseService.getAnalysisResults({
        where: {
          walletAddress: { in: walletAddresses },
          tokenAddress: mintAddress
        }
      });
      logger.info(`Found ${existingResults.length} existing analysis results in database`);
    } catch (error) {
      logger.warn(`Error fetching existing analysis results:`, error);
      existingResults = [];
    }

         // Step 4: Run PnL analysis for wallets missing results
     const walletsWithResults = new Set(existingResults.map(r => r.walletAddress));
     const missingWallets = walletAddresses.filter(addr => !walletsWithResults.has(addr));

           if (missingWallets.length > 0) {
        logger.info(`Running proper data pipeline for ${missingWallets.length} wallets missing database results...`);
        
        // Process in smaller batches to avoid overwhelming the system
        const batchSize = 3; // Smaller batch size for transaction fetching
        for (let i = 0; i < missingWallets.length; i += batchSize) {
          const batch = missingWallets.slice(i, i + batchSize);
          logger.info(`Processing data pipeline batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingWallets.length / batchSize)}`);
          
          const batchPromises = batch.map(async (walletAddress) => {
            try {
              logger.debug(`🔄 Starting data pipeline for ${walletAddress}`);
              
              // Step 1: Fetch and save transactions using Helius method
              const transactionsSaved = await this.fetchAndSaveWalletTransactions(walletAddress, mintAddress);
              
              if (transactionsSaved > 0) {
                logger.debug(`✅ Saved ${transactionsSaved} transactions for ${walletAddress}, now analyzing PnL`);
                
                // Step 2: Now analyze PnL using the saved transaction data
                // NOTE: We intentionally skip live balance fetching here to speed up bulk analysis.
                // This yields realized PnL and volume from stored transactions only.
                // Unrealized PnL for this specific mint will be added later as an optional step
                // by fetching current mint balances for top wallets and combining with price data.
                await this.pnlAnalysisService!.analyzeWalletPnl(
                  walletAddress,
                  undefined, // No time range - analyze all time
                  { isViewOnly: false, skipBalanceFetch: true } // Save results to database, skip live balance fetch for speed
                );
                logger.debug(`✅ Completed PnL analysis for ${walletAddress}`);
              } else {
                logger.warn(`⚠️ No transactions found for ${walletAddress}, skipping PnL analysis`);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.warn(`❌ Failed data pipeline for ${walletAddress}: ${errorMessage}`);
            }
          });

          await Promise.all(batchPromises);
          
          // Delay between batches
          if (i + batchSize < missingWallets.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

    // Step 5: Fetch all analysis results for the mint from database
    logger.info(`Fetching all analysis results for mint ${mintAddress} from database...`);
    let allResults: any[] = [];
    try {
      allResults = await this.databaseService.getAnalysisResults({
        where: {
          walletAddress: { in: walletAddresses },
          tokenAddress: mintAddress
        }
      });
      logger.info(`Retrieved ${allResults.length} total analysis results from database`);
    } catch (error) {
      logger.error(`Error fetching analysis results from database:`, error);
      allResults = [];
    }

         // Step 6: Convert database results to TopTraderResult format
     const topTradersData: TopTraderResult[] = [];
     
     for (const buyer of firstBuyers) {
       const analysisResult = allResults.find(result => result.walletAddress === buyer.walletAddress);
       
       if (analysisResult) {
         // Use database result if available
         const realizedPnl = analysisResult.netSolProfitLoss || 0;
         const totalVolume = (analysisResult.totalSolSpent || 0) + (analysisResult.totalSolReceived || 0);
         const profitableTokensCount = realizedPnl > 0 ? 1 : 0;
         const unprofitableTokensCount = realizedPnl <= 0 ? 1 : 0;
         const tokenWinRate = realizedPnl > 0 ? 100 : 0;

         topTradersData.push({
           ...buyer,
           rank: 0, // Will be set after sorting
           realizedPnl,
           netPnl: realizedPnl,
           totalVolume,
           profitableTokensCount,
           unprofitableTokensCount,
           tokenWinRate,
           analysisSuccess: true
         });
               } else {
          logger.warn(`No analysis result found for wallet ${buyer.walletAddress} on mint ${mintAddress}`);
          
                     // No fallback - if database analysis fails, skip this wallet
           topTradersData.push({
             ...buyer,
             rank: 0,
             realizedPnl: 0,
             netPnl: 0,
             totalVolume: 0,
             profitableTokensCount: 0,
             unprofitableTokensCount: 0,
             tokenWinRate: 0,
             analysisSuccess: false,
             errorMessage: 'No transaction data found for this wallet and mint'
           });
        }
     }

         // Step 7: Sort by token amount (descending) and assign ranks
     const sortedTraders = topTradersData
       .filter(trader => trader.analysisSuccess) // Include all successful analyses
       .sort((a, b) => b.tokenAmount - a.tokenAmount) // Sort by token amount descending
       .slice(0, topCount)
       .map((trader, index) => ({
         ...trader,
         rank: index + 1
       }));

    const successfulAnalyses = topTradersData.filter(t => t.analysisSuccess).length;
    const failedAnalyses = topTradersData.length - successfulAnalyses;
    const totalPnl = sortedTraders.reduce((sum, trader) => sum + trader.netPnl, 0);
    const totalVolume = sortedTraders.reduce((sum, trader) => sum + trader.totalVolume, 0);
    const averagePnl = sortedTraders.length > 0 ? totalPnl / sortedTraders.length : 0;

    logger.info(`Top traders analysis completed for ${mintAddress}:`);
    logger.info(`- Analyzed ${topTradersData.length} wallets`);
    logger.info(`- Successful analyses: ${successfulAnalyses}`);
    logger.info(`- Failed analyses: ${failedAnalyses}`);
    logger.info(`- Average PnL: ${averagePnl.toFixed(4)} SOL`);
    logger.info(`- Top ${sortedTraders.length} traders identified`);

    return {
      walletAddresses: sortedTraders.map(trader => trader.walletAddress), // Only return TOP traders
      topTraders: sortedTraders,
      summary: {
        totalAnalyzed: topTradersData.length,
        successfulAnalyses,
        failedAnalyses,
        averagePnl,
        totalVolume
      }
    };
  }

  /**
   * Convenience method to get top traders and save results to files.
   * Saves both a simple wallet list and detailed analysis results.
   * 
   * @param mintAddress The token mint address
   * @param outputDir Directory to save results (optional)
   * @param options Fetch options
   * @param topCount Number of top traders to return
   */
  async getTopTradersAndSave(
    mintAddress: string,
    outputDir?: string,
    options: TokenFirstBuyersOptions = {},
    topCount: number = 50
  ): Promise<{
    walletAddresses: string[];
    topTraders: TopTraderResult[];
    summary: any;
  }> {
    // Get ALL first buyers once for both TXT export and top-traders computation
    const allFirstBuyers = await this.getFirstBuyers(mintAddress, options);
    
    // Get top traders analysis
    const result = await this.getTopTradersFromFirstBuyers(mintAddress, options, topCount, allFirstBuyers);
    
    if (outputDir && allFirstBuyers.length > 0) {
      const fs = await import('fs');
      const path = await import('path');
      
      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const addressTypeSuffix = options.addressType === 'bonding-curve' ? '_bonding_curve' : 
                               options.addressType === 'mint' ? '_mint' : '_auto';

      // Save ALL first buyers wallet addresses list (space-separated for easy copy-paste)
      const walletListPath = path.join(outputDir, `wallet_addresses_${mintAddress}${addressTypeSuffix}_${timestamp}.txt`);
      const allWalletAddresses = allFirstBuyers.map(buyer => buyer.walletAddress);
      fs.writeFileSync(walletListPath, allWalletAddresses.join(' '), 'utf8');

      // Save detailed top traders analysis as CSV
      const topTradersPath = path.join(outputDir, `top_traders_${mintAddress}${addressTypeSuffix}_${timestamp}.csv`);
      
      // Create CSV content with only the requested columns
      const csvHeader = 'wallet_address,first_buy_timestamp,token_amount,realized_pnl,total_volume\n';
      const csvRows = result.topTraders.map(trader => 
        `${trader.walletAddress},${trader.firstBuyTimestamp},${trader.tokenAmount},${trader.realizedPnl},${trader.totalVolume}`
      ).join('\n');
      
      const csvContent = csvHeader + csvRows;
      fs.writeFileSync(topTradersPath, csvContent, 'utf8');
      
      // Save a human-friendly Markdown report
      const mdPath = path.join(outputDir, `top_traders_${mintAddress}${addressTypeSuffix}_${timestamp}.md`);
      const fmt = (n: number, maxFrac: number = 3): string => {
        if (!Number.isFinite(n)) return '0';
        return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
      };
      const fmtInt = (n: number): string => {
        if (!Number.isFinite(n)) return '0';
        return Math.round(n).toLocaleString('en-US');
      };
      const fmtDate = (ts: number): string => new Date(ts * 1000).toISOString().replace('T', ' ').replace('Z', ' UTC');

      const winners = [...result.topTraders].sort((a, b) => b.netPnl - a.netPnl).slice(0, Math.min(20, result.topTraders.length));
      const losers = [...result.topTraders].sort((a, b) => a.netPnl - b.netPnl).slice(0, Math.min(20, result.topTraders.length));
      const outliers = [...result.topTraders]
        .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl))
        .slice(0, Math.min(5, result.topTraders.length));

      const table = (rows: typeof winners) => {
        const header = '| Rank | Wallet | First Buy (UTC) | Tokens | Realized PnL (SOL) | Volume (SOL) |\n|---:|---|---:|---:|---:|---:|';
        const body = rows.map(t => `| ${t.rank} | ${t.walletAddress} | ${fmtDate(t.firstBuyTimestamp)} | ${fmtInt(t.tokenAmount)} | ${fmt(t.realizedPnl, 3)} | ${fmt(t.totalVolume, 2)} |`).join('\n');
        return `${header}\n${body}`;
      };

      const md = [
        `## Top Traders Report for ${mintAddress}${addressTypeSuffix}`,
        '',
        `- Generated: ${new Date().toISOString()}`,
        `- Total analyzed: ${result.summary.totalAnalyzed}`,
        `- Successful analyses: ${result.summary.successfulAnalyses}`,
        `- Failed analyses: ${result.summary.failedAnalyses}`,
        `- Average PnL (SOL): ${fmt(result.summary.averagePnl, 3)}`,
        `- Total Volume (SOL): ${fmt(result.summary.totalVolume, 2)}`,
        '',
        '### Top Winners (by realized/net PnL) — Top 20',
        table(winners),
        '',
        '### Top Losers (by realized/net PnL) — Top 20',
        table(losers),
        '',
        '### Outliers (largest |PnL|)',
        table(outliers),
      ].join('\n');

      fs.writeFileSync(mdPath, md, 'utf8');
      
      logger.info(`All ${allFirstBuyers.length} first buyer wallet addresses saved to: ${walletListPath}`);
      logger.info(`Top ${result.topTraders.length} traders analysis saved to CSV: ${topTradersPath}`);
      logger.info(`Human-friendly Markdown report saved to: ${mdPath}`);
    }

    return result;
  }

  /**
   * Fetches and saves transactions for a specific wallet and mint using the Helius method.
   * This is the proper data pipeline: get token accounts → fetch transactions → save to database.
   * 
   * @param walletAddress The wallet address to fetch transactions for
   * @param mintAddress The specific mint address to filter transactions
   * @returns Number of transactions saved to database
   */
  private async fetchAndSaveWalletTransactions(
    walletAddress: string, 
    mintAddress: string
  ): Promise<number> {
    if (!this.databaseService) {
      logger.warn('Database service not available, cannot save transactions');
      return 0;
    }

    try {
      logger.debug(`🔄 Fetching token accounts for wallet ${walletAddress} and mint ${mintAddress}`);
      
                   // Step 1: Get token accounts for this wallet and specific mint
      const tokenAccountsResult = await this.heliusClient.getTokenAccountsByOwner(
        walletAddress,
        mintAddress, // Filter by specific mint (this will create { mint: mintAddress } filter)
        // programId: Uses default SPL Token Program ID
        // commitment: Uses default
        'jsonParsed' // encoding for structured data
      );

      if (!tokenAccountsResult.value || tokenAccountsResult.value.length === 0) {
        logger.debug(`No token accounts found for wallet ${walletAddress} and mint ${mintAddress}`);
        return 0;
      }

      logger.debug(`Found ${tokenAccountsResult.value.length} token accounts for wallet ${walletAddress}`);

             // Step 2: Fetch transactions for all token accounts in batches
       const allTransactions: HeliusTransaction[] = [];
       const allSignatures: string[] = [];
       
       // First, collect all signatures from all token accounts
       for (const tokenAccount of tokenAccountsResult.value) {
         const tokenAccountAddress = tokenAccount.pubkey;
         
         try {
           logger.debug(`📡 Fetching signatures for token account ${tokenAccountAddress}`);
           
           // Get signatures for this token account (max 1000 per call)
           const signatures = await this.heliusClient['getSignaturesViaRpcPage'](
             tokenAccountAddress,
             1000, // Max limit
             null
           );

           if (signatures.length > 0) {
             allSignatures.push(...signatures.map(s => s.signature));
             logger.debug(`📄 Collected ${signatures.length} signatures from token account ${tokenAccountAddress}`);
           }
         } catch (error) {
           const errorMessage = error instanceof Error ? error.message : String(error);
           logger.warn(`Failed to fetch signatures for token account ${tokenAccountAddress}: ${errorMessage}`);
           // Continue with other token accounts
         }
       }

       // Step 3: Fetch all transactions in batches (more efficient)
       if (allSignatures.length > 0) {
         logger.debug(`🔄 Fetching ${allSignatures.length} total signatures in batches`);
         
         // Process signatures in batches of 100 (Helius recommended batch size)
         const batchSize = 100;
         for (let i = 0; i < allSignatures.length; i += batchSize) {
           const batch = allSignatures.slice(i, i + batchSize);
           
           try {
             const transactions = await this.heliusClient['getTransactionsBySignatures'](batch);
             allTransactions.push(...transactions);
             logger.debug(`📄 Fetched ${transactions.length} transactions for batch ${Math.floor(i / batchSize) + 1}`);
           } catch (error) {
             const errorMessage = error instanceof Error ? error.message : String(error);
             logger.warn(`Failed to fetch transactions for batch ${Math.floor(i / batchSize) + 1}: ${errorMessage}`);
             // Continue with next batch
           }
         }
       }

      if (allTransactions.length === 0) {
        logger.debug(`No transactions found for wallet ${walletAddress} and mint ${mintAddress}`);
        return 0;
      }

             logger.debug(`💾 Processing ${allTransactions.length} total transactions for database storage`);

       // Step 4: Map transactions to analysis inputs and save to database
      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(walletAddress, allTransactions);
      
      if (analysisInputs.length > 0) {
        await this.databaseService.saveSwapAnalysisInputs(analysisInputs);
        logger.debug(`✅ Successfully saved ${analysisInputs.length} analysis inputs to database for ${walletAddress}`);
        return analysisInputs.length;
      } else {
        logger.debug(`ℹ️ No analysis inputs to save for wallet ${walletAddress}`);
        return 0;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Failed to fetch and save transactions for ${walletAddress}: ${errorMessage}`);
      return 0;
    }
  }

     
}