#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { createLogger } from '../../general_crypto/utils/logger';
import { HeliusApiClient } from '../../wallet_analysis/services/helius-api-client';
import { mapHeliusTransactionsToIntermediateRecords } from '../../wallet_analysis/services/helius-transaction-mapper';
import { getWallet, updateWallet, saveSwapAnalysisInputs, prisma } from '../../wallet_analysis/services/database-service';
import { HeliusTransaction } from '../../types/helius-api';
import { Prisma } from '@prisma/client';
import { Wallet } from '@prisma/client';
import fs from 'fs';

// Initialize environment variables
dotenv.config();

// --- Set Log Level based on --verbose ---
const verboseLogging = process.argv.includes('-v') || process.argv.includes('--verbose');
process.env.LOG_LEVEL = verboseLogging ? 'debug' : 'info';
// --- End Log Level Setup ---

const logger = createLogger('BulkDataFetcherScript');

// --- Configuration for Concurrency ---
const DEFAULT_CONCURRENCY = 3; // Number of wallets to process in parallel

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
      logger.debug(`${logPrefix} Successfully saved ${saveResult.count} new records to SwapAnalysisInput table.`);
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
 * Processes a single wallet: fetches state, fetches new/old txns, saves, updates state.
 * Encapsulates the logic previously inside the main loop.
 */
