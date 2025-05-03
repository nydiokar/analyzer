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

// Helper function with proper type safety
function getErrorType(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'UnknownError';
}

/**
 * Fetches transactions from HeliusTransactionCache in batches, maps them,
 * and **unconditionally updates** existing SwapAnalysisInput records
 * with the latest mapped `associatedSolValue`, `associatedUsdcValue`, and `interactionType`.
 * Creates records if they don't exist.
 */
async function backfillForWallet(walletAddress: string, batchSize: number): Promise<void> {
  logger.info(`Starting backfill for wallet: ${walletAddress} with batch size: ${batchSize}`);
  logger.info(`This will update the database with values from the improved mapper`);

  let processedTransactions = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  // Error tracking
  const errorTypes = new Map<string, number>();
  const errorSamples = new Map<string, string[]>();
  const MAX_SAMPLE_ERRORS = 5; // Maximum number of sample errors to store per type
  
  let skip = 0;
  let hasMore = true;

  // Keep track of processed transactions to avoid duplication
  const processedSignatures = new Set<string>();

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
      const errorType = getErrorType(dbError);
      incrementErrorCount(errorType, String(dbError), errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
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
        // Skip already processed transactions for this run
        if (processedSignatures.has(cachedTx.signature)) {
          continue;
        }
        processedSignatures.add(cachedTx.signature);
        
        const parsed = JSON.parse(cachedTx.rawData as string) as HeliusTransaction;
        if (parsed && parsed.signature && parsed.timestamp) {
            parsedTransactions.push(parsed);
        } else {
            logger.warn(`Skipping cached transaction with missing data`, { signature: cachedTx.signature });
        }
      } catch (parseError) {
        const errorType = getErrorType(parseError);
        incrementErrorCount(errorType, String(parseError), errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
        logger.error(`Failed to parse rawData for cached signature: ${cachedTx.signature}`, { error: parseError });
      }
    }

    if (parsedTransactions.length === 0) {
        logger.warn(`Batch starting at skip=${skip} resulted in 0 successfully parsed transactions.`);
        skip += cachedTransactionsData.length; 
        continue;
    }

    logger.debug(`Processing ${parsedTransactions.length} transactions...`);
    // Process transactions through the mapper
    const mappedInputs = mapHeliusTransactionsToIntermediateRecords(walletAddress, parsedTransactions);
    
    // Group inputs by signature for database operations
    const signatureToInputsMap = new Map<string, Prisma.SwapAnalysisInputCreateInput[]>();
    for (const input of mappedInputs) {
      const sig = input.signature as string;
      if (!signatureToInputsMap.has(sig)) {
        signatureToInputsMap.set(sig, []);
      }
      signatureToInputsMap.get(sig)!.push(input);
    }
    
    // Update the database for all transactions in this batch
    logger.info(`Processing ${signatureToInputsMap.size} transactions...`);
    
    let batchCreated = 0;
    let batchUpdated = 0;
    let batchSkipped = 0;
    let batchErrors = 0;
    
    // Process transactions in smaller batches to manage memory
    const sigBatches: string[][] = [];
    const signatures = Array.from(signatureToInputsMap.keys());
    for (let i = 0; i < signatures.length; i += CONCURRENT_OPERATIONS) {
      sigBatches.push(signatures.slice(i, i + CONCURRENT_OPERATIONS));
    }
    
    // Process each batch of transactions
    for (const sigBatch of sigBatches) {
      const batchPromises = sigBatch.map(async (signature) => {
        const inputs = signatureToInputsMap.get(signature) || [];
        if (inputs.length === 0) return { signature, action: 'empty' };
        
        try {
          // 1. Find all existing records for this signature to determine create vs update
          const existingRecords = await prisma.swapAnalysisInput.findMany({
            where: {
              signature: signature,
              walletAddress: walletAddress
            }
          });
          
          // Create a map for faster lookups
          const existingMap = new Map();
          for (const record of existingRecords) {
            const key = `${record.mint}:${record.direction}:${record.amount}`;
            existingMap.set(key, record);
          }
          
          // 2. Process each input: update if exists, create if new
          const operations = [];
          for (const input of inputs) {
            const mint = input.mint as string;
            const direction = input.direction as string;
            const amount = input.amount as number;
            const key = `${mint}:${direction}:${amount}`;
            
            // Prepare data with proper nulls for optional fields
            const data = {
              walletAddress: input.walletAddress as string,
              signature: input.signature as string, 
              timestamp: input.timestamp as number,
              mint: mint,
              direction: direction,
              amount: amount,
              associatedSolValue: input.associatedSolValue as number,
              associatedUsdcValue: input.associatedUsdcValue ?? null,
              interactionType: input.interactionType ?? 'UNKNOWN'
            };
            
            if (existingMap.has(key)) {
              // Record exists - check if we need to update
              const existing = existingMap.get(key);
              
              // Only update if there are actual changes
              if (existing.associatedSolValue !== data.associatedSolValue ||
                  existing.associatedUsdcValue !== data.associatedUsdcValue ||
                  existing.interactionType !== data.interactionType) {
                  
                operations.push(
                  prisma.swapAnalysisInput.update({
                    where: { id: existing.id },
                    data: {
                      associatedSolValue: data.associatedSolValue,
                      associatedUsdcValue: data.associatedUsdcValue,
                      interactionType: data.interactionType
                    }
                  }).then(() => ({ action: 'updated' }))
                  .catch(err => {
                    const errorType = getErrorType(err);
                    incrementErrorCount(errorType, `Update error for ${signature}/${mint}/${direction}: ${err}`, 
                                      errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
                    return { action: 'error', error: err };
                  })
                );
              } else {
                operations.push(Promise.resolve({ action: 'skipped' }));
              }
            } else {
              // Record doesn't exist - create it
              operations.push(
                prisma.swapAnalysisInput.create({ data }).then(() => ({ action: 'created' }))
                .catch(err => {
                  const errorType = getErrorType(err);
                  incrementErrorCount(errorType, `Create error for ${signature}/${mint}/${direction}: ${err}`, 
                                    errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
                  return { action: 'error', error: err };
                })
              );
            }
          }
          
          // Execute all operations for this signature
          const results = await Promise.allSettled(operations);
          
          // Count the actions
          let sigCreated = 0;
          let sigUpdated = 0;
          let sigSkipped = 0;
          let sigErrors = 0;
          results.forEach(result => {
            if (result.status === 'fulfilled') {
              if (result.value.action === 'created') sigCreated++;
              else if (result.value.action === 'updated') sigUpdated++;
              else if (result.value.action === 'skipped') sigSkipped++;
              else if (result.value.action === 'error') sigErrors++;
            } else {
              const errorType = 'PromiseRejected';
              incrementErrorCount(errorType, `Promise rejected: ${result.reason}`, 
                                errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
              sigErrors++;
            }
          });
          
          batchCreated += sigCreated;
          batchUpdated += sigUpdated;
          batchSkipped += sigSkipped;
          batchErrors += sigErrors;
          
          return { 
            signature, 
            created: sigCreated, 
            updated: sigUpdated, 
            skipped: sigSkipped,
            errors: sigErrors
          };
        } catch (error) {
          const errorType = getErrorType(error);
          incrementErrorCount(errorType, `Processing error for ${signature}: ${error}`, 
                            errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
          logger.error(`Error processing transaction ${signature}`, { error });
          batchErrors++;
          return { signature, error: String(error) };
        }
      });
      
      await Promise.allSettled(batchPromises);
    }
    
    // Update totals
    totalCreated += batchCreated;
    totalUpdated += batchUpdated;
    totalSkipped += batchSkipped;
    totalErrors += batchErrors;
    
    logger.info(`Batch results: Created ${batchCreated}, Updated ${batchUpdated}, Skipped ${batchSkipped}, Errors ${batchErrors}`);
    
    processedTransactions += parsedTransactions.length;
    skip += cachedTransactionsData.length;

    logger.info(`Progress: ${processedTransactions} transactions, ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} unchanged, ${totalErrors} errors`);
    
    // Periodically log error distributions if we have errors
    if (errorTypes.size > 0 && (processedTransactions % (batchSize * 5) === 0 || !hasMore)) {
      logErrorDistribution(errorTypes, errorSamples);
    }
  }

  // Final error report
  if (errorTypes.size > 0) {
    logErrorDistribution(errorTypes, errorSamples);
  }

  logger.info(`Backfill complete for wallet: ${walletAddress}`);
  logger.info(`Total transactions processed: ${processedTransactions}`);
  logger.info(`Total records created: ${totalCreated}`);
  logger.info(`Total records updated: ${totalUpdated}`);
  logger.info(`Total records unchanged: ${totalSkipped}`);
  logger.info(`Total errors: ${totalErrors}`);
  logger.info(`✅ DATABASE UPDATED with values from the improved mapper`);
}

// Helper function to increment error counts and store samples
function incrementErrorCount(
  errorType: string,
  errorMessage: string,
  errorTypes: Map<string, number>,
  errorSamples: Map<string, string[]>,
  maxSamples: number
): void {
  // Increment count
  errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
  
  // Store sample error message
  if (!errorSamples.has(errorType)) {
    errorSamples.set(errorType, []);
  }
  
  const samples = errorSamples.get(errorType)!;
  if (samples.length < maxSamples) {
    samples.push(errorMessage);
  }
}

// Helper function to log error distribution
function logErrorDistribution(
  errorTypes: Map<string, number>,
  errorSamples: Map<string, string[]>
): void {
  logger.info("--- ERROR DISTRIBUTION ---");
  
  // Convert to array and sort by frequency
  const errorEntries = Array.from(errorTypes.entries())
    .sort((a, b) => b[1] - a[1]); // Sort descending by count
  
  for (const [type, count] of errorEntries) {
    logger.info(`${type}: ${count} occurrences`);
    
    // Log sample errors for this type
    const samples = errorSamples.get(type) || [];
    if (samples.length > 0) {
      logger.info(`Sample errors (${Math.min(samples.length, 3)}/${samples.length}):`);
      samples.slice(0, 3).forEach((sample, i) => {
        logger.info(`  ${i+1}. ${sample.slice(0, 300)}${sample.length > 300 ? '...' : ''}`);
      });
    }
  }
  
  logger.info("--- END ERROR DISTRIBUTION ---");
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