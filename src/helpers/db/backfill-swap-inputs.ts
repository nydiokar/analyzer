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

// Custom type for the extended SwapAnalysisInput with fee fields
interface ExtendedSwapAnalysisInput extends Prisma.SwapAnalysisInputCreateInput {
  feeAmount?: number | null;
  feePercentage?: number | null;
}

const DEFAULT_BATCH_SIZE = 500; // Process N cached transactions at a time
const CONCURRENT_OPERATIONS = 50; // Number of operations to run in parallel

// *** Original Single Transaction Processing Function (Logs Only) ***
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
  const mappedInputs = mapHeliusTransactionsToIntermediateRecords(walletAddress, [parsedTransaction]) as unknown as ExtendedSwapAnalysisInput[];

  // Debug mapper output
  debugMapperOutput(mappedInputs);

  // Check for fee data
  let hasFeeData = false;
  for (const input of mappedInputs) {
    if (input.feeAmount !== undefined && input.feeAmount !== null) {
      hasFeeData = true;
      break;
    }
  }

  logger.info(`--- Mapped Results for Signature: ${signature} ---`);
  logger.info(`Found ${mappedInputs.length} record(s) for this transaction`);
  logger.info(`Records contain fee data: ${hasFeeData ? 'YES' : 'NO'}`);

  // If no fee data but we have results, check if the mapper is returning the correct type
  if (!hasFeeData && mappedInputs.length > 0) {
    logger.info(`Checking mapper implementation - fields present in first record:`);
    const sample = mappedInputs[0];
    const keys = Object.keys(sample);
    logger.info(JSON.stringify(keys));
    logger.info(`Raw fields data: ${JSON.stringify(sample)}`);
  }

  if (mappedInputs.length > 0) {
      // Add special handling to display fee information
      const enhancedResults = mappedInputs.map(input => {
          // Extract fee info for display
          const feeInfo = input.feeAmount ?
            { feeAmount: input.feeAmount, feePercentage: input.feePercentage } :
            { feeAmount: 'N/A', feePercentage: 'N/A' };

          // Return input with fee info highlighted
          return {
              ...input,
              ...feeInfo
          };
      });
      console.log(JSON.stringify(enhancedResults, null, 2)); // Pretty print the results
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

// Helper function to detect unique constraint violations in Prisma errors
function isUniqueConstraintViolation(error: unknown): boolean {
  if (error && typeof error === 'object') {
    // Check if it's a PrismaClientKnownRequestError with code P2002 (unique constraint violation)
    if ('code' in error && error.code === 'P2002') {
      return true;
    }

    // Check error message for unique constraint text
    if ('message' in error && typeof error.message === 'string' &&
        error.message.includes('Unique constraint')) {
      return true;
    }
  }
  return false;
}

/**
 * Fetches transactions from HeliusTransactionCache, maps them,
 * and upserts them into the SwapAnalysisInput table.
 */
async function backfillForWallet(walletAddress: string, batchSize: number): Promise<void> {
  logger.info(`Starting backfill for wallet: ${walletAddress} with batch size: ${batchSize}`);
  logger.info(`<<< MODE: UPSERT. Existing SwapAnalysisInput records will be updated or new ones created. >>>`);

  let processedTransactions = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let totalWsolSkipped = 0;
  let totalWithFeeData = 0;

  const errorTypes = new Map<string, number>();
  const errorSamples = new Map<string, string[]>();
  const MAX_SAMPLE_ERRORS = 5;

  let skip = 0;
  let hasMore = true;
  const processedSignatures = new Set<string>();

  while (hasMore) {
    logger.debug(`Fetching batch of cached transactions (skip: ${skip}, take: ${batchSize})...`);
    let cachedTransactionsData: { signature: string; rawData: any }[] = [];
    try {
        // Fetch transactions (same as before)
         cachedTransactionsData = await prisma.heliusTransactionCache.findMany({
             select: { signature: true, rawData: true },
             orderBy: { timestamp: 'asc' },
             skip: skip,
             take: batchSize,
         });
    } catch (dbError) {
        // Error handling (same as before)
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

    // Parse transactions (same as before)
    const parsedTransactions: HeliusTransaction[] = [];
    for (const cachedTx of cachedTransactionsData) {
         try {
             if (processedSignatures.has(cachedTx.signature)) continue;
             processedSignatures.add(cachedTx.signature);
             const parsed = JSON.parse(cachedTx.rawData as string) as HeliusTransaction;
             if (parsed && parsed.signature && parsed.timestamp) {
                 parsedTransactions.push(parsed);
             } else { /* log warning */ }
         } catch (parseError) { /* handle parse error */ }
    }

    if (parsedTransactions.length === 0) {
        logger.warn(`Batch starting at skip=${skip} resulted in 0 successfully parsed transactions.`);
        skip += cachedTransactionsData.length;
        continue;
    }

    logger.debug(`Mapping ${parsedTransactions.length} transactions...`);
    // Process transactions through the mapper (same as before)
    const mappedInputs = mapHeliusTransactionsToIntermediateRecords(walletAddress, parsedTransactions);
    // Debug output (same as before)
    if (mappedInputs.length > 0) {
        debugMapperOutput(mappedInputs);
    }

    // Group inputs by signature (same as before)
    const signatureToInputsMap = new Map<string, ExtendedSwapAnalysisInput[]>();
    for (const input of mappedInputs) {
        const sig = input.signature as string;
        if (!signatureToInputsMap.has(sig)) {
            signatureToInputsMap.set(sig, []);
        }
        signatureToInputsMap.get(sig)!.push(input as unknown as ExtendedSwapAnalysisInput);
    }

    // --- Process Mapped Transactions (UPSERT) ---
    logger.info(`Processing ${signatureToInputsMap.size} transaction signatures from batch...`);

    let batchUpserted = 0;
    let batchErrors = 0;
    let batchWsolSkipped = 0;
    let batchFeeDataCount = 0;

    // Process signatures individually or in small groups if needed for error isolation
    for (const signature of signatureToInputsMap.keys()) {
        const inputsForSig = signatureToInputsMap.get(signature) || [];
        if (inputsForSig.length === 0) continue;

        try {
            // 2. UPSERT new records from mapper output
            let sigUpserted = 0;
            let sigWsolSkipped = 0;
            let sigFeeDataCount = 0;

            for (const input of inputsForSig) {
                const data: ExtendedSwapAnalysisInput = {
                    walletAddress: input.walletAddress as string,
                    signature: input.signature as string,
                    timestamp: input.timestamp as number,
                    mint: input.mint as string,
                    direction: input.direction as string,
                    amount: input.amount as number,
                    associatedSolValue: input.associatedSolValue as number,
                    associatedUsdcValue: input.associatedUsdcValue ?? null,
                    interactionType: input.interactionType ?? 'UNKNOWN',
                    feeAmount: input.feeAmount ?? null,
                    feePercentage: input.feePercentage ?? null
                };
                const isWsol = data.mint === 'So11111111111111111111111111111111111111112';

                if (isWsol) {
                    sigWsolSkipped++;
                    logger.debug(`WSOL upsert skipped for tx ${signature}, mint ${data.mint}/${data.direction} - this is expected behavior`);
                    continue; // Skip this input for upsert
                }

                try {
                    await prisma.swapAnalysisInput.upsert({
                        where: {
                            // This assumes a unique constraint named 'walletAddress_signature_mint_direction'
                            // (default for @@unique([walletAddress, signature, mint, direction]))
                            // Adjust if your schema uses a custom name or different fields.
                            signature_mint_direction_amount: {
                                signature: data.signature,
                                mint: data.mint,
                                direction: data.direction,
                                amount: data.amount
                            }
                        },
                        create: data,
                        update: {
                            // Fields NOT in the unique key 'signature_mint_direction_amount'
                            // are updated if the record exists.
                            walletAddress: data.walletAddress,
                            timestamp: data.timestamp,
                            associatedSolValue: data.associatedSolValue,
                            associatedUsdcValue: data.associatedUsdcValue,
                            interactionType: data.interactionType,
                            feeAmount: data.feeAmount,
                            feePercentage: data.feePercentage
                        }
                    });
                    sigUpserted++;
                    if (data.feeAmount !== null) sigFeeDataCount++;

                } catch (dbError) {
                     // No longer need isUniqueConstraintViolation check, upsert handles it.
                     // WSOL check moved before the try block.
                     batchErrors++;
                     const errorType = getErrorType(dbError);
                     incrementErrorCount(errorType, `Upsert error for ${signature}/${data.mint}/${data.direction}: ${dbError}`,
                                       errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
                     logger.error(`Failed to upsert record for tx ${signature}, mint ${data.mint}: ${dbError}`);
                }
            }
            batchUpserted += sigUpserted;
            batchWsolSkipped += sigWsolSkipped;
            batchFeeDataCount += sigFeeDataCount;

        } catch (error) {
            batchErrors++; // Count transaction-level errors
            const errorType = getErrorType(error);
            incrementErrorCount(errorType, `Processing error for signature ${signature}: ${error}`,
                              errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
            logger.error(`Error processing signature ${signature}`, { error });
        }
    }

    // Update totals
    totalUpserted += batchUpserted;
    totalErrors += batchErrors;
    totalWsolSkipped += batchWsolSkipped;
    totalWithFeeData += batchFeeDataCount;

    // Log batch results
    logger.info(`Batch results: Upserted ${batchUpserted}, WSOL Upserts Skipped ${batchWsolSkipped}, Fee data count ${batchFeeDataCount}, Errors ${batchErrors}`);

    processedTransactions += parsedTransactions.length; // Count processed transactions
    skip += cachedTransactionsData.length; // Advance skip based on fetched cache count

    // Periodically log error distributions (same as before)
    if (errorTypes.size > 0 && (processedTransactions % (batchSize * 5) === 0 || !hasMore)) {
        logErrorDistribution(errorTypes, errorSamples);
    }
  }

  // Final error report (same as before)
  if (errorTypes.size > 0) {
    logErrorDistribution(errorTypes, errorSamples);
  }

  logger.info(`Backfill complete for wallet: ${walletAddress}`);
  logger.info(`=== SUMMARY ===`);
  logger.info(`Total transactions processed: ${processedTransactions}`);
  logger.info(`Total records upserted: ${totalUpserted}`);
  logger.info(`Total WSOL upserts skipped: ${totalWsolSkipped}`);
  logger.info(`Total records with fee data (from upserts): ${totalWithFeeData}`);
  logger.info(`Total errors encountered: ${totalErrors}`);

  if (totalWithFeeData === 0 && totalUpserted > 0) { // Check only if records were upserted
    logger.warn(`⚠️ NO FEE DATA WAS FOUND in any newly upserted records! Check mapper fee logic.`);
  } else if (totalWithFeeData > 0) {
    logger.info(`✅ Database records UPSERTED using latest mapper output, including fee data (${totalWithFeeData} records).`);
  }
}

// Other helper functions (getErrorType, isUniqueConstraintViolation, incrementErrorCount, logErrorDistribution, debugMapperOutput) remain the same
function incrementErrorCount(
  errorType: string,
  errorMessage: string,
  errorTypes: Map<string, number>,
  errorSamples: Map<string, string[]>,
  maxSamples: number
): void {
  errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
  if ((errorSamples.get(errorType)?.length || 0) < maxSamples) {
    if (!errorSamples.has(errorType)) {
      errorSamples.set(errorType, []);
    }
    errorSamples.get(errorType)!.push(errorMessage);
  }
}

function logErrorDistribution(
  errorTypes: Map<string, number>,
  errorSamples: Map<string, string[]>
): void {
  logger.info("--- Error Distribution ---");
  if (errorTypes.size === 0) {
    logger.info("No errors recorded.");
    return;
  }
  for (const [type, count] of errorTypes.entries()) {
    logger.warn(`Error Type: ${type}, Count: ${count}`);
    if (errorSamples.has(type)) {
      logger.warn(`  Samples for ${type}:`);
      errorSamples.get(type)!.forEach((sample, index) => {
        logger.warn(`    ${index + 1}: ${sample.substring(0, 500)}${sample.length > 500 ? '...' : ''}`); // Log first 500 chars
      });
    }
  }
  logger.info("--- End Error Distribution ---");
}

function debugMapperOutput(mappedInputs: any[]): void {
  logger.debug('--- Debugging Mapper Output ---');
  if (!mappedInputs || mappedInputs.length === 0) {
    logger.debug('Mapper produced 0 records.');
    return;
  }
  logger.debug(`Mapper produced ${mappedInputs.length} record(s).`);
  const sampleSize = Math.min(mappedInputs.length, 3); // Log details for up to 3 records
  logger.debug(`Showing details for the first ${sampleSize} record(s):`);
  for (let i = 0; i < sampleSize; i++) {
    const record = mappedInputs[i];
    logger.debug(`Record ${i + 1}: ${JSON.stringify(record, null, 2)}`);
    // Specifically check for fee data if expected
    if (record && (record.feeAmount !== undefined || record.feePercentage !== undefined)) {
      logger.debug(`  Record ${i + 1} fee data: amount=${record.feeAmount}, percentage=${record.feePercentage}`);
    } else {
      logger.debug(`  Record ${i + 1} does NOT contain explicit feeAmount/feePercentage fields.`);
    }
  }
  if (mappedInputs.length > sampleSize) {
    logger.debug(`... and ${mappedInputs.length - sampleSize} more record(s).`);
  }
  logger.debug('--- End Debugging Mapper Output ---');
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
        description: 'Specific transaction signature to process in debug mode (will show fee info)',
        type: 'string',
        demandOption: false
    })
    .help()
    .alias('help', 'h')
    .epilog('Updates SwapAnalysisInput records with latest values from the mapper, including fee amount and percentage data.')
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