async function processSingleWallet(
    address: string,
    options: { limit: number; maxSignatures?: number | null; smartFetch: boolean },
    heliusClient: HeliusApiClient
): Promise<{ success: boolean, address: string, error?: Error }> {
    const logPrefix = `[${address}]`;
    logger.info(`${logPrefix} Processing wallet...`);
    try {
        // --- Get Wallet State ---
        let stopAtSignature: string | undefined = undefined;
        let newestProcessedTimestamp: number | undefined = undefined;
        let firstProcessedTimestamp: number | undefined = undefined;
        let isInitialFetchForWallet = false;
        const walletState = await getWallet(address);

        if (walletState) {
            stopAtSignature = walletState.newestProcessedSignature ?? undefined;
            newestProcessedTimestamp = walletState.newestProcessedTimestamp ?? undefined;
            firstProcessedTimestamp = walletState.firstProcessedTimestamp ?? undefined;
            logger.debug(`${logPrefix} Found state. Newest: ts=${newestProcessedTimestamp}, sig=${stopAtSignature}. Oldest: ts=${firstProcessedTimestamp}`);
        } else {
            isInitialFetchForWallet = true;
            logger.debug(`${logPrefix} No state found. Initial fetch.`);
        }

        let dbTransactionCount = 0;
        if (options.smartFetch && options.maxSignatures) {
            try {
                dbTransactionCount = await prisma.swapAnalysisInput.count({
                    where: { walletAddress: address }
                });
                // Note: Counting distinct signatures might be more accurate but slower.
                // Using total count as a proxy for smart fetch decision.
                logger.info(`${logPrefix} SmartFetch: Found ~${dbTransactionCount} records in DB.`);
            } catch (error) {
                logger.error(`${logPrefix} SmartFetch: Error counting existing transactions`, { error });
                // Continue, but smart fetch might not be accurate
            }

            if (dbTransactionCount >= options.maxSignatures) {
                logger.info(`${logPrefix} SmartFetch: DB count meets/exceeds target (${options.maxSignatures}). Skipping API fetch.`);
                return { success: true, address };
            }
        }

        let fetchLimit = options.maxSignatures;
        let needsOlderFetch = false;
        let olderFetchLimit: number | null = null;

        if (options.smartFetch && options.maxSignatures && !isInitialFetchForWallet) {
            const neededTotal = Math.max(0, options.maxSignatures - dbTransactionCount);
            logger.info(`${logPrefix} SmartFetch: Need ~${neededTotal} more transactions.`);
            fetchLimit = null; // Fetch all newer first
            needsOlderFetch = neededTotal > 0;
            olderFetchLimit = neededTotal;
        }

        // --- Fetch Newer Transactions ---
        logger.debug(`${logPrefix} Fetching newer transactions...`);
        let fetchedTransactions: HeliusTransaction[] = [];
        try {
            fetchedTransactions = await heliusClient.getAllTransactionsForAddress(
                address, options.limit, fetchLimit,
                stopAtSignature, newestProcessedTimestamp, true, undefined
            );
            logger.info(`${logPrefix} Fetched ${fetchedTransactions.length} newer transactions.`);
        } catch (error) {
             logger.error(`${logPrefix} Failed to fetch newer transactions.`, { error: error instanceof Error ? error.message : String(error) });
             if (!needsOlderFetch) {
                 throw error; // If this was the only planned fetch, propagate the error
             } else {
                 logger.warn(`${logPrefix} Proceeding to older fetch despite error.`);
             }
        }

        // --- Process and Save Newer Transactions ---
        if (fetchedTransactions.length > 0) {
            await processAndSaveTransactions(address, fetchedTransactions, isInitialFetchForWallet);
            if (options.smartFetch && olderFetchLimit) {
                olderFetchLimit = Math.max(0, olderFetchLimit - fetchedTransactions.length);
                logger.info(`${logPrefix} SmartFetch: ${olderFetchLimit} transactions still needed for older pass.`);
            }
        }

        // --- Fetch Older Transactions (if needed) ---
        if (needsOlderFetch && olderFetchLimit !== null && olderFetchLimit > 0) {
            logger.debug(`${logPrefix} SmartFetch: Fetching ${olderFetchLimit} older transactions...`);
            let olderTransactions: HeliusTransaction[] = [];
            try {
                olderTransactions = await heliusClient.getAllTransactionsForAddress(
                    address, options.limit, olderFetchLimit,
                    undefined, undefined, true,
                    firstProcessedTimestamp // Use firstProcessedTimestamp as the 'until' marker
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

        logger.info(`${logPrefix} Finished processing wallet successfully.`);
        return { success: true, address };

    } catch (error) {
        logger.error(`${logPrefix} Unhandled error processing wallet:`, { error });
        return { success: false, address, error: error instanceof Error ? error : new Error(String(error)) };
    }
}

/**
 * Main function for bulk fetching data - MODIFIED FOR CONCURRENCY
 */
async function bulkFetchData(
  walletAddresses: string[],
  options: {
    limit: number;
    maxSignatures?: number | null;
    smartFetch: boolean;
    concurrency: number; // Added concurrency level
  }
): Promise<{ successCount: number, failureCount: number }> {
    logger.info(`Starting CONCURRENT bulk data fetch for ${walletAddresses.length} wallets.`);
    logger.info(`Options: BatchLimit=${options.limit}, SmartFetch=${options.smartFetch}, MaxSignatures=${options.maxSignatures || 'none'}, Concurrency=${options.concurrency}`);

    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) throw new Error('HELIUS_API_KEY environment variable is required.');

    const heliusClient = new HeliusApiClient({ apiKey: heliusApiKey, network: 'mainnet' });

    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    const concurrency = options.concurrency;

    for (let i = 0; i < walletAddresses.length; i += concurrency) {
        const batchAddresses = walletAddresses.slice(i, i + concurrency);
        logger.info(`Processing batch starting at index ${i} (size ${batchAddresses.length})...`);

        const batchPromises = batchAddresses.map(address =>
            processSingleWallet(address, options, heliusClient)
        );

        const results = await Promise.allSettled(batchPromises);

        let batchSuccess = 0;
        let batchFailure = 0;
        results.forEach((result, index) => {
            const address = batchAddresses[index]; // Get address corresponding to result
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    batchSuccess++;
                } else {
                    batchFailure++;
                    logger.error(`[${address}] Processing failed within batch: ${result.value.error?.message || 'Unknown error'}`);
                }
            } else { // status === 'rejected'
                batchFailure++;
                logger.error(`[${address}] Processing promise rejected within batch:`, { error: result.reason });
            }
        });

        totalSuccessCount += batchSuccess;
        totalFailureCount += batchFailure;
        logger.info(`Batch completed. Success: ${batchSuccess}, Failure: ${batchFailure}. Total Success: ${totalSuccessCount}, Total Failure: ${totalFailureCount}`);
        
        // Optional: Add a small delay between batches if rate limiting becomes an issue despite concurrency control
        // await new Promise(resolve => setTimeout(resolve, 100)); 
    }

    logger.info(`Bulk fetch complete. Total Wallets Processed: ${totalSuccessCount}, Total Failures: ${totalFailureCount}`);
    return { successCount: totalSuccessCount, failureCount: totalFailureCount };
}

