#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { createLogger } from '../utils/logger';
import { HeliusApiClient } from '../services/helius-api-client';
import { mapHeliusTransactionsToIntermediateRecords } from '../services/helius-transaction-mapper';
import { getWallet, updateWallet, saveSwapAnalysisInputs, prisma } from '../services/database-service';
import { HeliusTransaction } from '../types/helius-api';
import { Prisma } from '@prisma/client';
import { Wallet } from '@prisma/client';

// Initialize environment variables
dotenv.config();

// --- Set Log Level based on --verbose ---
const verboseLogging = process.argv.includes('-v') || process.argv.includes('--verbose');
process.env.LOG_LEVEL = verboseLogging ? 'debug' : 'info';
// --- End Log Level Setup ---

const logger = createLogger('BulkDataFetcherScript');

/**
 * Helper function (copied from helius-analyzer.ts) to process and save transactions and update wallet state.
 * Adjusted slightly for the bulk context (e.g., logging prefix).
 */
async function processAndSaveTransactions(
  walletAddress: string,
  transactions: HeliusTransaction[],
  isInitialFetch: boolean // Determines if we should update firstProcessedTimestamp
): Promise<void> {
  const logPrefix = `[${walletAddress}]`;
  logger.debug(`${logPrefix} Mapping and saving ${transactions.length} transactions...`);

  // Map transactions to analysis inputs
  const analysisInputsToSave: Prisma.SwapAnalysisInputCreateInput[] =
    mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);

  if (analysisInputsToSave.length > 0) {
    logger.debug(`${logPrefix} Saving ${analysisInputsToSave.length} analysis input records to database...`);
    try {
      const saveResult = await saveSwapAnalysisInputs(analysisInputsToSave);
      logger.info(`${logPrefix} Successfully saved ${saveResult.count} new records to SwapAnalysisInput table.`);
    } catch (dbError) {
      logger.error(`${logPrefix} Error saving analysis input records to database:`, dbError);
      // Optionally re-throw or handle as needed for bulk processing
      throw dbError; // Re-throw to signal failure for this wallet in the main loop
    }
  } else {
    logger.debug(`${logPrefix} Mapping resulted in 0 analysis input records to save.`);
  }

  // --- Update Wallet State ---
  if (transactions.length > 0) {
    // Sort transactions by timestamp to reliably find first/last *within this batch*
    transactions.sort((a, b) => a.timestamp - b.timestamp);
    const oldestTxInBatch = transactions[0];
    const latestTxInBatch = transactions[transactions.length - 1];

    if (latestTxInBatch && oldestTxInBatch) {
      try {
        const currentWalletState = await getWallet(walletAddress);
        const updateData: Partial<Omit<Wallet, 'address'>> = {
            lastSuccessfulFetchTimestamp: new Date(),
        };

        // Always update newest timestamp/signature based on the latest tx in the fetched batch
        // Only update if the new one is actually newer than the stored one (or if none is stored)
        if (!currentWalletState?.newestProcessedTimestamp || latestTxInBatch.timestamp > currentWalletState.newestProcessedTimestamp) {
            logger.debug(`${logPrefix} Updating newest processed: ts=${latestTxInBatch.timestamp}, sig=${latestTxInBatch.signature}`);
            updateData.newestProcessedSignature = latestTxInBatch.signature;
            updateData.newestProcessedTimestamp = latestTxInBatch.timestamp;
        } else {
             logger.debug(`${logPrefix} Latest fetched transaction (${latestTxInBatch.timestamp}) is not newer than stored (${currentWalletState?.newestProcessedTimestamp}). Skipping newest update.`);
        }

        // Update oldest timestamp *only* if this is the very first fetch for the wallet
        // Or if the oldest in this batch is older than the currently stored oldest
        if (!currentWalletState?.firstProcessedTimestamp || oldestTxInBatch.timestamp < currentWalletState.firstProcessedTimestamp) {
            logger.debug(`${logPrefix} Updating first processed timestamp: ts=${oldestTxInBatch.timestamp}`);
            updateData.firstProcessedTimestamp = oldestTxInBatch.timestamp;
        } else {
            logger.debug(`${logPrefix} Oldest fetched transaction (${oldestTxInBatch.timestamp}) is not older than stored (${currentWalletState?.firstProcessedTimestamp}). Skipping first update.`);
        }


        if (Object.keys(updateData).length > 1) { // Check if there's more than just the lastSuccessfulFetchTimestamp
            await updateWallet(walletAddress, updateData);
            logger.info(`${logPrefix} Wallet state updated successfully.`);
        } else {
            logger.info(`${logPrefix} No relevant wallet state changes detected in this batch.`);
             // Still update the last fetch time even if no other state changed
             await updateWallet(walletAddress, { lastSuccessfulFetchTimestamp: new Date() });
        }

      } catch(walletUpdateError) {
         logger.error(`${logPrefix} Failed to update wallet state.`, { error: walletUpdateError });
         // Decide if this is critical enough to stop processing this wallet
      }

    } else {
      logger.warn(`${logPrefix} Failed to find latest/oldest transaction in batch for wallet state update.`);
    }
  }
}


