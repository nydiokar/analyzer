import {
    PrismaClient,
    Wallet,
    SwapAnalysisInput,
    AnalysisRun,
    AnalysisResult,
    AdvancedStatsResult,
    Prisma // Import Prisma namespace for input types
} from '@prisma/client';
import { HeliusTransaction } from '../../types/helius-api'; // Assuming HeliusTransaction type is defined here
import { TransactionData } from '../../types/correlation'; // Needed for getTransactionsForAnalysis
import { BaseAnalysisConfig } from '../../types/analysis'; // Needed for getTransactionsForAnalysis
import { createLogger } from '../../utils/logger'; // Assuming createLogger function is defined in utils
import zlib from 'zlib'; // Added zlib

// Instantiate Prisma Client - remains exported for potential direct use elsewhere, but service uses it too
export const prisma = new PrismaClient(); 

const logger = createLogger('DatabaseService');

// Corrected Type Definitions based on Prisma schema (inferred from usage/errors)

// Type for wallet updates
type WalletUpdateData = Partial<Omit<Wallet, 'address'>>;

// Type for Swap Input time range filter
interface SwapInputTimeRange {
    startTs?: number;
    endTs?: number;
}

// Use Prisma generated types directly where possible, or derive carefully
export type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;
export type AnalysisRunCreateData = Omit<Prisma.AnalysisRunCreateInput, 'id' | 'results' | 'advancedStats'>;

// Type for creating AnalysisResult records (omit auto-generated id, add runId and walletAddress explicitly)
/** Data structure for creating new AnalysisResult records, linked to a specific run and wallet. */
export type AnalysisResultCreateData = Omit<Prisma.AnalysisResultCreateInput, 'id' | 'run' | 'runId' | 'walletAddress'> & { 
    runId: number; 
    walletAddress: string; 
    // Ensure totalFeesPaidInSol is optional if it is in the Prisma model
    totalFeesPaidInSol?: number | null; 
};

// Type for creating an AdvancedStatsResult record (omit auto-generated id, add runId and walletAddress explicitly)
// Define this type within or import it for the class method
/** Data structure for the INPUT to saveAdvancedStats, containing the raw data points. */
export type AdvancedStatsInput = Omit<Prisma.AdvancedStatsResultCreateInput, 'id' | 'run'> & { runId: number; /* walletAddress is already included */ };

// --- DatabaseService Class ---

export class DatabaseService {
    // Using the exported prisma instance
    private prismaClient: PrismaClient = prisma; 
    private logger = logger; // Use the module-level logger

    constructor() {
        this.logger.info('DatabaseService instantiated.');
    }

    // --- Wallet Methods ---

    /**
     * Fetches multiple wallet records (addresses only).
     * @param walletAddresses An array of public keys for the wallets.
     * @returns An array of objects containing wallet addresses.
     */
    async getWallets(walletAddresses: string[]): Promise<{ address: string }[]> { // Return address only
        this.logger.debug(`Fetching wallet info for ${walletAddresses.length} addresses.`);
        try {
            const wallets = await this.prismaClient.wallet.findMany({
                where: {
                    address: { in: walletAddresses },
                },
                select: { address: true } // Select only address
            });
            this.logger.debug(`Found ${wallets.length} wallet records.`);
            return wallets; // Return the result directly
        } catch (error) {
            this.logger.error(`Error fetching wallets`, { error });
            return [];
        }
    }

    /**
     * Fetches a single wallet record from the database.
     * @param walletAddress The public key of the wallet.
     * @returns The Wallet object if found, otherwise null.
     */
    async getWallet(walletAddress: string): Promise<Wallet | null> {
      this.logger.debug(`Fetching wallet data for: ${walletAddress}`);
      try {
        const wallet = await this.prismaClient.wallet.findUnique({
          where: { address: walletAddress },
        });
        if (wallet) {
            this.logger.debug(`Found wallet data for: ${walletAddress}`);
        } else {
            this.logger.debug(`No wallet data found for: ${walletAddress}`);
        }
        return wallet;
      } catch (error) {
        this.logger.error(`Error fetching wallet ${walletAddress}`, { error });
        return null;
      }
    }

