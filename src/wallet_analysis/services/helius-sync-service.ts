import { createLogger } from '@/utils/logger';
import { HeliusApiClient } from '@/services/helius-api-client';
import { DatabaseService } from '@/services/database-service';
import { mapHeliusTransactionsToIntermediateRecords } from '@/services/helius-transaction-mapper';
import { HeliusTransaction } from '@/types/helius-api';
import { Prisma } from '@prisma/client';

const logger = createLogger('HeliusSyncService');

// Define options structure for syncing
export interface SyncOptions {
    limit: number;          // Batch size for API fetches
    fetchAll: boolean;       // Attempt to fetch all history (may be limited by API/service)
    skipApi: boolean;        // Skip API calls, rely only on existing DB data (no sync)
    fetchOlder: boolean;     // Ignore wallet state and fetch older transactions
    maxSignatures?: number | null; // Max transactions to fetch/ensure in DB
    smartFetch: boolean;     // Use smart fetch logic (new first, then old up to maxSignatures)
    // Note: timeRange/period is handled by the PnlAnalysisService, not the sync service
}

export class HeliusSyncService {
    private heliusClient: HeliusApiClient;

    constructor(
        private databaseService: DatabaseService,
        heliusApiKey: string // Directly require API key here
    ) {
        if (!heliusApiKey) {
            // Service requires API key to function, unlike script which could skip
            throw new Error('HeliusSyncService requires a valid Helius API key.');
        }
        this.heliusClient = new HeliusApiClient({
            apiKey: heliusApiKey,
            network: 'mainnet', // Assuming mainnet, could be configurable
        });
        logger.info('HeliusSyncService instantiated.');
    }

    /**
     * Synchronizes Helius transaction data for a given wallet with the database.
     * Handles incremental fetching, smart fetching, and saving intermediate records.
     *
     * @param walletAddress The wallet address to synchronize.
     * @param options Sync options controlling fetch behavior.
     * @returns Promise resolving when synchronization is complete or skipped.
     */
    async syncWalletData(walletAddress: string, options: SyncOptions): Promise<void> {
        if (options.skipApi) {
            logger.info(`[Sync] Skipping API fetch for ${walletAddress} (--skipApi).`);
            return;
        }

        logger.info(`[Sync] Starting data synchronization for wallet: ${walletAddress}`);
        logger.debug('[Sync] Options:', options); // Log the sync options

        // Implementation Notes:
        // 1. Get current wallet state (newest/oldest sig/ts) from databaseService.getWallet()
        // 2. Determine fetch parameters (untilSig, untilTs, beforeSig, beforeTs, limit) based on options and state.
        // 3. Implement Smart Fetch logic if options.smartFetch is true:
        //    - Check DB count vs options.maxSignatures.
        //    - Fetch newer transactions first.
        //    - Process/save newer.
        //    - If still needed, fetch older transactions up to the remaining limit.
        //    - Process/save older.
        // 4. Implement Standard Fetch logic otherwise:
        //    - Determine fetch start point based on options.fetchOlder and wallet state.
        //    - Call heliusClient.getAllTransactionsForAddress with appropriate parameters.
        //    - Process/save fetched transactions.
        // 5. Use processAndSaveTransactions helper (extracted below).

        // --- START OF LOGIC TO BE MOVED/ADAPTED FROM helius-analyzer.ts --- 
        
        // Example structure (needs full implementation using helius-analyzer logic)
        try {
            if (options.smartFetch && options.maxSignatures) {
                 await this.executeSmartFetch(walletAddress, options);
            } else {
                 await this.executeStandardFetch(walletAddress, options);
            }
             logger.info(`[Sync] Synchronization complete for wallet: ${walletAddress}`);
        } catch (error) {
             logger.error(`[Sync] Error during synchronization for ${walletAddress}:`, { error });
             // Decide if error should be re-thrown or just logged
             // throw error; // Re-throw if caller needs to handle it
        }
        // --- END OF LOGIC TO BE MOVED/ADAPTED --- 
    }

