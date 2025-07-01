import { createLogger } from 'core/utils/logger';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from '../../api/database/database.service';
import {
    mapHeliusTransactionsToIntermediateRecords,
    MappingResult
} from 'core/services/helius-transaction-mapper';
import { HeliusTransaction } from '@/types/helius-api';
import { Prisma, Wallet } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { HELIUS_CONFIG } from '../../config/constants';

const logger = createLogger('HeliusSyncService');

// Define options structure for syncing
/**
 * Defines the configuration options for synchronizing wallet data.
 * These options control the behavior of the HeliusSyncService when fetching
 * and processing transaction data for a wallet.
 */
export interface SyncOptions {
    /** Batch size for API fetches (number of signatures per Helius API request). */
    limit: number;          
    /** If true, attempts to fetch all available transaction history for the wallet. May be limited by API or service constraints. */
    fetchAll: boolean;       
    /** If true, skips all API calls and relies only on existing data in the database. No new data will be fetched or synced. */
    skipApi: boolean;        
    /** If true, ignores the current wallet state and fetches older transactions than what is already stored. */
    fetchOlder: boolean;     
    /** Optional. Maximum total number of signatures to fetch or ensure exist in the database for the wallet. */
    maxSignatures?: number | null; 
    /** If true, uses a smart fetch logic: fetches newer transactions first, then older ones if the maxSignatures target is not yet met. */
    smartFetch: boolean;     
    // Note: timeRange/period is handled by the PnlAnalysisService, not the sync service
}

/**
 * Service responsible for synchronizing Helius transaction data for wallets.
 * It orchestrates fetching data from the Helius API via HeliusApiClient,
 * processing it using HeliusTransactionMapper, and saving it to the database
 * via DatabaseService. It supports various syncing strategies like incremental,
 * full history, and smart fetching based on SyncOptions.
 */
@Injectable()
export class HeliusSyncService {
    private heliusClient: HeliusApiClient;

