#!/usr/bin/env node
/**
 * BACKFILL SWAP INPUTS SCRIPT
 * 
 * PURPOSE:
 * Reprocesses existing cached transactions through the mapper to update SwapAnalysisInput
 * records with new logic (like fee calculations, improved filtering). This script works
 * with ALREADY CACHED transactions and doesn't fetch new data from Helius.
 * 
 * WHEN TO USE:
 * ✅ After deploying mapper changes to update existing data with new logic
 * ✅ When you want to add fee data to existing records
 * ✅ When you want to apply new filtering logic to existing transactions
 * ✅ Debugging specific transactions (using --signature mode)
 * 
 * WHAT IT DOES:
 * 1. Reads transactions from HeliusTransactionCache (already fetched data)
 * 2. Reprocesses them through the mapper with latest logic
 * 3. Updates existing SwapAnalysisInput records (UPSERT)
 * 4. Preserves existing data while adding new fields/calculations
 * 
 * DIFFERENCE FROM BULK DATA FETCHER:
 * - Bulk Data Fetcher: Fetches NEW data from Helius API
 * - Backfill Script: Reprocesses EXISTING cached data with new logic
 * 
 * EXAMPLES:
 * # Reprocess all cached transactions for a wallet
 * npx ts-node backfill-swap-inputs.ts --address WALLET_ADDRESS --batchSize 200
 * 
 * # Debug a specific transaction
 * npx ts-node backfill-swap-inputs.ts --address WALLET_ADDRESS --signature TX_SIGNATURE
 * 
 * # Process in smaller batches (useful for large wallets)
 * npx ts-node backfill-swap-inputs.ts --address WALLET_ADDRESS --batchSize 50
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from 'core/utils/logger'; 
import { mapHeliusTransactionsToIntermediateRecords } from '../../core/services/helius-transaction-mapper';
import { HeliusTransaction } from '../../types/helius-api';
import zlib from 'zlib';
import { DatabaseService } from '../../core/services/database-service';

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

const DEFAULT_BATCH_SIZE = 200; // Process N cached transactions at a time
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
    const rawDataBuffer = cachedTransactionData.rawData as Buffer;
    if (!Buffer.isBuffer(rawDataBuffer)) {
      logger.error(`Transaction ${signature} rawData is not a Buffer. Type: ${typeof rawDataBuffer}. Skipping.`);
      return;
    }
    const decompressedBuffer = zlib.inflateSync(rawDataBuffer);
    const decompressedString = decompressedBuffer.toString('utf-8');
    const parsed = JSON.parse(decompressedString) as HeliusTransaction;

    if (parsed && parsed.signature && parsed.timestamp) {
      parsedTransaction = parsed;
    } else {
      logger.warn(`Cached transaction ${signature} has missing critical data after parsing.`);
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

  const dbService = new DatabaseService();

  let processedTransactions = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let totalWsolSkipped = 0;
  let totalWithFeeData = 0;

  // Counter for problematic rawData to Buffer conversions (limits console.log spam)
  let problematicRowsCounter: number = 0; 
  // Counter for errors during decompression/parsing after successful Buffer conversion
  let problematicProcessingErrorCounter: number = 0; 
  // Counter for successfully parsed but missing critical fields
  let missingFieldsLogCounter: number = 0;

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
         cachedTransactionsData = await prisma.heliusTransactionCache.findMany({
             select: { signature: true, rawData: true },
             orderBy: { timestamp: 'asc' }, 
             skip: skip,
             take: batchSize,
         });
         logger.info(`Fetched ${cachedTransactionsData.length} records in this batch (skip: ${skip}).`);
         if (cachedTransactionsData.length > 0 && skip === 0) { // Log details only for the very first batch
             logger.info(`First record in first batch - Signature: ${cachedTransactionsData[0].signature}, rawData type: ${typeof cachedTransactionsData[0].rawData}, isBuffer: ${Buffer.isBuffer(cachedTransactionsData[0].rawData)}`);
             if (Buffer.isBuffer(cachedTransactionsData[0].rawData)) {
                 logger.info(`  rawData Buffer length (first record, first batch): ${cachedTransactionsData[0].rawData.length}`);
             }
         }
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

             let rawDataBufferLoop: Buffer; 
             const rawDataObject = cachedTx.rawData; 

             if (Buffer.isBuffer(rawDataObject)) {
                 rawDataBufferLoop = rawDataObject;
             } else if (typeof rawDataObject === 'object' && rawDataObject !== null && rawDataObject.type === 'Buffer' && Array.isArray(rawDataObject.data)) {
                 rawDataBufferLoop = Buffer.from(rawDataObject.data);
             } else if (typeof rawDataObject === 'object' && rawDataObject !== null && !Array.isArray(rawDataObject)) {
                 const byteArray = Object.values(rawDataObject).filter(v => typeof v === 'number') as number[];
                 const isValidByteArrayCheck = byteArray.length > 0 && byteArray.every(v => typeof v === 'number' && v >= 0 && v <= 255);
                 if (isValidByteArrayCheck) {
                     rawDataBufferLoop = Buffer.from(byteArray);
                 } else {
                    logger.warn(`Cached transaction ${cachedTx.signature} rawData is not a Buffer and not a recognized Buffer-like object (array-like failed conversion). Type: ${typeof rawDataObject}. Skipping.`);
                    if (problematicRowsCounter < 2) { 
                        // console.log(`Problematic rawDataObject (unhandled type) for ${cachedTx.signature}:`, JSON.stringify(rawDataObject, null, 2));
                    }
                    problematicRowsCounter++;
                    continue;
                 }
             } else {
                 logger.warn(`Cached transaction ${cachedTx.signature} rawData is not a Buffer and not a recognized Buffer-like object. Type: ${typeof rawDataObject}. Skipping.`);
                 if (problematicRowsCounter < 2) { 
                     // console.log(`Problematic rawDataObject (unhandled type) for ${cachedTx.signature}:`, JSON.stringify(rawDataObject, null, 2));
                 }
                 problematicRowsCounter++;
                 continue;
             }

             // At this point, rawDataBufferLoop should be a valid Buffer
             // Now, try to decompress and parse it.
             try {
                const decompressedBuffer = zlib.inflateSync(rawDataBufferLoop);
                const decompressedString = decompressedBuffer.toString('utf-8');
                
                // Perform a single JSON.parse, assuming decompressedString is now always a clean single JSON string
                const parsed = JSON.parse(decompressedString) as HeliusTransaction;

                // Basic validation after the single parse
                if (parsed && typeof parsed === 'object' && parsed.signature && parsed.timestamp) {
                    parsedTransactions.push(parsed);
                } else {
                    if (missingFieldsLogCounter < 3) {
                        logger.warn(`[MISSING DATA AFTER PARSE] Transaction ${cachedTx.signature} appears to be missing critical data after successful parsing or is not an object.`);
                        logger.warn(`  Details for ${cachedTx.signature} (Occurrence #${missingFieldsLogCounter + 1}):`);
                        logger.warn(`    typeof parsed: ${typeof parsed}, parsed value: ${JSON.stringify(parsed, null, 2)?.substring(0, 1000)}...`);
                        if (parsed && typeof parsed === 'object') {
                            logger.warn(`    parsed.signature type: ${typeof (parsed as any).signature}, value: ${(parsed as any).signature}`);
                            logger.warn(`    parsed.timestamp type: ${typeof (parsed as any).timestamp}, value: ${(parsed as any).timestamp}`);
                        }
                        missingFieldsLogCounter++;
                    }
                }
            } catch (processError: any) {
                let stage = "unknown_processing";
                let errorDetails: any = { message: processError.message };

                if (processError.message.toLowerCase().includes('incorrect header check') || 
                    processError.message.toLowerCase().includes('invalid block type') || 
                    processError.message.toLowerCase().includes('zlib') ||
                    processError.code // zlib errors often have error codes like 'Z_DATA_ERROR'
                ) {
                    stage = "zlib_inflate";
                    errorDetails.code = processError.code;
                } else if (processError instanceof SyntaxError) { // JSON.parse errors are SyntaxError
                    stage = "json_parse";
                } else if (processError.message.toLowerCase().includes('tostring')) { // Less common for Buffer.toString('utf-8')
                    stage = "buffer_tostring";
                }

                logger.error(`Error during ${stage} for ${cachedTx.signature}`, {
                    signature: cachedTx.signature,
                    errorName: processError.name,
                    errorMessage: processError.message,
                    errorCode: processError.code, // Include zlib error code if present
                });

                if (problematicProcessingErrorCounter < 3) {
                    if (stage === "zlib_inflate") {
                        logger.warn(`  Buffer sample (first 64 bytes hex) for failed inflate on ${cachedTx.signature}: ${rawDataBufferLoop.slice(0, 64).toString('hex')}`);
                    } else if (stage === "json_parse") {
                        try {
                            // Re-attempt decompression for logging, assuming inflate might have worked but string was bad
                            const tempDecompressedForLog = zlib.inflateSync(rawDataBufferLoop).toString('utf-8');
                            logger.warn(`  Decompressed string snippet (first 200 chars) for failed JSON.parse on ${cachedTx.signature}: ${tempDecompressedForLog.substring(0,200)}...`);
                        } catch (e) {
                            logger.warn(`  Could not get decompressed string for JSON.parse error log on ${cachedTx.signature}. Original inflate/buffer may also be an issue.`);
                            logger.warn(`  Buffer sample (first 64 bytes hex) for ${cachedTx.signature} leading to JSON parse error: ${rawDataBufferLoop.slice(0, 64).toString('hex')}`);
                        }
                    }
                     problematicProcessingErrorCounter++;
                }
                const errorType = getErrorType(processError);
                incrementErrorCount(errorType, `Processing (${stage}) error for ${cachedTx.signature}: ${processError.message}`, errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
            }

         } catch (outerError: any) { 
             logger.error(`Outer catch: Unhandled error processing cached signature: ${cachedTx.signature}`, { errorName: outerError.name, errorMessage: outerError.message });
             const errorType = getErrorType(outerError);
             incrementErrorCount(errorType, `Outer error for ${cachedTx.signature}: ${outerError.message}`, errorTypes, errorSamples, MAX_SAMPLE_ERRORS);
         }
    }
    logger.info(`After parsing loop for batch (skip: ${skip}), parsedTransactions.length: ${parsedTransactions.length}`);

    if (parsedTransactions.length === 0 && cachedTransactionsData.length > 0) {
        logger.warn(`  Batch (skip: ${skip}) had ${cachedTransactionsData.length} records but resulted in 0 parsed transactions. Check parsing logic or rawData content for this batch.`);
        // Optionally log the first signature of this problematic batch if needed for deeper inspection
        // logger.warn(`    First signature in this non-parsing batch: ${cachedTransactionsData[0].signature}`);
    }

    if (parsedTransactions.length === 0) {
        logger.warn(`Batch starting at skip=${skip} resulted in 0 successfully parsed transactions.`);
        skip += cachedTransactionsData.length;
        continue;
    }

    logger.debug(`Mapping ${parsedTransactions.length} transactions...`);
    // Process transactions through the mapper
    const mappingResult = mapHeliusTransactionsToIntermediateRecords(walletAddress, parsedTransactions);
    const mappedInputs: ExtendedSwapAnalysisInput[] = mappingResult.analysisInputs as ExtendedSwapAnalysisInput[]; // Added type assertion

    // Debug output
    if (mappedInputs.length > 0) {
        debugMapperOutput(mappedInputs);
    }

    // Group inputs by signature
    const signatureToInputsMap = new Map<string, ExtendedSwapAnalysisInput[]>();
    for (const input of mappedInputs) {
        const sig = input.signature as string;
        if (!signatureToInputsMap.has(sig)) {
            signatureToInputsMap.set(sig, []);
        }
        signatureToInputsMap.get(sig)!.push(input);
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
                            signature_mint_direction_amount: {
                                signature: data.signature,
                                mint: data.mint,
                                direction: data.direction,
                                amount: data.amount
                            }
                        },
                        create: data,
                        update: {
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

    // Log mapping stats for this batch using dbService
    if (mappingResult.stats) {
        try {
            await dbService.saveMappingActivityLog(walletAddress, mappingResult.stats);
            logger.info(`Mapping activity log saved for wallet ${walletAddress} (batch starting skip: ${skip})`);
        } catch (logError) {
            logger.error(`Failed to save mapping activity log for wallet ${walletAddress}`, { error: logError });
        }
    }

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
  // logger.debug('--- Debugging Mapper Output ---'); // Can be noisy
  if (!mappedInputs || mappedInputs.length === 0) {
    // logger.debug('Mapper produced 0 records.'); // Can be noisy
    return;
  }
  // logger.debug(`Mapper produced ${mappedInputs.length} record(s).`); // Can be noisy
  const sampleSize = Math.min(mappedInputs.length, 1); // Log details for up to 1 record to reduce noise
  // logger.debug(`Showing details for the first ${sampleSize} record(s):`); // Can be noisy
  for (let i = 0; i < sampleSize; i++) {
    const record = mappedInputs[i];
    // logger.debug(`Record ${i + 1}: ${JSON.stringify(record, null, 2)}`); // Can be very noisy
    // Specifically check for fee data if expected
    if (record && (record.feeAmount !== undefined || record.feePercentage !== undefined)) {
      // logger.debug(`  Record ${i + 1} fee data: amount=${record.feeAmount}, percentage=${record.feePercentage}`);
    } else {
      // logger.debug(`  Record ${i + 1} does NOT contain explicit feeAmount/feePercentage fields.`);
    }
  }
  // if (mappedInputs.length > sampleSize) {
  //   logger.debug(`... and ${mappedInputs.length - sampleSize} more record(s).`);
  // }
  // logger.debug('--- End Debugging Mapper Output ---'); // Can be noisy
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