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

export async function getCachedTransaction(signature: string): Promise<HeliusTransaction | null> {
  logger.debug(`Querying cache for transaction: ${signature}`);
  try {
    const cached = await prisma.heliusTransactionCache.findUnique({
      where: { signature },
    });
    if (cached) {
        logger.debug(`Cache hit for signature: ${signature}`);
        // We need to parse the JSON rawData back into the HeliusTransaction type
        // Assuming rawData is a valid JSON representation of HeliusTransaction
        // Add validation/error handling for JSON parsing if needed
        try {
            return JSON.parse(cached.rawData as string) as HeliusTransaction; // Adjust casting as needed based on Prisma Json type handling
        } catch (parseError) {
            logger.error(`Failed to parse cached rawData for signature ${signature}`, { error: parseError });
            // Optionally delete the corrupted cache entry here
            return null;
        }
    } else {
        logger.debug(`Cache miss for signature: ${signature}`);
        return null;
    }
  } catch (error) {
      logger.error(`Error fetching cached transaction ${signature}`, { error });
      return null;
  }
}

export async function saveCachedTransactions(transactions: HeliusTransaction[]) {
    if (transactions.length === 0) {
        logger.debug('No transactions provided to save to cache.');
        return { count: 0 };
    }
    logger.info(`Attempting to save/update ${transactions.length} transactions in cache...`);
    let successCount = 0;
    let errorCount = 0;

    // Use upsert for each transaction to handle both create and update scenarios,
    // and avoid issues with createMany + unique constraints in SQLite.
    for (const tx of transactions) {
        try {
            await prisma.heliusTransactionCache.upsert({
                where: { signature: tx.signature },
                update: {
                    timestamp: tx.timestamp,
                    // Convert rawData object to JSON string for storage
                    // Prisma handles JSON type conversion, but explicit stringify ensures format
                    rawData: JSON.stringify(tx),
                    fetchedAt: new Date(),
                },
                create: {
                    signature: tx.signature,
                    timestamp: tx.timestamp,
                    rawData: JSON.stringify(tx),
                    fetchedAt: new Date(), // Can omit if @default(now()) works reliably
                },
            });
            successCount++;
        } catch (error) {
            logger.error(`Error upserting transaction ${tx.signature} into cache`, { error });
            errorCount++;
        }
    }

    logger.info(`Cache save complete. Success: ${successCount}, Errors: ${errorCount}`);
    return { count: successCount }; // Return the number successfully saved/updated
}

// --- SwapAnalysisInput Functions ---

// Use Prisma.SwapAnalysisInputCreateInput for the input type for createMany
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

export async function saveSwapAnalysisInputs(inputs: SwapAnalysisInputCreateData[]) {
    if (inputs.length === 0) {
        logger.debug('No swap analysis inputs provided to save.');
        return { count: 0 };
    }
    logger.info(`Attempting to save ${inputs.length} swap analysis inputs...`);
    try {
        // Use createMany for potentially better performance with SQLite
        const result = await prisma.swapAnalysisInput.createMany({
            data: inputs,
            // skipDuplicates: true, // Temporarily remove to resolve TS error - revisit if needed
        });
        logger.info(`Successfully saved ${result.count} swap analysis inputs.`);
        return result; // Contains the count of records created
    } catch (error) {
        logger.error('Error saving swap analysis inputs', { error });
        // Return a count of 0 or re-throw depending on desired error handling
        return { count: 0 };
    }
}

// Interface for time range filtering
interface SwapInputTimeRange {
    startTs?: number;
    endTs?: number;
}

// Return type uses the imported SwapAnalysisInput model type
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
                timestamp: 'asc', // Typically want inputs ordered by time
            },
        });
        logger.debug(`Found ${inputs.length} swap analysis inputs for ${walletAddress}`);
        return inputs;
    } catch (error) {
        logger.error(`Error fetching swap analysis inputs for ${walletAddress}`, { error });
        return []; // Return empty array on error
    }
}

// --- AnalysisRun / AnalysisResult / AdvancedStatsResult Functions ---

// Type for creating a new AnalysisRun (omit auto-generated id and relations)
export type AnalysisRunCreateData = Omit<Prisma.AnalysisRunCreateInput, 'id' | 'results' | 'advancedStats'>;

// Type for creating AnalysisResult records (omit auto-generated id, add runId explicitly)
export type AnalysisResultCreateData = Omit<Prisma.AnalysisResultCreateInput, 'id' | 'run' | 'runId'> & { runId: number };

// Type for creating an AdvancedStatsResult record (omit auto-generated id, add runId explicitly)
export type AdvancedStatsCreateData = Omit<Prisma.AdvancedStatsResultCreateInput, 'id' | 'run' | 'runId'> & { runId: number };

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
    logger.info(`Attempting to save ${results.length} analysis results for run ID: ${runId}...`);
    try {
        // Use createMany for performance
        const result = await prisma.analysisResult.createMany({
            data: results,
            // skipDuplicates: true, // Not available/needed here based on schema
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
    logger.info(`Attempting to save advanced stats for run ID: ${runId}...`);
    try {
        const savedStats = await prisma.advancedStatsResult.create({
            data: statsData,
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