    /**
     * Constructs an instance of the HeliusSyncService.
     *
     * @param databaseService Instance of DatabaseService for database interactions.
     * @param heliusApiClient Instance of HeliusApiClient for Helius API interactions.
     * @throws Error if heliusApiClient is not provided.
     */
    constructor(
        private databaseService: DatabaseService,
        heliusApiClient: HeliusApiClient // Changed from heliusApiKey: string
    ) {
        if (!heliusApiClient) {
            // Service requires an API client instance
            throw new Error('HeliusSyncService requires a valid HeliusApiClient instance.');
        }
        this.heliusClient = heliusApiClient; // Use the provided instance
        logger.info('HeliusSyncService instantiated with provided HeliusApiClient.');
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

        // Ensure wallet exists in the DB before starting sync operations
        try {
            await this.databaseService.ensureWalletExists(walletAddress);
            logger.info(`[Sync] Wallet entry ensured for ${walletAddress}. Proceeding with sync.`);
        } catch (error) {
            logger.error(`[Sync] CRITICAL: Could not ensure wallet entry for ${walletAddress}. Aborting sync.`, { error });
            // Depending on desired behavior, you might re-throw or just return to stop sync for this wallet.
            throw error; // Re-throw to make it visible to the caller (e.g., AnalysesController)
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
    
    /**
     * Executes the "Smart Fetch" strategy for synchronizing wallet data.
     * This strategy first fetches newer transactions since the last sync, then, if the
     * `options.maxSignatures` target is not met, it fetches older transactions until
     * the target is reached or no more older transactions are available.
     *
     * @param walletAddress The wallet address to synchronize.
     * @param options Sync options, particularly `maxSignatures` which is crucial for this strategy.
     * @returns A promise that resolves when the smart fetch process is complete.
     */
    private async executeSmartFetch(walletAddress: string, options: SyncOptions): Promise<void> {
        logger.info(`[Sync] Executing SmartFetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures in DB.`);
        
        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] SmartFetch called for ${walletAddress} without a valid positive options.maxSignatures. Proceeding with only fetching newer transactions.`);
            // Allow fetching newer even if maxSignatures is invalid, but log a warning.
            // Older transactions won't be fetched in this case.
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        
        // --- 1. Fetch Newer Transactions (Always attempt this for SmartFetch) ---
        const stopAtSignatureForNewer = walletState?.newestProcessedSignature ?? undefined;
        const newestProcessedTimestampForNewer = walletState?.newestProcessedTimestamp ?? undefined;
        
        let newerTransactionsFetchedCount = 0;
        // Determine a reasonable cap for fetching newer transactions. 
        // If maxSignatures is set, use it. Otherwise, fetch without a hard cap for "newer" phase,
        // relying on Helius default limits or a sensible internal cap in heliusClient if any.
        // For this phase, we primarily want to get anything NEW.
        const capForNewerFetch = options.maxSignatures && options.maxSignatures > 0 ? options.maxSignatures : undefined;

        logger.info(`[Sync] SmartFetch Phase 1 (Newer): Fetching for ${walletAddress} since sig: ${stopAtSignatureForNewer}, ts: ${newestProcessedTimestampForNewer}. API client call will be capped by ${capForNewerFetch ?? 'Helius default/internal cap'}.`);
        try {
            const newerTransactions = await this.heliusClient.getAllTransactionsForAddress(
               walletAddress, 
               options.limit, 
               capForNewerFetch, 
               stopAtSignatureForNewer, 
               newestProcessedTimestampForNewer, 
               true, 
               undefined,
               HELIUS_CONFIG.INTERNAL_CONCURRENCY // Configurable concurrency
           ); 
           newerTransactionsFetchedCount = newerTransactions.length;
           logger.info(`[Sync] SmartFetch Phase 1 (Newer): Fetched ${newerTransactionsFetchedCount} potentially newer transactions from API for ${walletAddress}.`);
           if (newerTransactionsFetchedCount > 0) {
               await this.processAndSaveTransactions(walletAddress, newerTransactions, true, options);
           }
        } catch (fetchError) {
           logger.error(`[Sync] SmartFetch Phase 1 (Newer): Failed to fetch/process newer transactions for ${walletAddress}:`, { fetchError });
           // Decide if we should still attempt to fetch older ones or re-throw. For now, log and continue.
        }

        // --- 2. Fetch Older Transactions if still needed (and if maxSignatures is valid) ---
        if (options.maxSignatures && options.maxSignatures > 0) {
            const countAfterNewerFetch = await this.getDbTransactionCount(walletAddress);
            logger.info(`[Sync] SmartFetch: DB count for ${walletAddress} after fetching newer is ${countAfterNewerFetch}. Target is ${options.maxSignatures}.`);

            if (countAfterNewerFetch < options.maxSignatures) {
                const remainingSignaturesToFetchForOlder = options.maxSignatures - countAfterNewerFetch;
                logger.info(`[Sync] SmartFetch Phase 2 (Older): Current count ${countAfterNewerFetch} is less than target ${options.maxSignatures}. Still need ${remainingSignaturesToFetchForOlder} older transactions.`);
                
                // Re-fetch wallet state to get the most up-to-date oldestProcessedTimestamp after Phase 1
                const updatedWalletStateAfterPhase1 = await this.databaseService.getWallet(walletAddress);
                const oldestProcessedTimestamp = updatedWalletStateAfterPhase1?.firstProcessedTimestamp ?? undefined;
                
                logger.info(`[Sync] SmartFetch Phase 2 (Older): Attempting to fetch ${remainingSignaturesToFetchForOlder} older transactions for ${walletAddress}, older than ts: ${oldestProcessedTimestamp}.`);
                try {
                    const olderTransactions = await this.heliusClient.getAllTransactionsForAddress(
                        walletAddress, 
                        options.limit, 
                        remainingSignaturesToFetchForOlder,
                        undefined,
                        undefined,
                        true, 
                        oldestProcessedTimestamp,
                        HELIUS_CONFIG.INTERNAL_CONCURRENCY // Configurable concurrency
                    );
                    logger.info(`[Sync] SmartFetch Phase 2 (Older): Fetched ${olderTransactions.length} potentially older transactions from API for ${walletAddress}.`);
                    if (olderTransactions.length > 0) {
                        await this.processAndSaveTransactions(walletAddress, olderTransactions, false, options);
                    }
                } catch (fetchError) {
                    logger.error(`[Sync] SmartFetch Phase 2 (Older): Failed to fetch/process older transactions for ${walletAddress}:`, { fetchError });
                }
            } else {
               logger.info(`[Sync] SmartFetch Phase 2 (Older): DB count (${countAfterNewerFetch}) already meets or exceeds target ${options.maxSignatures}. Skipping older fetch for ${walletAddress}.`);
            }
        } else {
            logger.info(`[Sync] SmartFetch: Skipping Phase 2 (Older) because options.maxSignatures is not valid or not set. Only newer transactions were fetched if available.`);
        }
        logger.info(`[Sync] SmartFetch process completed for ${walletAddress}.`);
    }

    /**
     * Executes the "Standard Fetch" strategy for synchronizing wallet data.
     * This strategy fetches transactions based on the current wallet state and options.
     * If `options.fetchOlder` is true or if it's an initial fetch, it attempts to get transactions
     * up to `options.maxSignatures` (typically newest first unless specific cursors are used internally
     * by HeliusApiClient for older data). Otherwise, it performs an incremental fetch for newer transactions
     * since the last sync.
     *
     * @param walletAddress The wallet address to synchronize.
     * @param options Sync options, including `maxSignatures`, `limit`, and `fetchOlder`.
     * @returns A promise that resolves when the standard fetch process is complete.
     * @throws Throws an error if the underlying Helius API client call fails critically.
     */
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
                untilTimestampForStd,
                HELIUS_CONFIG.INTERNAL_CONCURRENCY // Configurable concurrency
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
     * Helper to process transactions: maps them to intermediate records, saves these records,
     * saves mapping activity logs, and updates the wallet's sync state in the database.
     * 
     * @param walletAddress The wallet address for which transactions are being processed.
     * @param transactions An array of HeliusTransaction objects to process.
     * @param isNewerFetchOrInitial A boolean flag indicating if the transactions were fetched as part of a "newer" pass or an initial fetch. This influences how wallet state (e.g., newestProcessedSignature) is updated.
     * @param options The original SyncOptions to ensure context.
     * @returns A promise that resolves when processing and saving are complete.
     */
    private async processAndSaveTransactions(
      walletAddress: string, 
      transactions: HeliusTransaction[], 
      isNewerFetchOrInitial: boolean, 
      options: SyncOptions
    ): Promise<void> {
      logger.info(`[Sync] Processing ${transactions.length} transactions for wallet ${walletAddress}...`);
      
      const mappingResult: MappingResult = mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
      const analysisInputsToSave = mappingResult.analysisInputs;
      const mappingStats = mappingResult.stats;

      if (mappingStats) {
          try {
              await this.databaseService.saveMappingActivityLog(walletAddress, mappingStats);
              logger.info(`[Sync] Successfully saved mapping activity log for ${walletAddress}`);
          } catch (error) {
              logger.error(`[Sync] Failed to save mapping activity log for ${walletAddress}`, { error });
          }
      }

      if (analysisInputsToSave.length === 0) {
        logger.info(`[Sync] No analysis input records to save for ${walletAddress} from this batch.`);
      } else {
        logger.info(`[Sync] Saving ${analysisInputsToSave.length} analysis input records for ${walletAddress}...`);
        await this.databaseService.saveSwapAnalysisInputs(analysisInputsToSave);
        logger.info(`[Sync] Successfully saved ${analysisInputsToSave.length} new analysis input records for ${walletAddress}.`);
      }
    
      if (transactions.length > 0) {
        // Determine actual min and max timestamps from the CURRENT BATCH
        let batchMinTimestamp = Infinity;
        let batchMaxTimestamp = 0;
        let batchNewestSignature = ''; // To store the signature of the newest transaction in the batch
        let batchOldestSignature = ''; // To store the signature of the oldest transaction in the batch

        transactions.forEach(tx => {
            if (tx.timestamp < batchMinTimestamp) {
                batchMinTimestamp = tx.timestamp;
                batchOldestSignature = tx.signature; // Capture oldest sig
            }
            if (tx.timestamp > batchMaxTimestamp) {
                batchMaxTimestamp = tx.timestamp;
                batchNewestSignature = tx.signature; // Capture newest sig
            }
        });
        // If only one transaction, min and max are the same
        if (transactions.length === 1) {
            batchMinTimestamp = transactions[0].timestamp;
            batchMaxTimestamp = transactions[0].timestamp;
            batchOldestSignature = transactions[0].signature;
            batchNewestSignature = transactions[0].signature;
        }

        const updateData: Partial<Omit<Wallet, 'address'>> = { 
            lastSuccessfulFetchTimestamp: new Date() 
        };

        const currentWallet = await this.databaseService.getWallet(walletAddress);

        // Update firstProcessedTimestamp if the current batch's oldest is older than known, or if never set
        if (batchMinTimestamp !== Infinity && 
            (!currentWallet || currentWallet.firstProcessedTimestamp === null || batchMinTimestamp < currentWallet.firstProcessedTimestamp)) {
            updateData.firstProcessedTimestamp = batchMinTimestamp;
            // Potentially update oldestProcessedSignature if your Wallet model has it and it's useful
        }
        
        // Update newestProcessedTimestamp if the current batch's newest is newer than known, or if never set
        // Also update newestProcessedSignature accordingly
        if (batchMaxTimestamp !== 0 &&
            (!currentWallet || currentWallet.newestProcessedTimestamp === null || batchMaxTimestamp > currentWallet.newestProcessedTimestamp)) {
            updateData.newestProcessedTimestamp = batchMaxTimestamp;
            if (batchNewestSignature) { // Ensure we have a signature
                 updateData.newestProcessedSignature = batchNewestSignature;
            }
        }
        // Edge case: if timestamps are equal but signature needs init/update (e.g. reprocessing)
        // Or if only the signature was null but timestamp was already correct.
        else if (batchMaxTimestamp !== 0 && batchNewestSignature && currentWallet && 
                 batchMaxTimestamp === currentWallet.newestProcessedTimestamp && 
                 currentWallet.newestProcessedSignature !== batchNewestSignature) {
             updateData.newestProcessedSignature = batchNewestSignature; // Update if sig differs for same newest timestamp
        }
        // If the timestamp didn't change but the signature was null and now we have one
        else if (batchMaxTimestamp !==0 && batchNewestSignature && currentWallet &&
                batchMaxTimestamp === currentWallet.newestProcessedTimestamp && !currentWallet.newestProcessedSignature) {
            updateData.newestProcessedSignature = batchNewestSignature;
        }

        if (Object.keys(updateData).length > 1) { 
          await this.databaseService.updateWallet(walletAddress, updateData);
          logger.debug(`[Sync] Wallet state updated for ${walletAddress}.`, updateData);
        } else if (Object.keys(updateData).length > 0) {
             await this.databaseService.updateWallet(walletAddress, updateData);
             logger.debug(`[Sync] Wallet lastSuccessfulFetchTimestamp updated for ${walletAddress}.`, updateData);
        }
      } else {
        logger.info(`[Sync] No transactions in this batch to update wallet state for ${walletAddress}.`);
      }
      logger.info(`[Sync] Finished processing batch of ${transactions.length} transactions for ${walletAddress}.`);
    }

    /** Helper to get DB count (example) 
     * Retrieves the count of `SwapAnalysisInput` records for a given wallet address.
     * This is used, for example, in the SmartFetch logic to determine how many more
     * transactions need to be fetched to meet the `maxSignatures` target.
     *
     * @param walletAddress The wallet address for which to count records.
     * @returns A promise that resolves to the number of `SwapAnalysisInput` records, or 0 if an error occurs.
    */
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