    // --- Private Helper Methods (Extracted/Adapted from helius-analyzer.ts) ---
    
    private async executeSmartFetch(walletAddress: string, options: SyncOptions): Promise<void> {
        logger.info(`[Sync] Executing SmartFetch for ${walletAddress} with target ${options.maxSignatures} signatures.`);
        // ... (Implement logic from helius-analyzer lines ~184-264) ...
        // Requires careful adaptation to use this.databaseService and this.heliusClient
        // and call this.processAndSaveTransactions
        
         // Placeholder implementation detail:
         const currentCount = await this.getDbTransactionCount(walletAddress); // Need this helper
         if (currentCount >= options.maxSignatures!) {
             logger.info(`[Sync] Database count (${currentCount}) meets target. SmartFetch complete.`);
             return;
         }
         const neededCount = options.maxSignatures! - currentCount;
         logger.info(`[Sync] Need ${neededCount} more transactions.`);

         // 1. Fetch Newer
         const walletState = await this.databaseService.getWallet(walletAddress);
         const stopAtSignature = walletState?.newestProcessedSignature ?? undefined;
         const newestProcessedTimestamp = walletState?.newestProcessedTimestamp ?? undefined;
         
         let newerTransactions: HeliusTransaction[] = [];
         try {
              newerTransactions = await this.heliusClient.getAllTransactionsForAddress(
                 walletAddress, options.limit, null, stopAtSignature, newestProcessedTimestamp, false
             ); 
             logger.info(`[Sync] Fetched ${newerTransactions.length} potentially newer transactions.`);
             if (newerTransactions.length > 0) {
                 await this.processAndSaveTransactions(walletAddress, newerTransactions, true, options);
             }
         } catch (fetchError) {
             logger.error(`[Sync] Failed to fetch newer transactions during SmartFetch:`, { fetchError });
             // Continue to fetch older if needed, maybe log error state?
         }

         // 2. Fetch Older if still needed
         const remainingNeeded = neededCount - newerTransactions.length;
         if (remainingNeeded > 0) {
             logger.info(`[Sync] Still need ${remainingNeeded} older transactions.`);
             const oldestProcessedTimestamp = walletState?.firstProcessedTimestamp ?? undefined;
             try {
                 const olderTransactions = await this.heliusClient.getAllTransactionsForAddress(
                     walletAddress, options.limit, remainingNeeded, undefined, undefined, true, oldestProcessedTimestamp
                 );
                  logger.info(`[Sync] Fetched ${olderTransactions.length} potentially older transactions.`);
                 if (olderTransactions.length > 0) {
                     await this.processAndSaveTransactions(walletAddress, olderTransactions, false, options);
                 }
             } catch (fetchError) {
                 logger.error(`[Sync] Failed to fetch older transactions during SmartFetch:`, { fetchError });
             }
         }
         logger.info(`[Sync] SmartFetch process completed for ${walletAddress}.`);
    }

    private async executeStandardFetch(walletAddress: string, options: SyncOptions): Promise<void> {
        logger.info(`[Sync] Executing Standard Fetch for ${walletAddress}.`);
        // ... (Implement logic from helius-analyzer lines ~267-310) ...
        // Requires careful adaptation

        // Placeholder implementation detail:
        const walletState = await this.databaseService.getWallet(walletAddress);
        let initialFetch = !walletState || options.fetchOlder;
        let stopAtSignature: string | undefined = undefined;
        let newestProcessedTimestamp: number | undefined = undefined;
        
        if (walletState && !options.fetchOlder) {
            stopAtSignature = walletState.newestProcessedSignature ?? undefined;
            newestProcessedTimestamp = walletState.newestProcessedTimestamp ?? undefined;
        } else {
            logger.info(`[Sync] Performing initial fetch or fetchOlder=true.`);
            initialFetch = true;
        }
        
        const includeCached = initialFetch;
        try {
            const transactions = await this.heliusClient.getAllTransactionsForAddress(
                walletAddress, 
                options.limit, 
                options.maxSignatures, 
                stopAtSignature, 
                newestProcessedTimestamp, 
                includeCached
            );
            logger.info(`[Sync] Fetched ${transactions.length} transactions.`);
            if (transactions.length > 0) {
                await this.processAndSaveTransactions(walletAddress, transactions, initialFetch, options);
            }
        } catch (fetchError) {
             logger.error(`[Sync] Failed to fetch transactions during Standard Fetch:`, { fetchError });
             throw fetchError; // Re-throw to signal failure
        }
    }

