import {
    PrismaClient,
    Wallet,
    SwapAnalysisInput,
    AnalysisRun,
    AnalysisResult,
    AdvancedStatsResult,
    Prisma // Import Prisma namespace for input types
} from '@prisma/client';
import { HeliusTransaction } from '../types/helius-api'; // Assuming HeliusTransaction type is defined here
import { createLogger } from '../utils/logger'; // Assuming createLogger function is defined in utils

// Instantiate Prisma Client - Singleton pattern recommended for production
// Exporting the instance directly is simple for this stage
export const prisma = new PrismaClient();

const logger = createLogger('DatabaseService'); // Add logger

// TODO: Add proper error handling (try...catch) and logging to all functions.
// TODO: Define precise input/output types for function arguments and return values.

// --- Wallet Functions ---

// Type for the data used to update/create a Wallet record
// Using Partial<Wallet> allows updating only specific fields
type WalletUpdateData = Partial<Omit<Wallet, 'address'>>; // Omit address as it's the key

export async function getWallet(walletAddress: string): Promise<Wallet | null> {
  logger.debug(`Fetching wallet data for: ${walletAddress}`);
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { address: walletAddress },
    });
    if (wallet) {
        logger.debug(`Found wallet data for: ${walletAddress}`);
    } else {
        logger.debug(`No wallet data found for: ${walletAddress}`);
    }
    return wallet;
  } catch (error) {
    logger.error(`Error fetching wallet ${walletAddress}`, { error });
    return null;
  }
}

export async function updateWallet(walletAddress: string, data: WalletUpdateData): Promise<Wallet | null> {
  logger.debug(`Upserting wallet data for: ${walletAddress}`, data);
  try {
    const updatedWallet = await prisma.wallet.upsert({
        where: { address: walletAddress },
        update: data,
        create: {
            address: walletAddress,
            ...data, // Spread the rest of the data for creation
        },
    });
    logger.info(`Successfully upserted wallet data for: ${walletAddress}`);
    return updatedWallet;
  } catch (error) {
      logger.error(`Error upserting wallet ${walletAddress}`, { error, data });
      return null;
  }
}

// --- HeliusTransactionCache Functions ---

/**
 * Get cached transaction(s) - supports both single signature and batch operations
 * @param signature A single signature string or array of signature strings to fetch
 * @returns Single transaction, array of transactions, or Map of signature->transaction depending on input
 */
