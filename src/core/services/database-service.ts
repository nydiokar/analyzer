import {
    PrismaClient,
    Wallet,
    SwapAnalysisInput,
    AnalysisRun,
    AnalysisResult,
    AdvancedTradeStats,
    WalletBehaviorProfile,
    MappingActivityLog,
    Prisma, // Import Prisma namespace for input types
    User,         // Added User
    ActivityLog,   // Added ActivityLog
    WalletNote,    // Added WalletNote
    UserFavoriteWallet // Added UserFavoriteWallet model import
} from '@prisma/client';
import { HeliusTransaction } from '@/types/helius-api'; // Assuming HeliusTransaction type is defined here
import { TransactionData } from '@/types/correlation'; // Needed for getTransactionsForAnalysis
import { BaseAnalysisConfig } from '@/types/analysis'; // Needed for getTransactionsForAnalysis
import { createLogger } from 'core/utils/logger'; // Assuming createLogger function is defined in utils
import zlib from 'zlib'; // Added zlib
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { NotFoundException, InternalServerErrorException, Injectable, ConflictException } from '@nestjs/common';

// Instantiate Prisma Client - remains exported for potential direct use elsewhere, but service uses it too
/**
 * PrismaClient instance for database interactions.
 * Exported for potential direct use, though the DatabaseService is the preferred interface.
 */
export const prisma = new PrismaClient(); 

const logger = createLogger('DatabaseService');

// Corrected Type Definitions based on Prisma schema (inferred from usage/errors)

// Type for wallet updates
/**
 * Defines the structure for partial updates to a Wallet record.
 * Omits 'address' as it's the primary key and typically not updated.
 */
type WalletUpdateData = Partial<Omit<Wallet, 'address'>>;

// Type for Swap Input time range filter
/**
 * Defines the structure for specifying a time range filter for SwapAnalysisInput records.
 */
interface SwapInputTimeRange {
    /** Optional start timestamp (Unix seconds) of the time range (inclusive). */
    startTs?: number;
    /** Optional end timestamp (Unix seconds) of the time range (inclusive). */
    endTs?: number;
}

// Type for the return of getWalletTimestampsForRange
export interface WalletTimeRangeInfo {
    firstObservedTsInPeriod: number | null;
    lastObservedTsInPeriod: number | null;
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
export type AdvancedTradeStatsInput = Omit<Prisma.AdvancedTradeStatsCreateInput, 'id' | 'run'> & { runId: number; /* walletAddress is already included */ };

// Type for WalletBehaviorProfile upsert
/**
 * Defines the structure for creating or updating a WalletBehaviorProfile record.
 * Omits 'wallet' relation field which is handled via connect/create on 'walletAddress'.
 */
export type WalletBehaviorProfileUpsertData = Omit<Prisma.WalletBehaviorProfileCreateInput, 'wallet'> & { walletAddress: string };

// --- DatabaseService Class ---

/**
 * Provides a centralized service for interacting with the application's database.
 * Encapsulates Prisma Client operations and includes logging for database activities.
 * It manages various data models including Wallets, Transactions, Analysis Runs, User accounts, and more.
 */
@Injectable()
export class DatabaseService {
    // Using the exported prisma instance
    private prismaClient: PrismaClient = prisma; 
    private logger = logger; // Use the module-level logger

    /**
     * Initializes a new instance of the DatabaseService.
     * Sets up the Prisma client and logger.
     */
    constructor() {
        this.logger.info('DatabaseService instantiated.');
    }

    // --- Mapping Activity Log Methods ---
    /**
     * Saves a mapping activity log entry to the database.
     * Records statistics about the transaction mapping process for a specific wallet.
     *
     * @param walletAddress The address of the wallet for which the mapping activity is logged.
     * @param stats An object containing the statistics of the mapping activity, excluding auto-generated fields.
     * @returns A promise that resolves to the created MappingActivityLog object, or null if an error occurs.
     */
    async saveMappingActivityLog(
        walletAddress: string,
        stats: Omit<Prisma.MappingActivityLogCreateInput, 'walletAddress' | 'timestamp' | 'id'> // Use Prisma generated type
    ): Promise<MappingActivityLog | null> {
        this.logger.debug(`Saving mapping activity log for wallet: ${walletAddress}`);
        try {
            const logEntry = await this.prismaClient.mappingActivityLog.create({
                data: {
                    walletAddress,
                    timestamp: new Date(), // Set timestamp at save time
                    ...stats,
                },
            });
            this.logger.info(`Mapping activity log saved with ID: ${logEntry.id} for wallet ${walletAddress}`);
            return logEntry;
        } catch (error) {
            this.logger.error('Error saving mapping activity log', { error, walletAddress });
            return null;
        }
    }
    // --- End Mapping Activity Log Methods ---

