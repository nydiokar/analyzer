#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '../../utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '../../services/helius-transaction-mapper';
import { HeliusTransaction } from '../../types/helius-api';

// Initialize environment variables
dotenv.config();

// Create logger
const logger = createLogger('BackfillSwapInputsScript');

// Initialize Prisma Client
const prisma = new PrismaClient();

const DEFAULT_BATCH_SIZE = 500; // Process N cached transactions at a time
const CONCURRENT_OPERATIONS = 50; // Number of update/create operations to run in parallel

/**
 * Fetches transactions from HeliusTransactionCache in batches, maps them,
 * and **unconditionally updates** existing SwapAnalysisInput records
 * with the latest mapped `associatedSolValue`, `associatedUsdcValue`, and `interactionType`.
 * Creates records if they don't exist.
 */
async function backfillForWallet(walletAddress: string, batchSize: number): Promise<void> {
  logger.info(`Starting UNCONDITIONAL backfill for wallet: ${walletAddress} with batch size: ${batchSize}`);

  let processedSignatures = 0;
  let totalInputsFound = 0;
  let totalInputsUpdated = 0; // Renamed for clarity
  let totalInputsCreated = 0;
  let totalDbErrors = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    logger.debug(`Fetching batch of cached transactions (skip: ${skip}, take: ${batchSize})...`);
    let cachedTransactionsData: { signature: string; rawData: any }[] = [];
    try {
      cachedTransactionsData = await prisma.heliusTransactionCache.findMany({
        select: { signature: true, rawData: true }, 
        orderBy: { timestamp: 'asc' }, 
        skip: skip,
        take: batchSize,
      });
    } catch (dbError) {
      logger.error(`Failed to fetch batch from HeliusTransactionCache`, { error: dbError, skip, batchSize });
      hasMore = false; 
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
        if (parsed && parsed.signature && parsed.timestamp) {
            parsedTransactions.push(parsed);
        } else {
            logger.warn(`Skipping cached transaction with missing data`, { signature: cachedTx.signature });
        }
      } catch (parseError) {
        logger.error(`Failed to parse rawData for cached signature: ${cachedTx.signature}`, { error: parseError });
      }
    }

    if (parsedTransactions.length === 0) {
        logger.warn(`Batch starting at skip=${skip} resulted in 0 successfully parsed transactions.`);
        skip += cachedTransactionsData.length; 
        continue;
    }

    logger.debug(`Mapping ${parsedTransactions.length} transactions for wallet ${walletAddress}...`);
    const mappedInputs: Prisma.SwapAnalysisInputCreateInput[] = mapHeliusTransactionsToIntermediateRecords(walletAddress, parsedTransactions);
    totalInputsFound += mappedInputs.length;

    if (mappedInputs.length > 0) {
      logger.debug(`Processing ${mappedInputs.length} mapped inputs for updates/creates...`);
      let batchUpdated = 0;
      let batchCreated = 0;
      let batchErrors = 0;

      // Process DB operations in smaller concurrent chunks
      for (let i = 0; i < mappedInputs.length; i += CONCURRENT_OPERATIONS) {
          const chunk = mappedInputs.slice(i, i + CONCURRENT_OPERATIONS);

          const dbPromises = chunk.map(async (input) => {
              try {
                  // Use the correct unique constraint including amount
                  const whereCondition: Prisma.SwapAnalysisInputWhereUniqueInput = {
                       signature_mint_direction_amount: { // Correct constraint name
                           signature: input.signature as string,
                           mint: input.mint as string,
                           direction: input.direction as string,
                           amount: input.amount as number // Add amount for uniqueness
                       }
                  };

                  // Check if record exists using only ID selection for speed
                  const existingRecord = await prisma.swapAnalysisInput.findUnique({
                       where: whereCondition,
                       select: { id: true } // Only need to know if it exists
                  });

                  if (existingRecord) {
                      // Record exists, perform an UPDATE
                      const fieldsToUpdate: Prisma.SwapAnalysisInputUpdateInput = {
                          associatedSolValue: input.associatedSolValue,
                          associatedUsdcValue: input.associatedUsdcValue ?? null,
                          interactionType: input.interactionType ?? null,
                          // Add any other fields from the mapper you want to ensure are updated
                      };
                      await prisma.swapAnalysisInput.update({
                          where: whereCondition,
                          data: fieldsToUpdate,
                      });
                      return { status: 'fulfilled', action: 'updated' };
                  } else {
                      // Record doesn't exist, perform a CREATE
                      const createData: Prisma.SwapAnalysisInputCreateInput = {
                          walletAddress: input.walletAddress,
                          signature: input.signature,
                          timestamp: input.timestamp,
                          mint: input.mint,
                          amount: input.amount,
                          direction: input.direction,
                          associatedSolValue: input.associatedSolValue,
                          associatedUsdcValue: input.associatedUsdcValue ?? null,
                          interactionType: input.interactionType ?? null,
                      };
                      await prisma.swapAnalysisInput.create({ data: createData });
                      return { status: 'fulfilled', action: 'created' };
                  }
              } catch (err) {
                  // *** MODIFIED ERROR HANDLING ***
                  // Specifically check for the unique constraint violation error (P2002)
                  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                      // This likely means another concurrent operation created the record between 
                      // our findUnique check and our create attempt (race condition).
                      // We can treat this as a non-fatal issue for the backfill.
                      logger.warn(`Caught P2002 (Unique Constraint Violation) on create for sig ${input.signature}, mint ${input.mint}, dir ${input.direction}. Likely race condition, treating as handled.`);
                      // We might increment 'updated' or a separate 'conflict' counter here if needed for detailed stats
                      // For now, just don't count it as a hard error.
                      return { status: 'fulfilled', action: 'conflict_handled' }; // Indicate it was handled
                  } else {
                      // Log other unexpected DB errors
                      logger.error(`Unexpected DB operation failed for sig ${input.signature}, mint ${input.mint}, dir ${input.direction}`, { error: err });
                      return { status: 'rejected', reason: err };
                  }
              }
          });

          const results = await Promise.allSettled(dbPromises);

          results.forEach(result => {
              if (result.status === 'fulfilled') {
                  // Use type assertion after checking status
                  const fulfilledResult = result as PromiseFulfilledResult<{ status: string; action: string }>;
                  if (fulfilledResult.value.action === 'updated') batchUpdated++;
                  if (fulfilledResult.value.action === 'created') batchCreated++;
                  // Optionally track handled conflicts: 
                  // if (fulfilledResult.value.action === 'conflict_handled') batchConflicts++; 
              } else {
                  batchErrors++;
              }
          });
      } // End loop through concurrent chunks

      totalInputsUpdated += batchUpdated; // Use updated counter name
      totalInputsCreated += batchCreated;
      totalDbErrors += batchErrors;

      logger.info(`Processed DB ops batch (skip ${skip}): Mapped ${mappedInputs.length} -> Updated: ${batchUpdated}, Created: ${batchCreated}, Errors: ${batchErrors}`);

    } else {
        logger.info(`Processed batch (skip ${skip}): Found 0 relevant inputs for wallet ${walletAddress}.`);
    }

    processedSignatures += cachedTransactionsData.length;
    skip += cachedTransactionsData.length;

  } // end while(hasMore)

  logger.info(`Backfill complete for wallet: ${walletAddress}`);
  logger.info(`Summary: Total cached sigs processed: ${processedSignatures}, Found: ${totalInputsFound} inputs -> Updated: ${totalInputsUpdated}, Created: ${totalInputsCreated}, DB Errors: ${totalDbErrors}`); // Use updated counter name in summary
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