export async function getCachedTransaction(
  signature: string | string[]
): Promise<HeliusTransaction | null | HeliusTransaction[] | Map<string, HeliusTransaction>> {
  // Handle single signature case
  if (typeof signature === 'string') {
    try {
      const cached = await prisma.heliusTransactionCache.findUnique({
        where: { signature },
      });
      if (cached) {
        try {
          return JSON.parse(cached.rawData as string) as HeliusTransaction;
        } catch (parseError) {
          logger.error(`Failed to parse cached rawData for signature ${signature}`, { error: parseError });
          return null;
        }
      } else {
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching cached transaction ${signature}`, { error });
      return null;
    }
  }
  
  // Handle array of signatures case (batch operation)
  if (Array.isArray(signature)) {
    if (signature.length === 0) {
      return new Map();
    }
    
    try {
      const cachedRecords = await prisma.heliusTransactionCache.findMany({
        where: {
          signature: {
            in: signature
          }
        }
      });
      
      logger.debug(`Batch fetched ${cachedRecords.length} out of ${signature.length} requested signatures`);
      
      // Parse all JSON data and create a map of signature -> transaction
      const resultMap = new Map<string, HeliusTransaction>();
      for (const record of cachedRecords) {
        try {
          const tx = JSON.parse(record.rawData as string) as HeliusTransaction;
          resultMap.set(record.signature, tx);
        } catch (parseError) {
          logger.error(`Failed to parse cached rawData for signature ${record.signature}`, { error: parseError });
          // Skip this record - don't add to the map
        }
      }
      
      return resultMap;
    } catch (error) {
      logger.error(`Error batch fetching ${signature.length} cached transactions`, { error });
      return new Map();
    }
  }
  
  // Invalid input case
  logger.error('getCachedTransaction called with invalid signature type', { type: typeof signature });
  return null;
}

export async function saveCachedTransactions(transactions: HeliusTransaction[]) {
    if (transactions.length === 0) {
        logger.debug('No transactions provided to save to cache.');
        return { count: 0 };
    }
    logger.info(`Attempting to save ${transactions.length} transactions to cache efficiently...`);

    // 1. Get signatures from the incoming batch
    const incomingSignatures = transactions.map(tx => tx.signature);

    // 2. Find which of these signatures already exist in the database
    let existingSignatures = new Set<string>();
    try {
        const existingRecords = await prisma.heliusTransactionCache.findMany({
            where: {
                signature: {
                    in: incomingSignatures,
                },
            },
            select: {
                signature: true, // Only select the signature field
            },
        });
        existingSignatures = new Set(existingRecords.map(rec => rec.signature));
        logger.debug(`Found ${existingSignatures.size} existing signatures in cache out of ${incomingSignatures.length} incoming.`);
    } catch (error) {
        logger.error('Error checking for existing signatures in cache', { error });
        return { count: 0 }; // Abort if we cannot check existing signatures
    }

    // 3. Filter the incoming transactions to find only the new ones
    const newTransactions = transactions.filter(tx => !existingSignatures.has(tx.signature));

    if (newTransactions.length === 0) {
        logger.info('No new transactions to add to cache.');
        return { count: 0 };
    }

    logger.info(`Identified ${newTransactions.length} new transactions to insert.`);

    // 4. Prepare data for createMany (only new transactions)
    const dataToSave = newTransactions.map(tx => ({
        signature: tx.signature,
        timestamp: tx.timestamp,
        rawData: JSON.stringify(tx), // Ensure rawData is stringified
        // fetchedAt is handled by @default(now())
    }));

    // 5. Insert the new transactions using createMany
    try {
        const result = await prisma.heliusTransactionCache.createMany({
            data: dataToSave,
            // No skipDuplicates needed here as we pre-filtered
        });
        logger.info(`Cache save complete. ${result.count} new transactions added to cache.`);
        return result;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            logger.error('Prisma Error saving new cached transactions', { code: error.code, meta: error.meta });
        } else {
            logger.error('Error saving new cached transactions', { error });
        }
        return { count: 0 }; // Indicate failure
    }
}

// --- SwapAnalysisInput Functions ---

// Use Prisma.SwapAnalysisInputCreateInput for the input type for createMany
// Ensure this type reflects the new schema (prisma generate might be needed after schema change)
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

export async function saveSwapAnalysisInputs(inputs: SwapAnalysisInputCreateData[]) {
    if (inputs.length === 0) {
        logger.debug('No swap analysis inputs provided to save.');
        return { count: 0 };
    }
    logger.debug(`Attempting to save ${inputs.length} swap analysis inputs...`);
    
    try {
        // Process in batches to avoid overloading the database
        let savedCount = 0;
        const BATCH_SIZE = 100;
        
        for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
            const batch = inputs.slice(i, i + BATCH_SIZE);
            logger.debug(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(inputs.length/BATCH_SIZE)} (${batch.length} records)`);
            
            // Use a transaction for atomicity
            const batchResult = await prisma.$transaction(async (tx) => {
                let batchCount = 0;
                
                for (const input of batch) {
                    // Check if this exact record already exists
                    const exists = await tx.swapAnalysisInput.findFirst({
                        where: {
                            signature: input.signature as string,
                            mint: input.mint as string,
                            direction: input.direction as string
                        }
                    });
                    
                    // Only create if it doesn't exist
                    if (!exists) {
                        await tx.swapAnalysisInput.create({
                            data: input
                        });
                        batchCount++;
                    }
                }
                
                return batchCount;
            });
            
            savedCount += batchResult;
            logger.debug(`Batch ${Math.floor(i/BATCH_SIZE) + 1} complete. Saved ${batchResult} records in this batch.`);
        }
        
        logger.info(`Successfully saved ${savedCount} unique swap analysis inputs. ${inputs.length - savedCount} were duplicates and skipped.`);
        return { count: savedCount };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            logger.error('Prisma error saving swap analysis inputs', { 
                code: error.code, 
                meta: error.meta,
                message: error.message 
            });
        } else {
            logger.error('Error saving swap analysis inputs', { error });
        }
        return { count: 0 };
    }
}