    /**
     * Updates an existing wallet record or creates a new one (upsert).
     * @param walletAddress The public key of the wallet.
     * @param data An object containing the wallet fields to update/create.
     * @returns The updated or newly created Wallet object, or null on error.
     */
    async updateWallet(walletAddress: string, data: WalletUpdateData): Promise<Wallet | null> {
      this.logger.debug(`Upserting wallet data for: ${walletAddress}`, data);
      try {
        const updatedWallet = await this.prismaClient.wallet.upsert({
            where: { address: walletAddress },
            update: data,
            create: {
                address: walletAddress,
                ...data,
            },
        });
        this.logger.info(`Successfully upserted wallet data for: ${walletAddress}`);
        return updatedWallet;
      } catch (error) {
          this.logger.error(`Error upserting wallet ${walletAddress}`, { error, data });
          return null;
      }
    }

    // --- HeliusTransactionCache Methods ---

    /**
     * Retrieves cached Helius transaction data.
     * @param signature A single transaction signature string or an array of signature strings.
     * @returns Depends on input: HeliusTransaction | null | Map<string, HeliusTransaction>
     */
    async getCachedTransaction(signature: string | string[]): Promise<HeliusTransaction | null | Map<string, HeliusTransaction>> {
      if (typeof signature === 'string') {
        try {
          const cached = await this.prismaClient.heliusTransactionCache.findUnique({
            where: { signature },
          });
          if (cached) {
                try {
                    const rawDataObject = cached.rawData;
                    if (Buffer.isBuffer(rawDataObject)) {
                        const decompressedBuffer = zlib.inflateSync(rawDataObject);
                        const jsonString = decompressedBuffer.toString('utf-8');
                        return JSON.parse(jsonString) as HeliusTransaction;
                    } else if (typeof rawDataObject === 'string') {
                        this.logger.warn(`[CacheRead] rawData for ${signature} is a string (old format?), attempting direct parse.`);
                        return JSON.parse(rawDataObject) as HeliusTransaction;
                    } else if (typeof rawDataObject === 'object' && rawDataObject !== null) {
                        const byteArray = Object.values(rawDataObject).filter(v => typeof v === 'number') as number[];
                        if (byteArray.length > 0 && byteArray.every(v => v >= 0 && v <= 255)) {
                            const buffer = Buffer.from(byteArray);
                            const decompressedBuffer = zlib.inflateSync(buffer);
                            const jsonString = decompressedBuffer.toString('utf-8');
                            return JSON.parse(jsonString) as HeliusTransaction;
                        }
                    }
                    this.logger.error(`[CacheRead] rawData for ${signature} is in an unexpected format. Type: ${typeof rawDataObject}`);
                    return null;
                } catch (processError) {
                    this.logger.error(`Failed to process cached rawData for signature ${signature}`, { error: processError });
                    return null;
                }
            }
            return null;
        } catch (error) {
            this.logger.error(`Error fetching cached transaction ${signature}`, { error });
            return null;
        }
      }

      if (Array.isArray(signature)) {
         if (signature.length === 0) {
            return new Map();
         }
         try {
            const cachedRecords = await this.prismaClient.heliusTransactionCache.findMany({
                where: {
                    signature: {
                        in: signature
                    }
                }
            });
            const resultMap = new Map<string, HeliusTransaction>();
            for (const record of cachedRecords) {
                try {
                    const rawDataObject = record.rawData;
                    if (Buffer.isBuffer(rawDataObject)) {
                        const decompressedBuffer = zlib.inflateSync(rawDataObject);
                        const jsonString = decompressedBuffer.toString('utf-8');
                        const tx = JSON.parse(jsonString) as HeliusTransaction;
                        resultMap.set(record.signature, tx);
                    } else if (typeof rawDataObject === 'string') {
                         this.logger.warn(`[CacheRead-Batch] rawData for ${record.signature} is a string (old format?), attempting direct parse.`);
                         const tx = JSON.parse(rawDataObject) as HeliusTransaction;
                         resultMap.set(record.signature, tx);
                    } else if (typeof rawDataObject === 'object' && rawDataObject !== null) {
                        const byteArray = Object.values(rawDataObject).filter(v => typeof v === 'number') as number[];
                        if (byteArray.length > 0 && byteArray.every(v => v >= 0 && v <= 255)) {
                            const buffer = Buffer.from(byteArray);
                            const decompressedBuffer = zlib.inflateSync(buffer);
                            const jsonString = decompressedBuffer.toString('utf-8');
                            const tx = JSON.parse(jsonString) as HeliusTransaction;
                            resultMap.set(record.signature, tx);
                        } else {
                             this.logger.error(`[CacheRead-Batch] rawData for ${record.signature} is in an unexpected format. Type: ${typeof rawDataObject}`);
                        }
                    }
                } catch (processError) {
                     this.logger.error(`Failed to process cached rawData in batch for signature ${record.signature}`, { error: processError });
                }
            }
            return resultMap;
        } catch (error) {
             this.logger.error(`Error batch fetching ${signature.length} cached transactions`, { error });
             return new Map();
        }
      }
      return null;
    }

