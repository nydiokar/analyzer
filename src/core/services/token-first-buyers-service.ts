import { createLogger } from 'core/utils/logger';
import { HeliusApiClient } from './helius-api-client';
import { HeliusTransaction } from '@/types/helius-api';
import { Injectable } from '@nestjs/common';
import { PnlAnalysisService } from './pnl-analysis-service';
import { DatabaseService } from './database-service';
import { SwapAnalysisSummary } from '@/types/helius-api';

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
    topCount: number = 50
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

    // Step 1: Get first buyers
    const firstBuyers = await this.getFirstBuyers(mintAddress, options);
    
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
      logger.info(`Running full PnL analysis for ${missingWallets.length} wallets missing database results...`);
      
      // Process in smaller batches to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < missingWallets.length; i += batchSize) {
        const batch = missingWallets.slice(i, i + batchSize);
        logger.info(`Processing PnL batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingWallets.length / batchSize)}`);
        
        const batchPromises = batch.map(async (walletAddress) => {
          try {
            logger.debug(`🔄 Starting full PnL analysis for ${walletAddress}`);
            await this.pnlAnalysisService!.analyzeWalletPnl(
              walletAddress,
              undefined, // No time range - analyze all time
              { isViewOnly: false } // Save results to database
            );
            logger.debug(`✅ Completed PnL analysis for ${walletAddress}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`❌ Failed PnL analysis for ${walletAddress}: ${errorMessage}`);
          }
        });

        await Promise.all(batchPromises);
        
        // Delay between batches
        if (i + batchSize < missingWallets.length) {
          await new Promise(resolve => setTimeout(resolve, 3000));
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
    const topTradersData: TopTraderResult[] = firstBuyers.map(buyer => {
      const analysisResult = allResults.find(result => result.walletAddress === buyer.walletAddress);
      
      if (analysisResult) {
        const realizedPnl = analysisResult.netSolProfitLoss || 0;
        const totalVolume = (analysisResult.totalSolSpent || 0) + (analysisResult.totalSolReceived || 0);
        const profitableTokensCount = realizedPnl > 0 ? 1 : 0;
        const unprofitableTokensCount = realizedPnl <= 0 ? 1 : 0;
        const tokenWinRate = realizedPnl > 0 ? 100 : 0;

        return {
          ...buyer,
          rank: 0, // Will be set after sorting
          realizedPnl,
          netPnl: realizedPnl,
          totalVolume,
          profitableTokensCount,
          unprofitableTokensCount,
          tokenWinRate,
          analysisSuccess: true
        };
      } else {
        logger.warn(`No analysis result found for wallet ${buyer.walletAddress} on mint ${mintAddress}`);
        return {
          ...buyer,
          rank: 0,
          realizedPnl: 0,
          netPnl: 0,
          totalVolume: 0,
          profitableTokensCount: 0,
          unprofitableTokensCount: 0,
          tokenWinRate: 0,
          analysisSuccess: false,
          errorMessage: 'No analysis result found in database'
        };
      }
    });

    // Step 7: Sort by net PnL and assign ranks
    const sortedTraders = topTradersData
      .filter(trader => trader.analysisSuccess && trader.netPnl !== 0) // Only include traders with actual PnL data
      .sort((a, b) => b.netPnl - a.netPnl)
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
    const result = await this.getTopTradersFromFirstBuyers(mintAddress, options, topCount);
    
    if (outputDir && result.topTraders.length > 0) {
      const fs = await import('fs');
      const path = await import('path');
      
      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const addressTypeSuffix = options.addressType === 'bonding-curve' ? '_bonding_curve' : 
                               options.addressType === 'mint' ? '_mint' : '_auto';

      // Save simple wallet addresses list (space-separated for easy copy-paste)
      const walletListPath = path.join(outputDir, `wallet_addresses_${mintAddress}${addressTypeSuffix}_${timestamp}.txt`);
      fs.writeFileSync(walletListPath, result.walletAddresses.join(' '), 'utf8');

      // Save detailed top traders analysis
      const topTradersPath = path.join(outputDir, `top_traders_${mintAddress}${addressTypeSuffix}_${timestamp}.json`);
      const exportData = {
        metadata: {
          mintAddress,
          analysisTimestamp: new Date().toISOString(),
          addressType: options.addressType || 'auto',
          bondingCurveAddress: options.bondingCurveAddress,
          totalFirstBuyers: result.walletAddresses.length,
          topTradersCount: result.topTraders.length,
          summary: result.summary
        },
        topTraders: result.topTraders.map(trader => ({
          rank: trader.rank,
          walletAddress: trader.walletAddress,
          firstBuyTimestamp: trader.firstBuyTimestamp,
          firstBuyDate: new Date(trader.firstBuyTimestamp * 1000).toISOString(),
          firstBuySignature: trader.firstBuySignature,
          tokenAmount: trader.tokenAmount,
          realizedPnl: trader.realizedPnl,
          netPnl: trader.netPnl,
          totalVolume: trader.totalVolume,
          profitableTokensCount: trader.profitableTokensCount,
          unprofitableTokensCount: trader.unprofitableTokensCount,
          tokenWinRate: trader.tokenWinRate,
          analysisSuccess: trader.analysisSuccess,
          errorMessage: trader.errorMessage
        }))
      };

      fs.writeFileSync(topTradersPath, JSON.stringify(exportData, null, 2), 'utf8');
      
      logger.info(`Wallet addresses saved to: ${walletListPath}`);
      logger.info(`Top traders analysis saved to: ${topTradersPath}`);
    }

    return result;
  }

     /**
    * Efficient PnL calculation for a wallet's trading of a specific token.
    * Uses direct mint-specific queries instead of fetching all wallet transactions.
    */
   private async calculateSimplePnl(walletAddress: string, mintAddress: string): Promise<{
     realizedPnl: number;
     netPnl: number;
     totalVolume: number;
     profitableTokensCount: number;
     unprofitableTokensCount: number;
     tokenWinRate: number;
   }> {
     try {
               // Only validate that wallet address exists
        if (!walletAddress) {
          logger.debug(`No wallet address provided`);
          return {
            realizedPnl: 0,
            netPnl: 0,
            totalVolume: 0,
            profitableTokensCount: 0,
            unprofitableTokensCount: 0,
            tokenWinRate: 0
          };
        }

       // Try to get wallet's own transaction history first (more reliable)
       try {
         const walletSignatures = await this.heliusClient['getSignaturesViaRpcPage'](walletAddress, 200, null);
         
         if (walletSignatures.length === 0) {
           logger.debug(`No transaction history found for wallet: ${walletAddress}`);
           return {
             realizedPnl: 0,
             netPnl: 0,
             totalVolume: 0,
             profitableTokensCount: 0,
             unprofitableTokensCount: 0,
             tokenWinRate: 0
           };
         }

         // Get transaction details for wallet's recent transactions (increased from 50 to 100)
         const transactions = await this.heliusClient['getTransactionsBySignatures'](
           walletSignatures.slice(0, 100).map(s => s.signature)
         );

         let totalSolSpent = 0;
         let totalSolReceived = 0;
         let totalTokensReceived = 0;
         let totalTokensSold = 0;
         let tradeCount = 0;

         for (const tx of transactions) {
           if (!tx || !tx.tokenTransfers) continue;

           // Look for trades involving this specific token
           const tokenTransfers = tx.tokenTransfers.filter(transfer => 
             transfer.mint === mintAddress
           );
           
           for (const transfer of tokenTransfers) {
             if (transfer.toUserAccount === walletAddress && transfer.tokenAmount > 0) {
               // Wallet received tokens (buy)
               totalTokensReceived += transfer.tokenAmount;
               tradeCount++;
               
               // Find corresponding SOL transfer for this specific trade
               const solTransfers = tx.nativeTransfers?.filter(native => 
                 native.fromUserAccount === walletAddress && native.amount > 0
               ) || [];
               
               if (solTransfers.length > 0) {
                 totalSolSpent += solTransfers.reduce((sum, transfer) => sum + transfer.amount / 1e9, 0);
               }
             } else if (transfer.fromUserAccount === walletAddress && transfer.tokenAmount > 0) {
               // Wallet sent tokens (sell)
               totalTokensSold += transfer.tokenAmount;
               
               // Find corresponding SOL transfer for this specific trade
               const solTransfers = tx.nativeTransfers?.filter(native => 
                 native.toUserAccount === walletAddress && native.amount > 0
               ) || [];
               
               if (solTransfers.length > 0) {
                 totalSolReceived += solTransfers.reduce((sum, transfer) => sum + transfer.amount / 1e9, 0);
               }
             }
           }
         }

         const realizedPnl = totalSolReceived - totalSolSpent;
         const totalVolume = totalSolSpent + totalSolReceived;
         
         // Simple metrics
         const profitableTokensCount = realizedPnl > 0 ? 1 : 0;
         const unprofitableTokensCount = realizedPnl < 0 ? 1 : 0;
         const tokenWinRate = profitableTokensCount > 0 ? 100 : 0;

         // Remove debug logging - will be shown in final results

         return {
           realizedPnl,
           netPnl: realizedPnl,
           totalVolume,
           profitableTokensCount,
           unprofitableTokensCount,
           tokenWinRate
         };

       } catch (walletError) {
         // Enhanced error logging to understand what's causing the failures
         const errorMessage = walletError instanceof Error ? walletError.message : String(walletError);
         if (errorMessage.includes('400')) {
           logger.warn(`400 error for wallet ${walletAddress}: ${errorMessage}`);
           logger.warn(`Wallet address length: ${walletAddress.length}, looks like: ${walletAddress.substring(0, 10)}...`);
         } else {
           logger.debug(`Wallet-specific query failed for ${walletAddress}: ${errorMessage}`);
         }
         logger.debug(`Falling back to mint-based approach for ${walletAddress}`);
         
         // EFFICIENT APPROACH: Get transactions where this specific mint was involved
         const signatures = await this.heliusClient['getSignaturesViaRpcPage'](mintAddress, 1000, null);
         
         if (signatures.length === 0) {
           return {
             realizedPnl: 0,
             netPnl: 0,
             totalVolume: 0,
             profitableTokensCount: 0,
             unprofitableTokensCount: 0,
             tokenWinRate: 0
           };
         }

         // Get transaction details for the mint's recent transactions
         const transactions = await this.heliusClient['getTransactionsBySignatures'](
           signatures.slice(0, 200).map(s => s.signature)
         );

         let totalSolSpent = 0;
         let totalSolReceived = 0;
         let totalTokensReceived = 0;
         let totalTokensSold = 0;
         let tradeCount = 0;

         for (const tx of transactions) {
           if (!tx || !tx.tokenTransfers) continue;

           // Look for trades involving this specific token AND our wallet
           const tokenTransfers = tx.tokenTransfers.filter(transfer => 
             transfer.mint === mintAddress && 
             (transfer.toUserAccount === walletAddress || transfer.fromUserAccount === walletAddress)
           );
           
           for (const transfer of tokenTransfers) {
             if (transfer.toUserAccount === walletAddress && transfer.tokenAmount > 0) {
               // Wallet received tokens (buy)
               totalTokensReceived += transfer.tokenAmount;
               tradeCount++;
               
               // Find corresponding SOL transfer for this specific trade
               const solTransfers = tx.nativeTransfers?.filter(native => 
                 native.fromUserAccount === walletAddress && native.amount > 0
               ) || [];
               
               if (solTransfers.length > 0) {
                 totalSolSpent += solTransfers.reduce((sum, transfer) => sum + transfer.amount / 1e9, 0);
               }
             } else if (transfer.fromUserAccount === walletAddress && transfer.tokenAmount > 0) {
               // Wallet sent tokens (sell)
               totalTokensSold += transfer.tokenAmount;
               
               // Find corresponding SOL transfer for this specific trade
               const solTransfers = tx.nativeTransfers?.filter(native => 
                 native.toUserAccount === walletAddress && native.amount > 0
               ) || [];
               
               if (solTransfers.length > 0) {
                 totalSolReceived += solTransfers.reduce((sum, transfer) => sum + transfer.amount / 1e9, 0);
               }
             }
           }
         }

         const realizedPnl = totalSolReceived - totalSolSpent;
         const totalVolume = totalSolSpent + totalSolReceived;
         
         // Simple metrics
         const profitableTokensCount = realizedPnl > 0 ? 1 : 0;
         const unprofitableTokensCount = realizedPnl < 0 ? 1 : 0;
         const tokenWinRate = profitableTokensCount > 0 ? 100 : 0;

         return {
           realizedPnl,
           netPnl: realizedPnl,
           totalVolume,
           profitableTokensCount,
           unprofitableTokensCount,
           tokenWinRate
         };
       }

     } catch (error) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       
       // Handle specific API errors
       if (errorMessage.includes('400')) {
         logger.debug(`Invalid wallet address or API error for ${walletAddress}: ${errorMessage}`);
       } else {
         logger.debug(`Error calculating simple PnL for ${walletAddress}: ${errorMessage}`);
       }
       
       return {
         realizedPnl: 0,
         netPnl: 0,
         totalVolume: 0,
         profitableTokensCount: 0,
         unprofitableTokensCount: 0,
         tokenWinRate: 0
       };
     }
   }
}