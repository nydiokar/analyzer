import {
    PrismaClient,
    Wallet,
    SwapAnalysisInput,
    AnalysisRun,
    AnalysisResult,
    AdvancedTradeStats,
    WalletBehaviorProfile,
    HolderProfileSnapshot,
    MappingActivityLog,
    Prisma, // Import Prisma namespace for input types
    User,         // Added User
    ActivityLog,   // Added ActivityLog
    WalletNote,    // Added WalletNote
    UserFavoriteWallet, // Added UserFavoriteWallet model import
    TokenInfo
} from '@prisma/client';
import { HeliusTransaction } from '@/types/helius-api'; // Assuming HeliusTransaction type is defined here
import { TransactionData } from '@/types/correlation'; // Needed for getTransactionsForAnalysis
import { BaseAnalysisConfig } from '@/types/analysis'; // Needed for getTransactionsForAnalysis
import { createLogger } from 'core/utils/logger'; // Assuming createLogger function is defined in utils
import { sanitizePrismaInput } from 'core/utils/string-sanitizer'; // UTF-8 sanitization for PostgreSQL

import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { NotFoundException, InternalServerErrorException, Injectable, ConflictException, Logger, ForbiddenException } from '@nestjs/common';
import { WalletAnalysisStatus } from '@/types/wallet';
import { DB_CONFIG, USER_FAVORITES_CONFIG } from '../../config/constants';
import type { DashboardAnalysisScope } from '../../shared/dashboard-analysis.types';
import { getErrorMessage } from 'core/utils/error-utils';

// Instantiate Prisma Client - remains exported for potential direct use elsewhere, but service uses it too
/**
 * PrismaClient instance for database interactions.
 * Exported for potential direct use, though the DatabaseService is the preferred interface.
 *
 * Configuration:
 * - statement_timeout=120000ms (120s/2min) - Prevents queries from hanging indefinitely
 *   while allowing heavy operations like holder profile analysis and batch upserts
 */