    // --- WalletPnlSummary and WalletBehaviorProfile Accessors for Summary Endpoint ---
    /**
     * Retrieves the WalletPnlSummary for a given wallet, including related AdvancedTradeStats and Wallet.
     * Used by the main wallet summary endpoint.
     *
     * @param walletAddress The wallet address.
     * @returns A promise that resolves to the WalletPnlSummary object with relations, or null if not found.
     */
    async getWalletPnlSummaryWithRelations(
        walletAddress: string
    ): Promise<(Prisma.WalletPnlSummaryGetPayload<{ include: { advancedStats: true, wallet: true } }>) | null> {
        this.logger.debug(`Fetching WalletPnlSummary with relations for wallet: ${walletAddress}`);
        try {
            return await this.prismaClient.walletPnlSummary.findUnique({
                where: { walletAddress },
                include: { advancedStats: true, wallet: true },
            });
        } catch (error) {
            this.logger.error('Error fetching WalletPnlSummary with relations', { error, walletAddress });
            // Decide on error handling: re-throw, or return null for controller to handle as NotFound
            throw new InternalServerErrorException('Could not fetch PNL summary data.'); 
        }
    }

    /**
     * Retrieves the WalletBehaviorProfile for a given wallet.
     * Used by the main wallet summary endpoint.
     *
     * @param walletAddress The wallet address.
     * @returns A promise that resolves to the WalletBehaviorProfile object, or null if not found.
     */
    async getWalletBehaviorProfile(walletAddress: string): Promise<WalletBehaviorProfile | null> {
        this.logger.debug(`Fetching WalletBehaviorProfile for wallet: ${walletAddress}`);
        try {
            return await this.prismaClient.walletBehaviorProfile.findUnique({
                where: { walletAddress },
            });
        } catch (error) {
            this.logger.error('Error fetching WalletBehaviorProfile', { error, walletAddress });
            // Decide on error handling: re-throw, or return null for controller to handle as NotFound
            throw new InternalServerErrorException('Could not fetch behavior profile data.');
        }
    }
    // --- End WalletPnlSummary and WalletBehaviorProfile Accessors ---

    // --- AnalysisResult Methods ---

    /**
     * Retrieves multiple AnalysisResult records from the database based on specified criteria.
     * Allows for filtering, ordering, and pagination of results.
     *
     * @param params Parameters for querying AnalysisResult records, including where, orderBy, skip, and take.
     * @returns A promise that resolves to an array of AnalysisResult objects.
     * @throws Throws an error if the database query fails.
     */
    async getAnalysisResults(params: {
        where?: Prisma.AnalysisResultWhereInput;
        orderBy?: Prisma.AnalysisResultOrderByWithRelationInput;
        skip?: number;
        take?: number;
    }): Promise<AnalysisResult[]> {
        this.logger.debug(`Fetching AnalysisResults with params: ${JSON.stringify(params)}`);
        try {
            return await this.prismaClient.analysisResult.findMany(params);
        } catch (error) {
            this.logger.error('Error fetching AnalysisResults', { error, params });
            throw error; // Re-throw for service layer to handle
        }
    }

    /**
     * Counts the number of AnalysisResult records in the database that match the specified criteria.
     *
     * @param params Parameters for querying AnalysisResult records, primarily the 'where' clause for filtering.
     * @returns A promise that resolves to the total count of matching AnalysisResult records.
     * @throws Throws an error if the database query fails.
     */
    async countAnalysisResults(params: {
        where?: Prisma.AnalysisResultWhereInput;
    }): Promise<number> {
        this.logger.debug(`Counting AnalysisResults with params: ${JSON.stringify(params)}`);
        try {
            return await this.prismaClient.analysisResult.count(params);
        } catch (error) {
            this.logger.error('Error counting AnalysisResults', { error, params });
            throw error; // Re-throw for service layer to handle
        }
    }

    // --- User Management Methods ---

