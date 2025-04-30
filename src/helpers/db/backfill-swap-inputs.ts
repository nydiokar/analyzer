#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '../../services/helius-transaction-mapper';
import { saveSwapAnalysisInputs } from '../../services/database-service';
import { HeliusTransaction } from '../../types/helius-api';

// Initialize environment variables
dotenv.config();

// Create logger
const logger = createLogger('BackfillSwapInputsScript');

// Initialize Prisma Client
const prisma = new PrismaClient();

const DEFAULT_BATCH_SIZE = 200; // Process N cached transactions at a time

/**
 * Fetches transactions from HeliusTransactionCache in batches,
 * maps them using the provided mapper, and saves the results
 * to SwapAnalysisInput for a specific wallet address.
 */
async function backfillForWallet(walletAddress: string, batchSize: number): Promise<void> {
  logger.info(`Starting backfill for wallet: ${walletAddress} with batch size: ${batchSize}`);

  let processedSignatures = 0;
  let totalInputsFound = 0;
  let totalInputsSaved = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    logger.debug(`Fetching batch of cached transactions (skip: ${skip}, take: ${batchSize})...`);
    let cachedTransactionsData: { signature: string; rawData: any }[] = [];
    try {
      cachedTransactionsData = await prisma.heliusTransactionCache.findMany({
        select: { signature: true, rawData: true }, // Select only needed fields
        orderBy: { timestamp: 'asc' }, // Process in chronological order (optional)
        skip: skip,
        take: batchSize,
      });
    } catch (dbError) {
      logger.error(`Failed to fetch batch from HeliusTransactionCache`, { error: dbError, skip, batchSize });
      hasMore = false; // Stop processing if fetch fails
      continue;
    }

    if (cachedTransactionsData.length === 0) {
      logger.info('No more cached transactions found.');
      hasMore = false;
      continue;
    }

    const parsedTransactions: HeliusTransaction[] = [];
    for (const cachedTx of cachedTransactionsData) {
      try {
        const parsed = JSON.parse(cachedTx.rawData as string) as HeliusTransaction;
        // Basic validation
        if (parsed && parsed.signature && parsed.timestamp) {
            parsedTransactions.push(parsed);
        } else {
            logger.warn(`Skipping cached transaction with missing data`, { signature: cachedTx.signature });
        }
      } catch (parseError) {
        logger.error(`Failed to parse rawData for cached signature: ${cachedTx.signature}`, { error: parseError });
        // Optionally skip this specific transaction or stop the whole batch?
        // Skipping for now.
      }
    }

    if (parsedTransactions.length === 0) {
        logger.warn(`Batch starting at skip=${skip} resulted in 0 successfully parsed transactions.`);
        skip += cachedTransactionsData.length; // Move skip forward by the number of raw records fetched
        continue;
    }

    // Map the parsed transactions for the target wallet
    logger.debug(`Mapping ${parsedTransactions.length} transactions for wallet ${walletAddress}...`);
    const analysisInputsToSave = mapHeliusTransactionsToIntermediateRecords(walletAddress, parsedTransactions);
    totalInputsFound += analysisInputsToSave.length;

    if (analysisInputsToSave.length > 0) {
      // Save the results using the existing service function
      logger.debug(`Saving ${analysisInputsToSave.length} potential SwapAnalysisInput records...`);
      try {
        const saveResult = await saveSwapAnalysisInputs(analysisInputsToSave);
        totalInputsSaved += saveResult.count;
        logger.info(`Processed batch (skip ${skip}): Found ${analysisInputsToSave.length} inputs, Saved ${saveResult.count} new inputs.`);
      } catch (saveError) {
        logger.error(`Failed to save SwapAnalysisInput batch`, { error: saveError });
        // Decide if we should stop or continue on save errors
        // Continuing for now, but logging the error
      }
    } else {
        logger.info(`Processed batch (skip ${skip}): Found 0 relevant inputs for wallet ${walletAddress}.`);
    }

    processedSignatures += cachedTransactionsData.length;
    skip += cachedTransactionsData.length; // Increment skip by the number fetched

    // Optional: Add a small delay between batches if needed
    // await new Promise(resolve => setTimeout(resolve, 50));

  } // end while(hasMore)

  logger.info(`Backfill complete for wallet: ${walletAddress}`);
  logger.info(`Summary: Total cached signatures processed: ${processedSignatures}, Total potential inputs found: ${totalInputsFound}, Total new inputs saved: ${totalInputsSaved}`);
}

// --- Main Execution --- 
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('backfill-swap-inputs')
    .usage('$0 --address WALLET_ADDRESS [--batchSize N]')
    .option('address', {
      alias: 'a',
      description: 'Solana wallet address to backfill SwapAnalysisInput records for',
      type: 'string',
      demandOption: true
    })
    .option('batchSize', {
        alias: 'b',
        description: 'Number of cached transactions to process per batch',
        type: 'number',
        default: DEFAULT_BATCH_SIZE
    })
    .help()
    .alias('help', 'h')
    .parse();

  const typedArgv = argv as {
      address: string;
      batchSize: number;
      [key: string]: unknown;
  };

  try {
    await backfillForWallet(typedArgv.address, typedArgv.batchSize);
  } catch (error) {
    logger.error('Unhandled error during backfill process', { error });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    logger.info('Database connection closed.');
  }
})(); 