    /**
     * Efficiently saves multiple Helius transactions to the cache.
     * @param transactions An array of HeliusTransaction objects to cache.
     * @returns A Prisma Promise result containing the count of newly added records.
     */
    async saveCachedTransactions(transactions: HeliusTransaction[]): Promise<{ count: number }> {
      if (transactions.length === 0) {
            this.logger.debug('No transactions provided to save to cache.');
            return { count: 0 };
        }
        this.logger.debug(`Attempting to save ${transactions.length} transactions to cache efficiently...`);
        const incomingSignatures = transactions.map(tx => tx.signature);
        let existingSignatures = new Set<string>();
        try {
            const existingRecords = await this.prismaClient.heliusTransactionCache.findMany({
                where: {
                    signature: {
                        in: incomingSignatures,
                    },
                },
                select: {
                    signature: true,
                },
            });
            existingSignatures = new Set(existingRecords.map(rec => rec.signature));
             this.logger.debug(`Found ${existingSignatures.size} existing signatures in cache out of ${incomingSignatures.length} incoming.`);
        } catch (error) {
             this.logger.error('Error checking for existing signatures in cache', { error });
            return { count: 0 }; 
        }
        const newTransactions = transactions.filter(tx => !existingSignatures.has(tx.signature));
        if (newTransactions.length === 0) {
             this.logger.info('No new transactions to add to cache.');
            return { count: 0 };
        }
         this.logger.info(`Identified ${newTransactions.length} new transactions to insert into HeliusTransactionCache.`);
        const dataToSave = newTransactions.map(tx => {
            const jsonString = JSON.stringify(tx);
            const compressedRawData = zlib.deflateSync(Buffer.from(jsonString, 'utf-8'));
            return {
                signature: tx.signature,
                timestamp: tx.timestamp,
                rawData: compressedRawData,
            };
        });
        try {
            const result = await this.prismaClient.heliusTransactionCache.createMany({
                data: dataToSave,
            });
             this.logger.info(`Cache save complete. ${result.count} new transactions added to HeliusTransactionCache.`);
            return result;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                 this.logger.error('Prisma Error saving new cached transactions to HeliusTransactionCache', { code: error.code, meta: error.meta });
            } else {
                 this.logger.error('Error saving new cached transactions to HeliusTransactionCache', { error });
            }
            return { count: 0 }; // Return count 0 on error
        }
    }

    // --- SwapAnalysisInput Methods ---

    /**
     * Saves multiple SwapAnalysisInput records to the database.
     * Uses `createMany` for efficiency, skipping duplicates based on signature.
     * @param inputs An array of SwapAnalysisInput objects to save.
     * @returns A Prisma Promise result with the count of added records.
     */
    async saveSwapAnalysisInputs(inputs: SwapAnalysisInputCreateData[]): Promise<{ count: number }> {
        if (inputs.length === 0) {
            this.logger.debug('No SwapAnalysisInput records provided to save.');
            return { count: 0 };
        }
        this.logger.debug(`Attempting to save ${inputs.length} SwapAnalysisInput records efficiently...`);

        const incomingSignatures = inputs.map(input => input.signature);
        let existingSignatures = new Set<string>();
        try {
            // Check existing signatures just for SwapAnalysisInput
            const existingRecords = await this.prismaClient.swapAnalysisInput.findMany({
                where: {
                    signature: {
                        in: incomingSignatures,
                    },
                },
                select: {
                    signature: true,
                },
            });
            existingSignatures = new Set(existingRecords.map(rec => rec.signature));
            this.logger.debug(`Found ${existingSignatures.size} existing SwapAnalysisInput signatures out of ${incomingSignatures.length} incoming.`);
        } catch (error) {
            this.logger.error('Error checking for existing SwapAnalysisInput signatures', { error });
            return { count: 0 };
        }

        const newInputs = inputs.filter(input => !existingSignatures.has(input.signature));

        if (newInputs.length === 0) {
            this.logger.info('No new SwapAnalysisInput records to add.');
            return { count: 0 };
        }

        this.logger.info(`Identified ${newInputs.length} new SwapAnalysisInput records to insert.`);

        try {
            const result = await this.prismaClient.swapAnalysisInput.createMany({
                data: newInputs, // Data should already be in the correct format
            });
            this.logger.info(`SwapAnalysisInput save complete. ${result.count} new records added.`);
            return result;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                this.logger.error('Prisma Error saving new SwapAnalysisInput records', { code: error.code, meta: error.meta });
            } else {
                this.logger.error('Error saving new SwapAnalysisInput records', { error });
            }
            return { count: 0 };
        }
    }

    /**
     * Retrieves SwapAnalysisInput records for a specific wallet, optionally filtered by time.
     * @param walletAddress The wallet address.
     * @param timeRange Optional start and end timestamps.
     * @returns An array of SwapAnalysisInput records.
     */
    async getSwapAnalysisInputs(
        walletAddress: string,
        timeRange?: SwapInputTimeRange
    ): Promise<SwapAnalysisInput[]> {
        this.logger.debug(`Fetching SwapAnalysisInputs for ${walletAddress}`, { timeRange });
        try {
            const whereCondition: Prisma.SwapAnalysisInputWhereInput = {
                walletAddress: walletAddress,
            };

            if (timeRange?.startTs || timeRange?.endTs) {
                whereCondition.timestamp = {};
                if (timeRange.startTs) {
                    whereCondition.timestamp.gte = timeRange.startTs;
                }
                if (timeRange.endTs) {
                    whereCondition.timestamp.lte = timeRange.endTs;
                }
            }

            const inputs = await this.prismaClient.swapAnalysisInput.findMany({
                where: whereCondition,
                orderBy: {
                    timestamp: 'asc',
                },
            });
            this.logger.debug(`Found ${inputs.length} SwapAnalysisInput records for ${walletAddress}.`);
            return inputs;
        } catch (error) {
            this.logger.error(`Error fetching SwapAnalysisInputs for ${walletAddress}`, { error });
            return [];
        }
    }
    
    /**
     * Retrieves transactions (SwapAnalysisInput) suitable for correlation/similarity analysis.
     * Handles fetching for multiple wallets and applying AnalysisConfig filters.
     * @param walletAddresses Array of wallet addresses.
     * @param config Analysis configuration containing filters like timeRange and excludedMints.
     * @returns A record mapping wallet addresses to their filtered TransactionData arrays.
     */
    async getTransactionsForAnalysis(
        walletAddresses: string[],
        config: BaseAnalysisConfig
    ): Promise<Record<string, TransactionData[]>> {
        this.logger.debug(`Fetching transactions for analysis for ${walletAddresses.length} wallets.`);
        const results: Record<string, TransactionData[]> = {};
        
        try {
            const whereCondition: Prisma.SwapAnalysisInputWhereInput = {
                walletAddress: { in: walletAddresses },
            };

            // Apply time range from config
            if (config.timeRange?.startTs || config.timeRange?.endTs) {
                whereCondition.timestamp = {};
                if (config.timeRange.startTs) {
                    whereCondition.timestamp.gte = config.timeRange.startTs;
                }
                if (config.timeRange.endTs) {
                    whereCondition.timestamp.lte = config.timeRange.endTs;
                }
            }

            // Apply excluded mints from config
            if (config.excludedMints && config.excludedMints.length > 0) {
                 whereCondition.NOT = {
                     mint: { in: config.excludedMints },
                 };
            }

            const inputs = await this.prismaClient.swapAnalysisInput.findMany({
                where: whereCondition,
                select: { // Select fields matching TransactionData
                    walletAddress: true,
                    mint: true,
                    timestamp: true,
                    direction: true,
                    amount: true,
                    associatedSolValue: true,
                },
                orderBy: {
                    timestamp: 'asc',
                },
            });

            this.logger.debug(`Fetched ${inputs.length} total SwapAnalysisInput records for analysis.`);
            
            // Group results by wallet address
            walletAddresses.forEach(addr => { results[addr] = []; }); // Initialize empty arrays
            inputs.forEach(input => {
                // Convert SwapAnalysisInput to TransactionData format
                results[input.walletAddress].push({
                    mint: input.mint,
                    timestamp: input.timestamp,
                    direction: input.direction as 'in' | 'out', // Assuming direction is always 'in' or 'out'
                    amount: input.amount,
                    associatedSolValue: input.associatedSolValue ?? 0, // Handle potential null
                });
            });

            return results;
        } catch (error) {
            this.logger.error(`Error fetching transactions for analysis`, { error });
            // Return empty results structure on error
            walletAddresses.forEach(addr => { results[addr] = []; });
            return results;
        }
    }

    // --- AnalysisRun/Result/Stats Methods ---

    /**
     * Creates a new analysis run record.
     * @param data Data for the new analysis run.
     * @returns The created AnalysisRun object or null on error.
     */
    async createAnalysisRun(data: AnalysisRunCreateData): Promise<AnalysisRun | null> {
        this.logger.debug('Creating new AnalysisRun record...', data);
        try {
            const newRun = await this.prismaClient.analysisRun.create({
                data: {
                    ...data, // Spread the input data
                    // Prisma handles default timestamp (createdAt) automatically
                }
            });
            this.logger.info(`Created AnalysisRun with ID: ${newRun.id}`);
            return newRun;
        } catch (error) {
            this.logger.error('Error creating AnalysisRun', { error, data });
            return null;
        }
    }

    /**
     * Saves multiple analysis result records.
     * Maps input data to match Prisma.AnalysisResultCreateManyInput structure.
     * @param results An array of data objects to save. IMPORTANT: The structure of these input objects must match the expected fields.
     * @returns A Prisma Promise result with the count of added records.
     */
    async saveAnalysisResults(results: any[]): Promise<{ count: number }> { // Use any[] for input flexibility for now
        if (results.length === 0) {
            this.logger.debug('No AnalysisResult records provided to save.');
            return { count: 0 };
        }
        this.logger.debug(`Saving ${results.length} AnalysisResult records...`);

        // Map data carefully to match Prisma.AnalysisResultCreateManyInput
        // This requires knowing the exact structure of the `results` input array
        // and the exact fields in the `AnalysisResult` Prisma model.
        const dataToSave: Prisma.AnalysisResultCreateManyInput[] = results.map(r => ({
            runId: r.runId, // Required relation
            walletAddress: r.walletAddress, // Required part of the data payload
            // --- Fields likely present in the original data structure ---
            tokenAddress: r.tokenAddress,
            totalAmountIn: r.totalAmountIn,
            totalAmountOut: r.totalAmountOut,
            netAmountChange: r.netAmountChange,
            totalSolSpent: r.totalSolSpent,
            totalSolReceived: r.totalSolReceived,
            netSolProfitLoss: r.netSolProfitLoss,
            transferCountIn: r.transferCountIn,
            transferCountOut: r.transferCountOut,
            firstTransferTimestamp: r.firstTransferTimestamp,
            lastTransferTimestamp: r.lastTransferTimestamp,
            totalFeesPaidInSol: r.totalFeesPaidInSol, // Assuming this might be optional
            // Add any other fields that were part of the original save function's input 'r' object
            // and exist in the Prisma AnalysisResult model.
            // Example: clusterId: r.clusterId, metrics: r.metrics, correlationScore: r.correlationScore,
            // Only include these if they ACTUALLY exist in the model and input data.
        }));

        try {
            const result = await this.prismaClient.analysisResult.createMany({
                data: dataToSave,
                // skipDuplicates: true, // Removed: Type 'true' is not assignable to type 'never'.
            });
            this.logger.info(`AnalysisResult save complete. Attempted: ${results.length}, Added: ${result.count}.`);
            return result;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                this.logger.error('Prisma Error saving AnalysisResult records', { code: error.code, meta: error.meta });
            } else {
                this.logger.error('Error saving AnalysisResult records', { error });
            }
            return { count: 0 };
        }
    }

    /**
     * Saves an advanced statistics result record to the database.
     * Mimics the original function: attempts creation and handles unique constraint violation (P2002) on runId.
     *
     * @param inputData The data object containing runId, walletAddress, and all individual stat fields.
     * @returns The newly created AdvancedStatsResult object, or null if stats already existed for the runId or an error occurred.
     */
    async saveAdvancedStats(inputData: AdvancedStatsInput): Promise<AdvancedStatsResult | null> {
        const { runId, ...statsFields } = inputData; // Separate runId from stats fields
        const walletAddress = statsFields.walletAddress; // Extract walletAddress for logging
        
        this.logger.info(`Attempting to save advanced stats for run ID: ${runId}, wallet: ${walletAddress}...`);
        
        try {
            // Construct the data payload required by Prisma create, including the relation connection
            const dataToCreate: Prisma.AdvancedStatsResultCreateInput = {
                ...statsFields, // Spread the individual statistic fields (medianPnlPerToken, etc.)
                run: { // Explicitly connect to the AnalysisRun
                    connect: { id: runId }
                }
            };

            const savedStats = await this.prismaClient.advancedStatsResult.create({
                data: dataToCreate, 
            });
            this.logger.info(`Successfully saved advanced stats for run ID: ${runId}.`);
            return savedStats;
        } catch (error) {
            // Handle potential unique constraint violation (P2002 on runId)
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const target = (error.meta?.target as string[] | undefined) || [];
                if (target.includes('runId')) { // Check if the unique constraint is indeed on runId
                    this.logger.warn(`Advanced stats already exist for run ID: ${runId}. Ignoring duplicate save.`);
                    return null; // Return null as per original function logic
                } else {
                    this.logger.error(`Prisma unique constraint violation (P2002) on unexpected fields: ${target.join(', ')}`, { error, runId, walletAddress });
                    return null;
                }
            } else {
                this.logger.error(`Error saving advanced stats for run ID: ${runId}`, { error, inputData });
                return null;
            }
        }
    }

    // --- Retrieval Methods for Analysis Runs/Results ---

    /**
     * Retrieves a specific analysis run by its ID.
     * @param runId The ID of the analysis run.
     * @returns The AnalysisRun object or null if not found.
     */
    async getAnalysisRun(runId: number): Promise<AnalysisRun | null> {
        this.logger.debug(`Fetching AnalysisRun with ID: ${runId}`);
        try {
            const run = await this.prismaClient.analysisRun.findUnique({
                where: { id: runId },
            });
            if (!run) {
                this.logger.warn(`AnalysisRun with ID ${runId} not found.`);
            }
            return run;
        } catch (error) {
            this.logger.error(`Error fetching AnalysisRun ${runId}`, { error });
            return null;
        }
    }

    /**
     * Retrieves all analysis results associated with a specific run ID.
     * @param runId The ID of the analysis run.
     * @returns An array of AnalysisResult objects.
     */
    async getAnalysisResultsForRun(runId: number): Promise<AnalysisResult[]> {
        this.logger.debug(`Fetching AnalysisResults for run ID: ${runId}`);
        try {
            const results = await this.prismaClient.analysisResult.findMany({
                where: { runId: runId },
                orderBy: {
                    // Optional: Order by walletAddress or score?
                    walletAddress: 'asc' 
                }
            });
            this.logger.debug(`Found ${results.length} AnalysisResults for run ${runId}.`);
            return results;
        } catch (error) {
            this.logger.error(`Error fetching AnalysisResults for run ${runId}`, { error });
            return [];
        }
    }

    /**
     * Retrieves advanced stats associated with a specific run ID.
     * Assumes only one AdvancedStatsResult per run/wallet combo, but query could return multiple if schema changes.
     * @param runId The ID of the analysis run.
     * @returns The AdvancedStatsResult object or null if not found. 
     */
    async getAdvancedStatsForRun(runId: number): Promise<AdvancedStatsResult | null> {
        // This might need adjustment if multiple stats per run are possible
        this.logger.debug(`Fetching AdvancedStatsResult for run ID: ${runId}`);
        try {
            // If there's only one expected per run, findFirst might be suitable
            const stats = await this.prismaClient.advancedStatsResult.findFirst({
                where: { runId: runId },
            });
             if (!stats) {
                 this.logger.debug(`No AdvancedStatsResult found for run ${runId}.`);
             }
            return stats;
        } catch (error) {
            this.logger.error(`Error fetching AdvancedStatsResult for run ${runId}`, { error });
            return null;
        }
    }
}