/**
 * Main function for bulk fetching data.
 */
async function bulkFetchData(
  walletAddresses: string[],
  options: {
    limit: number;
    maxSignatures?: number | null;
    smartFetch: boolean;
  }
): Promise<void> {
  logger.info(`Starting bulk data fetch for ${walletAddresses.length} wallets.`);
  logger.info(`Options: BatchLimit=${options.limit}, SmartFetch=${options.smartFetch}, MaxSignatures=${options.maxSignatures || 'none'}`);

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey) {
    throw new Error('HELIUS_API_KEY environment variable is required. Please add it to your .env file.');
  }

  const heliusClient = new HeliusApiClient({
    apiKey: heliusApiKey!,
    network: 'mainnet',
  });

  let successCount = 0;
  let failureCount = 0;

  for (const address of walletAddresses) {
    const logPrefix = `[${address}]`;
    logger.info(`${logPrefix} Processing wallet...`);
    try {
      // --- Get Wallet State ---
      let stopAtSignature: string | undefined = undefined;
      let newestProcessedTimestamp: number | undefined = undefined;
      let firstProcessedTimestamp: number | undefined = undefined; // Needed for smart fetch older pass
      let isInitialFetchForWallet = false;
      const walletState = await getWallet(address);

      if (walletState) {
        stopAtSignature = walletState.newestProcessedSignature ?? undefined;
        newestProcessedTimestamp = walletState.newestProcessedTimestamp ?? undefined;
        firstProcessedTimestamp = walletState.firstProcessedTimestamp ?? undefined;
        logger.debug(`${logPrefix} Found existing state. Newest: ts=${newestProcessedTimestamp}, sig=${stopAtSignature}. Oldest: ts=${firstProcessedTimestamp}`);
      } else {
        isInitialFetchForWallet = true;
        logger.debug(`${logPrefix} No existing state found. Performing initial fetch.`);
      }

      let dbTransactionCount = 0; // Only needed for smart fetch logic
      if (options.smartFetch && options.maxSignatures) {
           try {
               const existingInputs = await prisma.swapAnalysisInput.findMany({
                   where: { walletAddress: address },
                   select: { signature: true },
                   distinct: ['signature']
               });
               dbTransactionCount = existingInputs.length;
               logger.info(`${logPrefix} SmartFetch: Found ${dbTransactionCount} unique transactions in DB.`);
           } catch (error) {
               logger.error(`${logPrefix} SmartFetch: Error counting existing transactions`, { error });
               // Continue, but smart fetch might not be accurate
           }

           if (dbTransactionCount >= options.maxSignatures) {
                logger.info(`${logPrefix} SmartFetch: DB count (${dbTransactionCount}) meets/exceeds target (${options.maxSignatures}). Skipping API fetch.`);
                successCount++;
                continue; // Skip to the next wallet
           }
      }


      // Determine how many transactions to fetch based on smart fetch logic
      let fetchLimit = options.maxSignatures; // Default to maxSignatures if not smart fetching or if initial smart fetch
      let needsOlderFetch = false;
      let olderFetchLimit: number | null = null;

      if (options.smartFetch && options.maxSignatures && !isInitialFetchForWallet) {
          const neededTotal = options.maxSignatures - dbTransactionCount;
          logger.info(`${logPrefix} SmartFetch: Need ${neededTotal} more transactions.`);
          // For smart fetch, first pass fetches all newer, limit is null initially
          fetchLimit = null;
          needsOlderFetch = true; // Plan to fetch older ones after newer ones
          olderFetchLimit = neededTotal; // Limit the older fetch pass
      }

      // --- Fetch Newer Transactions (or all if initial/not smart fetch) ---
      logger.debug(`${logPrefix} Fetching newer transactions from Helius API...`);
      let fetchedTransactions: HeliusTransaction[] = [];
      try {
        fetchedTransactions = await heliusClient.getAllTransactionsForAddress(
          address,
          options.limit,
          fetchLimit, // Use calculated limit for this pass
          stopAtSignature,
          newestProcessedTimestamp,
          false, // Always fetch fresh, don't rely on Helius client cache merging for this pass
          undefined // Explicitly set untilTimestamp to undefined for the *newer* fetch pass
        );
        logger.info(`${logPrefix} Fetched ${fetchedTransactions.length} newer transactions from Helius.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed to fetch newer transactions from Helius.`, { error: error instanceof Error ? error.message : String(error) });
        // Decide if we should stop for this wallet or try older fetch if planned
        if (!needsOlderFetch) {
            failureCount++;
            continue; // Skip to next wallet if this was the only planned fetch
        } else {
            logger.warn(`${logPrefix} Proceeding to older fetch despite error in newer fetch.`);
        }
      }

      // --- Process and Save Newer Transactions ---
      if (fetchedTransactions.length > 0) {
        await processAndSaveTransactions(address, fetchedTransactions, isInitialFetchForWallet);
        // Update count for potential older fetch limit adjustment
        if (options.smartFetch && olderFetchLimit) {
             olderFetchLimit = Math.max(0, olderFetchLimit - fetchedTransactions.length);
             logger.info(`${logPrefix} SmartFetch: ${olderFetchLimit} transactions still needed for older fetch pass.`);
        }
      }

      // --- Fetch Older Transactions (if SmartFetch required) ---
      if (needsOlderFetch && olderFetchLimit !== null && olderFetchLimit > 0) {
           logger.debug(`${logPrefix} SmartFetch: Fetching ${olderFetchLimit} older transactions...`);
           let olderTransactions: HeliusTransaction[] = [];
           try {
               // Fetch older transactions, using firstProcessedTimestamp as the 'until' point
               olderTransactions = await heliusClient.getAllTransactionsForAddress(
                   address,
                   options.limit,
                   olderFetchLimit, // Limit to remaining needed
                   undefined,      // No 'stopAt' signature for older
                   undefined,      // No 'newest' timestamp filter for older
                   false,          // Fetch fresh data
                   firstProcessedTimestamp 
               );
               logger.info(`${logPrefix} SmartFetch: Fetched ${olderTransactions.length} older transactions (requested ${olderFetchLimit}).`);
           } catch (error) {
                logger.error(`${logPrefix} SmartFetch: Failed to fetch older transactions.`, { error: error instanceof Error ? error.message : String(error) });
                // Don't mark as failure yet, newer ones might have been saved
           }

           // --- Process and Save Older Transactions ---
           if (olderTransactions.length > 0) {
               // Pass false for isInitialFetch as we are fetching older data specifically
               await processAndSaveTransactions(address, olderTransactions, false);
           }
      }


      // If we reached here without critical errors in required fetches
      successCount++;
      logger.info(`${logPrefix} Finished processing wallet.`);

    } catch (error) {
      logger.error(`${logPrefix} Unhandled error processing wallet:`, { error });
      failureCount++;
      // Continue to the next wallet
    }
  } // End loop through walletAddresses

  logger.info(`Bulk fetch complete. Wallets Processed: ${successCount}, Failures: ${failureCount}`);
}


