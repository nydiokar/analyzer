import { createLogger } from 'core/utils/logger';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from 'core/services/database-service';
import { mapHeliusTransactionsToIntermediateRecords } from 'core/services/helius-transaction-mapper';
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
        }, this.databaseService); // Pass DatabaseService instance
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
        logger.info(`[Sync] Executing SmartFetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures in DB.`);
        
        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] SmartFetch called for ${walletAddress} without a valid positive options.maxSignatures. Aborting SmartFetch for this wallet.`);
            return;
        }

        const initialDbCount = await this.getDbTransactionCount(walletAddress);
        if (initialDbCount >= options.maxSignatures) {
            logger.debug(`[Sync] SmartFetch: Database count (${initialDbCount}) already meets or exceeds target ${options.maxSignatures}. SmartFetch complete for ${walletAddress}.`);
            return;
        }
        
        const neededTotalInDb = options.maxSignatures;
        logger.info(`[Sync] SmartFetch: Current DB count for ${walletAddress}: ${initialDbCount}. Target DB count: ${neededTotalInDb}.`);

        const walletState = await this.databaseService.getWallet(walletAddress);
        
        // --- 1. Fetch Newer Transactions ---
        // Fetch transactions newer than what's in the DB, up to the overall maxSignatures limit.
        const stopAtSignatureForNewer = walletState?.newestProcessedSignature ?? undefined;
        const newestProcessedTimestampForNewer = walletState?.newestProcessedTimestamp ?? undefined;
        
        let newerTransactionsFetchedCount = 0;
        logger.info(`[Sync] SmartFetch Phase 1 (Newer): Fetching for ${walletAddress} since sig: ${stopAtSignatureForNewer}, ts: ${newestProcessedTimestampForNewer}. API client call will be capped by ${neededTotalInDb} total signatures.`);
        try {
            // HeliusApiClient's getAllTransactionsForAddress will respect 'neededTotalInDb' as a cap on signatures it processes from RPC.
            // It fetches newest first if stopAtSignatureForNewer/newestProcessedTimestampForNewer are provided.
            const newerTransactions = await this.heliusClient.getAllTransactionsForAddress(
               walletAddress, 
               options.limit, 
               neededTotalInDb, // Pass the overall target as the cap for this API client call
               stopAtSignatureForNewer, 
               newestProcessedTimestampForNewer, 
               true, // <--- MODIFIED: includeCached should be true here
               undefined // untilTimestamp is not for newer
           ); 
           newerTransactionsFetchedCount = newerTransactions.length;
           logger.info(`[Sync] SmartFetch Phase 1 (Newer): Fetched ${newerTransactionsFetchedCount} potentially newer transactions from API for ${walletAddress}.`);
           if (newerTransactionsFetchedCount > 0) {
               await this.processAndSaveTransactions(walletAddress, newerTransactions, true, options); // true for isNewerFetchOrInitial
           }
        } catch (fetchError) {
           logger.error(`[Sync] SmartFetch Phase 1 (Newer): Failed to fetch/process newer transactions for ${walletAddress}:`, { fetchError });
           // Continue to fetch older if needed.
        }

        // --- 2. Fetch Older Transactions if still needed ---
        const countAfterNewerFetch = await this.getDbTransactionCount(walletAddress);
        logger.info(`[Sync] SmartFetch: DB count for ${walletAddress} after fetching newer is ${countAfterNewerFetch}. Target is ${neededTotalInDb}.`);

        const phaseTwoThresholdFactor = 0.75; // Trigger Phase 2 if below 75% of target
        if (countAfterNewerFetch < (neededTotalInDb * phaseTwoThresholdFactor)) {
            const remainingSignaturesToFetchForOlder = neededTotalInDb - countAfterNewerFetch;
            logger.info(`[Sync] SmartFetch Phase 2 (Older): Current count ${countAfterNewerFetch} is less than ${phaseTwoThresholdFactor * 100}% of target ${neededTotalInDb}. Still need ${remainingSignaturesToFetchForOlder} older transactions to reach target.`);
            
            if (remainingSignaturesToFetchForOlder > 0) {
                // Re-fetch wallet state to get the most up-to-date oldestProcessedTimestamp after Phase 1
                const updatedWalletStateAfterPhase1 = await this.databaseService.getWallet(walletAddress);
                const oldestProcessedTimestamp = updatedWalletStateAfterPhase1?.firstProcessedTimestamp ?? undefined;
                
                logger.info(`[Sync] SmartFetch Phase 2 (Older): Attempting to fetch ${remainingSignaturesToFetchForOlder} older transactions for ${walletAddress}, older than ts: ${oldestProcessedTimestamp}.`);
                try {
                    const olderTransactions = await this.heliusClient.getAllTransactionsForAddress(
                        walletAddress, 
                        options.limit, 
                        remainingSignaturesToFetchForOlder, // Cap for this specific fetch pass
                        undefined,                        // stopAtSignature (not relevant for fetching older)
                        undefined,                        // newestProcessedTimestamp (not relevant for fetching older)
                        true,                             // includeCached for older ones.
                        oldestProcessedTimestamp          // Fetch transactions older than this timestamp.
                    );
                    logger.info(`[Sync] SmartFetch Phase 2 (Older): Fetched ${olderTransactions.length} potentially older transactions from API for ${walletAddress}.`);
                    if (olderTransactions.length > 0) {
                        await this.processAndSaveTransactions(walletAddress, olderTransactions, false, options); // false for isNewerFetchOrInitial
                    }
                } catch (fetchError) {
                    logger.error(`[Sync] SmartFetch Phase 2 (Older): Failed to fetch/process older transactions for ${walletAddress}:`, { fetchError });
                }
            } else {
               logger.info(`[Sync] SmartFetch Phase 2 (Older): No more signatures targeted for older fetch for ${walletAddress} (remainingSignaturesToFetchForOlder <= 0).`);
            }
        } else {
           logger.info(`[Sync] SmartFetch: DB count for ${walletAddress} (${countAfterNewerFetch}) meets or exceeds ${phaseTwoThresholdFactor * 100}% of target ${neededTotalInDb}. Skipping Phase 2.`);
        }
        logger.info(`[Sync] SmartFetch process completed for ${walletAddress}.`);
    }

    private async executeStandardFetch(walletAddress: string, options: SyncOptions): Promise<void> {
        logger.info(`[Sync] Executing Standard Fetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures.`);

        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] StandardFetch called for ${walletAddress} without a valid positive options.maxSignatures. Aborting StandardFetch.`);
            return;
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        const isEffectivelyInitialFetch = !walletState || options.fetchOlder;
        
        let stopAtSignatureForStd: string | undefined = undefined;
        let newestProcessedTimestampForStd: number | undefined = undefined;
        let untilTimestampForStd: number | undefined = undefined; 
        
        if (isEffectivelyInitialFetch) {
            logger.info(`[Sync] Standard Fetch (Initial/FetchOlder): Fetching for ${walletAddress} from beginning, up to ${options.maxSignatures} total transactions.`);
            // For initial/fetchOlder, HeliusApiClient will fetch newest first up to options.maxSignatures if no specific start/end timestamps are given.
            // To fetch truly oldest first, specific parameters would be needed for HeliusApiClient.
            // Current HeliusApiClient.getAllTransactionsForAddress defaults to fetching newest if only maxSignatures is provided.
        } else { // Incremental fetch for newer transactions
            logger.info(`[Sync] Standard Fetch (Incremental Newer): Fetching for ${walletAddress}.`);
            stopAtSignatureForStd = walletState!.newestProcessedSignature ?? undefined;
            newestProcessedTimestampForStd = walletState!.newestProcessedTimestamp ?? undefined;
        }
        
        const includeCached = true; // For standard fetch, always include cached results. API client handles de-duplication of fetch.
        
        try {
            logger.info(`[Sync] Standard Fetch: Calling HeliusApiClient for ${walletAddress} with:
                       maxSignatures: ${options.maxSignatures}, 
                       limit (page size): ${options.limit},
                       stopAtSig: ${stopAtSignatureForStd}, 
                       newestTs: ${newestProcessedTimestampForStd}, 
                       includeCached: ${includeCached},
                       untilTs (for older): ${untilTimestampForStd}`);
            
            const transactions = await this.heliusClient.getAllTransactionsForAddress(
                walletAddress, 
                options.limit, 
                options.maxSignatures, 
                stopAtSignatureForStd, 
                newestProcessedTimestampForStd, 
                includeCached,
                untilTimestampForStd 
            );
            logger.info(`[Sync] Standard Fetch: Fetched ${transactions.length} transactions from HeliusApiClient for ${walletAddress}.`);
            if (transactions.length > 0) {
                await this.processAndSaveTransactions(walletAddress, transactions, isEffectivelyInitialFetch, options);
            }
        } catch (fetchError) {
             logger.error(`[Sync] Standard Fetch: Failed to fetch/process transactions for ${walletAddress}:`, { fetchError });
             throw fetchError; 
        }
        logger.info(`[Sync] Standard Fetch process completed for ${walletAddress}.`);
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