    /**
     * Helper to process transactions (map, save inputs, update wallet state).
     * Adapted from helius-analyzer.ts
     * Added options parameter.
     */
    private async processAndSaveTransactions(
      walletAddress: string, 
      transactions: HeliusTransaction[], 
      isNewerFetchOrInitial: boolean, 
      options: SyncOptions // Added options parameter
    ): Promise<void> {
      logger.debug(`[Sync] Processing ${transactions.length} transactions...`);
      
      const analysisInputsToSave: Prisma.SwapAnalysisInputCreateInput[] = 
        mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
      
      if (analysisInputsToSave.length > 0) {
        logger.debug(`[Sync] Saving ${analysisInputsToSave.length} analysis input records...`);
        try {
          // Use DatabaseService method
          const saveResult = await this.databaseService.saveSwapAnalysisInputs(analysisInputsToSave);
          logger.info(`[Sync] Successfully saved ${saveResult.count} new analysis input records.`);
        } catch (dbError) {
          logger.error('[Sync] Error saving analysis input records:', dbError);
          // Consider if error should halt sync or just be logged
        }
      } else {
        logger.debug('[Sync] Mapping resulted in 0 analysis input records to save.');
      }

      // Update Wallet State
      if (transactions.length > 0) {
        const latestTx = transactions.reduce((latest, current) => 
            (!latest || current.timestamp > latest.timestamp) ? current : latest, null as HeliusTransaction | null);
        const oldestTx = transactions.reduce((oldest, current) => 
            (!oldest || current.timestamp < oldest.timestamp) ? current : oldest, null as HeliusTransaction | null);

        if (latestTx && oldestTx) {
          const updateData: any = { lastSuccessfulFetchTimestamp: new Date() };
          
          if (isNewerFetchOrInitial && latestTx) {
            updateData.newestProcessedSignature = latestTx.signature;
            updateData.newestProcessedTimestamp = latestTx.timestamp;
          }
          // Update oldest timestamp only if this is first fetch or fetching older data explicitly
          if (!isNewerFetchOrInitial && !options.fetchOlder) {
             // Don't update oldest if it was purely an incremental (newer) fetch
          } else if (oldestTx) {
             updateData.firstProcessedTimestamp = oldestTx.timestamp; 
          }
          
          // Use DatabaseService method
          await this.databaseService.updateWallet(walletAddress, updateData);
          logger.info('[Sync] Wallet state updated.');
        } else {
          logger.warn('[Sync] Failed to find latest/oldest transaction for state update.');
        }
      }
    }

    /** Helper to get DB count (example) */
    private async getDbTransactionCount(walletAddress: string): Promise<number> {
        try {
            const count = await this.databaseService['prismaClient'].swapAnalysisInput.count({
                where: { walletAddress: walletAddress }
            });
            // Alternatively, fetch distinct signatures if that's the definition of count
            // const distinctSigs = await this.databaseService.prismaClient.swapAnalysisInput.findMany({... select: { signature: true }, distinct: ['signature']});
            // return distinctSigs.length;
            return count;
        } catch (error) {
            logger.error(`[Sync] Error getting DB transaction count for ${walletAddress}`, { error });
            return 0;
        }
    }
} 