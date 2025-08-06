import { createLogger } from 'core/utils/logger';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from '../../api/services/database.service';
import {
    mapHeliusTransactionsToIntermediateRecords,
    MappingResult
} from 'core/services/helius-transaction-mapper';
import { HeliusTransaction } from '@/types/helius-api';
import { Prisma, Wallet } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { HELIUS_CONFIG } from '../../config/constants';
import { SmartFetchService } from './smart-fetch-service';

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
    onProgress?: (progress: number, details?: string) => void;     
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

    private smartFetchService: SmartFetchService;
    
    // ✅ ADD: Accumulated mapping stats for streaming operations
    private accumulatedMappingStats: Map<string, any> | null = null;
    
    // ✅ ADD: Transaction counters for better logging
    private walletTransactionCounters: Map<string, number> = new Map();

    /**
     * Constructs an instance of the HeliusSyncService.
     *
     * @param databaseService Instance of DatabaseService for database interactions.
     * @param heliusApiClient Instance of HeliusApiClient for Helius API interactions.
     * @param smartFetchService Optional SmartFetchService. If not provided, creates new instance.
     * @throws Error if heliusApiClient is not provided.
     */
    constructor(
        private databaseService: DatabaseService,
        heliusApiClient: HeliusApiClient, // Changed from heliusApiKey: string
        smartFetchService?: SmartFetchService
    ) {
        if (!heliusApiClient) {
            // Service requires an API client instance
            throw new Error('HeliusSyncService requires a valid HeliusApiClient instance.');
        }
        this.heliusClient = heliusApiClient; // Use the provided instance
        this.smartFetchService = smartFetchService || new SmartFetchService();
        logger.info('HeliusSyncService instantiated with provided HeliusApiClient and SmartFetchService.');
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
            logger.debug(`[Sync] Skipping API fetch for ${walletAddress} (--skipApi).`);
            return;
        }

        // Early check: Skip wallets already marked as INVALID to avoid wasting resources
        try {
            const existingWallet = await this.databaseService.getWallet(walletAddress);
            if (existingWallet?.classification === 'INVALID') {
                logger.debug(`[Sync] Skipping sync for ${walletAddress} - already marked as INVALID`);
                return;
            }
        } catch (error) {
            // If we can't check, proceed with normal flow
            logger.warn(`[Sync] Could not check wallet classification for ${walletAddress}, proceeding:`, error);
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

        logger.debug(`[Sync] Starting data synchronization for wallet: ${walletAddress}`);
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

        // ✅ SMART FETCH LIMITING DISABLED - Fetch full maxSignatures without limiting
        let adjustedOptions = { ...options };
        // 🚫 DISABLED: SmartFetchService limiting logic
        // This was preventing full transaction fetching by reducing maxSignatures
        // from 5000 → 1000-3000 for "bot-like" wallets
        /*
        try {
            const fetchRecommendation = await this.smartFetchService.getSmartFetchRecommendation(walletAddress);
            
            if (fetchRecommendation.shouldLimitFetch) {
                // Override maxSignatures to prevent constant 10k+ fetches
                const originalMax = adjustedOptions.maxSignatures;
                adjustedOptions.maxSignatures = fetchRecommendation.maxSignatures;
                
                logger.info(`🚨 [SmartFetch] Limiting fetch for ${walletAddress}: ${originalMax} → ${fetchRecommendation.maxSignatures} signatures`);
                logger.info(`📊 [SmartFetch] Reason: ${fetchRecommendation.reason}`);
                
                // Update wallet classification
                await this.smartFetchService.updateWalletClassificationIfNeeded(walletAddress);
            } else {
                logger.debug(`✅ [SmartFetch] Normal fetch recommended for ${walletAddress}: ${fetchRecommendation.reason}`);
            }
        } catch (error) {
            logger.warn(`[SmartFetch] Failed to get smart fetch recommendation for ${walletAddress}, using original options:`, error);
            // Continue with original options if smart fetch fails
        }
        */

        // Execute sync with (potentially adjusted) options
        try {
            if (adjustedOptions.smartFetch && adjustedOptions.maxSignatures) {
                 await this.executeSmartFetch(walletAddress, adjustedOptions);
            } else {
                 await this.executeStandardFetch(walletAddress, adjustedOptions);
            }
             logger.debug(`[Sync] Synchronization complete for wallet: ${walletAddress}`);
        } catch (error) {
             logger.error(`[Sync] Error during synchronization for ${walletAddress}:`, { error });
             // Decide if error should be re-thrown or just logged
             // throw error; // Re-throw if caller needs to handle it
        }
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
        logger.debug(`[Sync] Executing SmartFetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures in DB.`);
        
        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] SmartFetch called for ${walletAddress} without a valid positive options.maxSignatures. Proceeding with only fetching newer transactions.`);
            // Allow fetching newer even if maxSignatures is invalid, but log a warning.
            // Older transactions won't be fetched in this case.
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        
        // --- 1. Fetch Newer Transactions (Always attempt this for SmartFetch) ---
        const stopAtSignatureForNewer = walletState?.newestProcessedSignature ?? undefined;
        const newestProcessedTimestampForNewer = walletState?.newestProcessedTimestamp ?? undefined;

        // Determine a reasonable cap for fetching newer transactions. 
        // If maxSignatures is set, use it. Otherwise, fetch without a hard cap for "newer" phase,
        // relying on Helius default limits or a sensible internal cap in heliusClient if any.
        // For this phase, we primarily want to get anything NEW.
        const capForNewerFetch = options.maxSignatures && options.maxSignatures > 0 ? options.maxSignatures : undefined;

        logger.debug(`[Sync] SmartFetch Phase 1 (Newer): Fetching for ${walletAddress} since sig: ${stopAtSignatureForNewer}, ts: ${newestProcessedTimestampForNewer}. API client call will be capped by ${capForNewerFetch ?? 'Helius default/internal cap'}.`);
        options.onProgress?.(10, 'Fetching newer transactions...');
        try {
            // ✅ STREAM PROCESSING: Process batches as they arrive
            let newerTransactionsFetchedCount = 0;
            const newerTransactions = await this.heliusClient.getAllTransactionsForAddress(
               walletAddress, 
               options.limit, 
               capForNewerFetch, 
               stopAtSignatureForNewer, 
               newestProcessedTimestampForNewer, 
               undefined,
               HELIUS_CONFIG.INTERNAL_CONCURRENCY,
               (progress) => options.onProgress?.(10 + (progress * 0.4), 'Fetching newer transactions...'),
               // ✅ NEW: Stream callback - process immediately
               async (batch: HeliusTransaction[]) => {
                   await this.processAndSaveTransactions(walletAddress, batch, true, options);
                   newerTransactionsFetchedCount += batch.length;
                   const currentCount = this.walletTransactionCounters.get(walletAddress) || 0;
                   // ✅ INCREMENTAL PROGRESS: Show fetched vs processed
                   if (currentCount % 500 === 0 || currentCount <= 200) {
                       logger.debug(`[Sync] Phase 1 progress: ${newerTransactionsFetchedCount} txs fetched → ${currentCount} processed & saved for ${walletAddress}`);
                   }
               }
           );
           newerTransactionsFetchedCount = newerTransactionsFetchedCount || newerTransactions.length;
           const finalNewerCount = this.walletTransactionCounters.get(walletAddress) || 0;
           logger.info(`[Sync] SmartFetch Phase 1 (Newer): ✅ Completed processing ${newerTransactionsFetchedCount} newer transactions for ${walletAddress}.`);
           options.onProgress?.(50, 'Newer transactions processed...');
        } catch (fetchError) {
           // Check if this is a WrongSize error - mark wallet as invalid and stop processing
           if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
               logger.warn(`[Sync] WrongSize error detected for ${walletAddress}. Marking wallet as invalid.`);
               try {
                   await this.databaseService.updateWallet(walletAddress, { 
                       classification: 'INVALID'
                   });
               } catch (updateError) {
                   logger.error(`[Sync] Failed to mark wallet ${walletAddress} as invalid:`, { updateError });
               }
               throw fetchError; // Re-throw to stop further processing
           }
            logger.error(`[Sync] SmartFetch Phase 1 (Newer): Failed to fetch/process newer transactions for ${walletAddress}:`, { fetchError });
            // Decide if we should still attempt to fetch older ones or re-throw. For now, log and continue.
        }

        // --- 2. Fetch Older Transactions if still needed (and if maxSignatures is valid) ---
        if (options.maxSignatures && options.maxSignatures > 0) {
            const countAfterNewerFetch = await this.getDbTransactionCount(walletAddress);
            logger.debug(`[Sync] SmartFetch: DB count for ${walletAddress} after fetching newer is ${countAfterNewerFetch}. Target is ${options.maxSignatures}.`);

            if (countAfterNewerFetch < options.maxSignatures) {
                const remainingSignaturesToFetchForOlder = options.maxSignatures - countAfterNewerFetch;
                logger.debug(`[Sync] SmartFetch Phase 2 (Older): Current count ${countAfterNewerFetch} is less than target ${options.maxSignatures}. Still need ${remainingSignaturesToFetchForOlder} older transactions.`);
                
                // Re-fetch wallet state to get the most up-to-date oldestProcessedTimestamp after Phase 1
                const updatedWalletStateAfterPhase1 = await this.databaseService.getWallet(walletAddress);
                const oldestProcessedTimestamp = updatedWalletStateAfterPhase1?.firstProcessedTimestamp ?? undefined;
                
                logger.debug(`[Sync] SmartFetch Phase 2 (Older): Attempting to fetch ${remainingSignaturesToFetchForOlder} older transactions for ${walletAddress}, older than ts: ${oldestProcessedTimestamp}.`);
                options.onProgress?.(55, 'Fetching older transactions...');
                try {
                    // ✅ STREAM PROCESSING: Process older transactions as they arrive
                    let totalOlderProcessedCount = 0;
                    const olderTransactions = await this.heliusClient.getAllTransactionsForAddress(
                        walletAddress, 
                        options.limit, 
                        remainingSignaturesToFetchForOlder,
                        undefined,
                        undefined,
                        oldestProcessedTimestamp,
                        HELIUS_CONFIG.INTERNAL_CONCURRENCY,
                        (progress) => options.onProgress?.(55 + (progress * 0.4), 'Fetching older transactions...'),
                        // ✅ NEW: Stream callback for older transactions
                        async (batch: HeliusTransaction[]) => {
                            await this.processAndSaveTransactions(walletAddress, batch, false, options);
                            totalOlderProcessedCount += batch.length;
                            const currentCount = this.walletTransactionCounters.get(walletAddress) || 0;
                            // ✅ INCREMENTAL PROGRESS: Show older transactions progress
                            if (currentCount % 500 === 0) {
                                logger.debug(`[Sync] Phase 2 progress: ${totalOlderProcessedCount} older txs fetched → ${currentCount} total processed & saved for ${walletAddress}`);
                            }
                        }
                    );
                    totalOlderProcessedCount = totalOlderProcessedCount || olderTransactions.length;
                    const finalTotalCount = this.walletTransactionCounters.get(walletAddress) || 0;
                    logger.info(`[Sync] SmartFetch Phase 2 (Older): ✅ Completed processing ${totalOlderProcessedCount} older transactions for ${walletAddress}. Total: ${finalTotalCount} transactions.`);
                    options.onProgress?.(95, 'Older transactions processed...');
                } catch (fetchError) {
                    // Check if this is a WrongSize error - mark wallet as invalid and stop processing
                    if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
                        logger.warn(`[Sync] WrongSize error detected for ${walletAddress} in Phase 2. Marking wallet as invalid.`);
                        try {
                            await this.databaseService.updateWallet(walletAddress, { 
                                classification: 'INVALID'
                            });
                        } catch (updateError) {
                            logger.error(`[Sync] Failed to mark wallet ${walletAddress} as invalid:`, { updateError });
                        }
                        throw fetchError; // Re-throw to stop further processing
                    }
                    logger.error(`[Sync] SmartFetch Phase 2 (Older): Failed to fetch/process older transactions for ${walletAddress}:`, { fetchError });
                }
            } else {
               logger.debug(`[Sync] SmartFetch Phase 2 (Older): DB count (${countAfterNewerFetch}) already meets or exceeds target ${options.maxSignatures}. Skipping older fetch for ${walletAddress}.`);
            }
        } else {
            logger.debug(`[Sync] SmartFetch: Skipping Phase 2 (Older) because options.maxSignatures is not valid or not set. Only newer transactions were fetched if available.`);
        }
        // ✅ SAVE ACCUMULATED MAPPING STATS AT THE END
        if (this.accumulatedMappingStats && this.accumulatedMappingStats.has(walletAddress)) {
            try {
                const finalStats = this.accumulatedMappingStats.get(walletAddress);
                await this.databaseService.saveMappingActivityLog(walletAddress, finalStats);
                logger.debug(`[Sync] Successfully saved accumulated mapping activity log for ${walletAddress}`);
            } catch (error) {
                logger.error(`[Sync] Failed to save accumulated mapping activity log for ${walletAddress}`, { error });
            }
        }
        
        // ✅ CLEANUP: Reset accumulated stats and counters for this wallet
        if (this.accumulatedMappingStats) {
            this.accumulatedMappingStats.delete(walletAddress);
        }
        
        // ✅ FINAL SUMMARY LOG
        const finalCount = this.walletTransactionCounters.get(walletAddress) || 0;
        this.walletTransactionCounters.delete(walletAddress); // Cleanup counter
        
        options.onProgress?.(100, 'Sync complete.');
        logger.info(`[Sync] 🎉 SmartFetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.`);
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
        logger.debug(`[Sync] Executing Standard Fetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures.`);

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
            logger.debug(`[Sync] Standard Fetch (Initial/FetchOlder): Fetching for ${walletAddress} from beginning, up to ${options.maxSignatures} total transactions.`);
            // For initial/fetchOlder, HeliusApiClient will fetch newest first up to options.maxSignatures if no specific start/end timestamps are given.
            // To fetch truly oldest first, specific parameters would be needed for HeliusApiClient.
            // Current HeliusApiClient.getAllTransactionsForAddress defaults to fetching newest if only maxSignatures is provided.
        } else { // Incremental fetch for newer transactions
            logger.debug(`[Sync] Standard Fetch (Incremental Newer): Fetching for ${walletAddress}.`);
            stopAtSignatureForStd = walletState!.newestProcessedSignature ?? undefined;
            newestProcessedTimestampForStd = walletState!.newestProcessedTimestamp ?? undefined;
        }
        
        options.onProgress?.(10, 'Fetching transactions...');
        try {
            logger.debug(`[Sync] Standard Fetch: Calling HeliusApiClient for ${walletAddress} with maxSignatures: ${options.maxSignatures}, limit: ${options.limit}`);
            
            // ✅ STREAM PROCESSING: Process standard fetch transactions as they arrive
            let totalStandardProcessedCount = 0;
            const transactions = await this.heliusClient.getAllTransactionsForAddress(
                walletAddress, 
                options.limit, 
                options.maxSignatures, 
                stopAtSignatureForStd, 
                newestProcessedTimestampForStd, 
                untilTimestampForStd,
                HELIUS_CONFIG.INTERNAL_CONCURRENCY,
                (progress) => options.onProgress?.(10 + (progress * 0.8), 'Fetching transactions...'),
                // ✅ NEW: Stream callback for standard fetch
                async (batch: HeliusTransaction[]) => {
                    await this.processAndSaveTransactions(walletAddress, batch, isEffectivelyInitialFetch, options);
                    totalStandardProcessedCount += batch.length;
                    const currentCount = this.walletTransactionCounters.get(walletAddress) || 0;
                    // ✅ INCREMENTAL PROGRESS: Show standard fetch progress
                    if (currentCount % 500 === 0 || currentCount <= 200) {
                        logger.debug(`[Sync] Standard progress: ${totalStandardProcessedCount} txs fetched → ${currentCount} processed & saved for ${walletAddress}`);
                    }
                }
            );
            totalStandardProcessedCount = totalStandardProcessedCount || transactions.length;
            const finalStandardCount = this.walletTransactionCounters.get(walletAddress) || 0;
            logger.info(`[Sync] Standard Fetch: ✅ Completed processing ${totalStandardProcessedCount} transactions for ${walletAddress}.`);
            options.onProgress?.(90, 'Transactions processed...');
        } catch (fetchError) {
            // Check if this is a WrongSize error - mark wallet as invalid and stop processing
            if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
                logger.warn(`[Sync] WrongSize error detected for ${walletAddress} in Standard Fetch. Marking wallet as invalid.`);
                try {
                    await this.databaseService.updateWallet(walletAddress, { 
                        classification: 'INVALID'
                    });
                } catch (updateError) {
                    logger.error(`[Sync] Failed to mark wallet ${walletAddress} as invalid:`, { updateError });
                }
                throw fetchError; // Re-throw to stop further processing
            }
            if (fetchError instanceof Error && fetchError.message.includes('Non-retryable RPC Error')) {
                logger.error(`[Sync] CRITICAL: Aborting sync for ${walletAddress} due to a non-retryable RPC error (e.g., invalid address).`, { error: fetchError.message });
                // Do not re-throw, allowing the batch process to continue with other wallets
            } else {
                logger.error(`[Sync] Standard Fetch: Failed to fetch/process transactions for ${walletAddress}:`, { fetchError });
                throw fetchError; 
            }
        }
        // ✅ FINAL CLEANUP AND SUMMARY
        const finalCount = this.walletTransactionCounters.get(walletAddress) || 0;
        this.walletTransactionCounters.delete(walletAddress); // Cleanup counter
        
        options.onProgress?.(100, 'Sync complete.');
        logger.info(`[Sync] 🎉 Standard Fetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.`);
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
      logger.debug(`[Sync] Processing ${transactions.length} transactions for wallet ${walletAddress}...`);
      
      const mappingResult: MappingResult = mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
      const analysisInputsToSave = mappingResult.analysisInputs;
      const mappingStats = mappingResult.stats;

      // ✅ ACCUMULATE MAPPING STATS INSTEAD OF SAVING INDIVIDUALLY
      // We'll save this at the end of the entire sync operation
      if (mappingStats) {
          // Store for later accumulation instead of saving now
          if (!this.accumulatedMappingStats) {
              this.accumulatedMappingStats = new Map();
          }
          
          const existingStats = this.accumulatedMappingStats.get(walletAddress) || {};
          // Merge stats (assuming they're numeric values)
          Object.keys(mappingStats).forEach(key => {
              if (typeof mappingStats[key] === 'number') {
                  existingStats[key] = (existingStats[key] || 0) + mappingStats[key];
              }
          });
          this.accumulatedMappingStats.set(walletAddress, existingStats);
      }

      // ✅ SILENT SAVING: Save without logging each batch
      if (analysisInputsToSave.length > 0) {
        await this.databaseService.saveSwapAnalysisInputs(analysisInputsToSave);
        
        // ✅ UPDATE COUNTER: Track total processed for this wallet
        const currentCount = this.walletTransactionCounters.get(walletAddress) || 0;
        this.walletTransactionCounters.set(walletAddress, currentCount + analysisInputsToSave.length);
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
        logger.debug(`[Sync] No transactions in this batch to update wallet state for ${walletAddress}.`);
      }
      // logger.debug(`[Sync] Finished processing batch of ${transactions.length} transactions for ${walletAddress}.`);
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