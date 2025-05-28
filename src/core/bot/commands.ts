import { Telegraf, Context } from 'telegraf';
import { createLogger } from 'core/utils/logger';
import { WalletInfo, WalletCluster } from '@/types/wallet';
import { DEFAULT_RECENT_TRANSACTION_COUNT, CLUSTERING_CONFIG } from '../../config/constants';
import { DatabaseService, prisma as dbServicePrisma } from 'core/services/database-service';
import { SwapAnalysisInput, Prisma, User, ActivityLog } from '@prisma/client';
import { CorrelationAnalyzer } from '../analysis/correlation/analyzer';
import { calculatePnlForWallets } from 'core/utils/pnl_calculator';
import { TransactionData, CorrelatedPairData, GlobalTokenStats } from '../../types/correlation';
import { HeliusSyncService, SyncOptions } from '../services/helius-sync-service';
import pLimit from 'p-limit';
import { BehaviorService } from 'core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics } from '@/types/behavior';
import { AdvancedStatsAnalyzer } from 'core/analysis/stats/analyzer';
import { AdvancedTradeStats, OnChainAnalysisResult, SwapAnalysisSummary } from '@/types/helius-api';
import { PnlAnalysisService } from 'core/services/pnl-analysis-service';
import { ReportingService } from '../reporting/reportGenerator';
import { generatePnlOverviewHtmlTelegram, generateBehaviorSummaryHtmlTelegram, generateDetailedBehaviorHtmlTelegram, generateDetailedAdvancedStatsHtmlTelegram, generateCorrelationReportTelegram } from '../reporting/report_utils';
import { HeliusApiClient } from '../services/helius-api-client';

const logger = createLogger('WalletAnalysisCommands');
const BOT_SYSTEM_USER_DESCRIPTION = "SystemUser_TelegramBot"; // Define it here as it was originally

/**
 * @interface ProcessingStats
 * @description Contains statistics about the transaction processing.
 * @property {number} totalTransactions - Total number of transactions processed for the correlation analysis.
 * @property {number} timeRangeHours - The approximate time range in hours covered by the analyzed transactions (currently not fully implemented, defaults to 0).
 */
interface ProcessingStats {
  totalTransactions: number;
  overallFirstTimestamp?: number;
  overallLastTimestamp?: number;
}

/**
 * @class WalletAnalysisCommands
 * @description Handles the core logic for wallet analysis, including data fetching, processing,
 * correlation analysis, and report generation.
 */
export class WalletAnalysisCommands {
  private readonly heliusApiKey_string: string | undefined;
  private readonly databaseService: DatabaseService;
  private readonly heliusApiClient: HeliusApiClient | null;
  private readonly heliusSyncService: HeliusSyncService | undefined;
  private botSystemUserId: string | null = null;
  private isBotUserInitialized: boolean = false;
  private readonly behaviorService: BehaviorService;
  private readonly advancedStatsAnalyzer: AdvancedStatsAnalyzer;
  private readonly pnlAnalysisService: PnlAnalysisService;

  /**
   * @constructor
   * @param {string} [heliusApiKey_input] - Optional API key for the Helius service. If not provided,
   * functionality relying on Helius API calls will be limited or disabled.
   */
  constructor(heliusApiKey_input?: string) {
    this.heliusApiKey_string = heliusApiKey_input;
    this.databaseService = new DatabaseService();

    // Create HeliusApiClient instance (or null)
    if (this.heliusApiKey_string) {
      this.heliusApiClient = new HeliusApiClient({ 
          apiKey: this.heliusApiKey_string, 
          network: 'mainnet' 
      }, this.databaseService);
    } else {
      this.heliusApiClient = null;
    }

    // Initialize HeliusSyncService with the client instance
    if (this.heliusApiClient) {
      try {
        this.heliusSyncService = new HeliusSyncService(this.databaseService, this.heliusApiClient);
        logger.info('WalletAnalysisCommands initialized with HeliusSyncService.');
      } catch (error) {
        logger.error('Failed to initialize HeliusSyncService even with API client:', error);
        this.heliusSyncService = undefined;
      }
    } else {
      this.heliusSyncService = undefined;
      logger.warn('WalletAnalysisCommands initialized WITHOUT a Helius API client. HeliusSyncService is not available.');
    }
    
    // Initialize analyzers
    const behaviorConfig: BehaviorAnalysisConfig = {
      timeRange: undefined,
      excludedMints: [] // We'll use defaults from the service
    };
    this.behaviorService = new BehaviorService(this.databaseService, behaviorConfig);
    this.advancedStatsAnalyzer = new AdvancedStatsAnalyzer();
    this.pnlAnalysisService = new PnlAnalysisService(this.databaseService, this.heliusApiClient);
    
    // Initialize bot system user asynchronously
    this.initializeBotSystemUser().catch(err => {
        logger.error('Failed to initialize bot system user for activity logging:', err);
    });
  }