// --- CLI Setup ---
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('bulk-data-fetcher')
    .usage('$0 --addresses WALLET1 WALLET2 ... [options]')
    .option('addresses', {
      alias: 'a',
      description: 'List of Solana wallet addresses to fetch data for',
      type: 'array', // Changed to array
      string: true, // Ensures elements are treated as strings
      demandOption: true
    })
    .option('limit', {
      alias: 'l',
      description: 'Transaction fetch batch size for Helius API calls (default: 100)',
      type: 'number',
      default: 100
    })
    .option('maxSignatures', {
      alias: 'ms',
      description: 'Maximum number of *new* signatures to fetch per wallet (approx). With --smartFetch, ensures DB has at least this many total.',
      type: 'number',
      demandOption: false
    })
     .option('smartFetch', {
      alias: 'sf',
      description: 'Smart fetch mode: first fetches new transactions, then fills up to --ms with older ones if needed',
      type: 'boolean',
      default: false
    })
    .option('verbose', {
      alias: 'v',
      description: 'Enable detailed debug logging',
      type: 'boolean',
      default: false
    })
    .example('npx ts-node src/scripts/bulk-data-fetcher.ts -a <WALLET1> <WALLET2> --ms 5000', 'Fetch up to 5000 new txns for each wallet')
    .example('npx ts-node src/scripts/bulk-data-fetcher.ts -a <WALLET1> <WALLET2> --smartFetch --ms 10000', 'Ensure DB has at least 10k txns total for each wallet')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'V')
    .epilogue('Fetches transaction history for multiple wallets and stores intermediate swap data in the database.')
    .parse();

  const typedArgv = argv as {
      addresses: string[];
      limit: number;
      maxSignatures?: number | null;
      smartFetch: boolean;
      verbose: boolean; // Keep verbose for logging control
      [key: string]: unknown;
  };

  try {
      await bulkFetchData(typedArgv.addresses, {
          limit: typedArgv.limit,
          maxSignatures: typedArgv.maxSignatures || null,
          smartFetch: typedArgv.smartFetch
      });
      logger.info("Script finished successfully.");
      // Ensure prisma client disconnects
      await prisma.$disconnect();
      process.exit(0);
  } catch (error) {
      logger.error('Script failed with unhandled error:', error);
      await prisma.$disconnect();
      process.exit(1);
  }

})(); 