    /**
     * Creates a new user with a generated API key.
     * @param description Optional description for the user.
     * @returns The created User object and the plaintext API key (to be shown once).
     */
    async createUser(description?: string): Promise<{ user: User; apiKey: string } | null> {
        this.logger.debug('Attempting to create a new user.');
        try {
            const plaintextApiKey = uuidv4(); // Generate a UUID v4 for the API key
            const saltRounds = 10;
            const hashedApiKey = await bcrypt.hash(plaintextApiKey, saltRounds); 

            const user = await this.prismaClient.user.create({
                data: {
                    apiKey: hashedApiKey, // Store the HASHED key
                    description: description,
                },
            });
            this.logger.info('User created with ID: ' + user.id);
            return { user, apiKey: plaintextApiKey }; 
        } catch (error) {
            this.logger.error('Error creating user', { error });
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') { 
                    this.logger.warn('Failed to create user due to unique constraint violation (apiKey should be unique).');
                }
            }
            return null;
        }
    }

    /**
     * Validates an API key against stored hashed keys.
     * @param apiKeyToValidate The plaintext API key to validate.
     * @returns The User object if the key is valid and the user is active, otherwise null.
     */
    async validateApiKey(apiKeyToValidate: string): Promise<User | null> {
        this.logger.debug('Attempting to validate API key.');
        try {
            const users = await this.prismaClient.user.findMany({
                where: { isActive: true }, // Only consider active users
            });

            for (const user of users) {
                const isMatch = await bcrypt.compare(apiKeyToValidate, user.apiKey);
                if (isMatch) {
                    this.logger.info(`API key validated successfully for user ID: ${user.id}`);
                    return user;
                }
            }

            this.logger.warn('API key validation failed: No matching active user found for the provided key.');
            return null;
        } catch (error) {
            this.logger.error('Error during API key validation:', error);
            throw new Error('Could not validate API key due to a server error.'); // Generic error to client
        }
    }

    /**
     * Retrieves all users from the database.
     * @returns A promise that resolves to an array of User objects.
     */
    async getAllUsers(): Promise<User[]> {
        this.logger.debug('Fetching all users.');
        try {
            const users = await this.prismaClient.user.findMany();
            this.logger.info(`Retrieved ${users.length} users.`);
            return users;
        } catch (error) {
            this.logger.error('Error fetching users', { error });
            throw error; // Re-throw for service layer to handle
        }
    }

    /**
     * Ensures a wallet record exists in the database.
     * If the wallet doesn't exist, it creates a new one with default values.
     * 
     * @param walletAddress The address of the wallet to find or create.
     * @returns A promise that resolves to the found or newly created Wallet object.
     * @throws Throws an error if the database operation fails unexpectedly.
     */
    async ensureWalletExists(walletAddress: string): Promise<Wallet> {
        this.logger.debug(`Ensuring wallet exists for address: ${walletAddress}`);
        try {
            const wallet = await this.prismaClient.wallet.upsert({
                where: { address: walletAddress },
                update: {}, // No fields to update if it exists
                create: { address: walletAddress },
            });
            return wallet;
        } catch (error) {
            this.logger.error(`Error ensuring wallet ${walletAddress} exists in database`, { error });
            throw new InternalServerErrorException(`Could not ensure wallet ${walletAddress} due to a database error.`);
        }
    }

    /**
     * Activates a user by their ID.
     * @param userId The ID of the user to activate.
     * @returns The updated User object or null if not found.
     */
    async activateUser(userId: string): Promise<User | null> {
        this.logger.debug(`Attempting to activate user with ID: ${userId}`);
        try {
            const user = await this.prismaClient.user.update({
                where: { id: userId, isActive: false }, // Only update if currently inactive
                data: { isActive: true },
            });
            this.logger.info(`User ${userId} activated successfully.`);
            return user;
        } catch (error: any) {
            // Prisma throws P2025 if record to update is not found
            if (error.code === 'P2025') {
                this.logger.warn(`User ${userId} not found or already active.`);
                return null; 
            }
            this.logger.error(`Error activating user ${userId}:`, error);
            throw new Error('Could not activate user due to a server error.');
        }
    }

    /**
     * Deactivates a user by their ID.
     * @param userId The ID of the user to deactivate.
     * @returns The updated User object or null if not found.
     */
    async deactivateUser(userId: string): Promise<User | null> {
        this.logger.debug(`Attempting to deactivate user with ID: ${userId}`);
        try {
            const user = await this.prismaClient.user.update({
                where: { id: userId, isActive: true }, // Only update if currently active
                data: { isActive: false },
            });
            this.logger.info(`User ${userId} deactivated successfully.`);
            return user;
        } catch (error: any) {
             // Prisma throws P2025 if record to update is not found
            if (error.code === 'P2025') {
                this.logger.warn(`User ${userId} not found or already inactive.`);
                return null;
            }
            this.logger.error(`Error deactivating user ${userId}:`, error);
            throw new Error('Could not deactivate user due to a server error.');
        }
    }

    /**
     * Deletes a user by their ID.
     * IMPORTANT: This is a permanent deletion.
     * @param userId The ID of the user to delete.
     * @returns The deleted User object or null if not found.
     */
    async deleteUser(userId: string): Promise<User | null> {
        this.logger.debug(`Attempting to delete user with ID: ${userId}`);
        try {
            const user = await this.prismaClient.user.delete({
                where: { id: userId },
            });
            this.logger.info(`User ${userId} deleted successfully.`);
            return user;
        } catch (error: any) {
            // Prisma throws P2025 if record to delete is not found
            if (error.code === 'P2025') {
                this.logger.warn(`User ${userId} not found for deletion.`);
                return null;
            }
            this.logger.error(`Error deleting user ${userId}:`, error);
            throw new Error('Could not delete user due to a server error.');
        }
    }

    /**
     * Sets the demo status for a user.
     * @param userId The ID of the user to modify.
     * @param isDemo The demo status to set.
     * @returns The updated User object or null if not found.
     */
    async setUserDemoStatus(userId: string, isDemo: boolean): Promise<User | null> {
        this.logger.debug(`Attempting to set demo status for user ${userId} to ${isDemo}`);
        try {
            const user = await this.prismaClient.user.update({
                where: { id: userId },
                data: { isDemo: isDemo },
            });
            this.logger.info(`User ${userId} demo status updated to ${user.isDemo}.`);
            return user;
        } catch (error: any) {
            if (error.code === 'P2025') {
                this.logger.warn(`User with ID ${userId} not found for updating demo status.`);
                return null;
            }
            this.logger.error(`Error setting demo status for user ${userId}:`, error);
            throw new Error('Could not set demo status due to a server error.');
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
        this.logger.info('Logging activity for user ID: ' + userId + ', action: ' + actionType);
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

    // --- Wallet Favorite Methods ---
    /**
     * Adds a wallet to a user\'s favorites.
     * Ensures both user and wallet exist before creating the favorite entry.
     *
     * @param userId The ID of the user.
     * @param walletAddress The address of the wallet to favorite.
     * @returns A promise that resolves to the created UserFavoriteWallet record.
     * @throws NotFoundException if the user or wallet does not exist.
     * @throws ConflictException if the wallet is already in the user\'s favorites.
     * @throws InternalServerErrorException for other database errors.
     */
    async addFavoriteWallet(userId: string, walletAddress: string): Promise<UserFavoriteWallet> {
        this.logger.debug(`Attempting to add wallet ${walletAddress} to favorites for user ${userId}`);
        
        const userExists = await this.prismaClient.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            this.logger.warn(`Add favorite failed: User ${userId} not found.`);
            throw new NotFoundException(`User with ID "${userId}" not found.`);
        }

        const walletExists = await this.prismaClient.wallet.findUnique({ where: { address: walletAddress } });
        if (!walletExists) {
            this.logger.warn(`Add favorite failed: Wallet ${walletAddress} not found.`);
            throw new NotFoundException(`Wallet with address "${walletAddress}" not found. It may need to be analyzed first.`);
        }

        try {
            const favorite = await this.prismaClient.userFavoriteWallet.create({
                data: {
                    userId: userId,
                    walletAddress: walletAddress,
                },
            });
            this.logger.info(`Wallet ${walletAddress} added to favorites for user ${userId}`);
            return favorite;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') { // Unique constraint violation
                    this.logger.warn(`Add favorite conflict: Wallet ${walletAddress} already in favorites for user ${userId}.`);
                    throw new ConflictException('This wallet is already in your favorites.');
                }
            }
            this.logger.error(`Error adding favorite wallet ${walletAddress} for user ${userId}:`, { error });
            throw new InternalServerErrorException('Could not add wallet to favorites due to an unexpected error.');
        }
    }

    /**
     * Removes a wallet from a user\'s favorites.
     *
     * @param userId The ID of the user.
     * @param walletAddress The address of the wallet to remove from favorites.
     * @returns A promise that resolves to the removed UserFavoriteWallet record, or null if not found (Prisma delete throws if not found).
     * @throws NotFoundException if the favorite entry does not exist.
     * @throws InternalServerErrorException for other database errors.
     */
    async removeFavoriteWallet(userId: string, walletAddress: string): Promise<UserFavoriteWallet> {
        this.logger.debug(`Attempting to remove wallet ${walletAddress} from favorites for user ${userId}`);
        try {
            const favorite = await this.prismaClient.userFavoriteWallet.delete({
                where: {
                    userId_walletAddress: {
                        userId: userId,
                        walletAddress: walletAddress,
                    },
                },
            });
            this.logger.info(`Wallet ${walletAddress} removed from favorites for user ${userId}`);
            return favorite;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                this.logger.warn(`Remove favorite failed: Wallet ${walletAddress} not found in favorites for user ${userId}.`);
                throw new NotFoundException('This wallet is not in your favorites.');
            }
            this.logger.error(`Error removing favorite wallet ${walletAddress} for user ${userId}:`, { error });
            throw new InternalServerErrorException('Could not remove wallet from favorites due to an unexpected error.');
        }
    }

    /**
     * Retrieves all favorite wallets for a given user.
     * Includes the related Wallet object for each favorite.
     *
     * @param userId The ID of the user.
     * @returns A promise that resolves to an array of UserFavoriteWallet records, including their related Wallet data.
     * @throws NotFoundException if the user does not exist.
     * @throws InternalServerErrorException for other database errors.
     */
    async getFavoriteWalletsByUserId(userId: string): Promise<Array<Prisma.UserFavoriteWalletGetPayload<{ include: { wallet: { include: { pnlSummary: true, behaviorProfile: true } } } }>>> {
        this.logger.debug(`Fetching favorite wallets for user ${userId}`);
        try {
            return await this.prismaClient.userFavoriteWallet.findMany({
                where: { userId: userId },
                include: {
                    wallet: {
                        include: {
                            pnlSummary: true,
                            behaviorProfile: true,
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
        } catch (error) {
            this.logger.error(`Error fetching favorite wallets for user ${userId}:`, { error });
            throw new InternalServerErrorException('Could not fetch favorite wallets.');
        }
    }
    // --- End Wallet Favorite Methods ---

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
      // Prepare the payload for create/update operations.
      // This will contain all optional fields from 'data', transformed and validated.
      const payloadData: Partial<Omit<Wallet, 'address' | 'createdAt' | 'updatedAt' | 'id'>> = {};

      if (data.firstProcessedTimestamp !== undefined && data.firstProcessedTimestamp !== null) {
        payloadData.firstProcessedTimestamp = Number(data.firstProcessedTimestamp);
      }
      if (data.newestProcessedSignature !== undefined && data.newestProcessedSignature !== null) {
        payloadData.newestProcessedSignature = String(data.newestProcessedSignature);
      }
      if (data.newestProcessedTimestamp !== undefined && data.newestProcessedTimestamp !== null) {
        payloadData.newestProcessedTimestamp = Number(data.newestProcessedTimestamp);
      }
      if (data.lastSuccessfulFetchTimestamp !== undefined && data.lastSuccessfulFetchTimestamp !== null) {
        const tsDate = data.lastSuccessfulFetchTimestamp instanceof Date 
            ? data.lastSuccessfulFetchTimestamp 
            : new Date(data.lastSuccessfulFetchTimestamp);
        if (!isNaN(tsDate.getTime())) {
            payloadData.lastSuccessfulFetchTimestamp = tsDate;
        }
      }

      const upsertOptions = {
        where: { address: walletAddress },
        create: {
          address: walletAddress, // Explicitly set address for creation
          ...payloadData,         // Spread the processed optional fields
        },
        update: payloadData,           // Use the same processed optional fields for update
      };

      try {
        const updatedWallet = await this.prismaClient.wallet.upsert(upsertOptions);
        this.logger.info(`[DB] Successfully upserted wallet: ${walletAddress}`);
        return updatedWallet;
      } catch (error: any) {
          this.logger.error(`[DB] Error upserting wallet ${walletAddress}. Create Payload: ${JSON.stringify(upsertOptions.create)}, Update Payload: ${JSON.stringify(upsertOptions.update)}`, { error: { message: error.message, code: error.code, meta: error.meta, name: error.name }, data });
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

        // Declare existingDbEntries here to be accessible in the later loop
        let existingDbEntries: { signature: string; mint: string; direction: string; amount: number; }[] = [];

        if (distinctInputSignatures.length > 0) {
            this.logger.debug(`[DB] Distinct signatures for findMany: ${JSON.stringify(distinctInputSignatures.slice(0, 5))}${distinctInputSignatures.length > 5 ? '...' : ''}`);
            this.logger.debug(`[DB] Sample input for findMany (first item): ${inputs.length > 0 ? JSON.stringify(inputs[0]) : 'N/A'}`);
            // Assign to the already declared variable
            existingDbEntries = await this.prismaClient.swapAnalysisInput.findMany({ // Note: assign here
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
                // this.logger.warn(`[DB] Duplicate SwapAnalysisInput within incoming batch (sig: ${record.signature}, key: ${recordKey}). Skipping.`);
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
            // --- REMOVED Detailed Logging for Potential Float Precision Issues ---
            // The extensive block comparing incoming records with DB records for float issues has been removed
            // as the primary debugging for that is complete. The iterative save handles the skips.
            // --- End of REMOVED Detailed Logging ---

            // --- ITERATIVE CREATE (WORKAROUND FOR SQLITE) ---
            // TODO: Revert to using prisma.swapAnalysisInput.createMany({ data: uniqueNewRecordsToInsert, skipDuplicates: true (if supported/needed) })
            // if the database is switched from SQLite to a system like PostgreSQL that offers more robust 
            // 'ON CONFLICT DO NOTHING' or equivalent behavior with `createMany` that reliably handles these float-precision-induced duplicates.
            // SQLite's `createMany` with `skipDuplicates: true` (or its default behavior) was found to still throw P2002 errors
            // in these float precision scenarios, necessitating this iterative approach for robust skipping.
            let successfulInserts = 0;
            let skippedDuplicatesCount = 0; 
            this.logger.info(`[DB] Using iterative create for SwapAnalysisInput. Attempting to insert ${uniqueNewRecordsToInsert.length} records one by one...`);

            for (const record of uniqueNewRecordsToInsert) {
                try {
                    await this.prismaClient.swapAnalysisInput.create({ data: record });
                    successfulInserts++;
                } catch (error) {
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                        skippedDuplicatesCount++;
                        // Downgraded to debug to reduce noise, as the final summary is an info log.
                        this.logger.debug(
                            `[DB] Iterative Save: Skipped inserting duplicate SwapAnalysisInput (P2002). Sig: ${record.signature}, Mint: ${record.mint}, Amount: ${record.amount}. Total skipped so far: ${skippedDuplicatesCount}.`
                        );
                    } else {
                        // For non-P2002 errors, log more verbosely as it's unexpected.
                        this.logger.error('[DB] Iterative Save: Error inserting single SwapAnalysisInput record', {
                            signature: record.signature, 
                            mint: record.mint, 
                            amount: record.amount,
                            error 
                        });
                        // Depending on policy, you might want to re-throw or break for unexpected errors.
                    }
                }
            }
            this.logger.info(`[DB] Iterative insert process complete. Attempted: ${uniqueNewRecordsToInsert.length}, Successfully inserted: ${successfulInserts}, Skipped due to P2002 (duplicates/float precision): ${skippedDuplicatesCount}`);
            return { count: successfulInserts };
            // --- END OF ITERATIVE LOGIC ---

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
            throw error;
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
    async saveAdvancedStats(inputData: AdvancedTradeStatsInput): Promise<AdvancedTradeStats | null> {
        const { runId, ...statsFields } = inputData; // Separate runId from stats fields
        // walletAddress for logging is tricky here as statsFields.walletPnlSummary is a create/connect input.
        // For logging purposes, we'll acknowledge it might not be directly available or use the runId (which is walletPnlSummaryId).
        this.logger.debug(`Attempting to save advanced stats for walletPnlSummary ID (runId): ${runId}...`);
        
        try {
            const dataToCreate: Prisma.AdvancedTradeStatsCreateInput = {
                ...statsFields, 
                walletPnlSummary: { 
                    connect: { id: runId } // runId here is walletPnlSummaryId
                }
            };

            const savedStats = await this.prismaClient.advancedTradeStats.create({
                data: dataToCreate, 
            });
            return savedStats;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const target = (error.meta?.target as string[] | undefined) || [];
                // The unique constraint on AdvancedTradeStats is walletPnlSummaryId
                if (target.includes('walletPnlSummaryId')) { 
                    this.logger.warn(`Advanced stats already exist for walletPnlSummary ID: ${runId}. Ignoring duplicate save.`);
                    return null; 
                } else {
                    this.logger.error(`Prisma unique constraint violation (P2002) on unexpected fields: ${target.join(', ')} for walletPnlSummaryId ${runId}`, { error });
                    return null;
                }
            } else {
                this.logger.error(`Error saving advanced stats for walletPnlSummary ID: ${runId}`, { error, inputData });
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
    async getAdvancedStatsForRun(runId: number): Promise<AdvancedTradeStats | null> {
        // Assuming runId here refers to walletPnlSummaryId based on schema
        this.logger.debug(`Fetching AdvancedTradeStats for walletPnlSummary ID: ${runId}`);
        try {
            const stats = await this.prismaClient.advancedTradeStats.findUnique({ // findUnique as walletPnlSummaryId is unique
                where: { walletPnlSummaryId: runId }, 
            });
             if (!stats) {
                 this.logger.debug(`No AdvancedTradeStats found for walletPnlSummaryId ${runId}.`);
             }
            return stats;
        } catch (error) {
            this.logger.error(`Error fetching AdvancedTradeStats for walletPnlSummaryId ${runId}`, { error });
            return null;
        }
    }

    /**
     * Fetches the latest AdvancedStatsResult for a given wallet address.
     * It orders by the AnalysisRun's runTimestamp in descending order to find the latest.
     * @param walletAddress The public key of the wallet.
     * @returns The latest AdvancedStatsResult object if found, otherwise null.
     */
    async getLatestAdvancedStatsByWallet(walletAddress: string): Promise<AdvancedTradeStats | null> {
      this.logger.debug(`Fetching latest advanced stats for wallet: ${walletAddress}`);
      try {
        const advancedStats = await this.prismaClient.advancedTradeStats.findFirst({
          where: { walletPnlSummary: { walletAddress: walletAddress } },
          orderBy: {
            walletPnlSummary: { // Order by the related WalletPnlSummary's update timestamp
              updatedAt: 'desc',
            },
          },
          // Removed: include: { run: true } - 'run' relation doesn't exist here
        });

        if (advancedStats) {
          // Removed: advancedStats.runId - runId is not a direct field of AdvancedTradeStats
          this.logger.debug(`Found latest advanced stats for wallet ${walletAddress}, associated with walletPnlSummaryId: ${advancedStats.walletPnlSummaryId}`);
          return advancedStats;
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

    /**
     * Retrieves the most recent AnalysisRun for a given wallet.
     * @param walletAddress The wallet address.
     * @returns The latest AnalysisRun object or null if not found.
     */
    async getLatestAnalysisRun(walletAddress: string): Promise<AnalysisRun | null> {
        this.logger.debug(`Fetching latest AnalysisRun for wallet: ${walletAddress}`);
        try {
            const run = await this.prismaClient.analysisRun.findFirst({
                where: { walletAddress: walletAddress },
                orderBy: {
                    runTimestamp: 'desc',
                },
            });
            if (!run) {
                this.logger.warn(`No AnalysisRun found for wallet ${walletAddress}`);
            }
            return run;
        } catch (error) {
            this.logger.error(`Error fetching latest AnalysisRun for wallet ${walletAddress}`, { error });
            return null;
        }
    }

    async getLatestPnlAggregates(walletAddress: string): Promise<{ overallRealizedPnl: number; totalSolSpent: number; totalSolReceived: number } | null> {
        this.logger.debug(`Fetching latest PNL aggregates for wallet: ${walletAddress}`);
        try {
            const results = await this.prismaClient.analysisResult.findMany({
                where: { walletAddress: walletAddress },
            });

            if (!results || results.length === 0) {
                this.logger.warn(`No AnalysisResult records found for wallet ${walletAddress} to aggregate PNL.`);
                return null;
            }

            let overallRealizedPnl = 0;
            let totalSolSpent = 0;
            let totalSolReceived = 0;

            for (const result of results) {
                overallRealizedPnl += result.netSolProfitLoss;
                totalSolSpent += result.totalSolSpent;
                totalSolReceived += result.totalSolReceived;
            }

            return {
                overallRealizedPnl,
                totalSolSpent,
                totalSolReceived,
            };
        } catch (error) {
            this.logger.error(`Error fetching PNL aggregates for wallet ${walletAddress}`, { error });
            // Consider re-throwing or returning a more specific error structure if needed by controller
            // For now, rethrow to be caught by the controller's generic error handling.
            throw new Error(`Failed to fetch PNL aggregates for wallet ${walletAddress}`);
        }
    }

    /**
     * Upserts a WalletBehaviorProfile record.
     * @param data The data for creating or updating the wallet behavior profile.
     * @returns The upserted WalletBehaviorProfile object or null on error.
     */
    async upsertWalletBehaviorProfile(data: WalletBehaviorProfileUpsertData): Promise<WalletBehaviorProfile | null> {
        const { walletAddress, ...profileData } = data;
        this.logger.debug(`Upserting WalletBehaviorProfile for wallet: ${walletAddress}`);
        try {
            const profile = await this.prismaClient.walletBehaviorProfile.upsert({
                where: { walletAddress },
                create: {
                    ...profileData,
                    wallet: {
                        connectOrCreate: {
                            where: { address: walletAddress },
                            create: { address: walletAddress }
                        }
                    }
                },
                update: profileData
            });
            return profile;
        } catch (error) {
            this.logger.error(`Error upserting WalletBehaviorProfile for wallet ${walletAddress}:`, { error });
            return null;
        }
    }

    /**
     * Retrieves the earliest and latest SwapAnalysisInput timestamps for a wallet within a given time range.
     * @param walletAddress The wallet address.
     * @param timeRange The start and end timestamps for the query period.
     * @returns An object with firstObservedTsInPeriod and lastObservedTsInPeriod, or nulls if no records found.
     */
    async getWalletTimestampsForRange(
        walletAddress: string,
        timeRange: Required<SwapInputTimeRange> // Ensure startTs and endTs are provided
    ): Promise<WalletTimeRangeInfo> {
        this.logger.debug(`Fetching wallet timestamps for range for ${walletAddress}`, { timeRange });
        try {
            const result = await this.prismaClient.swapAnalysisInput.aggregate({
                where: {
                    walletAddress: walletAddress,
                    timestamp: {
                        gte: timeRange.startTs,
                        lte: timeRange.endTs,
                    },
                },
                _min: {
                    timestamp: true,
                },
                _max: {
                    timestamp: true,
                },
            });

            return {
                firstObservedTsInPeriod: result._min.timestamp,
                lastObservedTsInPeriod: result._max.timestamp,
            };
        } catch (error) {
            this.logger.error(`Error fetching wallet timestamps for range for ${walletAddress}`, { error });
            throw error; // Or return { firstObservedTsInPeriod: null, lastObservedTsInPeriod: null }
        }
    }

    // --- Wallet Note Management ---
    /**
     * Creates a new wallet note for a given wallet and user.
     * @param walletAddress The address of the wallet associated with the note.
     * @param userId The ID of the user creating the note.
     * @param content The textual content of the note.
     * @returns A promise that resolves to the created WalletNote object.
     * @throws {NotFoundException} If the associated wallet or user does not exist.
     * @throws {InternalServerErrorException} If a database error occurs.
     */
    async createWalletNote(
      walletAddress: string,
      userId: string,
      content: string
    ): Promise<WalletNote> {
      this.logger.debug(`CoreService: Creating note for wallet ${walletAddress} by user ${userId}`);
      try {
        const note = await this.prismaClient.walletNote.create({
          data: {
            walletAddress,
            userId,
            content,
          },
        });
        this.logger.verbose(`CoreService: Note created with ID: ${note.id} for wallet ${walletAddress}`);
        return note;
      } catch (error: any) {
        this.logger.error(`CoreService: Error creating wallet note for ${walletAddress}: ${error.message}`, error.stack);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // Example: Foreign key constraint failed (e.g., walletAddress or userId doesn't exist)
          if (error.code === 'P2003' || error.code === 'P2025') { 
            throw new NotFoundException(`Failed to create note. Ensure wallet and user exist.`);
          }
        }
        throw new InternalServerErrorException('Could not create wallet note due to a database error.');
      }
    }

    /**
     * Retrieves wallet notes for a given wallet and user.
     * @param walletAddress The address of the wallet associated with the notes.
     * @param userId The ID of the user whose notes are being retrieved.
     * @returns A promise that resolves to an array of WalletNote objects.
     * @throws {InternalServerErrorException} If a database error occurs.
     */
    async getWalletNotes(walletAddress: string, userId: string): Promise<WalletNote[]> {
      this.logger.debug(`CoreService: Fetching notes for wallet ${walletAddress} by user ${userId}`);
      try {
        const notes = await this.prismaClient.walletNote.findMany({
          where: {
            walletAddress,
            userId, // Filter by the user who created the note
          },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, description: true } } },
        });
        this.logger.verbose(`CoreService: Found ${notes.length} notes for wallet ${walletAddress} authored by user ${userId}`);
        return notes;
      } catch (error: any) {
        this.logger.error(`CoreService: Error fetching wallet notes for ${walletAddress} by user ${userId}: ${error.message}`, error.stack);
        throw new InternalServerErrorException('Could not retrieve wallet notes due to a database error.');
      }
    }

    /**
     * Deletes a wallet note for a given user.
     * @param noteId The ID of the note to delete.
     * @param userId The ID of the user attempting to delete the note (must be the owner).
     * @returns A promise that resolves to the deleted WalletNote object, or null if not found or permission denied.
     * @throws {NotFoundException} If the note is not found or the user does not have permission to delete it.
     * @throws {InternalServerErrorException} If a database error occurs.
     */
    async deleteWalletNote(noteId: string, userId: string): Promise<WalletNote | null> {
      this.logger.debug(`CoreService: Attempting to delete note ${noteId} by user ${userId}`);
      try {
        // First, verify the note exists and belongs to the user to prevent unauthorized deletion
        const note = await this.prismaClient.walletNote.findUnique({
          where: { id: noteId },
        });

        if (!note) {
          throw new NotFoundException(`Note with ID ${noteId} not found.`);
        }

        if (note.userId !== userId) {
          // Though the API controller should also enforce this, good to have a safeguard
          this.logger.warn(`CoreService: User ${userId} attempted to delete note ${noteId} owned by ${note.userId}. Denied.`);
          throw new NotFoundException('Note not found or permission denied.'); // Generic message to client
        }

        const deletedNote = await this.prismaClient.walletNote.delete({
          where: {
            id: noteId,
            // Redundant userId check here given the above, but doesn't hurt for an explicit delete call targetting user's own note
            // userId: userId 
          },
        });
        this.logger.verbose(`CoreService: Note ${noteId} deleted successfully by user ${userId}`);
        return deletedNote;
      } catch (error: any) {
        if (error instanceof NotFoundException) throw error;
        
        this.logger.error(`CoreService: Error deleting note ${noteId} by user ${userId}: ${error.message}`, error.stack);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          // Record to delete does not exist - already handled by the explicit findUnique check above, but good fallback.
          throw new NotFoundException(`Note with ID ${noteId} not found for deletion.`);
        }
        throw new InternalServerErrorException('Could not delete note due to a database error.');
      }
    }

    /**
     * Updates a wallet note for a given user.
     * @param noteId The ID of the note to update.
     * @param userId The ID of the user attempting to update the note (must be the owner).
     * @param newContent The new textual content for the note.
     * @returns A promise that resolves to the updated WalletNote object.
     * @throws {NotFoundException} If the note is not found or the user does not have permission to update it.
     * @throws {InternalServerErrorException} If a database error occurs.
     */
    async updateWalletNote(
      noteId: string,
      userId: string,
      newContent: string
    ): Promise<WalletNote> {
      this.logger.debug(`CoreService: Attempting to update note ${noteId} by user ${userId}`);
      try {
        // First, verify the note exists and belongs to the user
        const note = await this.prismaClient.walletNote.findUnique({
          where: { id: noteId },
        });

        if (!note) {
          throw new NotFoundException(`Note with ID ${noteId} not found.`);
        }

        if (note.userId !== userId) {
          this.logger.warn(`CoreService: User ${userId} attempted to update note ${noteId} owned by ${note.userId}. Denied.`);
          throw new NotFoundException('Note not found or permission denied.');
        }

        // Update the note
        const updatedNote = await this.prismaClient.walletNote.update({
          where: {
            id: noteId,
            // userId: userId, // Implicitly checked above
          },
          data: {
            content: newContent,
            updatedAt: new Date(), // Explicitly set updatedAt
          },
        });
        this.logger.verbose(`CoreService: Note ${noteId} updated successfully by user ${userId}`);
        return updatedNote;
      } catch (error: any) {
        if (error instanceof NotFoundException) throw error;
        
        this.logger.error(`CoreService: Error updating note ${noteId} by user ${userId}: ${error.message}`, error.stack);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException(`Note with ID ${noteId} not found for update.`);
        }
        throw new InternalServerErrorException('Could not update note due to a database error.');
      }
    }

    // --- Wallet Search Method ---
    /**
     * Searches for wallets by a fragment of their address.
     * Returns a list of wallet addresses matching the fragment.
     *
     * @param fragment The partial wallet address to search for.
     * @param limit The maximum number of results to return (default: 10).
     * @returns A promise that resolves to an array of objects containing wallet addresses.
     */
    async searchWalletsByAddressFragment(
      fragment: string,
    ): Promise<{ address: string }[]> {
        this.logger.debug(`Searching for wallets with fragment: ${fragment}`);
        try {
            const wallets = await this.prismaClient.wallet.findMany({
                where: {
                    address: {
                        contains: fragment,
                    },
                },
                select: {
                    address: true,
                },
                take: 15, // Limit results for performance
            });
            return wallets;
        } catch (error) {
            this.logger.error(`Database error while searching wallets for fragment "${fragment}":`, { error });
            throw new InternalServerErrorException('Wallet search failed due to a database error.');
        }
    }
    // --- End Wallet Search Method ---
}