export const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}statement_timeout=120000`
        : undefined,
    },
  },
}); 

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

export type TokenLotCreateData = Prisma.TokenLotCreateManyInput;

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

interface HolderProfileSnapshotCreateParams {
  walletAddress: string;
  tokenMint?: string | null;
  analysisMode: 'token' | 'wallet';
  holderRank?: number | null;
  supplyPercent?: number | null;
  topN?: number | null;
  jobId?: string | null;
  requestId?: string | null;
  profile: any;
  metadata?: any;
  computedAt?: Date;
}

interface WalletStatus {
  walletAddress: string;
  status: WalletAnalysisStatus;
  lastSuccessfulFetchTimestamp?: Date | null;
}

interface WalletStatusResponse {
  statuses: WalletStatus[];
}

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
        // this.logger.info('DatabaseService instantiated.');
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private isTransientDbTimeout(error: unknown): boolean {
        const message = (error as { message?: string })?.message ?? '';
        const code = (error as { code?: string })?.code ?? '';
        // Prisma timeout or sqlite lock symptoms
        return code === 'P1008' || code === 'P2024' || message.includes('Socket timeout') || message.includes('database is locked');
    }

    private async executeWithRetry<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
        const maxRetries: number = DB_CONFIG.maxRetries ?? 3;
        const baseDelayMs: number = DB_CONFIG.retryDelayMs ?? 1000;
        let attempt: number = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                return await fn();
            } catch (error) {
                attempt += 1;
                if (!this.isTransientDbTimeout(error) || attempt > maxRetries) {
                    this.logger.error(`DB ${operationName} failed${attempt > 1 ? ` after ${attempt} attempts` : ''}`, { error });
                    throw error;
                }
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                this.logger.warn(`DB ${operationName} transient error (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }
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
        
        // Add defensive validation and default values for all required fields
        const safeStats = {
            totalTransactionsReceived: this.ensureNumber(stats.totalTransactionsReceived, 0),
            transactionsSkippedError: this.ensureNumber(stats.transactionsSkippedError, 0),
            transactionsSuccessfullyProcessed: this.ensureNumber(stats.transactionsSuccessfullyProcessed, 0),
            analysisInputsGenerated: this.ensureNumber(stats.analysisInputsGenerated, 0),
            nativeSolTransfersProcessed: this.ensureNumber(stats.nativeSolTransfersProcessed, 0),
            tokenTransfersProcessed: this.ensureNumber(stats.tokenTransfersProcessed, 0),
            wsolTransfersProcessed: this.ensureNumber(stats.wsolTransfersProcessed, 0),
            usdcTransfersProcessed: this.ensureNumber(stats.usdcTransfersProcessed, 0),
            otherTokenTransfersProcessed: this.ensureNumber(stats.otherTokenTransfersProcessed, 0),
            feePayerHeuristicApplied: this.ensureNumber(stats.feePayerHeuristicApplied, 0),
            feesCalculated: this.ensureNumber(stats.feesCalculated, 0),
            eventMatcherAttempts: this.ensureNumber(stats.eventMatcherAttempts, 0),
            eventMatcherPrimaryMintsIdentified: this.ensureNumber(stats.eventMatcherPrimaryMintsIdentified, 0),
            eventMatcherConsistentSolFound: this.ensureNumber(stats.eventMatcherConsistentSolFound, 0),
            eventMatcherConsistentUsdcFound: this.ensureNumber(stats.eventMatcherConsistentUsdcFound, 0),
            eventMatcherAmbiguous: this.ensureNumber(stats.eventMatcherAmbiguous, 0),
            eventMatcherNoConsistentValue: this.ensureNumber(stats.eventMatcherNoConsistentValue, 0),
            splToSplSwapDetections: this.ensureNumber(stats.splToSplSwapDetections, 0),
            associatedValueFromSplToSpl: this.ensureNumber(stats.associatedValueFromSplToSpl, 0),
            associatedValueFromEventMatcher: this.ensureNumber(stats.associatedValueFromEventMatcher, 0),
            associatedValueFromTotalMovement: this.ensureNumber(stats.associatedValueFromTotalMovement, 0),
            associatedValueFromNetChange: this.ensureNumber(stats.associatedValueFromNetChange, 0),
            smallOutgoingHeuristicApplied: this.ensureNumber(stats.smallOutgoingHeuristicApplied, 0),
            skippedDuplicateRecordKey: this.ensureNumber(stats.skippedDuplicateRecordKey, 0),
            unknownTxSkippedNoJito: this.ensureNumber((stats as any).unknownTxSkippedNoJito, 0),
            countByInteractionType: (stats as any).countByInteractionType || {}
        };

        // Log any field corrections for debugging
        const corrections = [];
        Object.keys(safeStats).forEach(key => {
            if (key !== 'countByInteractionType' && (stats as any)[key] !== safeStats[key]) {
                corrections.push(`${key}: ${(stats as any)[key]} → ${safeStats[key]}`);
            }
        });
        if (corrections.length > 0) {
            this.logger.warn(`Applied default values to mapping stats for ${walletAddress}: ${corrections.join(', ')}`);
        }

        try {
            const logEntry = await this.prismaClient.mappingActivityLog.create({
                data: {
                    walletAddress,
                    timestamp: new Date(), // Set timestamp at save time
                    ...safeStats,
                },
            });
            this.logger.info(`Mapping activity log saved with ID: ${logEntry.id} for wallet ${walletAddress}`);
            return logEntry;
        } catch (error) {
            // Enhanced error logging with field analysis
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Error saving mapping activity log - DETAILED ANALYSIS:', { 
                error: errorMessage,
                walletAddress,
                receivedStats: stats,
                safeStats,
                errorType: error instanceof Error ? error.constructor.name : 'Unknown',
                // Log which fields might be problematic
                fieldAnalysis: Object.keys(safeStats).map(key => ({
                    field: key,
                    receivedValue: (stats as any)[key],
                    receivedType: typeof (stats as any)[key],
                    safenessApplied: (stats as any)[key] !== safeStats[key]
                }))
            });
            return null;
        }
    }

    /**
     * Helper method to ensure a value is a valid number, providing a default if not
     */
    private ensureNumber(value: any, defaultValue: number): number {
        if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
            return Math.floor(value); // Ensure integer for database
        }
        return defaultValue;
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
        try {
            // Use findFirst instead of findUnique for better performance with includes
            return await this.prismaClient.walletPnlSummary.findFirst({
                where: { walletAddress },
                include: { 
                    advancedStats: true, 
                    wallet: true 
                },
                // Add orderBy to ensure consistent results
                orderBy: { updatedAt: 'desc' }
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
        this.logger.trace(`Fetching WalletBehaviorProfile for wallet: ${walletAddress}`);
        try {
            // Use findFirst for better performance with potential indexes
            return await this.prismaClient.walletBehaviorProfile.findFirst({
                where: { walletAddress },
                orderBy: { updatedAt: 'desc' } // Get the most recent profile
            });
        } catch (error) {
            this.logger.error('Error fetching WalletBehaviorProfile', { error, walletAddress });
            // Decide on error handling: re-throw, or return null for controller to handle as NotFound
            throw new InternalServerErrorException('Could not fetch behavior profile data.');
        }
    }
    // --- End WalletPnlSummary and WalletBehaviorProfile Accessors ---

    // --- MappingActivityLog Methods ---

    /**
     * Get recent mapping activity logs for a wallet
     */
    async getMappingActivityLogs(
        walletAddress: string, 
        options: { limit?: number; fromDate?: Date } = {}
    ): Promise<MappingActivityLog[]> {
        const { limit = 10, fromDate } = options;
        
        try {
            const whereClause: any = { walletAddress };
            if (fromDate) {
                whereClause.timestamp = { gte: fromDate };
            }

            return await this.prismaClient.mappingActivityLog.findMany({
                where: whereClause,
                orderBy: { timestamp: 'desc' },
                take: limit,
            });
        } catch (error) {
            this.logger.error(`Error fetching mapping activity logs for ${walletAddress}: ${getErrorMessage(error)}`);
            return [];
        }
    }

    // --- Wallet Classification Methods ---

    /**
     * Updates wallet classification data including bot detection results
     */
    async updateWalletClassification(
        walletAddress: string,
        classificationData: {
            classification: string;
            classificationConfidence?: number;
            classificationMethod?: string;
            classificationUpdatedAt?: Date;
            botType?: string;
            botPatternTags?: string[];
            isVerifiedBot?: boolean;
            knownType?: string;
            knownLabel?: string;
        }
    ): Promise<Wallet> {
        const updateData: any = {
            classification: classificationData.classification,
            classificationUpdatedAt: classificationData.classificationUpdatedAt || new Date(),
        };

        if (classificationData.classificationConfidence !== undefined) {
            updateData.classificationConfidence = classificationData.classificationConfidence;
        }

        if (classificationData.classificationMethod) {
            updateData.classificationMethod = classificationData.classificationMethod;
        }

        if (classificationData.botType) {
            updateData.botType = classificationData.botType;
        }

        if (classificationData.botPatternTags) {
            updateData.botPatternTags = classificationData.botPatternTags;
        }

        if (classificationData.isVerifiedBot !== undefined) {
            updateData.isVerifiedBot = classificationData.isVerifiedBot;
        }

        if (classificationData.knownType) {
            updateData.knownType = classificationData.knownType;
        }

        if (classificationData.knownLabel) {
            updateData.knownLabel = classificationData.knownLabel;
        }

        return await this.prismaClient.wallet.upsert({
            where: { address: walletAddress },
            create: {
                address: walletAddress,
                ...updateData,
            },
            update: updateData,
        });
    }

    /**
     * Gets wallet classification data
     */
    async getWalletClassification(walletAddress: string): Promise<{
        classification: string | null;
        classificationConfidence: number | null;
        classificationMethod: string | null;
        classificationUpdatedAt: Date | null;
        botType: string | null;
        botPatternTags: any | null;
        isVerifiedBot: boolean;
    } | null> {
        const wallet = await this.prismaClient.wallet.findUnique({
            where: { address: walletAddress },
            select: {
                classification: true,
                classificationConfidence: true,
                classificationMethod: true,
                classificationUpdatedAt: true,
                botType: true,
                botPatternTags: true,
                isVerifiedBot: true,
            },
        });

        return wallet;
    }

    /**
     * Simple wallet classification update for minimal implementation
     */
    async updateWalletSimpleClassification(
        walletAddress: string,
        classification: string
    ): Promise<void> {
        try {
            await this.prismaClient.wallet.update({
                where: { address: walletAddress },
                data: { classification },
            });
        } catch (error) {
            this.logger.error(`Error updating simple classification for ${walletAddress}: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    // --- End Wallet Classification Methods ---

    // --- Wallet Status and Search Methods ---

    /**
     * Checks a list of wallet addresses against the database for their analysis readiness.
     * This method powers both the initial check (identifying stale/missing wallets) and
     * the polling check (waiting for analysis to complete).
     * @param walletAddresses An array of wallet addresses to check.
     * @returns An object containing an array of detailed wallet statuses.
     */
    async getWalletsStatus(walletAddresses: string[]): Promise<WalletStatusResponse> {
        if (!walletAddresses || walletAddresses.length === 0) {
            return { statuses: [] };
        }

        try {
            const latestRuns = await this.prismaClient.analysisRun.findMany({
                where: { walletAddress: { in: walletAddresses } },
                orderBy: { runTimestamp: 'desc' },
                distinct: ['walletAddress'],
            });

            const foundWallets = await this.prismaClient.wallet.findMany({
                where: { address: { in: walletAddresses } },
                select: { address: true, analyzedTimestampEnd: true, lastSuccessfulFetchTimestamp: true },
            });

            const latestRunMap = new Map(latestRuns.map(run => [run.walletAddress, run]));
            const walletMap = new Map(foundWallets.map(w => [w.address, w]));
            const { WALLET_STALENESS_CONFIG } = await import('../../config/constants');
            const stalenessThreshold = Date.now() / 1000 - WALLET_STALENESS_CONFIG.ANALYSIS_STALENESS_SECONDS;

            const statuses: WalletStatus[] = walletAddresses.map(addr => {
                const latestRun = latestRunMap.get(addr);
                const wallet = walletMap.get(addr);
                const lastFetch = wallet?.lastSuccessfulFetchTimestamp ?? null;

                if (!latestRun) {
                    return { walletAddress: addr, status: WalletAnalysisStatus.MISSING, lastSuccessfulFetchTimestamp: lastFetch };
                }

                if (latestRun.status === 'IN_PROGRESS' || latestRun.status === 'INITIATED') {
                    return { walletAddress: addr, status: WalletAnalysisStatus.IN_PROGRESS, lastSuccessfulFetchTimestamp: lastFetch };
                }

                if (latestRun.status === 'FAILED') {
                    // It failed, but we treat it as "finished" for polling.
                    // The "staleness" check below will determine if we should retry.
                }

                // If the run is COMPLETED or FAILED, check for staleness.
                if (!wallet?.analyzedTimestampEnd || wallet.analyzedTimestampEnd < stalenessThreshold) {
                    return { walletAddress: addr, status: WalletAnalysisStatus.STALE, lastSuccessfulFetchTimestamp: lastFetch };
                }

                return { walletAddress: addr, status: WalletAnalysisStatus.READY, lastSuccessfulFetchTimestamp: lastFetch };
            });

            return { statuses };
        } catch (error) {
            this.logger.error('Error checking wallet status via AnalysisRun', { error, walletAddresses });
            throw new InternalServerErrorException('Could not check wallet status in database.');
        }
    }

    // --- Holder Profile Snapshot Methods ---

    async saveHolderProfileSnapshot(params: HolderProfileSnapshotCreateParams): Promise<HolderProfileSnapshot> {
        const {
            walletAddress,
            tokenMint = null,
            analysisMode,
            holderRank = null,
            supplyPercent = null,
            topN = null,
            jobId = null,
            requestId = null,
            profile,
            metadata,
            computedAt,
        } = params;

        return this.executeWithRetry('holderProfileSnapshot.create', async () => {
            return this.prismaClient.holderProfileSnapshot.create({
                data: {
                    walletAddress,
                    tokenMint,
                    analysisMode,
                    holderRank,
                    supplyPercent,
                    topN,
                    jobId,
                    requestId,
                    computedAt: computedAt ?? new Date(),
                    profile: profile as Prisma.InputJsonValue,
                    metadata: metadata as Prisma.InputJsonValue | undefined,
                },
            });
        });
    }

    async getLatestHolderProfileSnapshotsForToken(tokenMint: string, walletAddresses: string[]): Promise<Map<string, HolderProfileSnapshot>> {
        if (!walletAddresses || walletAddresses.length === 0) {
            return new Map();
        }

        const snapshots = await this.executeWithRetry('holderProfileSnapshot.findMany', async () => {
            return this.prismaClient.holderProfileSnapshot.findMany({
                where: {
                    tokenMint,
                    walletAddress: { in: walletAddresses },
                },
                orderBy: [
                    { walletAddress: 'asc' },
                    { computedAt: 'desc' },
                ],
            });
        });

        const snapshotMap = new Map<string, HolderProfileSnapshot>();
        for (const snapshot of snapshots) {
            if (!snapshotMap.has(snapshot.walletAddress)) {
                snapshotMap.set(snapshot.walletAddress, snapshot);
            }
        }
        return snapshotMap;
    }

    async getLatestHolderProfileSnapshot(params: {
        walletAddress: string;
        tokenMint?: string | null;
        analysisMode?: 'token' | 'wallet';
    }): Promise<HolderProfileSnapshot | null> {
        const { walletAddress, tokenMint = null, analysisMode } = params;
        return this.executeWithRetry('holderProfileSnapshot.findFirst', async () => {
            return this.prismaClient.holderProfileSnapshot.findFirst({
                where: {
                    walletAddress,
                    tokenMint,
                    analysisMode: analysisMode ?? undefined,
                },
                orderBy: { computedAt: 'desc' },
            });
        });
    }

    async countHolderProfileSnapshots(): Promise<number> {
        return this.executeWithRetry('holderProfileSnapshot.count', async () => {
            return this.prismaClient.holderProfileSnapshot.count();
        });
    }

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
        return this.executeWithRetry('analysisResult.findMany', async () => {
            return await this.prismaClient.analysisResult.findMany(params);
        });
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
        return this.executeWithRetry('analysisResult.count', async () => {
            return await this.prismaClient.analysisResult.count(params);
        });
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
                    this.logger.debug(`API key validated successfully for user ID: ${user.id}`);
                    return user;
                }
            }

            this.logger.warn('API key validation failed: No matching active user found for the provided key.');
            return null;
        } catch (error) {
            this.logger.error(`Error during API key validation: ${getErrorMessage(error)}`);
            throw new Error('Could not validate API key due to a server error.'); // Generic error to client
        }
    }

    /**
     * Retrieves all users from the database.
     * @returns A promise that resolves to an array of User objects.
     */
    async getAllUsers(): Promise<User[]> {
        this.logger.trace('Fetching all users.');
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
     * List users with filtering, sorting, and pagination.
     * Supports search by email/displayName and filtering by status flags.
     *
     * @param limit - Maximum number of users to return (1-1000)
     * @param offset - Number of users to skip (for pagination)
     * @param filters - Optional filters (search, isActive, isAdmin, isDemo)
     * @param sortBy - Field to sort by (default: 'createdAt')
     * @param sortOrder - Sort direction ('asc' or 'desc', default: 'desc')
     * @returns Object containing users array and total count
     */
    async listUsers(
        limit: number = 50,
        offset: number = 0,
        filters?: {
            search?: string;
            isActive?: boolean;
            isAdmin?: boolean;
            isDemo?: boolean;
        },
        sortBy: string = 'createdAt',
        sortOrder: 'asc' | 'desc' = 'desc'
    ): Promise<{ users: Array<Pick<User, 'id' | 'email' | 'displayName' | 'description' | 'isAdmin' | 'isActive' | 'isDemo' | 'emailVerified' | 'createdAt' | 'lastLoginAt' | 'lastSeenAt'>>; total: number }> {
        this.logger.trace('Listing users with filters', { limit, offset, filters, sortBy, sortOrder });

        try {
            const where: Prisma.UserWhereInput = {};

            // Apply boolean filters
            if (filters?.isActive !== undefined) {
                where.isActive = filters.isActive;
            }
            if (filters?.isAdmin !== undefined) {
                where.isAdmin = filters.isAdmin;
            }
            if (filters?.isDemo !== undefined) {
                where.isDemo = filters.isDemo;
            }

            // Apply search filter (case-insensitive search on email or displayName)
            if (filters?.search) {
                where.OR = [
                    { email: { contains: filters.search, mode: 'insensitive' } },
                    { displayName: { contains: filters.search, mode: 'insensitive' } }
                ];
            }

            // Execute queries in parallel for performance
            const [users, total] = await Promise.all([
                this.prismaClient.user.findMany({
                    where,
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                        description: true,
                        isAdmin: true,
                        isActive: true,
                        isDemo: true,
                        emailVerified: true,
                        createdAt: true,
                        lastLoginAt: true,
                        lastSeenAt: true,
                    },
                    orderBy: { [sortBy]: sortOrder },
                    take: limit,
                    skip: offset,
                }),
                this.prismaClient.user.count({ where }),
            ]);

            // this.logger.info(`Listed ${users.length} users out of ${total} total (limit=${limit}, offset=${offset})`);
            return { users, total };
        } catch (error) {
            this.logger.error('Error listing users', { error, filters, limit, offset });
            throw error;
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
        try {
            const wallet = await this.prismaClient.wallet.upsert({
                where: { address: walletAddress },
                update: {}, // No fields to update if it exists
                create: { address: walletAddress },
            });
            // ✅ REMOVED: Successful upsert logging to reduce spam
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
            this.logger.error(`Error activating user ${userId}: ${getErrorMessage(error)}`);
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
            this.logger.error(`Error deactivating user ${userId}: ${getErrorMessage(error)}`);
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
            // Use a transaction to ensure atomicity
            return await this.prismaClient.$transaction(async (tx) => {
                // First, check if user exists
                const existingUser = await tx.user.findUnique({
                    where: { id: userId },
                });
                
                if (!existingUser) {
                    this.logger.warn(`User ${userId} not found for deletion.`);
                    return null;
                }

                // Delete related records in the correct order to avoid foreign key violations
                
                // 1. Delete ActivityLog records
                const deletedActivityLogs = await tx.activityLog.deleteMany({
                    where: { userId: userId },
                });
                this.logger.debug(`Deleted ${deletedActivityLogs.count} activity logs for user ${userId}`);

                // 2. Delete UserFavoriteWallet records
                const deletedFavorites = await tx.userFavoriteWallet.deleteMany({
                    where: { userId: userId },
                });
                this.logger.debug(`Deleted ${deletedFavorites.count} favorite wallets for user ${userId}`);

                // 3. Delete WalletNote records
                const deletedNotes = await tx.walletNote.deleteMany({
                    where: { userId: userId },
                });
                this.logger.debug(`Deleted ${deletedNotes.count} wallet notes for user ${userId}`);

                // 4. Finally, delete the User record
                const deletedUser = await tx.user.delete({
                    where: { id: userId },
                });

                this.logger.info(`User ${userId} and all related data deleted successfully.`);
                return deletedUser;
            });
        } catch (error: any) {
            // Prisma throws P2025 if record to delete is not found
            if (error.code === 'P2025') {
                this.logger.warn(`User ${userId} not found for deletion.`);
                return null;
            }
            this.logger.error(`Error deleting user ${userId}: ${getErrorMessage(error)}`);
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
            this.logger.error(`Error setting demo status for user ${userId}: ${getErrorMessage(error)}`);
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
        // this.logger.debug('Logging activity for user ID: ' + userId + ', action: ' + actionType);
        
        // Handle system operations by setting userId to null to avoid foreign key constraint issues
        const isSystemOperation = userId?.startsWith('system-') || userId === 'system-enrichment-job';
        
        // Defensive validation for activity logging
        const safeData = {
            userId: isSystemOperation ? null : (userId?.trim() || null), // Set to null for system operations
            actionType: actionType?.trim() || 'unknown_action',
            requestParameters: requestParameters ? JSON.stringify(requestParameters) : null,
            status: status || 'INITIATED',
            durationMs: durationMs || null,
            errorMessage: errorMessage?.trim() || null,
            sourceIp: sourceIp?.trim() || null
        };

        // Additional validation
        const validationInfo = {
            userIdValid: safeData.userId === null || (typeof safeData.userId === 'string' && safeData.userId.length > 0),
            actionTypeValid: typeof safeData.actionType === 'string' && safeData.actionType.length > 0,
            statusValid: ['INITIATED', 'SUCCESS', 'FAILURE'].includes(safeData.status),
            durationValid: safeData.durationMs === null || (typeof safeData.durationMs === 'number' && safeData.durationMs >= 0)
        };

        if (!validationInfo.userIdValid || !validationInfo.actionTypeValid || !validationInfo.statusValid || !validationInfo.durationValid) {
            this.logger.warn('Invalid activity log data - validation failed', { 
                receivedParams: { userId, actionType, requestParameters, status, durationMs, errorMessage, sourceIp },
                safeData,
                validationInfo
            });
            return null;
        }

        try {
            const activityLog = await this.prismaClient.activityLog.create({
                data: safeData
            });
            
            this.logger.debug(`Activity logged successfully: ${activityLog.id} for ${isSystemOperation ? 'system operation' : 'user: ' + safeData.userId}, for action: ${actionType}`);
            return activityLog;
        } catch (error) {
            this.logger.error('Error logging activity - DETAILED ANALYSIS:', {
                error: error instanceof Error ? error.message : String(error),
                errorType: error?.constructor?.name,
                receivedParams: { userId, actionType, requestParameters, status, durationMs, errorMessage, sourceIp },
                safeData,
                validationInfo,
                isSystemOperation
            });
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
       * @throws NotFoundException if the user does not exist.
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

        const existingFavorite = await this.prismaClient.userFavoriteWallet.findUnique({
            where: { userId_walletAddress: { userId, walletAddress } },
        });
        if (existingFavorite) {
            this.logger.warn(`Add favorite conflict: Wallet ${walletAddress} already in favorites for user ${userId}.`);
            throw new ConflictException('This wallet is already in your favorites.');
        }

        const currentCount = await this.prismaClient.userFavoriteWallet.count({ where: { userId } });
        if (currentCount >= USER_FAVORITES_CONFIG.MAX_FAVORITES) {
            this.logger.warn(`Add favorite blocked: User ${userId} reached max favorites (${USER_FAVORITES_CONFIG.MAX_FAVORITES}).`);
            throw new ForbiddenException(`Favorites limit reached (${USER_FAVORITES_CONFIG.MAX_FAVORITES}). Remove a wallet to add another.`);
        }

        // Ensure wallet exists in DB; create a lightweight stub if missing.
        await this.prismaClient.wallet.upsert({
            where: { address: walletAddress },
            create: { address: walletAddress },
            update: {},
        });

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
     * Removes all favorite wallets for a user.
     *
     * @param userId The ID of the user.
     * @returns The number of favorites removed.
     * @throws InternalServerErrorException for database errors.
     */
    async clearFavoriteWallets(userId: string): Promise<number> {
        this.logger.warn(`Clearing all favorite wallets for user ${userId}`);
        try {
            const result = await this.prismaClient.userFavoriteWallet.deleteMany({
                where: { userId },
            });
            this.logger.info(`Cleared ${result.count} favorite wallets for user ${userId}`);
            return result.count;
        } catch (error) {
            this.logger.error(`Error clearing favorite wallets for user ${userId}:`, { error });
            throw new InternalServerErrorException('Could not clear favorites due to an unexpected error.');
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
    async getFavoriteWalletsByUserId(userId: string): Promise<Array<Prisma.UserFavoriteWalletGetPayload<{ include: { wallet: { include: { pnlSummary: { include: { advancedStats: true } }, behaviorProfile: true } } } }>>> {
       // this.logger.debug(`Fetching favorite wallets for user ${userId}`);
        try {
            return await this.prismaClient.userFavoriteWallet.findMany({
                where: { userId: userId },
                include: {
                    wallet: {
                        include: {
                            pnlSummary: {
                                include: {
                                    advancedStats: true,
                                }
                            },
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

    /**
     * Updates a favorite wallet's metadata.
     *
     * @param userId The ID of the user.
     * @param walletAddress The address of the wallet to update.
     * @param updateData The data to update.
     * @throws NotFoundException if the favorite entry does not exist.
     * @throws InternalServerErrorException for other database errors.
     */
    async updateFavoriteWallet(
        userId: string,
        walletAddress: string,
        updateData: { nickname?: string; collections?: string | null; metadata?: any }
    ): Promise<void> {
        this.logger.debug(`Updating favorite wallet ${walletAddress} for user ${userId}`);
        try {
            await this.prismaClient.userFavoriteWallet.update({
                where: { userId_walletAddress: { userId, walletAddress } },
                data: updateData,
            });
            this.logger.info(`Favorite wallet ${walletAddress} updated for user ${userId}`);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                throw new NotFoundException('Favorite wallet not found');
            }
            this.logger.error(`Error updating favorite wallet ${walletAddress} for user ${userId}:`, { error });
            throw new InternalServerErrorException('Could not update favorite wallet.');
        }
    }

    /**
     * Updates the last viewed timestamp for a favorite wallet.
     *
     * @param userId The ID of the user.
     * @param walletAddress The address of the wallet.
     */
    async updateFavoriteWalletLastViewed(userId: string, walletAddress: string): Promise<void> {
        this.logger.debug(`Updating last viewed for wallet ${walletAddress} for user ${userId}`);
        try {
            await this.prismaClient.userFavoriteWallet.update({
                where: { userId_walletAddress: { userId, walletAddress } },
                data: { lastViewedAt: new Date() },
            });
        } catch (error) {
            // Silently fail if the wallet is not favorited
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
                this.logger.error(`Error updating last viewed for wallet ${walletAddress} for user ${userId}:`, { error });
            }
        }
    }

    /**
     * Gets all unique collections used by a user across their favorite wallets.
     *
     * @param userId The ID of the user.
     * @returns Array of unique collection strings.
     */
    async getUserFavoriteCollections(userId: string): Promise<string[]> {
        this.logger.debug(`Fetching favorite collections for user ${userId}`);
        try {
            const favorites = await this.prismaClient.userFavoriteWallet.findMany({
                where: { userId },
                select: { collections: true },
            });

            const collectionSet = new Set<string>();
            favorites.forEach(fav => {
                if (fav.collections) {
                    try {
                        const collections = JSON.parse(fav.collections);
                        if (Array.isArray(collections)) {
                            collections.forEach((collection: string) => collectionSet.add(collection));
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            });

            return Array.from(collectionSet).sort();
        } catch (error) {
            this.logger.error(`Error fetching favorite collections for user ${userId}:`, { error });
            return [];
        }
    }
    // --- End Wallet Favorite Methods ---

    /**
     * Bulk upsert favorite wallets for a user.
     * - Creates missing Wallet records.
     * - Inserts new favorites via createMany.
     * - Optionally merges collections and metadata for existing favorites.
     */
    async bulkUpsertFavoriteWallets(params: {
        userId: string;
        favorites: Array<{
            walletAddress: string;
            nickname?: string;
            collections?: string[];
            metadata?: any;
        }>;
        mergeCollections?: boolean;
        overwriteNickname?: boolean;
        mergeMetadata?: boolean;
    }): Promise<{ added: number; updated: number; skipped: number; overLimit: number; createdWallets: string[] }> {
        const {
            userId,
            favorites,
            mergeCollections = true,
            overwriteNickname = false,
            mergeMetadata = true,
        } = params;

        this.logger.debug(`Bulk importing ${favorites.length} favorite wallets for user ${userId}`);

        const userExists = await this.prismaClient.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            this.logger.warn(`Bulk favorite import failed: User ${userId} not found.`);
            throw new NotFoundException(`User with ID "${userId}" not found.`);
        }

        if (!favorites.length) {
            return { added: 0, updated: 0, skipped: 0, overLimit: 0, createdWallets: [] };
        }

        const maxFavorites = USER_FAVORITES_CONFIG.MAX_FAVORITES;
        const currentCount = await this.prismaClient.userFavoriteWallet.count({ where: { userId } });

        const uniqueFavorites = new Map<string, { walletAddress: string; nickname?: string; collections?: string[]; metadata?: any }>();
        for (const favorite of favorites) {
            const existing = uniqueFavorites.get(favorite.walletAddress);
            if (!existing) {
                uniqueFavorites.set(favorite.walletAddress, {
                    walletAddress: favorite.walletAddress,
                    nickname: favorite.nickname,
                    collections: favorite.collections ? [...favorite.collections] : [],
                    metadata: favorite.metadata,
                });
                continue;
            }

            if (!existing.nickname && favorite.nickname) {
                existing.nickname = favorite.nickname;
            }

            if (favorite.collections?.length) {
                const merged = new Set<string>([...(existing.collections || []), ...favorite.collections]);
                existing.collections = Array.from(merged);
            }

            if (favorite.metadata && typeof favorite.metadata === 'object') {
                const existingMeta = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
                existing.metadata = { ...existingMeta, ...favorite.metadata };
            }
        }

        const addresses = Array.from(uniqueFavorites.keys());
        if (!addresses.length) {
            return { added: 0, updated: 0, skipped: 0, overLimit: 0, createdWallets: [] };
        }

        const existingFavorites = await this.prismaClient.userFavoriteWallet.findMany({
            where: { userId, walletAddress: { in: addresses } },
            select: { walletAddress: true, nickname: true, collections: true, metadata: true },
        });

        const existingMap = new Map<string, typeof existingFavorites[number]>();
        existingFavorites.forEach(fav => existingMap.set(fav.walletAddress, fav));

        const toCreate: Prisma.UserFavoriteWalletCreateManyInput[] = [];
        const updates: Array<{ walletAddress: string; data: Prisma.UserFavoriteWalletUpdateInput }> = [];

        const parseCollections = (raw: string | null): string[] => {
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        };

        for (const favorite of uniqueFavorites.values()) {
            const existing = existingMap.get(favorite.walletAddress);
            const normalizedCollections = favorite.collections?.filter(c => c && c.trim()) ?? [];
            const metadata = favorite.metadata;

            if (!existing) {
                toCreate.push({
                    userId,
                    walletAddress: favorite.walletAddress,
                    nickname: favorite.nickname ?? null,
                    collections: normalizedCollections.length > 0 ? JSON.stringify(normalizedCollections) : null,
                    metadata: metadata ?? undefined,
                });
                continue;
            }

            const updateData: Prisma.UserFavoriteWalletUpdateInput = {};
            let changed = false;

            if (favorite.nickname && (overwriteNickname || !existing.nickname)) {
                updateData.nickname = favorite.nickname;
                changed = true;
            }

            if (normalizedCollections.length > 0) {
                const existingCollections = parseCollections(existing.collections ?? null);
                const nextCollections = mergeCollections
                    ? Array.from(new Set([...existingCollections, ...normalizedCollections]))
                    : normalizedCollections;

                if (JSON.stringify(existingCollections) !== JSON.stringify(nextCollections)) {
                    updateData.collections = JSON.stringify(nextCollections);
                    changed = true;
                }
            }

            if (metadata !== undefined) {
                const existingMeta = existing.metadata ?? undefined;
                let nextMeta = metadata;
                if (mergeMetadata && metadata && typeof metadata === 'object') {
                    const baseMeta = existingMeta && typeof existingMeta === 'object' ? existingMeta : {};
                    nextMeta = { ...baseMeta, ...metadata };
                }

                if (JSON.stringify(existingMeta) !== JSON.stringify(nextMeta)) {
                    updateData.metadata = nextMeta as Prisma.InputJsonValue;
                    changed = true;
                }
            }

            if (changed) {
                updates.push({ walletAddress: favorite.walletAddress, data: updateData });
            }
        }

        const availableSlots = Math.max(0, maxFavorites - currentCount);
        const allowedCreates = availableSlots > 0 ? toCreate.slice(0, availableSlots) : [];
        const overLimit = Math.max(0, toCreate.length - allowedCreates.length);
        const createdWallets = allowedCreates.map(entry => entry.walletAddress);

        if (allowedCreates.length > 0) {
            await this.prismaClient.wallet.createMany({
                data: allowedCreates.map(entry => ({ address: entry.walletAddress })),
                skipDuplicates: true,
            });
        }

        let added = 0;
        if (allowedCreates.length > 0) {
            const result = await this.prismaClient.userFavoriteWallet.createMany({
                data: allowedCreates,
                skipDuplicates: true,
            });
            added = result.count;
        }

        if (updates.length > 0) {
            const batchSize = 200;
            for (let i = 0; i < updates.length; i += batchSize) {
                const batch = updates.slice(i, i + batchSize);
                await this.prismaClient.$transaction(
                    batch.map(update =>
                        this.prismaClient.userFavoriteWallet.update({
                            where: { userId_walletAddress: { userId, walletAddress: update.walletAddress } },
                            data: update.data,
                        })
                    )
                );
            }
        }

        const updated = updates.length;
        const skipped = addresses.length - added - updated;

        return { added, updated, skipped: Math.max(0, skipped), overLimit, createdWallets };
    }

    // --- User Methods ---

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        return this.prismaClient.user.findUnique({
            where: { id: userId },
        });
    }

    /**
     * Update user's last bulk import timestamp
     */
    async updateUserLastBulkImport(userId: string): Promise<void> {
        await this.prismaClient.user.update({
            where: { id: userId },
            data: { lastBulkImportAt: new Date() },
        });
    }

    // --- Wallet Methods ---

    /**
     * Fetches multiple wallet records with configurable data depth.
     * 
     * This method provides two modes of operation to optimize performance and memory usage:
     * 
     * 1. **Addresses-only mode** (default): Returns minimal data for basic operations
     * 2. **Full data mode**: Returns complete wallet objects for detailed analysis
     * 
     * @param walletAddresses An array of public keys for the wallets to fetch.
     * @param includeFullData 
     *   - `false` (default): Returns only wallet addresses for fast, lightweight operations
     *   - `true`: Returns complete wallet objects including classification, timestamps, etc.
     * 
     * @returns 
     *   - When `includeFullData = false`: Array of `{ address: string }[]` objects
     *   - When `includeFullData = true`: Array of complete `Wallet[]` objects
     * 
     * @example
     * ```typescript
     * // Fast address validation (addresses only)
     * const addresses = await this.databaseService.getWallets(walletAddresses);
     * // Returns: [{ address: "..." }, { address: "..." }]
     * 
     * // Similarity analysis (needs classification field)
     * const wallets = await this.databaseService.getWallets(walletAddresses, true);
     * // Returns: [{ address: "...", classification: "...", ... }, ...]
     * ```
     * 
     * @performance
     * - **Addresses-only**: Optimized for speed and low memory usage
     * - **Full data**: Higher memory usage but provides complete wallet information
     * 
     * @usage
     * - Use default (false) for: address validation, existence checks, basic operations
     * - Use true for: similarity analysis, classification checks, detailed wallet processing
     */
    async getWallets(walletAddresses: string[], includeFullData: boolean = false): Promise<Wallet[] | { address: string }[]> {
        this.logger.trace(`Fetching wallet info for ${walletAddresses.length} addresses (full data: ${includeFullData}).`);
        try {
            const wallets = await this.prismaClient.wallet.findMany({
                where: {
                    address: { in: walletAddresses },
                },
                select: includeFullData ? undefined : { address: true } // Select only address unless full data requested
            });
            this.logger.debug(`Found ${walletAddresses.length} wallet records.`);
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
      // this.logger.debug(`Fetching wallet data for: ${walletAddress}`);
      try {
        const wallet = await this.prismaClient.wallet.findUnique({
          where: { address: walletAddress },
        });
        // if (wallet) {
        //     this.logger.debug(`Found wallet data for: ${walletAddress}`);
        // } else {
        //     this.logger.debug(`No wallet data found for: ${walletAddress}`);
        // }
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
        // ✅ REMOVED: Successful upsert logging to reduce spam - only log errors now
        return updatedWallet;
      } catch (error: any) {
          this.logger.error(`[DB] Error upserting wallet ${walletAddress}. Create Payload: ${JSON.stringify(upsertOptions.create)}, Update Payload: ${JSON.stringify(upsertOptions.update)}`, { error: { message: error.message, code: error.code, meta: error.meta, name: error.name }, data });
          return null;
      }
    }

    // --- HeliusTransactionCache Methods ---
    /**
     * Retrieves cached transaction signatures (lightweight cache).
     * @param signature A single transaction signature string or an array of signature strings.
     * @returns Depends on input: { timestamp: number } | null | Map<string, { timestamp: number }>
     */
    async getCachedTransaction(signature: string | string[]): Promise<{ timestamp: number } | null | Map<string, { timestamp: number }>> {
      if (typeof signature === 'string') {
        try {
          const cached = await this.prismaClient.heliusTransactionCache.findUnique({
            where: { signature },
            select: { signature: true, timestamp: true }
          });
          if (cached) {
            return { timestamp: cached.timestamp };
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
                },
                select: { signature: true, timestamp: true }
            });
            const resultMap = new Map<string, { timestamp: number }>();
            for (const record of cachedRecords) {
                resultMap.set(record.signature, { timestamp: record.timestamp });
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
        // this.logger.debug(`Attempting to save ${transactions.length} transaction signatures to lightweight cache...`);
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
             // this.logger.debug(`Found ${existingSignatures.size} existing signatures in cache out of ${incomingSignatures.length} incoming.`);
        } catch (error) {
             this.logger.error('Error checking for existing signatures in cache', { error });
            return { count: 0 }; 
        }
        const newTransactions = transactions.filter(tx => !existingSignatures.has(tx.signature));
        if (newTransactions.length === 0) {
             // this.logger.debug('No new transactions to add to cache.');
            return { count: 0 };
        }
         // this.logger.debug(`Identified ${newTransactions.length} new transactions to insert into HeliusTransactionCache.`);
        const dataToSave = newTransactions.map(tx => ({
            signature: tx.signature,
            timestamp: tx.timestamp,
        }));
        try {
            const result = await this.prismaClient.heliusTransactionCache.createMany({
                data: dataToSave,
            });
             // this.logger.debug(`Cache save complete. ${result.count} new transaction signatures added to HeliusTransactionCache.`);
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

    async upsertSignificantBuyersCache(data: {
        mint: string;
        startBlockTime: number;
        endBlockTime: number;
        walletAddresses: string[];
        transactions: Array<{ signature: string; timestamp: number }>;
    }): Promise<void> {
        try {
            await this.prismaClient.significantBuyersCache.upsert({
                where: {
                    mint_startBlockTime_endBlockTime: {
                        mint: data.mint,
                        startBlockTime: data.startBlockTime,
                        endBlockTime: data.endBlockTime,
                    },
                },
                create: {
                    mint: data.mint,
                    startBlockTime: data.startBlockTime,
                    endBlockTime: data.endBlockTime,
                    walletAddresses: JSON.stringify(data.walletAddresses),
                    transactions: JSON.stringify(data.transactions),
                    totalTransactions: data.transactions.length,
                },
                update: {
                    walletAddresses: JSON.stringify(data.walletAddresses),
                    transactions: JSON.stringify(data.transactions),
                    totalTransactions: data.transactions.length,
                    processedAt: new Date(),
                },
            });
        } catch (error) {
            this.logger.error(`Error upserting SignificantBuyersCache for ${data.mint}`, { error });
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
        // this.logger.debug(`[DB] Attempting to save ${inputs.length} SwapAnalysisInput records efficiently...`);
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
            // this.logger.debug(`[DB] Distinct signatures for findMany: ${JSON.stringify(distinctInputSignatures.slice(0, 5))}${distinctInputSignatures.length > 5 ? '...' : ''}`);
            // this.logger.debug(`[DB] Sample input for findMany (first item): ${inputs.length > 0 ? JSON.stringify(inputs[0]) : 'N/A'}`);
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
            // this.logger.debug(`[DB] Found ${existingDbEntries.length} existing SwapAnalysisInput entries for ${distinctInputSignatures.length} distinct incoming signatures.`);
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

            // Sanitize record to remove null bytes and invalid UTF-8 characters
            const sanitizedRecord = sanitizePrismaInput(record);

            // If not a duplicate, add to list and track it for this batch
            uniqueNewRecordsToInsert.push(sanitizedRecord);
            if (!batchRecordTracker.has(record.signature)) {
                batchRecordTracker.set(record.signature, new Set<string>());
            }
            batchRecordTracker.get(record.signature)!.add(recordKey);
        }
        
        // this.logger.debug(`[DB] Identified ${uniqueNewRecordsToInsert.length} unique new SwapAnalysisInput records to insert.`);

        if (uniqueNewRecordsToInsert.length > 0) {
            // --- REMOVED Detailed Logging for Potential Float Precision Issues ---
            // The extensive block comparing incoming records with DB records for float issues has been removed
            // as the primary debugging for that is complete. The iterative save handles the skips.
            // --- End of REMOVED Detailed Logging ---
            
            // this.logger.debug(`[DB] Attempting to bulk insert ${uniqueNewRecordsToInsert.length} records with createMany...`);
            try {
                // The fast path: try to insert everything in one go.
                const result = await this.prismaClient.swapAnalysisInput.createMany({
                    data: uniqueNewRecordsToInsert,
                });
                // ✅ REDUCED LOGGING: Only log for large batches to reduce spam
                if (result.count >= 100) {
                    this.logger.debug(`[DB] createMany successful. Inserted ${result.count} records.`);
                }
                return result;
            } catch (error) {
                // The fallback path: if the batch fails due to a unique constraint violation...
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    this.logger.warn(`[DB] createMany failed due to a duplicate record (P2002). Falling back to iterative insertion for this batch.`);
                    
                    // Now, we perform the original, slower, but safer iterative insertion.
                    let successfulInserts = 0;
                    let skippedDuplicatesCount = 0; 
                    
                    for (const record of uniqueNewRecordsToInsert) {
                        try {
                            await this.prismaClient.swapAnalysisInput.create({ data: record });
                            successfulInserts++;
                        } catch (iterativeError) {
                            if (iterativeError instanceof Prisma.PrismaClientKnownRequestError && iterativeError.code === 'P2002') {
                                skippedDuplicatesCount++;
                            } else {
                                this.logger.error('[DB] Iterative Fallback: Error inserting single record', { error: iterativeError });
                            }
                        }
                    }
                    this.logger.debug(`[DB] Iterative fallback complete. Successfully inserted: ${successfulInserts}, Skipped duplicates: ${skippedDuplicatesCount}`);
                    return { count: successfulInserts };

                } else {
                    // If it's a different kind of error, we should log it and re-throw it.
                    this.logger.error('[DB] createMany failed with a non-duplicate error', { error });
                    throw error; // Re-throwing the error for other unexpected issues.
                }
            }

        } else {
            this.logger.debug('[DB] No unique new SwapAnalysisInput records to add after filtering.');
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
            throw error;
        }
    }

    /**
     * Batch fetch swap analysis inputs for multiple wallets
     * Used by holder profiles analysis to avoid N+1 queries
     * @param walletAddresses Array of wallet addresses to fetch swaps for
     * @returns Array of swap analysis inputs sorted by wallet and timestamp
     */
    async getSwapAnalysisInputsBatch(
        walletAddresses: string[]
    ): Promise<SwapAnalysisInput[]> {
        this.logger.debug(`Batch fetching SwapAnalysisInputs for ${walletAddresses.length} wallets`);

        if (walletAddresses.length === 0) {
            return [];
        }

        try {
            return await this.executeWithRetry('swapAnalysisInput.findMany (batch)', async () => {
                const inputs = await this.prismaClient.swapAnalysisInput.findMany({
                    where: {
                        walletAddress: { in: walletAddresses },
                    },
                    orderBy: [
                        { walletAddress: 'asc' },
                        { timestamp: 'asc' },
                    ],
                });

                this.logger.debug(`Batch fetched ${inputs.length} SwapAnalysisInput records for ${walletAddresses.length} wallets`);
                return inputs;
            });
        } catch (error) {
            this.logger.error(`Error batch fetching SwapAnalysisInputs for ${walletAddresses.length} wallets`, { error });
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
        const excludedCount = config.excludedMints?.length || 0;
        const hasStart = Boolean(config.timeRange?.startTs);
        const hasEnd = Boolean(config.timeRange?.endTs);
        this.logger.debug(
            `Fetching transactions for analysis for ${walletAddresses.length} wallets ` +
            `(excludedMints=${excludedCount}, timeRange=${hasStart || hasEnd ? 'yes' : 'no'}).`
        );
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
            realizedPnlSol: r.realizedPnlSol ?? null,
            unrealizedPnlSol: r.unrealizedPnlSol ?? null,
            totalPnlSol: r.totalPnlSol ?? null,
            hasIncompleteHistory: r.hasIncompleteHistory ?? false,
            currentHoldingsCostBasisSol: r.currentHoldingsCostBasisSol ?? null,
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
     * @returns The latest AdvancedTradeStats object if found, otherwise null.
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

    async getLatestDashboardAnalysisRun(
        walletAddress: string,
        scope: DashboardAnalysisScope
    ): Promise<AnalysisRun | null> {
        this.logger.debug(`Fetching latest Dashboard AnalysisRun for wallet ${walletAddress} [scope=${scope}]`);
        try {
            return await this.prismaClient.analysisRun.findFirst({
                where: {
                    walletAddress,
                    serviceInvoked: `DashboardAnalysis.${scope}`,
                    status: 'COMPLETED',
                },
                orderBy: {
                    runTimestamp: 'desc',
                },
            });
        } catch (error) {
            this.logger.error(`Error fetching Dashboard AnalysisRun for wallet ${walletAddress} [scope=${scope}]`, { error });
            return null;
        }
    }

    async recordDashboardAnalysisRun(params: {
        walletAddress: string;
        scope: DashboardAnalysisScope;
        status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
        triggerSource: string;
        runTimestamp?: Date;
        durationMs?: number;
        signaturesConsidered?: number;
        inputDataStartTs?: number;
        inputDataEndTs?: number;
        historyWindowDays?: number;
        notes?: Record<string, unknown>;
    }): Promise<AnalysisRun | null> {
        const {
            walletAddress,
            scope,
            status,
            triggerSource,
            runTimestamp,
            durationMs,
            signaturesConsidered,
            inputDataStartTs,
            inputDataEndTs,
            historyWindowDays,
            notes,
        } = params;

        const payloadNotes = {
            triggerSource,
            historyWindowDays,
            ...(notes || {}),
        };

        return this.createAnalysisRun({
            walletAddress,
            serviceInvoked: `DashboardAnalysis.${scope}`,
            status,
            runTimestamp: runTimestamp ?? new Date(),
            durationMs,
            signaturesConsidered,
            inputDataStartTs,
            inputDataEndTs,
            notes: JSON.stringify(payloadNotes),
        });
    }

    async countSwapInputs(
        walletAddress: string,
        options: { sinceTs?: number; untilTs?: number } = {}
    ): Promise<number> {
        this.logger.debug(`Counting swap inputs for wallet ${walletAddress}`, options);
        try {
            const where: Prisma.SwapAnalysisInputWhereInput = {
                walletAddress,
            };

            if (options.sinceTs !== undefined || options.untilTs !== undefined) {
                const timestampFilter: Prisma.IntFilter = {};
                if (options.sinceTs !== undefined) {
                    timestampFilter.gte = options.sinceTs;
                }
                if (options.untilTs !== undefined) {
                    timestampFilter.lte = options.untilTs;
                }
                where.timestamp = timestampFilter;
            }

            return await this.prismaClient.swapAnalysisInput.count({ where });
        } catch (error) {
            this.logger.error(`Error counting swap inputs for wallet ${walletAddress}`, { error, options });
            return 0;
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
                overallRealizedPnl += result.netSolProfitLoss ?? 0;
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
     * Efficiently batch upserts AnalysisResult records for better performance.
     * Uses transactions to group operations and reduce database round trips.
     * @param results Array of AnalysisResult data to upsert
     * @returns Promise that resolves when all records are processed
     */
    async batchUpsertAnalysisResults(results: any[]): Promise<void> {
        if (results.length === 0) {
            this.logger.debug('No AnalysisResult records to upsert.');
            return;
        }

        this.logger.debug(`Batch upserting ${results.length} AnalysisResult records...`);
        
        const batchSize = DB_CONFIG.analysisBatchSize; // Use the optimized batch size for analysis results
        let totalProcessed = 0;

        try {
            for (let i = 0; i < results.length; i += batchSize) {
                const batch = results.slice(i, i + batchSize);
                
                // Use transaction for batch processing
                await this.prismaClient.$transaction(
                    batch.map(record =>
                        this.prismaClient.analysisResult.upsert({
                            where: {
                                walletAddress_tokenAddress: {
                                    walletAddress: record.walletAddress,
                                    tokenAddress: record.tokenAddress,
                                },
                            },
                            create: record,
                            update: record,
                        })
                    )
                );
                
                totalProcessed += batch.length;
                this.logger.debug(`Processed batch ${Math.ceil((i + batchSize) / batchSize)} of ${Math.ceil(results.length / batchSize)} (${totalProcessed}/${results.length} records)`);
            }
            
            this.logger.info(`Successfully batch upserted ${totalProcessed} AnalysisResult records.`);
        } catch (error) {
            this.logger.error(`Error during batch upsert of AnalysisResult records:`, { error, totalProcessed });
            throw error;
        }
    }

    /**
     * Replaces all TokenLot records for a wallet with the provided set.
     * Intended for deterministic FIFO backfills and full recomputation runs.
     */
    async replaceTokenLotsForWallet(
        walletAddress: string,
        lots: TokenLotCreateData[],
    ): Promise<void> {
        await this.prismaClient.$transaction([
            this.prismaClient.tokenLot.deleteMany({ where: { walletAddress } }),
            ...(lots.length > 0 ? [this.prismaClient.tokenLot.createMany({ data: lots })] : []),
        ]);
    }

    async getTokenLots(walletAddress: string): Promise<Array<Prisma.TokenLotGetPayload<{}>>> {
        return this.prismaClient.tokenLot.findMany({ where: { walletAddress } });
    }

    /**
     * Get tokens that have been recently checked in DexScreener to avoid redundant API calls
     * @param tokenAddresses Array of token addresses to check
     * @param hoursAgo How many hours ago to consider "recent"
     * @returns Array of token addresses that were recently checked
     */
    async getRecentlyCheckedTokens(tokenAddresses: string[], hoursAgo: number): Promise<string[]> {
        if (tokenAddresses.length === 0) {
            return [];
        }

        const cutoffDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
        
        try {
            const recentTokens = await this.prismaClient.tokenInfo.findMany({
                where: {
                    tokenAddress: { in: tokenAddresses },
                    dexscreenerUpdatedAt: { gte: cutoffDate }
                },
                select: { tokenAddress: true }
            });

            return recentTokens.map(t => t.tokenAddress);
        } catch (error) {
            this.logger.error('Error fetching recently checked tokens:', { error });
            return []; // Fail gracefully, fetch all tokens if error
        }
    }

    /**
     * Get tokens that have recent trading activity to prioritize them for metadata fetching
     * @param tokenAddresses Array of token addresses to check
     * @returns Array of token addresses with recent activity (prioritized)
     */
    async getTokensWithRecentActivity(tokenAddresses: string[]): Promise<string[]> {
        if (tokenAddresses.length === 0) {
            return [];
        }

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        try {
            // Find tokens that have recent swap analysis input records (trading activity)
            const activeTokens = await this.prismaClient.swapAnalysisInput.findMany({
                where: {
                    mint: { in: tokenAddresses },
                    timestamp: { gte: Math.floor(sevenDaysAgo.getTime() / 1000) }
                },
                select: { mint: true },
                distinct: ['mint'],
                orderBy: { timestamp: 'desc' }
            });

            return activeTokens.map(t => t.mint);
        } catch (error) {
            this.logger.error('Error fetching tokens with recent activity:', { error });
            return []; // Fail gracefully, no prioritization if error
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
        this.logger.error(`CoreService: Error creating wallet note for ${walletAddress}: ${error.message}`);
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
        this.logger.error(`CoreService: Error fetching wallet notes for ${walletAddress} by user ${userId}: ${error.message}`);
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

        this.logger.error(`CoreService: Error deleting note ${noteId} by user ${userId}: ${error.message}`);
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

        this.logger.error(`CoreService: Error updating note ${noteId} by user ${userId}: ${error.message}`);
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
        return await this.prismaClient.wallet.findMany({
          where: { address: { contains: fragment } },
          take: 10,
          select: { address: true },
        });
      } catch (error) {
        this.logger.error('Error searching wallets by address fragment', { error, fragment });
        throw new InternalServerErrorException('Database search failed.');
      }
    }
    // --- End Wallet Search Method ---

    /**
     * Retrieves wallets for the Discover page using cached summary tables only.
     * Applies pagination and ordering to keep the query lightweight.
     */
    async getDiscoverWallets(params: {
        where: Prisma.WalletWhereInput;
        orderBy: Prisma.WalletOrderByWithRelationInput[];
        skip: number;
        take: number;
    }): Promise<{
        total: number;
        wallets: Array<Prisma.WalletGetPayload<{ include: { pnlSummary: { include: { advancedStats: true } }, behaviorProfile: true } }>>;
    }> {
        return this.executeWithRetry('getDiscoverWallets', async () => {
            const [total, wallets] = await this.prismaClient.$transaction([
                this.prismaClient.wallet.count({ where: params.where }),
                this.prismaClient.wallet.findMany({
                    where: params.where,
                    include: {
                        pnlSummary: { include: { advancedStats: true } },
                        behaviorProfile: true,
                    },
                    orderBy: params.orderBy,
                    skip: params.skip,
                    take: params.take,
                }),
            ]);

            return { total, wallets };
        });
    }

    /**
     * Get speedCategory, flowPattern, and PnL for aggregation statistics
     * Efficient query that only selects the fields needed for distribution calculation
     */
    async getDiscoverAggregationData(params: {
        where: Prisma.WalletWhereInput;
    }): Promise<Array<{ speedCategory: string | null; flowPattern: string | null; pnl: number | null }>> {
        return this.executeWithRetry('getDiscoverAggregationData', async () => {
            const wallets = await this.prismaClient.wallet.findMany({
                where: params.where,
                select: {
                    behaviorProfile: {
                        select: {
                            speedCategory: true,
                            flowPattern: true,
                        },
                    },
                    pnlSummary: {
                        select: {
                            netPnl: true,
                        },
                    },
                },
            });

            // Flatten the structure for easier processing
            return wallets.map(w => ({
                speedCategory: w.behaviorProfile?.speedCategory || null,
                flowPattern: w.behaviorProfile?.flowPattern || null,
                pnl: w.pnlSummary?.netPnl || null,
            }));
        });
    }

    // --- TokenInfo Methods ---
    async findManyTokenInfo(tokenAddresses: string[]): Promise<TokenInfo[]> {
        if (tokenAddresses.length === 0) return [];
        return this.prismaClient.tokenInfo.findMany({
            where: {
                tokenAddress: { in: tokenAddresses },
            },
        });
    }

    async upsertManyTokenInfo(data: Prisma.TokenInfoCreateInput[]): Promise<void> {
        if (data.length === 0) return;

        const MAX_RETRIES = 3;
        const BASE_DELAY_MS = 100;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Sort token addresses to ensure consistent lock acquisition order
                // This significantly reduces deadlock probability
                const sortedData = [...data].sort((a, b) =>
                    a.tokenAddress.localeCompare(b.tokenAddress)
                );

                const operations = sortedData.map(tokenData => {
                    return this.prismaClient.tokenInfo.upsert({
                        where: { tokenAddress: tokenData.tokenAddress },
                        update: { ...tokenData, updatedAt: new Date() },
                        create: tokenData,
                    });
                });

                // Execute all upsert operations in a transaction
                await this.prismaClient.$transaction(operations);

                if (attempt > 1) {
                    this.logger.info(`Successfully upserted ${data.length} token info records after ${attempt} attempts.`);
                } else {
                    this.logger.debug(`Successfully upserted ${data.length} token info records.`);
                }

                return; // Success - exit retry loop

            } catch (error) {
                // Check if this is a deadlock error (PostgreSQL code 40P01)
                const isDeadlock = (typeof error === 'object' && error !== null) && (
                    ('code' in error && (error.code === '40P01' || error.code === 'P2034')) ||
                    ('meta' in error && typeof error.meta === 'object' && error.meta !== null && 'code' in error.meta && error.meta.code === '40P01')
                );

                if (isDeadlock && attempt < MAX_RETRIES) {
                    // Exponential backoff with jitter to reduce retry collision
                    const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 50;
                    this.logger.warn(
                        `Deadlock detected in upsertManyTokenInfo (attempt ${attempt}/${MAX_RETRIES}), ` +
                        `retrying in ${delayMs.toFixed(0)}ms...`
                    );
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue; // Retry
                }

                // Non-deadlock error or max retries exceeded
                this.logger.error('Error in upsertManyTokenInfo transaction', { error });
                throw new InternalServerErrorException('Failed to save token information.');
            }
        }
    }

    async getUniqueTokenAddressesFromAnalysisResults(walletAddress: string): Promise<string[]> {
        const results = await this.prismaClient.analysisResult.findMany({
            where: { walletAddress },
            select: { tokenAddress: true },
            distinct: ['tokenAddress'],
        });
        return results.map(r => r.tokenAddress);
    }

    /**
     * Finds multiple TokenInfo records but only selects a partial set of fields.
     * This is optimized for the similarity lab's "skeleton" load.
     */
    async findManyTokenInfoPartial(tokenAddresses: string[]): Promise<Partial<TokenInfo>[]> {
        if (tokenAddresses.length === 0) {
            return [];
        }
        return this.prismaClient.tokenInfo.findMany({
            where: { tokenAddress: { in: tokenAddresses } },
            select: {
                tokenAddress: true,
                name: true,
                symbol: true,
                imageUrl: true,
                priceUsd: true,
            },
        });
    }

    /**
     * Batch save onchain metadata for tokens
     * Creates new tokens and updates existing ones in chunked transactions
     * to avoid excessive memory usage with large batches
     */
    async saveOnchainMetadataBatch(
        newTokens: Array<{
            tokenAddress: string;
            onchainName?: string;
            onchainSymbol?: string;
            onchainDescription?: string;
            onchainImageUrl?: string;
            onchainCreator?: string;
            onchainMetadataUri?: string;
        }>,
        existingTokenUpdates: Array<{
            tokenAddress: string;
            onchainName?: string;
            onchainSymbol?: string;
            onchainDescription?: string;
            onchainImageUrl?: string;
            onchainCreator?: string;
            onchainMetadataUri?: string;
        }>
    ): Promise<void> {
        // Bulk create new tokens (createMany is already optimized)
        if (newTokens.length > 0) {
            try {
                await this.prismaClient.tokenInfo.createMany({
                    data: newTokens.map(t => ({
                        ...t,
                        onchainBasicFetchedAt: new Date(),
                        metadataSource: 'onchain',
                    })),
                });
            } catch (error: any) {
                // If there are duplicate key errors, some tokens may already exist - that's OK
                // We only log if it's not a known duplicate error
                if (error?.code !== 'P2002') { // P2002 is unique constraint violation
                    throw error;
                }
            }
        }

        // Update existing tokens in chunks to avoid excessive memory usage
        // Process 100 updates per transaction to balance performance and memory
        const CHUNK_SIZE = 100;
        for (let i = 0; i < existingTokenUpdates.length; i += CHUNK_SIZE) {
            const chunk = existingTokenUpdates.slice(i, i + CHUNK_SIZE);
            const operations = chunk.map(t =>
                this.prismaClient.tokenInfo.update({
                    where: { tokenAddress: t.tokenAddress },
                    data: {
                        ...t,
                        onchainBasicFetchedAt: new Date(),
                    },
                })
            );

            await this.prismaClient.$transaction(operations);
        }
    }

    /**
     * Update social links for a single token
     */
    async updateTokenSocialLinks(
        tokenAddress: string,
        socialLinks: {
            twitter?: string;
            website?: string;
            telegram?: string;
            discord?: string;
            imageUrl?: string; // Image from metadata JSON (fallback when DAS doesn't provide it)
        }
    ): Promise<void> {
        await this.prismaClient.tokenInfo.update({
            where: { tokenAddress },
            data: {
                onchainTwitterUrl: socialLinks.twitter,
                onchainWebsiteUrl: socialLinks.website,
                onchainTelegramUrl: socialLinks.telegram,
                onchainDiscordUrl: socialLinks.discord,
                // Only update onchainImageUrl if we have one from metadata AND it's currently null
                ...(socialLinks.imageUrl ? { onchainImageUrl: socialLinks.imageUrl } : {}),
                onchainSocialsFetchedAt: new Date(),
            },
        });
    }

    /**
     * Update metadataSource to 'hybrid' for tokens with both onchain and dexscreener data
     * Uses individual updates to avoid deadlocks from concurrent batch operations
     */
    async updateMetadataSourceToHybrid(tokenAddresses: string[]): Promise<number> {
        if (tokenAddresses.length === 0) return 0;

        // Process in smaller batches with retry logic to avoid deadlocks
        let successCount = 0;
        const BATCH_SIZE = 10; // Small batches to reduce lock contention

        for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
            const batch = tokenAddresses.slice(i, i + BATCH_SIZE);

            try {
                const result = await this.prismaClient.tokenInfo.updateMany({
                    where: {
                        tokenAddress: { in: batch },
                        onchainBasicFetchedAt: { not: null },
                        dexscreenerUpdatedAt: { not: null },
                    },
                    data: {
                        metadataSource: 'hybrid',
                    },
                });

                successCount += result.count;
            } catch (error: any) {
                // Skip deadlock errors silently - this update is non-critical
                if (error.code === '40P01') {
                    logger.debug(`Skipping hybrid metadata update batch due to deadlock (${batch.length} tokens)`);
                } else {
                    logger.warn(`Error updating metadata source batch: ${getErrorMessage(error)}`);
                }
            }
        }

        return successCount;
    }

    // ========================
    // Token Account Watermarks (for incremental balance fetching)
    // ========================

    /**
     * Get the last processed slot for a wallet + filter combination.
     * Used for incremental balance fetching with changedSinceSlot.
     *
     * @param ownerPubkey Wallet address
     * @param filterKey Filter identifier (e.g., "program:spl-token", "mint:{address}")
     * @returns The last processed slot number, or null if no watermark exists
     */
    async getTokenAccountWatermark(ownerPubkey: string, filterKey: string): Promise<number | null> {
        try {
            const record = await this.prisma.tokenAccountWatermark.findUnique({
                where: {
                    ownerPubkey_filterKey: {
                        ownerPubkey,
                        filterKey
                    }
                },
                select: {
                    lastSlot: true
                }
            });
            return record?.lastSlot ?? null;
        } catch (error) {
            logger.warn(`Error fetching watermark for ${ownerPubkey}/${filterKey}: ${getErrorMessage(error)}`);
            return null; // Fail open - return null to trigger full fetch
        }
    }

    /**
     * Set/update the last processed slot for a wallet + filter combination.
     * Creates new watermark if doesn't exist, updates if exists.
     *
     * @param ownerPubkey Wallet address
     * @param filterKey Filter identifier (e.g., "program:spl-token", "mint:{address}")
     * @param lastSlot The slot number to store
     */
    async setTokenAccountWatermark(ownerPubkey: string, filterKey: string, lastSlot: number): Promise<void> {
        try {
            await this.prisma.tokenAccountWatermark.upsert({
                where: {
                    ownerPubkey_filterKey: {
                        ownerPubkey,
                        filterKey
                    }
                },
                create: {
                    ownerPubkey,
                    filterKey,
                    lastSlot
                },
                update: {
                    lastSlot
                }
            });
        } catch (error) {
            // Non-critical - log but don't throw
            logger.warn(`Error setting watermark for ${ownerPubkey}/${filterKey}: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Delete watermark for a specific wallet + filter.
     * Used for cleanup when wallet is deleted or cache invalidation.
     *
     * @param ownerPubkey Wallet address
     * @param filterKey Optional filter key - if not provided, deletes all watermarks for wallet
     */
    async deleteTokenAccountWatermark(ownerPubkey: string, filterKey?: string): Promise<void> {
        try {
            if (filterKey) {
                await this.prisma.tokenAccountWatermark.delete({
                    where: {
                        ownerPubkey_filterKey: {
                            ownerPubkey,
                            filterKey
                        }
                    }
                });
            } else {
                // Delete all watermarks for this wallet
                await this.prisma.tokenAccountWatermark.deleteMany({
                    where: {
                        ownerPubkey
                    }
                });
            }
        } catch (error) {
            // Ignore errors (might not exist)
            logger.debug(`Watermark deletion for ${ownerPubkey}/${filterKey || 'all'}: ${getErrorMessage(error)}`);
        }
    }
}