// --- CLI Setup ---
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('bulk-data-fetcher')
    .usage('$0 --addresses WALLET1... | --walletsFile <path.json> | --uploadCsv <path.csv> [options]')
    .option('addresses', {
      alias: 'a',
      description: 'List of Solana wallet addresses to fetch data for',
      type: 'array',
      string: true,
    })
    .option('walletsFile', {
      alias: 'f',
      type: 'string',
      description: 'Path to a JSON file containing wallet addresses or {address, label} objects',
    })
    .option('uploadCsv', {
        alias: 'c',
        type: 'string',
        description: 'Path to a CSV file containing wallet addresses (one per line, optionally with label)',
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
    .option('concurrency', { // Added concurrency option
        alias: 'cn', // Example alias
        description: 'Number of wallets to fetch data for in parallel',
        type: 'number',
        default: DEFAULT_CONCURRENCY
    })
    .option('verbose', {
      alias: 'v',
      description: 'Enable detailed debug logging',
      type: 'boolean',
      default: false
    })
    .check((argv) => {
        const sources = [argv.addresses, argv.walletsFile, argv.uploadCsv].filter(Boolean).length;
        if (sources === 0) throw new Error('One of --addresses, --walletsFile, or --uploadCsv is required.');
        if (sources > 1) throw new Error('Provide only one of --addresses, --walletsFile, or --uploadCsv.');
        return true;
    })
    .example('npx ts-node src/helpers/db/bulk-data-fetcher.ts --uploadCsv wallets_to_fetch.csv --ms 5000', 'Fetch up to 5000 new txns for wallets in CSV')
    .example('npx ts-node src/helpers/db/bulk-data-fetcher.ts --walletsFile wallets.json --smartFetch --ms 10000', 'Ensure DB has 10k txns for wallets in JSON')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'V')
    .epilogue('Fetches transaction history for multiple wallets (from list or file) and stores intermediate swap data in the database.')
    .parse();

  const typedArgv = argv as {
      addresses?: string[];
      walletsFile?: string;
      uploadCsv?: string;
      limit: number;
      maxSignatures?: number | null;
      smartFetch: boolean;
      concurrency: number; // Added
      verbose: boolean;
      [key: string]: unknown;
  };

  let finalWalletAddresses: string[] = [];

  if (typedArgv.addresses && typedArgv.addresses.length > 0) {
      logger.info(`Processing ${typedArgv.addresses.length} wallets from command line arguments.`);
      finalWalletAddresses = typedArgv.addresses;
  } else if (typedArgv.walletsFile) {
      logger.info(`Processing wallets from JSON file: ${typedArgv.walletsFile}`);
      try {
          const fileContent = fs.readFileSync(typedArgv.walletsFile, 'utf-8');
          const walletsData = JSON.parse(fileContent);
          if (Array.isArray(walletsData)) {
              finalWalletAddresses = walletsData.map((item: any): string | null => {
                  if (typeof item === 'string') return item.trim();
                  if (item && typeof item.address === 'string') return item.address.trim();
                  logger.warn(`Skipping invalid wallet entry in JSON file: ${JSON.stringify(item)}`);
                  return null;
              }).filter((addr): addr is string => addr !== null && addr !== '');
          } else {
              throw new Error('Wallets file is not a JSON array.');
          }
      } catch (error) {
          logger.error(`Error reading or parsing JSON wallets file '${typedArgv.walletsFile}':`, { error });
          process.exit(1);
      }
  } else if (typedArgv.uploadCsv) {
      logger.info(`Processing wallets from CSV file: ${typedArgv.uploadCsv}`);
      try {
          const fileContent = fs.readFileSync(typedArgv.uploadCsv, 'utf-8');
          const lines = fileContent.split('\n').filter(line => line.trim() !== '');
          finalWalletAddresses = lines.map((line: string): string | null => {
              const parts = line.split(',').map(p => p.trim());
              const address = parts[0];
              if (!address) return null; 
              return address;
          }).filter((addr): addr is string => addr !== null && addr !== '');
      } catch (error) {
          logger.error(`Error reading or parsing CSV wallets file '${typedArgv.uploadCsv}':`, { error });
          process.exit(1);
      }
  }

  if (finalWalletAddresses.length === 0) {
      logger.error('No valid wallet addresses found from the specified source. Exiting.');
      process.exit(1);
  }

  try {
      await bulkFetchData(finalWalletAddresses, {
          limit: typedArgv.limit,
          maxSignatures: typedArgv.maxSignatures || null,
          smartFetch: typedArgv.smartFetch,
          concurrency: typedArgv.concurrency // Pass concurrency
      });
      logger.info("Script finished successfully.");
      await prisma.$disconnect();
      process.exit(0);
  } catch (error) {
      logger.error('Script failed with unhandled error:', error);
      await prisma.$disconnect();
      process.exit(1);
  }

})(); 