  private async initializeBotSystemUser(): Promise<void> {
    try {
        let botUser = await dbServicePrisma.user.findFirst({
            where: { description: BOT_SYSTEM_USER_DESCRIPTION }
        });

        if (!botUser) {
            logger.info('Bot system user (\'' + BOT_SYSTEM_USER_DESCRIPTION + '\') not found, creating one...');
            const creationResult = await this.databaseService.createUser(BOT_SYSTEM_USER_DESCRIPTION);
            if (creationResult) {
                botUser = creationResult.user;
                logger.info('Bot system user created with ID: ' + botUser.id);
            } else {
                logger.error('Failed to create bot system user.');
                return; // Exit if creation fails
            }
        } else {
            logger.info('Found existing bot system user with ID: ' + botUser.id);
        }
        this.botSystemUserId = botUser.id;
        this.isBotUserInitialized = true;
    } catch (error) {
        logger.error('Error initializing bot system user:', error);
        this.isBotUserInitialized = false; // Ensure flag is set correctly on error
    }
  }

  /**
   * Orchestrates the analysis of a list of wallet addresses.
   * Fetches transaction data, performs correlation analysis, and sends a report to the user via Telegram.
   * @param {Context} ctx - The Telegraf context object for interacting with the Telegram API.
   * @param {string[]} walletAddressesInput - An array of wallet addresses to analyze.
   * @param {number} [userRequestedTxCount] - Optional number of recent transactions to consider for each wallet's analysis.
   *                                          Defaults to `DEFAULT_RECENT_TRANSACTION_COUNT`.
   * @returns {Promise<void>} A promise that resolves when the analysis is complete and a report has been sent.
   */
  async analyzeWallets(ctx: Context, walletAddressesInput: string[], userRequestedTxCount?: number) {
    const startTime = Date.now();
    let activityLogId: string | null = null; // To store the ID of the 'INITIATED' log
    let analysisStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS'; // Assume success initially
    let errorMessage: string | undefined = undefined;
    let walletsPostBotFilter: WalletInfo[] = []; // Initialize here

    const uniqueWalletAddresses = Array.from(new Set(walletAddressesInput.map(addr => addr.trim())));

    if (this.isBotUserInitialized && this.botSystemUserId) {
        try {
            const logData = {
                telegramUserId: ctx.from?.id,
                telegramChatId: ctx.chat?.id,
                walletAddresses: uniqueWalletAddresses,
                requestedTxCount: userRequestedTxCount,
                commandArgs: ctx.message && 'text' in ctx.message ? ctx.message.text : 'N/A'
            };
            const initialLog = await this.databaseService.logActivity(
                this.botSystemUserId,
                'telegram_command_analyze_wallets',
                logData,
                'INITIATED'
            );
            if (initialLog) {
                activityLogId = initialLog.id; // Assuming logActivity returns the created log with its ID
            }
        } catch (logError) {
            logger.error('Failed to create initial activity log for analyzeWallets:', logError);
        }
    }

    try {
      await ctx.reply('🔄 Initializing analysis... This may take a few moments.');
      
      // Deduplicate wallet addresses
      const uniqueWalletAddresses = Array.from(new Set(walletAddressesInput.map(addr => addr.trim())));
      
      if (uniqueWalletAddresses.length < walletAddressesInput.length) {
        await ctx.reply(`ℹ️ Duplicate wallet addresses were provided. Processing ${uniqueWalletAddresses.length} unique addresses.`);
      }
      
      const initialWallets: WalletInfo[] = uniqueWalletAddresses.map(addr => ({ address: addr }));
      
      const allSwapInputsByWallet: Record<string, SwapAnalysisInput[]> = {};
      const transactionsForBotFilterPass: Record<string, TransactionData[]> = {};
      const failedWallets: string[] = []; // Stores addresses of wallets that failed anywhere in the process
      const successfullyProcessedWalletsInfo: WalletInfo[] = []; // Stores WalletInfo for successfully processed wallets for correlation

      const targetTxCountInDb = userRequestedTxCount !== undefined && userRequestedTxCount > 0 
                                ? userRequestedTxCount 
                                : DEFAULT_RECENT_TRANSACTION_COUNT;

      // Type for the outcome of each sync attempt
      type SyncAttemptOutcome = 
        | { status: 'fulfilled'; walletInfo: WalletInfo }
        | { status: 'rejected'; walletAddress: string; reason: string };

      // ---- Start: Parallel Helius Sync with Concurrency Limiting ----
      const CONCURRENCY_LIMIT = 3; // Define concurrency limit (e.g., 5-10, needs tuning)
      const limit = pLimit(CONCURRENCY_LIMIT);
      let syncOperationsCompleted = 0;
      let lastReportedProgress = 0;

      const syncPromises = initialWallets.map((walletInfo) => 
        limit(async (): Promise<SyncAttemptOutcome> => {
          const walletAddress = walletInfo.address;
          try {
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
              throw new Error(`Invalid Solana address format`);
            }
            if (!this.heliusApiClient || !this.heliusSyncService) {
              throw new Error('Helius API client not configured or HeliusSyncService not initialized.');
            }
            
            // logger.info(`Initiating sync for wallet: ${walletAddress}.`); // Logged by syncWalletData or too verbose here
            const walletState = await this.databaseService.getWallet(walletAddress);
            const isInitialFetch = !walletState || !walletState.lastSuccessfulFetchTimestamp;
            const maxSignaturesToConsiderForSync = Math.max(targetTxCountInDb * 1.5, 500);

            const syncOptions: SyncOptions = {
              limit: 100, 
              fetchAll: false, 
              skipApi: false, 
              fetchOlder: false, 
              maxSignatures: maxSignaturesToConsiderForSync,
              smartFetch: true 
            };
            await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
            // logger.info(`Sync completed successfully for wallet: ${walletAddress}.`); // Also potentially too verbose for many wallets
            return { status: 'fulfilled', walletInfo };
          } catch (error: any) {
            logger.error(`Failed to sync wallet ${walletAddress}: ${error.message}`, { stack: error.stack });
            return { status: 'rejected', walletAddress, reason: error.message };
          } finally {
            syncOperationsCompleted++;
            // Basic progress reporting
            const currentProgress = Math.floor((syncOperationsCompleted / initialWallets.length) * 100);
            if (currentProgress >= lastReportedProgress + 10 || currentProgress === 100) { // Report every 10% or at 100%
                if (ctx.chat?.id) { // Ensure chat context is available for editing messages or sending new ones
                    // Consider editing the initial message or sending a new one for progress
                    // For simplicity now, just logging. A real bot might ctx.telegram.editMessageText(...)
                    logger.info(`Sync progress: ${currentProgress}% (${syncOperationsCompleted}/${initialWallets.length})`);
                }
                lastReportedProgress = currentProgress;
            }
          }
        })
      );

      await ctx.reply(`⏳ Synchronizing data for ${initialWallets.length} wallets (up to ${CONCURRENCY_LIMIT} in parallel)...`);
      const syncResults = await Promise.allSettled(syncPromises);
      await ctx.reply('✅ Sync phase complete. Processing results...');
      
      // Process sync results
      for (const result of syncResults) {
        if (result.status === 'fulfilled') {
          const syncOutcome = result.value;
          if (syncOutcome.status === 'fulfilled') {
            // Successfully synced, now fetch and prepare data for this wallet
            const walletInfo = syncOutcome.walletInfo;
            const walletAddress = walletInfo.address;
            try {
              let allSwapInputsForWallet: SwapAnalysisInput[] = await this.databaseService.getSwapAnalysisInputs(walletAddress);
              allSwapInputsForWallet.sort((a, b) => b.timestamp - a.timestamp);
              const slicedInputs = allSwapInputsForWallet.slice(0, targetTxCountInDb);
              const finalInputsForAnalysis = slicedInputs.sort((a, b) => a.timestamp - b.timestamp);
              
              logger.info(`Retrieved and prepared ${finalInputsForAnalysis.length} SwapAnalysisInput records for ${walletAddress}.`);
              allSwapInputsByWallet[walletAddress] = finalInputsForAnalysis;
              transactionsForBotFilterPass[walletAddress] = finalInputsForAnalysis.map(input => ({
                mint: input.mint,
                timestamp: input.timestamp,
                direction: input.direction as 'in' | 'out',
                amount: input.amount,
                associatedSolValue: input.associatedSolValue || 0,
              }));
              successfullyProcessedWalletsInfo.push(walletInfo); // Add to list for bot filtering

              if (finalInputsForAnalysis.length === 0 && targetTxCountInDb > 0) {
                logger.warn(`No relevant transactions available for ${walletAddress} after full data pipeline.`);
              }
            } catch (dbError: any) {
              logger.error(`Failed to fetch/process DB data for ${walletAddress} after sync: ${dbError.message}`);
              failedWallets.push(`${walletAddress} (DB Error: ${dbError.message})`);
            }
          } else { // Sync failed for this wallet (syncOutcome.status === 'rejected')
            failedWallets.push(`${syncOutcome.walletAddress} (Sync Error: ${syncOutcome.reason})`);
          }
        } else { // Promise from .map() itself rejected (less likely if inner try/catch is robust)
          logger.error('A sync promise itself rejected unexpectedly:', result.reason);
          // Attempt to log a generic failure if address isn't easily available
          failedWallets.push(`Unknown Wallet (Unexpected Sync Promise Rejection: ${result.reason?.message || result.reason})`);
        }
      }
      // ---- End: Parallel Helius Sync & Sequential Post-Sync DB Fetch ----
      
      if (failedWallets.length > 0) {
        await ctx.replyWithHTML(`⚠️ Encountered issues processing some wallets:<br>${failedWallets.join('<br>')}`);
      }
      
      // Check if enough wallets remain for correlation after all processing attempts
      if (successfullyProcessedWalletsInfo.length < 2 && initialWallets.length >=2) {
        await ctx.reply("ℹ️ Not enough wallets successfully processed to perform correlation analysis (need at least 2).");
        return;
      }
       if (successfullyProcessedWalletsInfo.length === 0 && initialWallets.length > 0) {
        await ctx.reply("ℹ️ No wallets could be processed. Analysis halted.");
        return;
      }
       if (initialWallets.length < 2 && successfullyProcessedWalletsInfo.length < 2) { // Adjusted condition
         await ctx.reply("ℹ️ Please provide at least two wallets and ensure they can be processed for correlation analysis.");
         analysisStatus = 'FAILURE'; // Update status
         errorMessage = "Not enough wallets provided or processable for correlation.";
         return; // Exit early
       }

      // Perform bot filtering using the successfullyProcessedWalletsInfo and transactionsForBotFilterPass
      const botFilterResult = this.filterOutBotWallets(
        successfullyProcessedWalletsInfo, 
        transactionsForBotFilterPass, 
        CLUSTERING_CONFIG.MAX_DAILY_TOKENS_FOR_FILTER
      );
      walletsPostBotFilter = botFilterResult.walletsForAnalysis; // Assign here
      const numFilteredOutByBotLogic = successfullyProcessedWalletsInfo.length - walletsPostBotFilter.length;

      // Now, prepare allFetchedCorrelatorTransactions for the wallets that passed bot filtering,
      // applying the excludedMints filter at this stage.
      const allFetchedCorrelatorTransactions: Record<string, TransactionData[]> = {};
      let overallMinTimestamp: number | undefined = undefined;
      let overallMaxTimestamp: number | undefined = undefined;

      for (const walletInfo of walletsPostBotFilter) {
          const walletAddress = walletInfo.address;
          // Use the already fetched and sliced SwapAnalysisInput data for this wallet
          const originalSwapInputsForThisWallet = allSwapInputsByWallet[walletAddress] || []; 
          
          const correlatorTxsForWallet = originalSwapInputsForThisWallet
              .filter(input => !CLUSTERING_CONFIG.excludedMints.includes(input.mint)) // Apply mint exclusion here
              .map(input => {
                  const txData: TransactionData = { // Explicitly type for clarity
                      mint: input.mint,
                      timestamp: input.timestamp,
                      direction: input.direction as 'in' | 'out',
                      amount: input.amount,
                      associatedSolValue: input.associatedSolValue || 0,
                  };
                  // Update overall min/max timestamps
                  if (txData.timestamp) {
                      if (overallMinTimestamp === undefined || txData.timestamp < overallMinTimestamp) {
                          overallMinTimestamp = txData.timestamp;
                      }
                      if (overallMaxTimestamp === undefined || txData.timestamp > overallMaxTimestamp) {
                          overallMaxTimestamp = txData.timestamp;
                      }
                  }
                  return txData;
              });
          allFetchedCorrelatorTransactions[walletAddress] = correlatorTxsForWallet;
          
          logger.debug(`Prepared ${correlatorTxsForWallet.length} CorrelatorTransactionData records for ${walletAddress} (post-bot-filter and mint-exclusion).`);
          if (correlatorTxsForWallet.length === 0 && originalSwapInputsForThisWallet.length > 0) {
             logger.warn(`No relevant (post-mint-filter) transactions for ${walletAddress} although it passed bot filter and had initial data.`);
          }
      }

      if (numFilteredOutByBotLogic > 0) {
        await ctx.reply(`ℹ️ Filtered out ${numFilteredOutByBotLogic} wallets suspected of bot activity. Analyzing ${walletsPostBotFilter.length} wallets.`);
      }

      if (walletsPostBotFilter.length < 2) {
        await ctx.reply("ℹ️ Not enough wallets remaining after bot-activity filtering to perform correlation analysis (need at least 2). Analysis halted.");
        analysisStatus = 'FAILURE'; // Update status
        errorMessage = "Not enough wallets remaining after bot-activity filtering.";
        return; // Exit early
      }
      
      // Calculate PNL using the utility function
      const walletPnLs = calculatePnlForWallets(allFetchedCorrelatorTransactions);

      // --- Start: New Analysis Logic using CorrelationAnalyzer ---
      const analyzer = new CorrelationAnalyzer(CLUSTERING_CONFIG);

      const transactionsForCorrelation: Record<string, TransactionData[]> = {};
      walletsPostBotFilter.forEach(w => {
        transactionsForCorrelation[w.address] = allFetchedCorrelatorTransactions[w.address] || [];
      });

      // 1. Get Global Token Stats
      const globalTokenStatsFromAnalyzer: GlobalTokenStats = analyzer.getGlobalTokenStats(transactionsForCorrelation);
      const globalTokenStats: GlobalTokenStats = globalTokenStatsFromAnalyzer;

      // 2. Analyze Correlations for pairs
      const correlatedPairsRaw: CorrelatedPairData[] = await analyzer.analyzeCorrelations(
          transactionsForCorrelation,
          walletsPostBotFilter
      );

      // 3. Identify Clusters
      const clusters: WalletCluster[] = await analyzer.identifyClusters(correlatedPairsRaw);

      // 4. Filter for Top Correlated Pairs (logic preserved)
      const walletsInAnyCluster = new Set<string>();
      clusters.forEach(cluster => {
        cluster.wallets.forEach(wallet => walletsInAnyCluster.add(wallet));
      });

      const filteredCorrelatedPairs = correlatedPairsRaw.filter(pair => {
        const walletA_inCluster = walletsInAnyCluster.has(pair.walletA_address);
        const walletB_inCluster = walletsInAnyCluster.has(pair.walletB_address);
        return !(walletA_inCluster && walletB_inCluster);
      });
      const topCorrelatedPairs = filteredCorrelatedPairs.slice(0, CLUSTERING_CONFIG.topKCorrelatedPairsToReport);
      // --- End: New Analysis Logic using CorrelationAnalyzer ---
      
      let totalRelevantCorrelatorTransactions = 0;
      walletsPostBotFilter.forEach(w => {
        totalRelevantCorrelatorTransactions += (allFetchedCorrelatorTransactions[w.address] || []).length;
      });
      
      const processingStats: ProcessingStats = {
        totalTransactions: totalRelevantCorrelatorTransactions,
        overallFirstTimestamp: overallMinTimestamp,
        overallLastTimestamp: overallMaxTimestamp,
      };

      const uniqueTokenCountsPerWallet: Record<string, number> = {};
      Object.entries(allFetchedCorrelatorTransactions).forEach(([walletAddr, txs]) => {
          const uniqueMints = new Set(txs.map(tx => tx.mint));
          uniqueTokenCountsPerWallet[walletAddr] = uniqueMints.size;
      });

      const reportMessages: string[] = generateCorrelationReportTelegram(
        initialWallets.length, 
        walletsPostBotFilter.length, 
        numFilteredOutByBotLogic, 
        walletPnLs,
        globalTokenStats,
        clusters,
        topCorrelatedPairs,
        processingStats,
        uniqueTokenCountsPerWallet
      );

      for (const messagePart of reportMessages) {
        if (messagePart.trim().length > 0) {
            try {
                await ctx.replyWithHTML(messagePart);
            } catch (error: any) {
                logger.error('Error sending a part of Telegram report:', { message: error.message, description: error.description, partLength: messagePart.length });
                await ctx.reply(`Failed to send a part of the report. Error: ${error.description || error.message}`);
            }
        }
      }
      logger.info(`Successfully sent wallet analysis report in ${reportMessages.length} part(s).`);

    } catch (error) {
      const err = error as Error;
      logger.error('Error in analyzeWallets (top level):', err);
      await ctx.reply(`❌ Top-level error analyzing wallets: ${err.message}`);
      analysisStatus = 'FAILURE'; // Update status on error
      errorMessage = err.message; // Capture error message
    } finally {
        if (this.isBotUserInitialized && this.botSystemUserId) {
            const durationMs = Date.now() - startTime;
            try {
                const finalLogData = {
                    telegramUserId: ctx.from?.id,
                    telegramChatId: ctx.chat?.id,
                    walletAddresses: uniqueWalletAddresses,
                    requestedTxCount: userRequestedTxCount,
                    initialLogId: activityLogId, // Optionally link to the initial log
                    finalAnalyzedCount: walletsPostBotFilter.length // Now safely accessed
                };
                await this.databaseService.logActivity(
                    this.botSystemUserId,
                    'telegram_command_analyze_wallets_completed',
                    finalLogData,
                    analysisStatus,
                    durationMs,
                    errorMessage
                );
            } catch (logError) {
                logger.error('Failed to create final activity log for analyzeWallets:', logError);
            }
        }
    }
  }

  /**
   * Filters out wallets suspected of bot activity based on the number of unique tokens purchased daily.
   * @param {WalletInfo[]} initialWallets - The initial list of wallets to filter.
   * @param {Record<string, TransactionData[]>} allTransactions - A record mapping wallet addresses to their transactions.
   *                                                                       These transactions are used *before* mint exclusion for bot filtering.
   * @param {number} maxDailyPurchasedTokens - The maximum number of unique tokens a wallet can purchase in a single day
   *                                           before being flagged as a potential bot.
   * @returns {{ walletsForAnalysis: WalletInfo[], dailyTokenCountsByWallet: Record<string, Record<string, Set<string>>> }}
   *            An object containing the list of wallets that passed the filter and a record of daily token purchase counts.
   */
  private filterOutBotWallets(
    initialWallets: WalletInfo[],
    allTransactions: Record<string, TransactionData[]>,
    maxDailyPurchasedTokens: number
  ): { walletsForAnalysis: WalletInfo[], dailyTokenCountsByWallet: Record<string, Record<string, Set<string>>> } {
    const dailyPurchasedTokenCountsByWallet: Record<string, Record<string, Set<string>>> = {};

    for (const walletInfo of initialWallets) {
        const walletAddress = walletInfo.address;
        const transactions = allTransactions[walletAddress];
        if (!transactions || transactions.length === 0) continue;

        dailyPurchasedTokenCountsByWallet[walletAddress] = dailyPurchasedTokenCountsByWallet[walletAddress] || {};

        transactions.forEach(txn => {
            if (txn.direction === 'in' && txn.associatedSolValue && txn.associatedSolValue > 0) {
                const day = new Date(txn.timestamp * 1000).toISOString().split('T')[0];
                dailyPurchasedTokenCountsByWallet[walletAddress][day] = dailyPurchasedTokenCountsByWallet[walletAddress][day] || new Set<string>();
                dailyPurchasedTokenCountsByWallet[walletAddress][day].add(txn.mint);
            }
        });
    }

    const walletsForAnalysis = initialWallets.filter(wallet => {
        const walletDailyActivity = dailyPurchasedTokenCountsByWallet[wallet.address];
        if (!walletDailyActivity || Object.keys(walletDailyActivity).length === 0) {
            return true;
        }

        const exceedsThreshold = Object.values(walletDailyActivity).some(
            tokenSetOnDay => tokenSetOnDay.size > maxDailyPurchasedTokens
        );

        if (exceedsThreshold) {
            logger.debug(`Filtering out wallet ${wallet.address} due to exceeding ${maxDailyPurchasedTokens} unique *purchased* tokens on at least one day.`);
            return false;
        }
        return true;
    });
    return { walletsForAnalysis, dailyTokenCountsByWallet: dailyPurchasedTokenCountsByWallet };
  }

  /**
   * Analyzes the behavioral patterns of a single wallet.
   * @param ctx - The Telegraf context
   * @param walletAddress - The wallet address to analyze
   * @param transactionCount - Optional number of transactions to consider
   */
  async analyzeWalletBehavior(ctx: Context, walletAddresses: string[], transactionCount?: number) {
    // Outer try-catch for each wallet address iteration to handle errors per wallet
    for (const walletAddress of walletAddresses) {
        const startTime = Date.now(); // Specific to this wallet's processing
        let analysisStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
        let errorMessage: string | undefined = undefined;
        // Note: Activity logging for individual wallets within a multi-wallet command might need a different strategy
        // For simplicity, we'll assume logging is handled per individual call or not at all for this example modification.

        try {
            // Main logic for a single wallet
            try {
                await ctx.reply(`🔄 Analyzing wallet behavior for ${walletAddress}... This may take a moment.`);

                // Sync wallet data first
                if (this.heliusSyncService) {
                    const syncOptions: SyncOptions = {
                        limit: 100,
                        fetchAll: false,
                        skipApi: false,
                        fetchOlder: false,
                        maxSignatures: Math.max((transactionCount || DEFAULT_RECENT_TRANSACTION_COUNT) * 1.5, 500),
                        smartFetch: true
                    };
                    await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
                } else {
                    logger.warn(`[analyzeWalletBehavior] HeliusSyncService not available for ${walletAddress}, skipping sync. API client might be missing or service failed to init.`);
                    // Optionally inform the user if sync is critical for this command
                    // await ctx.reply(`️ Sync service is not available. Analysis may be based on stale data for ${walletAddress}.`);
                }

                const metrics = await this.behaviorService.analyzeWalletBehavior(walletAddress);
                
                if (!metrics) {
                    errorMessage = `No sufficient data found for behavioral analysis for ${walletAddress}.`;
                    analysisStatus = 'FAILURE';
                    await ctx.reply(`⚠️ ${errorMessage}`);
                    // continue; // This would be part of the original loop logic, handled by the outer try/catch now
                } else {
                    const report = generateDetailedBehaviorHtmlTelegram(walletAddress, metrics);
                    await ctx.replyWithHTML(report);
                }

            } catch (error) { // Inner catch for main logic
                const err = error as Error;
                logger.error(`Error in analyzeWalletBehavior for ${walletAddress}:`, err);
                analysisStatus = 'FAILURE';
                errorMessage = err.message;
                // No separate reply here, let outer catch handle it for consistency
                // throw err; // Re-throw to be caught by the outer per-wallet catch
            }
        } catch (e: any) { // Outer catch for this specific wallet_address processing
            logger.error(`CRITICAL: Top-level command handler error in analyzeWalletBehavior for ${walletAddress}:`, e);
            analysisStatus = 'FAILURE';
            errorMessage = (e instanceof Error) ? e.message : 'Unknown critical error';

            if (e.name === 'TimeoutError') {
                errorMessage = 'Behavior analysis timed out for ' + walletAddress + '. ' + errorMessage;
                await ctx.reply(`🚨 Apologies, behavior analysis for ${walletAddress} took too long and was stopped.`);
            } else {
                await ctx.reply(`🚨 An unexpected error occurred during behavior analysis for ${walletAddress}.`);
            }
        } finally {
            // Example: Log completion for this specific wallet if needed
            // This is where you'd put the per-wallet activity log update if you had one here.
            logger.info(`Processing for analyzeWalletBehavior on ${walletAddress} completed with status: ${analysisStatus}. Duration: ${Date.now() - startTime}ms. Error: ${errorMessage || 'None'}`);
        }
    } // End loop over walletAddresses
  }

  /**
   * Analyzes advanced trading statistics for a single wallet.
   * @param ctx - The Telegraf context
   * @param walletAddress - The wallet address to analyze
   * @param transactionCount - Optional number of transactions to consider
   */
  async analyzeAdvancedStats(ctx: Context, walletAddresses: string[], transactionCount?: number) {
    for (const walletAddress of walletAddresses) {
        const startTime = Date.now();
        let analysisStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
        let errorMessage: string | undefined = undefined;

        try { // Outer try for this wallet_address
            try { // Inner try for main logic
                await ctx.reply(`🔄 Analyzing advanced trading statistics for ${walletAddress}... This may take a moment.`);

                if (this.heliusSyncService) {
                    const syncOptions: SyncOptions = {
                        limit: 100,
                        fetchAll: false,
                        skipApi: false,
                        fetchOlder: false,
                        maxSignatures: Math.max((transactionCount || DEFAULT_RECENT_TRANSACTION_COUNT) * 1.5, 500),
                        smartFetch: true
                    };
                    await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
                } else {
                    logger.warn(`[analyzeAdvancedStats] HeliusSyncService not available for ${walletAddress}, skipping sync. API client might be missing or service failed to init.`);
                    // Optionally inform the user
                    // await ctx.reply(`️ Sync service is not available. Analysis may be based on stale data for ${walletAddress}.`);
                }

                const swapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress);
                
                if (!swapRecords || swapRecords.length === 0) {
                    errorMessage = `No sufficient data found for advanced analysis for ${walletAddress}.`;
                    analysisStatus = 'FAILURE';
                    await ctx.reply(`⚠️ ${errorMessage}`);
                    // continue; // Original loop logic, now handled by outer try/catch structure
                } else {
                    const results: OnChainAnalysisResult[] = swapRecords.map(record => ({
                        tokenAddress: record.mint,
                        mint: record.mint,
                        firstTransferTimestamp: record.timestamp,
                        lastTransferTimestamp: record.timestamp,
                        netSolProfitLoss: record.associatedSolValue || 0,
                        totalAmountIn: record.direction === 'in' ? record.amount : 0,
                        totalAmountOut: record.direction === 'out' ? record.amount : 0,
                        netAmountChange: record.direction === 'in' ? record.amount : -record.amount,
                        totalSolSpent: record.direction === 'out' ? record.associatedSolValue || 0 : 0,
                        totalSolReceived: record.direction === 'in' ? record.associatedSolValue || 0 : 0,
                        transferCountIn: record.direction === 'in' ? 1 : 0,
                        transferCountOut: record.direction === 'out' ? 1 : 0
                    }));

                    const stats = this.advancedStatsAnalyzer.analyze(results);
                    
                    if (!stats) {
                        errorMessage = `Could not calculate advanced statistics for ${walletAddress}.`;
                        analysisStatus = 'FAILURE';
                        await ctx.reply(`⚠️ ${errorMessage}`);
                    } else {
                        const report = generateDetailedAdvancedStatsHtmlTelegram(walletAddress, stats);
                        await ctx.replyWithHTML(report);
                    }
                }
            } catch (error) { // Inner catch
                const err = error as Error;
                logger.error(`Error in analyzeAdvancedStats for ${walletAddress}:`, err);
                analysisStatus = 'FAILURE';
                errorMessage = err.message;
                // throw err; // Re-throw to be caught by outer
            }
        } catch (e: any) { // Outer catch for this wallet_address
            logger.error(`CRITICAL: Top-level command handler error in analyzeAdvancedStats for ${walletAddress}:`, e);
            analysisStatus = 'FAILURE';
            errorMessage = (e instanceof Error) ? e.message : 'Unknown critical error';

            if (e.name === 'TimeoutError') {
                errorMessage = 'Advanced stats analysis timed out for ' + walletAddress + '. ' + errorMessage;
                await ctx.reply(`🚨 Apologies, advanced stats analysis for ${walletAddress} took too long and was stopped.`);
            } else {
                await ctx.reply(`🚨 An unexpected error occurred during advanced stats analysis for ${walletAddress}.`);
            }
        } finally {
            logger.info(`Processing for analyzeAdvancedStats on ${walletAddress} completed with status: ${analysisStatus}. Duration: ${Date.now() - startTime}ms. Error: ${errorMessage || 'None'}`);
        }
    } // End loop
  }

  // --- NEW COMMAND HANDLERS FOR CONCISE SUMMARIES ---

  async getPnlOverview(ctx: Context, walletAddresses: string[]) {
    for (const walletAddress of walletAddresses) {
      const startTime = Date.now();
      let activityLogId: string | null = null;
      let analysisStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
      let errorMessage: string | undefined = undefined;

      try { // Outer try for this wallet_address
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
          await ctx.reply(`❌ Invalid Solana wallet address format: ${walletAddress}`);
          // This is a validation error, not a timeout. We might want to log it differently or just skip.
          // For now, let it be caught by the generic outer catch, or add specific handling.
          // To keep it simple, we'll let the outer catch handle it for now, though it won't be a 'TimeoutError'.
          throw new Error('Invalid Solana wallet address format');
        }

        if (this.isBotUserInitialized && this.botSystemUserId) {
          try {
            const logData = {
              telegramUserId: ctx.from?.id,
              telegramChatId: ctx.chat?.id,
              walletAddress: walletAddress,
              commandArgs: ctx.message && 'text' in ctx.message ? ctx.message.text : 'N/A'
            };
            const initialLog = await this.databaseService.logActivity(
              this.botSystemUserId,
              'telegram_command_pnl_overview',
              logData,
              'INITIATED'
            );
            if (initialLog) activityLogId = initialLog.id;
          } catch (logError) {
            logger.error('Failed to create initial activity log for getPnlOverview:', logError);
            // Non-fatal, continue with the main operation
          }
        }

        try { // Inner try for main PNL logic
          await ctx.reply(`🔍 Fetching PNL overview for ${walletAddress}...`);
          
          const pnlData = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);

          if (!pnlData || pnlData.analysisSkipped) {
            errorMessage = `Could not retrieve PNL data for ${walletAddress}. Analysis might have been skipped or no data found.`;
            analysisStatus = 'FAILURE';
            await ctx.reply(`⚠️ ${errorMessage}`);
          } else {
            const summaryForReport: SwapAnalysisSummary = pnlData;
            const report = generatePnlOverviewHtmlTelegram(walletAddress, summaryForReport);
            await ctx.replyWithHTML(report);
          }
        } catch (error: any) { // Inner catch for PNL logic error
          logger.error(`Error in PNL logic for ${walletAddress}:`, error);
          analysisStatus = 'FAILURE';
          errorMessage = error.message || 'An unexpected error occurred in PNL logic.';
          // Let outer catch handle user reply for consistency if it's a more general failure
          // No specific reply here to avoid double-messaging if it's a timeout.
        }
      } catch (e: any) { // Outer catch for this wallet_address (includes validation, timeout, etc.)
        logger.error(`CRITICAL: Top-level command handler error in getPnlOverview for ${walletAddress}:`, e);
        analysisStatus = 'FAILURE'; // Ensure status is failure
        errorMessage = (e instanceof Error) ? e.message : 'Unknown critical error'; // Ensure errorMessage is set

        if (e.name === 'TimeoutError') {
          errorMessage = 'PNL overview timed out for ' + walletAddress + '. ' + errorMessage;
          await ctx.reply(`🚨 Apologies, PNL overview for ${walletAddress} took too long and was stopped.`);
        } else if (errorMessage === 'Invalid Solana wallet address format') {
           // Already handled by initial reply, or if we removed that, reply here.
           // Assuming the initial reply is fine, or if we want to consolidate:
           // await ctx.reply(`❌ Invalid Solana wallet address format: ${walletAddress}`);
           // No further generic message needed if specific error handled.
        } else {
          await ctx.reply(`🚨 An unexpected error occurred while fetching PNL overview for ${walletAddress}.`);
        }
      } finally {
        if (activityLogId && this.isBotUserInitialized && this.botSystemUserId) { // Check isBotUserInitialized too
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(
            this.botSystemUserId!,
            'telegram_command_pnl_overview_completed', // Changed event name for final log
            { originalLogId: activityLogId, processingTimeMs: durationMs, walletAddress: walletAddress },
            analysisStatus,
            durationMs,
            analysisStatus === 'FAILURE' ? errorMessage : undefined
          );
        } else {
          logger.info(`Processing for getPnlOverview on ${walletAddress} completed (no activityLogId or bot user not init). Status: ${analysisStatus}. Duration: ${Date.now() - startTime}ms. Error: ${errorMessage || 'None'}`);
        }
      }
    } // End loop over walletAddresses
  }

  async getBehaviorSummary(ctx: Context, walletAddresses: string[]) {
    for (const walletAddress of walletAddresses) {
      const startTime = Date.now();
      let activityLogId: string | null = null;
      let analysisStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
      let errorMessage: string | undefined = undefined;
      
      try { // Outer try for this wallet_address
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
          // Let outer catch handle this specific error message if desired, or reply & throw here
          throw new Error('Invalid Solana wallet address format');
        }

        if (this.isBotUserInitialized && this.botSystemUserId) {
          try {
            const logData = {
              telegramUserId: ctx.from?.id,
              telegramChatId: ctx.chat?.id,
              walletAddress: walletAddress,
              commandArgs: ctx.message && 'text' in ctx.message ? ctx.message.text : 'N/A'
            };
            const initialLog = await this.databaseService.logActivity(
              this.botSystemUserId,
              'telegram_command_behavior_summary',
              logData,
              'INITIATED'
            );
            if (initialLog) activityLogId = initialLog.id;
          } catch (logError) {
            logger.error('Failed to create initial activity log for getBehaviorSummary:', logError);
          }
        }

        try { // Inner try for main behavior summary logic
          await ctx.reply(`🧠 Fetching behavior summary for ${walletAddress}...`);
          
          const behaviorMetrics = await this.behaviorService.analyzeWalletBehavior(walletAddress);

          if (!behaviorMetrics) {
            errorMessage = `Could not retrieve behavior metrics for ${walletAddress}.`;
            analysisStatus = 'FAILURE';
            await ctx.reply(`⚠️ ${errorMessage}`);
          } else {
            const report = generateBehaviorSummaryHtmlTelegram(walletAddress, behaviorMetrics);
            await ctx.replyWithHTML(report);
          }
        } catch (error: any) { // Inner catch for behavior logic error
          logger.error(`Error in behavior summary logic for ${walletAddress}:`, error);
          analysisStatus = 'FAILURE';
          errorMessage = error.message || 'An unexpected error occurred in behavior summary logic.';
          // No specific reply here; let outer catch handle for consistency.
        }
      } catch (e: any) { // Outer catch for this wallet_address
        logger.error(`CRITICAL: Top-level command handler error in getBehaviorSummary for ${walletAddress}:`, e);
        analysisStatus = 'FAILURE';
        errorMessage = (e instanceof Error) ? e.message : 'Unknown critical error';

        if (e.name === 'TimeoutError') {
          errorMessage = 'Behavior summary timed out for ' + walletAddress + '. ' + errorMessage;
          await ctx.reply(`🚨 Apologies, behavior summary for ${walletAddress} took too long and was stopped.`);
        } else if (errorMessage === 'Invalid Solana wallet address format') {
          await ctx.reply(`❌ Invalid Solana wallet address format: ${walletAddress}`);
        } else {
          await ctx.reply(`🚨 An unexpected error occurred while fetching behavior summary for ${walletAddress}.`);
        }
      } finally {
        if (activityLogId && this.isBotUserInitialized && this.botSystemUserId) {
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(
            this.botSystemUserId!,
            'telegram_command_behavior_summary_completed',
            { originalLogId: activityLogId, processingTimeMs: durationMs, walletAddress: walletAddress },
            analysisStatus,
            durationMs,
            analysisStatus === 'FAILURE' ? errorMessage : undefined
          );
        } else {
          logger.info(`Processing for getBehaviorSummary on ${walletAddress} completed (no activityLogId or bot user not init). Status: ${analysisStatus}. Duration: ${Date.now() - startTime}ms. Error: ${errorMessage || 'None'}`);
        }
      }
    } // End loop over walletAddresses
  }
  // --- END NEW COMMAND HANDLERS ---
} 