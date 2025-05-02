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
      logger.debug(`Processing ${mappedInputs.length} mapped inputs using upsert...`);
      let batchUpdated = 0; // Will track records updated by upsert
      let batchCreated = 0; // Will track records created by upsert
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

                   // Define the data for update (only fields that should change)
                   const updateData: Prisma.SwapAnalysisInputUpdateInput = {
                       associatedSolValue: input.associatedSolValue,
                       associatedUsdcValue: input.associatedUsdcValue ?? null,
                       interactionType: input.interactionType ?? null,
                       // DO NOT update fields that are part of the unique key (sig, mint, dir, amount)
                       // Add other fields here if the mapper provides updated values for them
                   };

                   // Perform the upsert operation
                   const result = await prisma.swapAnalysisInput.upsert({
                       where: whereCondition,
                       create: createData,
                       update: updateData,
                       // Optionally select the id to know if it was create/update, but Prisma doesn't directly return this easily in upsert result itself
                   });
                  
                   // Note: It's harder to precisely track created vs updated with simple upsert result. 
                   // We'll just count success/error for now. A more complex approach could re-query.
                   return { status: 'fulfilled' }; 

              } catch (err) {
                   // Log unexpected DB errors (P2002 should be gone now)
                   logger.error(`Upsert failed for sig ${input.signature}, mint ${input.mint}, dir ${input.direction}`, { error: err });
                   return { status: 'rejected', reason: err };
              }
          });

          const results = await Promise.allSettled(dbPromises);

          let successes = 0;
          results.forEach(result => {
              if (result.status === 'fulfilled') {
                   successes++;
                   // Can't easily distinguish created vs updated here without extra query/logic
              } else {
                  batchErrors++;
              }
          });
          // Adjust logging since we can't easily split updated/created counts anymore
          logger.info(`Processed DB upsert batch (chunk size ${chunk.length}): Successes: ${successes}, Errors: ${batchErrors}`); 
          // Accumulate total successes if needed, maybe just log batch results
          // totalInputsUpdated += ?; // Cannot easily track these separately now
          // totalInputsCreated += ?;
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
   // Adjust summary log as created/updated counts aren't tracked separately by default with upsert
   logger.info(`Summary: Total cached sigs processed: ${processedSignatures}, Found: ${totalInputsFound} potential inputs. DB Errors during upsert: ${totalDbErrors}`); 
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