// Interface for time range filtering
interface SwapInputTimeRange {
    startTs?: number;
    endTs?: number;
}

// Return type uses the imported SwapAnalysisInput model type
// This function likely doesn't need significant change, as the new fields
// are primarily used by the analyzer, not necessarily needed during retrieval here.
// However, the return type `Promise<SwapAnalysisInput[]>` will now reflect the new schema.
export async function getSwapAnalysisInputs(
    walletAddress: string,
    timeRange?: SwapInputTimeRange
): Promise<SwapAnalysisInput[]> {
    logger.debug(`Getting swap analysis inputs for ${walletAddress}`, { timeRange });
    try {
        // Explicitly type the where clause for clarity
        const whereClause: Prisma.SwapAnalysisInputWhereInput = {
            walletAddress: walletAddress,
        };

        // Build the timestamp part of the where clause if timeRange is provided
        const timestampFilter: Prisma.IntFilter = {};
        let hasTimestampFilter = false;
        if (timeRange?.startTs !== undefined) {
            timestampFilter.gte = timeRange.startTs;
            hasTimestampFilter = true;
        }
        if (timeRange?.endTs !== undefined) {
            timestampFilter.lte = timeRange.endTs;
            hasTimestampFilter = true;
        }
        if (hasTimestampFilter) {
            whereClause.timestamp = timestampFilter;
        }


        const inputs = await prisma.swapAnalysisInput.findMany({
            where: whereClause,
            orderBy: {
                timestamp: 'asc',
            },
        });
        logger.debug(`Found ${inputs.length} swap analysis inputs for ${walletAddress}`);
        // The returned `inputs` will automatically conform to the updated SwapAnalysisInput type from Prisma
        return inputs;
    } catch (error) {
        logger.error(`Error fetching swap analysis inputs for ${walletAddress}`, { error });
        return []; // Return empty array on error
    }
}

// --- AnalysisRun / AnalysisResult / AdvancedStatsResult Functions ---

// Type for creating a new AnalysisRun (omit auto-generated id and relations)
export type AnalysisRunCreateData = Omit<Prisma.AnalysisRunCreateInput, 'id' | 'results' | 'advancedStats'>;

// Type for creating AnalysisResult records (omit auto-generated id, add runId and walletAddress explicitly)
export type AnalysisResultCreateData = Omit<Prisma.AnalysisResultCreateInput, 'id' | 'run' | 'runId' | 'walletAddress'> & { runId: number; walletAddress: string };

// Type for creating an AdvancedStatsResult record (omit auto-generated id, add runId and walletAddress explicitly)
export type AdvancedStatsCreateData = Omit<Prisma.AdvancedStatsResultCreateInput, 'id' | 'run' | 'runId' | 'walletAddress'> & { runId: number; walletAddress: string };

export async function createAnalysisRun(data: AnalysisRunCreateData): Promise<AnalysisRun | null> {
    logger.debug('Creating new AnalysisRun...', { wallet: data.walletAddress });
    try {
        const newRun = await prisma.analysisRun.create({
            data: data,
        });
        logger.info(`Created new AnalysisRun with ID: ${newRun.id} for wallet ${data.walletAddress}`);
        return newRun;
    } catch (error) {
        logger.error('Error creating AnalysisRun', { error, data });
        return null;
    }
}

