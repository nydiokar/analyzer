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

// *** NEW FUNCTION for Single Transaction Processing ***
async function processSingleTransaction(walletAddress: string, signature: string): Promise<void> {
  logger.info(`Processing single transaction mode for wallet: ${walletAddress}, signature: ${signature}`);
 

  let cachedTransactionData: { signature: string; rawData: any } | null = null;
  try {
    cachedTransactionData = await prisma.heliusTransactionCache.findUnique({
      where: {
        signature: signature,
        // Optional: Add walletAddress filter if your cache table supports it and it's indexed
        // walletAddress: walletAddress 
      },
      select: { signature: true, rawData: true },
    });
  } catch (dbError) {
    logger.error(`Failed to fetch transaction ${signature} from HeliusTransactionCache`, { error: dbError });
    return; // Exit if DB fetch fails
  }

  if (!cachedTransactionData) {
    logger.warn(`Transaction with signature ${signature} not found in cache.`);
    return;
  }

  let parsedTransaction: HeliusTransaction | null = null;
  try {
    const parsed = JSON.parse(cachedTransactionData.rawData as string) as HeliusTransaction;
    if (parsed && parsed.signature && parsed.timestamp) {
      parsedTransaction = parsed;
    } else {
      logger.warn(`Cached transaction ${signature} has missing critical data after parsing.`);
      return;
    }
  } catch (parseError) {
    logger.error(`Failed to parse rawData for cached signature: ${cachedTransactionData.signature}`, { error: parseError });
    return;
  }

  if (!parsedTransaction) {
      logger.error("Failed to obtain a valid parsed transaction.");
      return;
  }

  logger.debug(`Mapping transaction ${signature} for wallet ${walletAddress}...`);
  
  // IMPORTANT: Call mapper with an array containing the single transaction
  const mappedInputs: Prisma.SwapAnalysisInputCreateInput[] = mapHeliusTransactionsToIntermediateRecords(walletAddress, [parsedTransaction]); 

  logger.info(`--- Mapped Results for Signature: ${signature} ---`);
  if (mappedInputs.length > 0) {
      console.log(JSON.stringify(mappedInputs, null, 2)); // Pretty print the results
  } else {
      logger.info("Mapper produced 0 analysis input records for this transaction.");
  }
  logger.info(`--- End Mapped Results ---`);
}
// *** END NEW FUNCTION ***


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
      logger.debug(`Processing ${mappedInputs.length} mapped inputs, checking for changes before upsert...`);
      let batchSkipped = 0; 
      let batchUpserted = 0;
      let batchErrors = 0;

      // Process DB operations in smaller concurrent chunks
      for (let i = 0; i < mappedInputs.length; i += CONCURRENT_OPERATIONS) {
          const chunk = mappedInputs.slice(i, i + CONCURRENT_OPERATIONS);

          const dbPromises = chunk.map(async (input) => {
              try {
                   // Define the unique condition for lookup
                   const whereCondition: Prisma.SwapAnalysisInputWhereUniqueInput = {
                       signature_mint_direction_amount: { 
                           signature: input.signature as string,
                           mint: input.mint as string,
                           direction: input.direction as string,
                           amount: input.amount as number 
                       }
                   };

                   // --- Check if update is necessary ---
                   const existingRecord = await prisma.swapAnalysisInput.findUnique({
                       where: whereCondition,
                       select: { // Select only the fields we need to compare
                           associatedSolValue: true,
                           associatedUsdcValue: true,
                           interactionType: true 
                       }
                   });

                   let needsUpdate = true; // Assume update is needed unless proven otherwise
                   if (existingRecord) {
                       const currentSol = existingRecord.associatedSolValue;
                       const newSol = input.associatedSolValue;
                       const currentUsdc = existingRecord.associatedUsdcValue ?? null; // Normalize null
                       const newUsdc = input.associatedUsdcValue ?? null; // Normalize null
                       const currentType = existingRecord.interactionType ?? null; // Normalize null
                       const newType = input.interactionType ?? null; // Normalize null

                       // Basic comparison (adjust if float precision issues arise)
                       if (currentSol === newSol && currentUsdc === newUsdc && currentType === newType) {
                           needsUpdate = false;
                       }
                   }
                   // --- End Check ---

                   if (!needsUpdate) {
                       // logger.debug(`Skipping upsert for sig ${input.signature}, mint ${input.mint} - no changes detected.`);
                       return { status: 'fulfilled', action: 'skipped' }; 
                   } else {
                       // logger.debug(`Proceeding with upsert for sig ${input.signature}, mint ${input.mint} - changes detected or new record.`);
                       // Define the data for creation
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

                       // Define the data for update 
                       const updateData: Prisma.SwapAnalysisInputUpdateInput = {
                           associatedSolValue: input.associatedSolValue,
                           associatedUsdcValue: input.associatedUsdcValue ?? null,
                           interactionType: input.interactionType ?? null,
                       };

                       // Perform the upsert operation ONLY if needed
                       await prisma.swapAnalysisInput.upsert({
                           where: whereCondition,
                           create: createData,
                           update: updateData,
                       });
                       return { status: 'fulfilled', action: 'upserted' }; 
                   }

              } catch (err) {
                   logger.error(`DB operation failed for sig ${input.signature}, mint ${input.mint}, dir ${input.direction}`, { error: err });
                   return { status: 'rejected', reason: err };
              }
          });

          const results = await Promise.allSettled(dbPromises);

          // Update batch counters based on action
          results.forEach(result => {
              if (result.status === 'fulfilled') {
                   // Use type assertion after checking status
                   const fulfilledResult = result as PromiseFulfilledResult<{ status: string; action: string }>;
                  if (fulfilledResult.value.action === 'skipped') batchSkipped++;
                  if (fulfilledResult.value.action === 'upserted') batchUpserted++;
              } else {
                  batchErrors++;
              }
          });
           logger.info(`Processed DB upsert batch (chunk size ${chunk.length}): Upserted: ${batchUpserted}, Skipped (no change): ${batchSkipped}, Errors: ${batchErrors}`); 
           // Accumulate totals if needed
           totalDbErrors += batchErrors;

      } // End loop through concurrent chunks

       logger.info(`Finished processing mapped inputs batch (skip ${skip}). Total DB errors so far: ${totalDbErrors}`);

    } else {
        logger.info(`Processed batch (skip ${skip}): Found 0 relevant inputs for wallet ${walletAddress}.`);
    }

    processedSignatures += cachedTransactionsData.length;
    skip += cachedTransactionsData.length;

  } // end while(hasMore)

   logger.info(`Backfill complete for wallet: ${walletAddress}`);
   logger.info(`Summary: Total cached sigs processed: ${processedSignatures}, Found: ${totalInputsFound} potential inputs. DB Errors during upsert: ${totalDbErrors}`); 
}

// --- Main Execution ---
(async () => {
   const argv = await yargs(hideBin(process.argv))
    .scriptName('backfill-swap-inputs')
    .usage('$0 --address WALLET_ADDRESS [--batchSize N] [--signature TX_SIGNATURE]')
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
    .option('signature', {
        alias: 's',
        description: 'Specific transaction signature to process in debug mode',
        type: 'string',
        demandOption: false
    })
    .help()
    .alias('help', 'h')
    .parse();

  const typedArgv = argv as {
      address: string;
      batchSize: number;
      signature?: string;
      [key: string]: unknown;
  };

  try {
    if (typedArgv.signature) {
        await processSingleTransaction(typedArgv.address, typedArgv.signature);
    } else {
        await backfillForWallet(typedArgv.address, typedArgv.batchSize);
    }
  } catch (error) {
    logger.error('Unhandled error during backfill process', { error });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    logger.info('Database connection closed.');
  }
})(); 