import { createLogger } from 'core/utils/logger';
import { getErrorMessage } from 'core/utils/error-utils';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from '../../api/services/database.service';
import {
    mapHeliusTransactionsToIntermediateRecords,
    MappingResult
} from 'core/services/helius-transaction-mapper';
import { HeliusTransaction } from '@/types/helius-api';
import { Prisma, Wallet } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { HELIUS_CONFIG, RPC_FULL_MAPPER_CONFIG } from '../../config/constants';
import { mapRpcFullToSwapAnalysisInputs } from './rpc-full-mapper';
import { isAnalysisBlockingType, type KnownWalletType } from '../../config/known-wallets';
import { SmartFetchService } from './smart-fetch-service';
import Redis from 'ioredis';

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

    private readonly syncLockTtlMs = 15 * 60 * 1000;
    private readonly syncLockWaitTimeoutMs = 3 * 60 * 1000;

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
        smartFetchService?: SmartFetchService,
        private readonly redisClient?: Redis,
    ) {
        if (!heliusApiClient) {
            // Service requires an API client instance
            throw new Error('HeliusSyncService requires a valid HeliusApiClient instance.');
        }
        this.heliusClient = heliusApiClient; // Use the provided instance
        this.smartFetchService = smartFetchService || new SmartFetchService();
    }

    private syncLockKey(walletAddress: string): string {
      return `lock:wallet:sync:${walletAddress}`;
    }

    private async waitForActiveSync(walletAddress: string): Promise<void> {
      if (!this.redisClient) {
        return;
      }

      const lockKey = this.syncLockKey(walletAddress);
      const startedAt = Date.now();
      while (Date.now() - startedAt < this.syncLockWaitTimeoutMs) {
        const currentLock = await this.redisClient.get(lockKey).catch((error) => {
          logger.warn(`[Sync] Failed to read sync lock for ${walletAddress}: ${getErrorMessage(error)}`);
          return null;
        });
        if (!currentLock) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.warn(`[Sync] Timed out waiting for active sync lock for ${walletAddress}; skipping duplicate sync.`);
    }

    private async updateWalletDiscoveryRange(
      walletAddress: string,
      direction: 'newer' | 'older',
      range?: {
        newestSignature?: string;
        newestTimestamp?: number;
        oldestSignature?: string;
        oldestTimestamp?: number;
      },
    ): Promise<void> {
      if (!range) {
        return;
      }

      const currentWallet = await this.databaseService.getWallet(walletAddress);
      const updateData: Partial<Omit<Wallet, 'address'>> = {};

      if (
        direction === 'newer' &&
        range.newestSignature &&
        range.newestTimestamp !== undefined &&
        (
          !currentWallet ||
          currentWallet.newestProcessedTimestamp === null ||
          range.newestTimestamp > currentWallet.newestProcessedTimestamp ||
          (
            range.newestTimestamp === currentWallet.newestProcessedTimestamp &&
            currentWallet.newestProcessedSignature !== range.newestSignature
          )
        )
      ) {
        updateData.newestProcessedTimestamp = range.newestTimestamp;
        updateData.newestProcessedSignature = range.newestSignature;
      }

      if (
        direction === 'older' &&
        range.oldestSignature &&
        range.oldestTimestamp !== undefined &&
        (
          !currentWallet ||
          currentWallet.firstProcessedTimestamp === null ||
          range.oldestTimestamp < currentWallet.firstProcessedTimestamp ||
          (
            range.oldestTimestamp === currentWallet.firstProcessedTimestamp &&
            currentWallet.oldestProcessedSignature !== range.oldestSignature
          )
        )
      ) {
        updateData.firstProcessedTimestamp = range.oldestTimestamp;
        updateData.oldestProcessedSignature = range.oldestSignature;
      }

      if (Object.keys(updateData).length > 0) {
        await this.databaseService.updateWallet(walletAddress, updateData);
      }
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

        const lockKey = this.syncLockKey(walletAddress);
        const lockValue = `sync-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let lockAcquired = false;
        let lockRenewal: NodeJS.Timeout | undefined;

        if (this.redisClient) {
            const acquired = await this.redisClient
                .set(lockKey, lockValue, 'PX', this.syncLockTtlMs, 'NX')
                .catch((error) => {
                    logger.warn(`[Sync] Failed to acquire sync lock for ${walletAddress}; continuing without lock: ${getErrorMessage(error)}`);
                    return null;
                });
            if (acquired !== 'OK') {
                if (acquired === null) {
                    // Redis locking is a guardrail, not a hard dependency for wallet sync.
                    // Continue with the old behavior when Redis is unavailable.
                } else {
                    logger.debug(`[Sync] Waiting for active sync to finish for ${walletAddress}.`);
                    await this.waitForActiveSync(walletAddress);
                    return;
                }
            } else {
                lockAcquired = true;
                lockRenewal = setInterval(() => {
                    void this.redisClient?.eval(
                        `
                        local current = redis.call('GET', KEYS[1])
                        if current == ARGV[1] then
                          return redis.call('PEXPIRE', KEYS[1], ARGV[2])
                        else
                          return 0
                        end
                        `,
                        1,
                        lockKey,
                        lockValue,
                        this.syncLockTtlMs.toString(),
                    ).catch((error) => {
                        logger.warn(`[Sync] Failed to renew sync lock for ${walletAddress}: ${getErrorMessage(error)}`);
                    });
                }, Math.floor(this.syncLockTtlMs / 3));
            }
        }

        // Per-run accumulators to avoid long-lived shared state
        const mappingStatsAccumulator = new Map<string, Record<string, number>>();
        const walletTransactionCounters = new Map<string, number>();

        try {
            // Early check: Skip system wallets to avoid wasting resources.
            // KOL wallets (knownType='KOL') are real traders and must sync normally.
            try {
                const existingWallet = await this.databaseService.getWallet(walletAddress);
                if (existingWallet?.knownType && isAnalysisBlockingType(existingWallet.knownType as KnownWalletType)) {
                    logger.debug(`[Sync] Skipping sync for ${walletAddress} - has knownType=${existingWallet.knownType}`);
                    return;
                }
                // Handle legacy INVALID classification
                if (existingWallet?.classification === 'INVALID' || existingWallet?.classification === 'SYSTEM') {
                    logger.debug(`[Sync] Skipping sync for ${walletAddress} - already marked as ${existingWallet.classification}`);
                    return;
                }
            } catch (error) {
                // If we can't check, proceed with normal flow
                logger.warn(`[Sync] Could not check wallet classification for ${walletAddress}, proceeding: ${getErrorMessage(error)}`);
            }

            // Ensure wallet exists in the DB before starting sync operations
            try {
                await this.databaseService.ensureWalletExists(walletAddress);
                logger.debug(`[Sync] Wallet entry ensured for ${walletAddress}. Proceeding with sync.`);
            } catch (error) {
                logger.error(`[Sync] CRITICAL: Could not ensure wallet entry for ${walletAddress}. Aborting sync.`, { error });
                // Depending on desired behavior, you might re-throw or just return to stop sync for this wallet.
                throw error; // Re-throw to make it visible to the caller (e.g., AnalysesController)
            }

            // logger.debug(`[Sync] Starting data synchronization for wallet: ${walletAddress}`);
            // logger.debug('[Sync] Options:', options); // Log the sync options
            
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
            const adjustedOptions = { ...options };
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
                logger.warn(`[SmartFetch] Failed to get smart fetch recommendation for ${walletAddress}, using original options: ${getErrorMessage(error)}`);
                // Continue with original options if smart fetch fails
            }
            */

            // Execute sync with (potentially adjusted) options
            try {
                if (RPC_FULL_MAPPER_CONFIG.enabled) {
                     // Feature-flagged path: fetch RAW RPC-full txs and map with the clean balance-delta
                     // mapper. Default OFF; the Enhanced/legacy path below is unchanged when the flag is off.
                     await this.executeRpcFullFetch(walletAddress, adjustedOptions, walletTransactionCounters);
                } else if (adjustedOptions.smartFetch && adjustedOptions.maxSignatures) {
                     await this.executeSmartFetch(walletAddress, adjustedOptions, mappingStatsAccumulator, walletTransactionCounters);
                } else {
                     await this.executeStandardFetch(walletAddress, adjustedOptions, mappingStatsAccumulator, walletTransactionCounters);
                }
                 // logger.debug(`[Sync] Synchronization complete for wallet: ${walletAddress}`);
            } catch (error) {
                 logger.error(`[Sync] Error during synchronization for ${walletAddress}:`, { error });
                 // Decide if error should be re-thrown or just logged
                 // throw error; // Re-throw if caller needs to handle it
            }
        } finally {
            if (lockRenewal) {
                clearInterval(lockRenewal);
            }
            if (lockAcquired && this.redisClient) {
                await this.redisClient.eval(
                    `
                    local current = redis.call('GET', KEYS[1])
                    if current == ARGV[1] then
                      return redis.call('DEL', KEYS[1])
                    else
                      return 0
                    end
                    `,
                    1,
                    lockKey,
                    lockValue,
                ).catch((error) => {
                    logger.warn(`[Sync] Failed to release sync lock for ${walletAddress}: ${getErrorMessage(error)}`);
                });
            }
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
    protected async executeSmartFetch(
      walletAddress: string,
      options: SyncOptions,
      mappingStatsAccumulator: Map<string, Record<string, number>>,
      walletTransactionCounters: Map<string, number>,
    ): Promise<void> {
        logger.debug(`[Sync] Executing SmartFetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures in DB.`);
        
        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] SmartFetch called for ${walletAddress} without a valid positive options.maxSignatures. Proceeding with only fetching newer transactions.`);
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        
        const stopAtSignatureForNewer = walletState?.newestProcessedSignature ?? undefined;
        const newestProcessedTimestampForNewer = walletState?.newestProcessedTimestamp ?? undefined;
        const capForNewerFetch = options.maxSignatures && options.maxSignatures > 0 ? options.maxSignatures : undefined;

        try {
            logger.debug(`[Sync] SmartFetch Phase 1 (Newer): Fetching for ${walletAddress} since sig: ${stopAtSignatureForNewer}, ts: ${newestProcessedTimestampForNewer}. API client call will be capped by ${capForNewerFetch ?? 'Helius default/internal cap'}.`);
            options.onProgress?.(10, 'Fetching newer transactions...');
            let newerTransactionsFetchedCount = 0;
            let prefetchedHeadSignatures: any[] | undefined = undefined;
            let prefetchedContinueBeforeSignature: string | null | undefined = undefined;
            let shouldSkipNewerFetch = false;
            let newerDiscoveryRange:
              | {
                  signatureCount: number;
                  newestSignature?: string;
                  newestTimestamp?: number;
                  oldestSignature?: string;
                  oldestTimestamp?: number;
                }
              | undefined = undefined;

            if (stopAtSignatureForNewer || newestProcessedTimestampForNewer !== undefined) {
                const headCheck = await this.heliusClient.getIncrementalHeadSignatures(
                    walletAddress,
                    newestProcessedTimestampForNewer,
                    stopAtSignatureForNewer,
                );

                if (headCheck.signatures.length === 0) {
                    logger.debug(`[Sync] SmartFetch Phase 1 (Newer): No signatures newer than cursor for ${walletAddress}. Skipping newer fetch.`);
                    options.onProgress?.(50, 'No newer transactions found.');
                    shouldSkipNewerFetch = true;
                } else {
                    prefetchedHeadSignatures = headCheck.canReuseInMainFetch ? headCheck.signatures : undefined;
                    prefetchedContinueBeforeSignature = headCheck.canReuseInMainFetch
                        ? headCheck.continueBeforeSignature
                        : undefined;
                }
            }

            if (prefetchedHeadSignatures === undefined && stopAtSignatureForNewer && newestProcessedTimestampForNewer !== undefined) {
                // Head check on V2 found potential new signatures but could not safely seed pagination.
                // Continue with the normal incremental path below.
            }

            const newerTransactions = shouldSkipNewerFetch
                ? []
                : await this.heliusClient.getAllTransactionsForAddress(
                    walletAddress, 
                    options.limit, 
                    capForNewerFetch, 
                    stopAtSignatureForNewer, 
                    newestProcessedTimestampForNewer, 
                    undefined,
                    HELIUS_CONFIG.INTERNAL_CONCURRENCY,
                    (progress) => options.onProgress?.(10 + (progress * 0.4), 'Fetching newer transactions...'),
                    async (batch: HeliusTransaction[]) => {
                        await this.processAndSaveTransactions(walletAddress, batch, true, options, mappingStatsAccumulator, walletTransactionCounters);
                        newerTransactionsFetchedCount += batch.length;
                        const currentCount = walletTransactionCounters.get(walletAddress) || 0;
                        if (currentCount % 500 === 0 || currentCount <= 200) {
                            // logger.debug(`[Sync] Phase 1 progress: ${newerTransactionsFetchedCount} txs fetched → ${currentCount} processed & saved for ${walletAddress}`);
                        }
                    },
                    prefetchedHeadSignatures,
                    prefetchedContinueBeforeSignature,
                    (range) => {
                        newerDiscoveryRange = range;
                    },
                );
            newerTransactionsFetchedCount = newerTransactionsFetchedCount || newerTransactions.length;
            await this.updateWalletDiscoveryRange(walletAddress, 'newer', newerDiscoveryRange);
           logger.debug(`[Sync] SmartFetch Phase 1 (Newer): ✅ Completed processing ${newerTransactionsFetchedCount} newer transactions for ${walletAddress}.`);
           options.onProgress?.(50, 'Newer transactions processed...');
        } catch (fetchError) {
           if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
               logger.warn(`[Sync] WrongSize error detected for ${walletAddress}. Marking wallet as SYSTEM.`);
               try {
                   await this.databaseService.updateWallet(walletAddress, {
                       classification: 'SYSTEM'
                   });
               } catch (updateError) {
                   logger.error(`[Sync] Failed to mark wallet ${walletAddress} as SYSTEM:`, { updateError });
               }
               throw fetchError; // Re-throw to stop further processing
           }
            logger.error(`[Sync] SmartFetch Phase 1 (Newer): Failed to fetch/process newer transactions for ${walletAddress}:`, { fetchError });
        }

        try {
            if (options.maxSignatures && options.maxSignatures > 0) {
                const countAfterNewerFetch = await this.getDbTransactionCount(walletAddress);
                logger.debug(`[Sync] SmartFetch: DB count for ${walletAddress} after fetching newer is ${countAfterNewerFetch}. Target is ${options.maxSignatures}.`);

                const olderHistorySatisfiedTarget = walletState?.olderHistorySatisfiedTarget ?? null;

                if (
                    countAfterNewerFetch < options.maxSignatures &&
                    !(olderHistorySatisfiedTarget !== null && olderHistorySatisfiedTarget >= options.maxSignatures)
                ) {
                    const remainingSignaturesToFetchForOlder = options.maxSignatures - countAfterNewerFetch;
                    logger.debug(`[Sync] SmartFetch Phase 2 (Older): Current count ${countAfterNewerFetch} is less than target ${options.maxSignatures}. Still need ${remainingSignaturesToFetchForOlder} older transactions.`);
                    
                    const updatedWalletStateAfterPhase1 = await this.databaseService.getWallet(walletAddress);
                    const oldestProcessedTimestamp = updatedWalletStateAfterPhase1?.firstProcessedTimestamp ?? undefined;
                    const oldestProcessedSignature = updatedWalletStateAfterPhase1?.oldestProcessedSignature ?? undefined;
                    
                    logger.debug(`[Sync] SmartFetch Phase 2 (Older): Attempting to fetch ${remainingSignaturesToFetchForOlder} older transactions for ${walletAddress}, older than sig: ${oldestProcessedSignature}, ts: ${oldestProcessedTimestamp}.`);
                    options.onProgress?.(55, 'Fetching older transactions...');
                    try {
                        let totalOlderProcessedCount = 0;
                        let olderDiscoveryRange:
                          | {
                              signatureCount: number;
                              newestSignature?: string;
                              newestTimestamp?: number;
                              oldestSignature?: string;
                              oldestTimestamp?: number;
                            }
                          | undefined = undefined;
                        const olderTransactions = await this.heliusClient.getAllTransactionsForAddress(
                            walletAddress, 
                            options.limit, 
                            remainingSignaturesToFetchForOlder,
                            oldestProcessedSignature,
                            undefined,
                            oldestProcessedSignature ? undefined : oldestProcessedTimestamp,
                            HELIUS_CONFIG.INTERNAL_CONCURRENCY,
                            (progress) => options.onProgress?.(55 + (progress * 0.4), 'Fetching older transactions...'),
                            async (batch: HeliusTransaction[]) => {
                                await this.processAndSaveTransactions(walletAddress, batch, false, options, mappingStatsAccumulator, walletTransactionCounters);
                                totalOlderProcessedCount += batch.length;
                                const currentCount = walletTransactionCounters.get(walletAddress) || 0;
                                if (currentCount % 500 === 0) {
                                    // logger.debug(`[Sync] Phase 2 progress: ${totalOlderProcessedCount} older txs fetched → ${currentCount} total processed & saved for ${walletAddress}`);
                                }
                            },
                            undefined,
                            undefined,
                            (range) => {
                                olderDiscoveryRange = range;
                            },
                        );
                        totalOlderProcessedCount = totalOlderProcessedCount || olderTransactions.length;
                        await this.updateWalletDiscoveryRange(walletAddress, 'older', olderDiscoveryRange);
                        if ((olderDiscoveryRange?.signatureCount ?? 0) < remainingSignaturesToFetchForOlder) {
                            await this.databaseService.updateWallet(walletAddress, {
                                olderHistorySatisfiedTarget: options.maxSignatures,
                            });
                            logger.debug(`[Sync] SmartFetch Phase 2 (Older): Marked older history satisfied for target ${options.maxSignatures} on ${walletAddress} after discovering ${olderDiscoveryRange?.signatureCount ?? 0} signatures (< requested ${remainingSignaturesToFetchForOlder}).`);
                        }
                        const finalTotalCount = walletTransactionCounters.get(walletAddress) || 0;
                        logger.debug(`[Sync] SmartFetch Phase 2 (Older): ✅ Completed processing ${totalOlderProcessedCount} older transactions for ${walletAddress}. Total: ${finalTotalCount} transactions.`);
                        options.onProgress?.(95, 'Older transactions processed...');
                    } catch (fetchError) {
                        if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
                            logger.warn(`[Sync] WrongSize error detected for ${walletAddress} in Phase 2. Marking wallet as SYSTEM.`);
                            try {
                                await this.databaseService.updateWallet(walletAddress, {
                                    classification: 'SYSTEM'
                                });
                            } catch (updateError) {
                                logger.error(`[Sync] Failed to mark wallet ${walletAddress} as SYSTEM:`, { updateError });
                            }
                            throw fetchError; // Re-throw to stop further processing
                        }
                        logger.error(`[Sync] SmartFetch Phase 2 (Older): Failed to fetch/process older transactions for ${walletAddress}:`, { fetchError });
                    }
                } else if (olderHistorySatisfiedTarget !== null && olderHistorySatisfiedTarget >= options.maxSignatures) {
                   logger.debug(`[Sync] SmartFetch Phase 2 (Older): Older history already satisfied for target ${options.maxSignatures} on ${walletAddress}. Skipping older fetch.`);
                } else {
                   logger.debug(`[Sync] SmartFetch Phase 2 (Older): DB count (${countAfterNewerFetch}) already meets or exceeds target ${options.maxSignatures}. Skipping older fetch for ${walletAddress}.`);
                }
            } else {
                logger.debug(`[Sync] SmartFetch: Skipping Phase 2 (Older) because options.maxSignatures is not valid or not set. Only newer transactions were fetched if available.`);
            }
        } finally {
            const finalStats = mappingStatsAccumulator.get(walletAddress);
            if (finalStats) {
                try {
                    await this.databaseService.saveMappingActivityLog(walletAddress, finalStats as any);
                    logger.debug(`[Sync] Successfully saved accumulated mapping activity log for ${walletAddress}`);
                } catch (error) {
                    logger.error(`[Sync] Failed to save accumulated mapping activity log for ${walletAddress}`, { error });
                }
            }
            mappingStatsAccumulator.delete(walletAddress);
            
            const finalCount = walletTransactionCounters.get(walletAddress) || 0;
            walletTransactionCounters.delete(walletAddress);
            options.onProgress?.(100, 'Sync complete.');
            logger.info(`[Sync] 🎉 SmartFetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.`);
        }
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
    protected async executeStandardFetch(
      walletAddress: string,
      options: SyncOptions,
      mappingStatsAccumulator: Map<string, Record<string, number>>,
      walletTransactionCounters: Map<string, number>,
    ): Promise<void> {
        logger.debug(`[Sync] Executing Standard Fetch for ${walletAddress} with overall target of ${options.maxSignatures} signatures.`);

        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync] StandardFetch called for ${walletAddress} without a valid positive options.maxSignatures. Aborting StandardFetch.`);
            return;
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        const isEffectivelyInitialFetch = !walletState || options.fetchOlder;
        
        let stopAtSignatureForStd: string | undefined = undefined;
        let newestProcessedTimestampForStd: number | undefined = undefined;
        const untilTimestampForStd: number | undefined = undefined; 
        
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
                async (batch: HeliusTransaction[]) => {
                    await this.processAndSaveTransactions(walletAddress, batch, isEffectivelyInitialFetch, options, mappingStatsAccumulator, walletTransactionCounters);
                    totalStandardProcessedCount += batch.length;
                    const currentCount = walletTransactionCounters.get(walletAddress) || 0;
                    if (currentCount % 500 === 0 || currentCount <= 200) {
                        // logger.debug(`[Sync] Standard progress: ${totalStandardProcessedCount} txs fetched → ${currentCount} processed & saved for ${walletAddress}`);
                    }
                },
            );
            totalStandardProcessedCount = totalStandardProcessedCount || transactions.length;
            const finalStandardCount = walletTransactionCounters.get(walletAddress) || 0;
            logger.debug(`[Sync] Standard Fetch: ✅ Completed processing ${totalStandardProcessedCount} transactions for ${walletAddress}.`);
            options.onProgress?.(90, 'Transactions processed...');
        } catch (fetchError) {
            if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
                logger.warn(`[Sync] WrongSize error detected for ${walletAddress} in Standard Fetch. Marking wallet as SYSTEM.`);
                try {
                    await this.databaseService.updateWallet(walletAddress, {
                        classification: 'SYSTEM'
                    });
                } catch (updateError) {
                    logger.error(`[Sync] Failed to mark wallet ${walletAddress} as SYSTEM:`, { updateError });
                }
                throw fetchError; // Re-throw to stop further processing
            }
            if (fetchError instanceof Error && fetchError.message.includes('Non-retryable RPC Error')) {
                logger.error(`[Sync] CRITICAL: Aborting sync for ${walletAddress} due to a non-retryable RPC error (e.g., invalid address).`, { error: fetchError.message });
            } else {
                logger.error(`[Sync] Standard Fetch: Failed to fetch/process transactions for ${walletAddress}:`, { fetchError });
                throw fetchError; 
            }
        } finally {
            const finalStats = mappingStatsAccumulator.get(walletAddress);
            if (finalStats) {
                try {
                    await this.databaseService.saveMappingActivityLog(walletAddress, finalStats as any);
                    logger.debug(`[Sync] Successfully saved accumulated mapping activity log for ${walletAddress} (standard fetch)`);
                } catch (error) {
                    logger.error(`[Sync] Failed to save accumulated mapping activity log for ${walletAddress}`, { error });
                }
            }
            mappingStatsAccumulator.delete(walletAddress);

            const finalCount = walletTransactionCounters.get(walletAddress) || 0;
            walletTransactionCounters.delete(walletAddress);
            options.onProgress?.(100, 'Sync complete.');
            logger.info(`[Sync] 🎉 Standard Fetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.`);
        }
    }

    /**
     * Feature-flagged sync path (USE_RPC_FULL_MAPPER): fetches RAW RPC-full transactions and maps them
     * with the clean balance-delta mapper (`rpc-full-mapper.ts`). Mirrors `executeSmartFetch`'s
     * two-phase strategy so it is a faithful replacement:
     *   Phase 1 (newer): incremental fetch of txs newer than `newestProcessedTimestamp` (or, on an
     *     initial / `fetchOlder` sync, newest-first up to `maxSignatures`).
     *   Phase 2 (older): if the DB row count is still below `maxSignatures`, backfill OLDER history
     *     (blockTime <= the oldest stored ts) until the target is met or older history is exhausted —
     *     so bumping `maxSignatures` later deepens history without a full re-fetch.
     * Does NOT touch the Enhanced/legacy path.
     */
    protected async executeRpcFullFetch(
      walletAddress: string,
      options: SyncOptions,
      walletTransactionCounters: Map<string, number>,
    ): Promise<void> {
        if (!options.maxSignatures || options.maxSignatures <= 0) {
            logger.warn(`[Sync][RpcFull] Called for ${walletAddress} without a valid positive maxSignatures. Aborting.`);
            return;
        }

        const walletState = await this.databaseService.getWallet(walletAddress);
        const isEffectivelyInitialFetch = !walletState || options.fetchOlder;
        const newestProcessedTimestamp = isEffectivelyInitialFetch
            ? undefined
            : (walletState!.newestProcessedTimestamp ?? undefined);

        logger.debug(`[Sync][RpcFull] Phase 1 (newer) for ${walletAddress} (initial=${isEffectivelyInitialFetch}, maxSignatures=${options.maxSignatures}, sinceTs=${newestProcessedTimestamp ?? 'none'}).`);
        options.onProgress?.(10, 'Fetching newer transactions (RPC-full)...');

        try {
            // === PHASE 1: newer (or initial newest-first) ===
            await this.heliusClient.getAllRawRpcFullTransactionsForAddress(walletAddress, {
                limit: options.limit,
                maxSignatures: options.maxSignatures,
                newestProcessedTimestamp,
                onProgress: (p) => options.onProgress?.(10 + p * 0.4, 'Fetching newer transactions (RPC-full)...'),
                onTransactionBatch: async (batch: any[]) => {
                    await this.processAndSaveRawRpcFull(walletAddress, batch, walletTransactionCounters);
                },
            });

            // === PHASE 2: older backfill until maxSignatures is met (or older history exhausted) ===
            const countAfterNewer = await this.getDbTransactionCount(walletAddress);
            const olderHistorySatisfiedTarget = walletState?.olderHistorySatisfiedTarget ?? null;
            const olderAlreadySatisfied = olderHistorySatisfiedTarget !== null && olderHistorySatisfiedTarget >= options.maxSignatures;

            if (countAfterNewer < options.maxSignatures && !olderAlreadySatisfied) {
                const stateAfterNewer = await this.databaseService.getWallet(walletAddress);
                const oldestProcessedTimestamp = stateAfterNewer?.firstProcessedTimestamp ?? undefined;
                if (oldestProcessedTimestamp !== undefined) {
                    const remaining = options.maxSignatures - countAfterNewer;
                    logger.debug(`[Sync][RpcFull] Phase 2 (older) for ${walletAddress}: have ${countAfterNewer}, need ${remaining} more (untilTs=${oldestProcessedTimestamp}).`);
                    options.onProgress?.(55, 'Fetching older transactions (RPC-full)...');
                    let olderFetched = 0;
                    await this.heliusClient.getAllRawRpcFullTransactionsForAddress(walletAddress, {
                        limit: options.limit,
                        maxSignatures: remaining,
                        untilTimestamp: oldestProcessedTimestamp,
                        onProgress: (p) => options.onProgress?.(55 + p * 0.4, 'Fetching older transactions (RPC-full)...'),
                        onTransactionBatch: async (batch: any[]) => {
                            olderFetched += batch.length;
                            await this.processAndSaveRawRpcFull(walletAddress, batch, walletTransactionCounters);
                        },
                    });
                    // If we discovered fewer older txs than requested, older history is exhausted for
                    // this target — record it so future syncs skip the (futile) older fetch.
                    if (olderFetched < remaining) {
                        await this.databaseService.updateWallet(walletAddress, {
                            olderHistorySatisfiedTarget: options.maxSignatures,
                        });
                    }
                }
            }

            const finalCount = walletTransactionCounters.get(walletAddress) || 0;
            walletTransactionCounters.delete(walletAddress);
            options.onProgress?.(100, 'Sync complete.');
            logger.info(`[Sync][RpcFull] 🎉 Completed for ${walletAddress}: ${finalCount} clean-mapper rows saved.`);
        } catch (fetchError) {
            if (fetchError instanceof Error && fetchError.message.includes('Invalid param: WrongSize')) {
                logger.warn(`[Sync][RpcFull] WrongSize error detected for ${walletAddress}. Marking wallet as SYSTEM.`);
                try {
                    await this.databaseService.updateWallet(walletAddress, { classification: 'SYSTEM' });
                } catch (updateError) {
                    logger.error(`[Sync][RpcFull] Failed to mark wallet ${walletAddress} as SYSTEM:`, { updateError });
                }
                throw fetchError;
            }
            logger.error(`[Sync][RpcFull] Failed to fetch/process transactions for ${walletAddress}:`, { fetchError });
            throw fetchError;
        }
    }

    /**
     * Maps a batch of RAW RPC-full txs with the clean mapper and persists with replace-by-signature
     * semantics (the mapper NETS per (mint,direction), so a plain upsert could strand legacy per-leg
     * rows for the same signature). Logs — but does not throw on — any SWAP leg with zero associated
     * value (the price-independent self-consistency invariant) so live regressions stay visible.
     */
    protected async processAndSaveRawRpcFull(
      walletAddress: string,
      rawBatch: any[],
      walletTransactionCounters: Map<string, number>,
    ): Promise<void> {
        if (rawBatch.length === 0) return;

        const { rows } = mapRpcFullToSwapAnalysisInputs(walletAddress, rawBatch);

        // Self-consistency guard: a SWAP leg should never carry zero value. Log, don't throw.
        const zeroValueSwaps = rows.filter(
            (r) => r.interactionType === 'SWAP'
                && !(Math.abs(r.associatedSolValue) > 0)
                && !(Math.abs(r.associatedUsdcValue) > 0),
        );
        if (zeroValueSwaps.length > 0) {
            const sampleSigs = Array.from(new Set(zeroValueSwaps.map((r) => r.signature))).slice(0, 5);
            logger.warn(`[Sync][RpcFull] ${zeroValueSwaps.length} zero-value SWAP leg(s) for ${walletAddress} (self-consistency invariant). Sample sigs: ${sampleSigs.join(', ')}`);
        }

        const signatures = Array.from(new Set(
            rawBatch
                .map((tx) => (tx?.signature || tx?.transaction?.signatures?.[0]) as string | undefined)
                .filter((s): s is string => !!s),
        ));

        if (signatures.length > 0) {
            await this.databaseService.replaceSwapAnalysisInputsForSignatures(
                walletAddress,
                signatures,
                rows as Prisma.SwapAnalysisInputCreateInput[],
            );
            const currentCount = walletTransactionCounters.get(walletAddress) || 0;
            walletTransactionCounters.set(walletAddress, currentCount + rows.length);
        }

        // Advance the wallet discovery cursor from this batch (blockTime + signature).
        const stateBatch = rawBatch
            .map((tx) => ({
                timestamp: typeof tx?.blockTime === 'number' ? tx.blockTime : 0,
                signature: (tx?.signature || tx?.transaction?.signatures?.[0] || '') as string,
            }))
            .filter((b) => b.signature && b.timestamp > 0);
        await this.updateWalletStateFromBatch(walletAddress, stateBatch);
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
    protected async processAndSaveTransactions(
      walletAddress: string, 
      transactions: HeliusTransaction[], 
      isNewerFetchOrInitial: boolean, 
      options: SyncOptions,
      mappingStatsAccumulator: Map<string, Record<string, number>>,
      walletTransactionCounters: Map<string, number>,
    ): Promise<void> {
      // logger.debug(`[Sync] Processing ${transactions.length} transactions for wallet ${walletAddress}...`);
      const mappingResult: MappingResult = mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
      const analysisInputsToSave = mappingResult.analysisInputs;
      const mappingStats = mappingResult.stats;

      // ✅ ACCUMULATE MAPPING STATS INSTEAD OF SAVING INDIVIDUALLY
      // We'll save this at the end of the entire sync operation
      if (mappingStats) {
          const existingStats = mappingStatsAccumulator.get(walletAddress) || {};
          Object.keys(mappingStats).forEach(key => {
              if (typeof mappingStats[key] === 'number') {
                  existingStats[key] = (existingStats[key] || 0) + mappingStats[key];
              }
          });
          mappingStatsAccumulator.set(walletAddress, existingStats);
      }

      // ✅ SILENT SAVING: Save without logging each batch
      if (analysisInputsToSave.length > 0) {
        await this.databaseService.saveSwapAnalysisInputs(analysisInputsToSave);

        // ✅ UPDATE COUNTER: Track total processed for this wallet
        const currentCount = walletTransactionCounters.get(walletAddress) || 0;
        walletTransactionCounters.set(walletAddress, currentCount + analysisInputsToSave.length);
      }
    
      await this.updateWalletStateFromBatch(walletAddress, transactions);
      // logger.debug(`[Sync] Finished processing batch of ${transactions.length} transactions for ${walletAddress}.`);
    }

    /**
     * Updates the wallet's discovery cursor (newest/oldest processed timestamp + signature and
     * lastSuccessfulFetchTimestamp) from a processed batch. Shared by the Enhanced (legacy) and the
     * RPC-full clean-mapper sync paths so both advance the cursor identically. Batch items only need
     * `timestamp` (unix seconds) and `signature`.
     */
    private async updateWalletStateFromBatch(
      walletAddress: string,
      batch: Array<{ timestamp: number; signature: string }>,
    ): Promise<void> {
      if (batch.length > 0) {
        // Determine actual min and max timestamps from the CURRENT BATCH
        let batchMinTimestamp = Infinity;
        let batchMaxTimestamp = 0;
        let batchNewestSignature = ''; // To store the signature of the newest transaction in the batch
        let batchOldestSignature = ''; // To store the signature of the oldest transaction in the batch

        batch.forEach(tx => {
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
        if (batch.length === 1) {
            batchMinTimestamp = batch[0].timestamp;
            batchMaxTimestamp = batch[0].timestamp;
            batchOldestSignature = batch[0].signature;
            batchNewestSignature = batch[0].signature;
        }

        const updateData: Partial<Omit<Wallet, 'address'>> = { 
            lastSuccessfulFetchTimestamp: new Date() 
        };

        const currentWallet = await this.databaseService.getWallet(walletAddress);

        // Update firstProcessedTimestamp/oldestProcessedSignature if the current batch's oldest is older than known, or if never set
        if (batchMinTimestamp !== Infinity && 
            (!currentWallet || currentWallet.firstProcessedTimestamp === null || batchMinTimestamp < currentWallet.firstProcessedTimestamp)) {
            updateData.firstProcessedTimestamp = batchMinTimestamp;
            if (batchOldestSignature) {
                updateData.oldestProcessedSignature = batchOldestSignature;
            }
        } else if (
            batchMinTimestamp !== Infinity &&
            batchOldestSignature &&
            currentWallet &&
            batchMinTimestamp === currentWallet.firstProcessedTimestamp &&
            currentWallet.oldestProcessedSignature !== batchOldestSignature
        ) {
            updateData.oldestProcessedSignature = batchOldestSignature;
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
          // logger.debug(`[Sync] Wallet state updated for ${walletAddress}.`, updateData);
        } else if (Object.keys(updateData).length > 0) {
             await this.databaseService.updateWallet(walletAddress, updateData);
             // logger.debug(`[Sync] Wallet lastSuccessfulFetchTimestamp updated for ${walletAddress}.`, updateData);
        }
      } else {
        logger.debug(`[Sync] No transactions in this batch to update wallet state for ${walletAddress}.`);
      }
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