export async function saveAnalysisResults(results: AnalysisResultCreateData[]) {
    if (results.length === 0) {
        logger.debug('No analysis results provided to save.');
        return { count: 0 };
    }
    const runId = results[0]?.runId; // Assume all results belong to the same run
    const walletAddress = results[0]?.walletAddress; // Assume all results belong to the same wallet
    logger.info(`Attempting to save ${results.length} analysis results for run ID: ${runId}, wallet: ${walletAddress}...`);
    // NOTE: We assume the walletAddress is correctly populated in the input `results` array
    try {
        // Filter out extra fields that aren't in the database schema to avoid validation errors
        const filteredResults = results.map(result => {
            // Only include fields that exist in the AnalysisResult schema
            return {
                runId: result.runId,
                walletAddress: result.walletAddress,
                tokenAddress: result.tokenAddress,
                totalAmountIn: result.totalAmountIn,
                totalAmountOut: result.totalAmountOut,
                netAmountChange: result.netAmountChange,
                totalSolSpent: result.totalSolSpent,
                totalSolReceived: result.totalSolReceived,
                netSolProfitLoss: result.netSolProfitLoss,
                transferCountIn: result.transferCountIn,
                transferCountOut: result.transferCountOut,
                firstTransferTimestamp: result.firstTransferTimestamp,
                lastTransferTimestamp: result.lastTransferTimestamp,
                // Omit: adjustedNetSolProfitLoss, estimatedPreservedValue, isValuePreservation, preservationType
            };
        });
        
        // Use createMany for performance
        const result = await prisma.analysisResult.createMany({
            data: filteredResults, // Use the filtered results that match the schema
        });
        logger.info(`Successfully saved ${result.count} analysis results for run ID: ${runId}.`);
        return result;
    } catch (error) {
        logger.error(`Error saving analysis results for run ID: ${runId}`, { error });
        return { count: 0 };
    }
}

export async function saveAdvancedStats(statsData: AdvancedStatsCreateData): Promise<AdvancedStatsResult | null> {
    const runId = statsData.runId;
    const walletAddress = statsData.walletAddress;
    logger.info(`Attempting to save advanced stats for run ID: ${runId}, wallet: ${walletAddress}...`);
    // NOTE: We assume walletAddress is correctly populated in the input `statsData` object
    try {
        const savedStats = await prisma.advancedStatsResult.create({
            data: statsData, // Input object already includes runId and walletAddress
        });
        logger.info(`Successfully saved advanced stats for run ID: ${runId}.`);
        return savedStats;
    } catch (error) {
        // Handle potential unique constraint violation if stats already exist for this runId
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            logger.warn(`Advanced stats already exist for run ID: ${runId}. Ignoring duplicate save.`);
            // Optionally, find and return the existing record or implement an update logic
            return null; // Or fetch existing: await prisma.advancedStatsResult.findUnique({ where: { runId } });
        } else {
            logger.error(`Error saving advanced stats for run ID: ${runId}`, { error });
            return null;
        }
    }
}

// Add more functions as needed (e.g., querying results for reports)

export async function getAnalysisRun(runId: number): Promise<AnalysisRun | null> {
    logger.debug(`Fetching AnalysisRun data for ID: ${runId}`);
    try {
        const run = await prisma.analysisRun.findUnique({
            where: { id: runId },
        });
        return run;
    } catch (error) {
        logger.error(`Error fetching AnalysisRun ${runId}`, { error });
        return null;
    }
}

export async function getAnalysisResultsForRun(runId: number): Promise<AnalysisResult[]> {
    logger.debug(`Fetching AnalysisResult data for Run ID: ${runId}`);
    try {
        const results = await prisma.analysisResult.findMany({
            where: { runId: runId },
            orderBy: { netSolProfitLoss: 'desc' } // Default sort for reports
        });
        return results;
    } catch (error) {
        logger.error(`Error fetching AnalysisResults for Run ID ${runId}`, { error });
        return [];
    }
}

export async function getAdvancedStatsForRun(runId: number): Promise<AdvancedStatsResult | null> {
    logger.debug(`Fetching AdvancedStatsResult data for Run ID: ${runId}`);
    try {
        const stats = await prisma.advancedStatsResult.findUnique({
            where: { runId: runId },
        });
        return stats;
    } catch (error) {
        logger.error(`Error fetching AdvancedStatsResult for Run ID ${runId}`, { error });
        return null;
    }
} 