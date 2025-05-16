import {
    PrismaClient,
    Wallet,
    SwapAnalysisInput,
    AnalysisRun,
    AnalysisResult,
    AdvancedStatsResult,
    Prisma, // Import Prisma namespace for input types
    User,         // Added User
    ActivityLog   // Added ActivityLog
} from '@prisma/client';
import { HeliusTransaction } from '@/types/helius-api'; // Assuming HeliusTransaction type is defined here
import { TransactionData } from '@/types/correlation'; // Needed for getTransactionsForAnalysis
import { BaseAnalysisConfig } from '@/types/analysis'; // Needed for getTransactionsForAnalysis
import { createLogger } from 'core/utils/logger'; // Assuming createLogger function is defined in utils
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

    // --- User Management Methods ---

    /**
     * Creates a new user with a generated API key.
     * IMPORTANT: API key generation and hashing are placeholders and NOT secure for production.
     * TODO: Implement secure random API key generation and bcrypt hashing.
     * @param description Optional description for the user.
     * @returns The created User object and the plaintext API key (to be shown once).
     */
    async createUser(description?: string): Promise<{ user: User; apiKey: string } | null> {
        this.logger.debug('Attempting to create a new user.');
        try {
            // IMPORTANT: Placeholder for secure API key generation
            const plaintextApiKey = `temp_api_key_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
            
            // IMPORTANT: Placeholder for API key hashing (e.g., using bcrypt)
            // const hashedApiKey = await bcrypt.hash(plaintextApiKey, 10); 
            // For now, storing plaintext - HIGHLY INSECURE, for dev only.
            const hashedApiKey = plaintextApiKey; 

            const user = await this.prismaClient.user.create({
                data: {
                    apiKey: hashedApiKey, // Store the HASHED key in production
                    description: description,
                },
            });
            this.logger.info('User created with ID: ' + user.id);
            // Return the new user and the PLAINTEXT API key for one-time display
            return { user, apiKey: plaintextApiKey }; 
        } catch (error) {
            this.logger.error('Error creating user', { error });
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') { // Unique constraint violation (e.g. apiKey)
                    this.logger.warn('Failed to create user due to unique constraint violation. This might happen if API key generation is not truly unique (especially with placeholder).');
                }
            }
            return null;
        }
    }

    /**
     * Validates an API key.
     * IMPORTANT: This current implementation validates against PLAINTEXT keys if stored that way (dev placeholder).
     * TODO: Modify to use bcrypt.compare if API keys are properly hashed in the database.
     * @param apiKey The plaintext API key to validate.
     * @returns The User object if the key is valid and the user is active, otherwise null.
     */
    async validateApiKey(apiKey: string): Promise<User | null> {
        this.logger.debug('Validating API key.');
        try {
            // IMPORTANT: In production, you would hash the provided apiKey and search for the hash,
            // or, if using a prefix system, find by prefix then use bcrypt.compare.
            // Current placeholder finds by plaintext apiKey (INSECURE if used in prod).
            const user = await this.prismaClient.user.findUnique({
                where: { apiKey: apiKey }, // This assumes apiKey is unique and plaintext (dev only)
            });

            if (user && user.isActive) {
                this.logger.debug('API key validated for user ID: ' + user.id);
                // Optionally update lastSeenAt here or make it a separate call
                await this.updateUserLastSeen(user.id);
                return user;
            } else if (user && !user.isActive) {
                this.logger.warn('API key belongs to inactive user ID: ' + user.id);
                return null;
            } else {
                this.logger.warn('Invalid API key provided.');
                return null;
            }
        } catch (error) {
            this.logger.error('Error validating API key', { error });
            return null;
        }
    }

    /**
     * Updates the lastSeenAt timestamp for a user.
     * @param userId The ID of the user.
     * @returns The updated User object or null on error.
     */
    async updateUserLastSeen(userId: string): Promise<User | null> {
        this.logger.debug('Updating lastSeenAt for user ID: ' + userId);
        try {
            const user = await this.prismaClient.user.update({
                where: { id: userId },
                data: { lastSeenAt: new Date() },
            });
            this.logger.debug('Successfully updated lastSeenAt for user ID: ' + userId);
            return user;
        } catch (error) {
            this.logger.error('Error updating lastSeenAt for user ID: ' + userId, { error });
            return null;
        }
    }

    // --- Activity Log Methods ---

    /**
     * Logs an activity performed by a user.
     * @param userId ID of the user performing the action.
     * @param actionType Type of action (e.g., 'get_wallet_summary').
     * @param requestParameters Optional parameters for the action (will be JSON.stringified).
     * @param status Status of the action ('INITIATED', 'SUCCESS', 'FAILURE').
     * @param durationMs Optional duration of the action in milliseconds.
     * @param errorMessage Optional error message if the action failed.
     * @param sourceIp Optional IP address of the requester.
     * @returns The created ActivityLog object or null on error.
     */
    async logActivity(
        userId: string,
        actionType: string,
        requestParameters?: object | null, // Allow null
        status: 'INITIATED' | 'SUCCESS' | 'FAILURE' = 'INITIATED',
        durationMs?: number,
        errorMessage?: string,
        sourceIp?: string
    ): Promise<ActivityLog | null> {
        this.logger.debug('Logging activity for user ID: ' + userId + ', action: ' + actionType);
        try {
            const activity = await this.prismaClient.activityLog.create({
                data: {
                    userId,
                    actionType,
                    requestParameters: requestParameters ? JSON.stringify(requestParameters) : null,
                    status,
                    durationMs,
                    errorMessage,
                    sourceIp,
                },
            });
            this.logger.info('Activity logged with ID: ' + activity.id);
            return activity;
        } catch (error) {
            this.logger.error('Error logging activity', { error });
            return null;
        }
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
    async saveSwapAnalysisInputs(
        inputs: Prisma.SwapAnalysisInputCreateInput[]
    ): Promise<Prisma.BatchPayload> {
        this.logger.info(`[DB] Attempting to save ${inputs.length} SwapAnalysisInput records efficiently...`);
        if (inputs.length === 0) {
            return { count: 0 };
        }

        // 1. Create a structure to hold details of existing records for quick lookup
        //    Map: signature -> Set of (mint-direction-amount_string)
        const existingRecordsDetails = new Map<string, Set<string>>();
        
        // Get all distinct signatures from the input batch
        const distinctInputSignatures = Array.from(new Set(inputs.map(i => i.signature)));

        if (distinctInputSignatures.length > 0) {
            this.logger.debug(`[DB] Distinct signatures for findMany: ${JSON.stringify(distinctInputSignatures.slice(0, 5))}${distinctInputSignatures.length > 5 ? '...' : ''}`);
            this.logger.debug(`[DB] Sample input for findMany (first item): ${inputs.length > 0 ? JSON.stringify(inputs[0]) : 'N/A'}`);
            const existingDbEntries = await this.prismaClient.swapAnalysisInput.findMany({
                where: {
                    signature: { in: distinctInputSignatures }
                },
                select: { // Select only the fields part of the unique constraint
                    signature: true,
                    mint: true,
                    direction: true,
                    amount: true
                }
            });

            for (const entry of existingDbEntries) {
                if (!existingRecordsDetails.has(entry.signature)) {
                    existingRecordsDetails.set(entry.signature, new Set<string>());
                }
                // Standardize amount for key generation
                const key = `${entry.mint.toLowerCase()}-${entry.direction.toLowerCase()}-${entry.amount.toFixed(9)}`;
                existingRecordsDetails.get(entry.signature)!.add(key);
            }
            this.logger.debug(`[DB] Found ${existingDbEntries.length} existing SwapAnalysisInput entries for ${distinctInputSignatures.length} distinct incoming signatures.`);
        }

        // 2. Filter out duplicates from the incoming 'inputs'
        //    - Duplicates already in the DB
        //    - Duplicates within the incoming batch itself
        const uniqueNewRecordsToInsert: Prisma.SwapAnalysisInputCreateInput[] = [];
        // Map to track records being added in *this batch* to avoid intra-batch duplicates
        const batchRecordTracker = new Map<string, Set<string>>(); 

        for (const record of inputs) {
            // Standardize amount for key generation
            const recordKey = `${record.mint.toLowerCase()}-${record.direction.toLowerCase()}-${record.amount.toFixed(9)}`;

            // Check if this exact record (sig + key) exists in DB
            if (existingRecordsDetails.has(record.signature) && existingRecordsDetails.get(record.signature)!.has(recordKey)) {
                continue; // Already in DB
            }

            // Check if this exact record (sig + key) is already added in this current batch
            if (batchRecordTracker.has(record.signature) && batchRecordTracker.get(record.signature)!.has(recordKey)) {
                this.logger.warn(`[DB] Duplicate SwapAnalysisInput within incoming batch (sig: ${record.signature}, key: ${recordKey}). Skipping.`);
                continue; // Duplicate within this batch
            }

            // If not a duplicate, add to list and track it for this batch
            uniqueNewRecordsToInsert.push(record);
            if (!batchRecordTracker.has(record.signature)) {
                batchRecordTracker.set(record.signature, new Set<string>());
            }
            batchRecordTracker.get(record.signature)!.add(recordKey);
        }
        
        this.logger.info(`[DB] Identified ${uniqueNewRecordsToInsert.length} unique new SwapAnalysisInput records to insert.`);

        if (uniqueNewRecordsToInsert.length > 0) {
            try {
                const result = await this.prismaClient.swapAnalysisInput.createMany({
                    data: uniqueNewRecordsToInsert,
                });
                this.logger.info(`[DB] Prisma createMany for SwapAnalysisInput successful. New records added: ${result.count}`);
                return result;
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError) {
                    this.logger.error('[DB] Prisma Error during createMany for SwapAnalysisInput', { code: error.code, meta: error.meta });
                } else {
                    this.logger.error('[DB] Generic Error during createMany for SwapAnalysisInput', { error });
                }
                return { count: 0 }; // Return 0 if error occurs
            }
        } else {
            this.logger.info('[DB] No unique new SwapAnalysisInput records to add after filtering.');
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
            this.logger.info(`Found ${inputs.length} SwapAnalysisInput records for ${walletAddress}.`);
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
            // Explicitly destructure and omit 'timestamp' if it's part of AnalysisRunCreateData
            // and assuming it should be auto-generated by the DB (@default(now()))
            const { timestamp, ...restOfData } = data as any; // Use 'as any' to handle potential extra field
            
            const newRun = await this.prismaClient.analysisRun.create({
                data: {
                    ...restOfData, // Spread the input data, excluding timestamp
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
        // this.logger.debug(`Saving ${results.length} AnalysisResult records...`);

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
        
        this.logger.debug(`Attempting to save advanced stats for run ID: ${runId}, wallet: ${walletAddress}...`);
        
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

    /**
     * Fetches the latest AdvancedStatsResult for a given wallet address.
     * It orders by the AnalysisRun's runTimestamp in descending order to find the latest.
     * @param walletAddress The public key of the wallet.
     * @returns The latest AdvancedStatsResult object if found, otherwise null.
     */
    async getLatestAdvancedStatsByWallet(walletAddress: string): Promise<(AdvancedStatsResult & { run: AnalysisRun | null }) | null> {
      this.logger.debug(`Fetching latest advanced stats for wallet: ${walletAddress}`);
      try {
        const advancedStats = await this.prismaClient.advancedStatsResult.findFirst({
          where: { walletAddress: walletAddress },
          orderBy: {
            run: {
              runTimestamp: 'desc',
            },
          },
          include: {
            run: true, // Include the associated AnalysisRun data
          },
        });

        if (advancedStats) {
          this.logger.debug(`Found latest advanced stats for wallet ${walletAddress}, run ID: ${advancedStats.runId}`);
          return advancedStats as (AdvancedStatsResult & { run: AnalysisRun | null });
        } else {
          this.logger.debug(`No advanced stats found for wallet ${walletAddress}`);
          return null;
        }
      } catch (error) {
        this.logger.error(`Error fetching latest advanced stats for wallet ${walletAddress}`, { error });
        return null;
      }
    }

    /**
     * Retrieves paginated AnalysisResult records for a specific wallet, with sorting.
     * @param walletAddress The wallet address.
     * @param page The page number (1-indexed).
     * @param pageSize The number of items per page.
     * @param sortBy The field to sort by (must be a valid key of AnalysisResult).
     * @param sortOrder The sort order ('asc' or 'desc').
     * @returns An object containing the paginated data and total count.
     */
    async getPaginatedAnalysisResults(
        walletAddress: string,
        page: number,
        pageSize: number,
        sortBy: keyof AnalysisResult, // Use keyof for type safety
        sortOrder: Prisma.SortOrder
    ): Promise<{ data: AnalysisResult[]; total: number }> {
        this.logger.debug(`Fetching paginated AnalysisResults for ${walletAddress}`, { page, pageSize, sortBy, sortOrder });
        const skip = (page - 1) * pageSize;
        const take = pageSize;

        const whereClause: Prisma.AnalysisResultWhereInput = {
            walletAddress: walletAddress,
        };

        const orderByClause: Prisma.AnalysisResultOrderByWithRelationInput = {};
        orderByClause[sortBy] = sortOrder;

        try {
            const total = await this.prismaClient.analysisResult.count({
                where: whereClause,
            });

            if (total === 0) {
                return { data: [], total: 0 };
            }

            const data = await this.prismaClient.analysisResult.findMany({
                where: whereClause,
                orderBy: orderByClause,
                skip: skip,
                take: take,
            });

            this.logger.info(`Found ${data.length} AnalysisResult records for ${walletAddress} on page ${page} (total: ${total}).`);
            return { data, total };
        } catch (error) {
            this.logger.error(`Error fetching paginated AnalysisResults for ${walletAddress}`, { error });
            return { data: [], total: 0 }; // Return empty on error
        }
    }
}