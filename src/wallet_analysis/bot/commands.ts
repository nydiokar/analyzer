import { Context } from 'telegraf';
import { createLogger } from '@/utils/logger';
import { WalletInfo, WalletCluster } from '@/types/wallet';
import { DEFAULT_RECENT_TRANSACTION_COUNT, CLUSTERING_CONFIG } from '../../config/constants';
import { DatabaseService } from '@/services/database-service';
import { SwapAnalysisInput, Wallet } from '@prisma/client';
import { CorrelationAnalyzer } from '../core/correlation/analyzer';
import { calculatePnlForWallets } from '@/utils/pnl_calculator';
import { TransactionData, CorrelatedPairData, GlobalTokenStats } from '../../types/correlation';
import { HeliusSyncService, SyncOptions } from '../services/helius-sync-service';
import pLimit from 'p-limit';

const logger = createLogger('WalletAnalysisCommands');

/**
 * @interface ProcessingStats
 * @description Contains statistics about the transaction processing.
 * @property {number} totalTransactions - Total number of transactions processed for the correlation analysis.
 * @property {number} timeRangeHours - The approximate time range in hours covered by the analyzed transactions (currently not fully implemented, defaults to 0).
 */
interface ProcessingStats {
  totalTransactions: number;
  timeRangeHours: number;
}

/**
 * @class WalletAnalysisCommands
 * @description Handles the core logic for wallet analysis, including data fetching, processing,
 * correlation analysis, and report generation.
 */
export class WalletAnalysisCommands {
  private readonly heliusApiKey: string | undefined;
  private readonly databaseService: DatabaseService;
  private readonly heliusSyncService: HeliusSyncService | undefined;

  /**
   * @constructor
   * @param {string} [heliusApiKey] - Optional API key for the Helius service. If not provided,
   * functionality relying on Helius API calls will be limited or disabled.
   */
  constructor(heliusApiKey?: string) {
    this.heliusApiKey = heliusApiKey;
    this.databaseService = new DatabaseService();
    if (heliusApiKey) {
      try {
        this.heliusSyncService = new HeliusSyncService(this.databaseService, heliusApiKey);
        logger.info('WalletAnalysisCommands initialized with HeliusSyncService.');
      } catch (error) {
        logger.error('Failed to initialize HeliusSyncService even with API key:', error);
        this.heliusSyncService = undefined; // Ensure it's undefined on error
      }
    } else {
      this.heliusSyncService = undefined;
      logger.warn('WalletAnalysisCommands initialized WITHOUT a Helius API key. HeliusSyncService is not available.');
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
      const CONCURRENCY_LIMIT = 5; // Define concurrency limit (e.g., 5-10, needs tuning)
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
            if (!this.heliusApiKey || !this.heliusSyncService) {
              throw new Error('Helius API key not configured or HeliusSyncService not initialized.');
            }
            
            // logger.info(`Initiating sync for wallet: ${walletAddress}.`); // Logged by syncWalletData or too verbose here
            const walletState = await this.databaseService.getWallet(walletAddress);
            const isInitialFetch = !walletState || !walletState.lastSuccessfulFetchTimestamp;
            const maxSignaturesToConsiderForSync = Math.max(targetTxCountInDb * 1.5, 300);

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
         return;
       }

      // Perform bot filtering using the successfullyProcessedWalletsInfo and transactionsForBotFilterPass
      const { walletsForAnalysis: walletsPostBotFilter } = this.filterOutBotWallets(
        successfullyProcessedWalletsInfo, 
        transactionsForBotFilterPass, 
        CLUSTERING_CONFIG.MAX_DAILY_TOKENS_FOR_FILTER
      );
      const numFilteredOutByBotLogic = successfullyProcessedWalletsInfo.length - walletsPostBotFilter.length;

      // Now, prepare allFetchedCorrelatorTransactions for the wallets that passed bot filtering,
      // applying the excludedMints filter at this stage.
      const allFetchedCorrelatorTransactions: Record<string, TransactionData[]> = {};
      for (const walletInfo of walletsPostBotFilter) {
          const walletAddress = walletInfo.address;
          // Use the already fetched and sliced SwapAnalysisInput data for this wallet
          const originalSwapInputsForThisWallet = allSwapInputsByWallet[walletAddress] || []; 
          
          const correlatorTxsForWallet = originalSwapInputsForThisWallet
              .filter(input => !CLUSTERING_CONFIG.excludedMints.includes(input.mint)) // Apply mint exclusion here
              .map(input => ({
                  mint: input.mint,
                  timestamp: input.timestamp,
                  direction: input.direction as 'in' | 'out',
                  amount: input.amount,
                  associatedSolValue: input.associatedSolValue || 0,
              }));
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
        return;
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
         timeRangeHours: 0 
      };

      const uniqueTokenCountsPerWalletInAnalysis: Record<string, number> = {};
      for (const walletAddress of walletsPostBotFilter.map(w => w.address)) {
        const txs = allFetchedCorrelatorTransactions[walletAddress] || [];
        const uniqueMints = new Set(txs.map(tx => tx.mint));
        uniqueTokenCountsPerWalletInAnalysis[walletAddress] = uniqueMints.size;
      }

      const reportMessages: string[] = this.generateTelegramReport(
        initialWallets.length, 
        walletsPostBotFilter.length, 
        numFilteredOutByBotLogic, 
        walletPnLs,
        globalTokenStats,
        clusters,
        topCorrelatedPairs,
        processingStats,
        uniqueTokenCountsPerWalletInAnalysis
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
   * Generates a multi-part HTML report for Telegram, summarizing the wallet analysis results.
   * Splits the report into multiple messages if it exceeds Telegram's message length limits.
   * @param {number} requestedWalletsCount - The initial number of wallets requested for analysis.
   * @param {number} analyzedWalletsCount - The number of wallets actually analyzed after filtering.
   * @param {number} botFilteredCount - The number of wallets filtered out due to suspected bot activity.
   * @param {Record<string, number>} walletPnLs - A map of wallet addresses to their calculated PnL.
   * @param {GlobalTokenStats | null} globalTokenStats - Statistics about token distribution.
   * @param {WalletCluster[]} identifiedClusters - An array of identified wallet clusters.
   * @param {CorrelatedPairData[]} topCorrelatedPairs - An array of top correlated wallet pairs.
   * @param {ProcessingStats} processingStats - Statistics about the transaction processing.
   * @param {Record<string, number>} uniqueTokenCountsPerWallet - A map of wallet addresses to their unique token counts.
   * @returns {string[]} An array of strings, where each string is a part of the report formatted for Telegram (HTML).
   */
  private generateTelegramReport(
    requestedWalletsCount: number,
    analyzedWalletsCount: number,
    botFilteredCount: number,
    walletPnLs: Record<string, number>,
    globalTokenStats: GlobalTokenStats | null,
    identifiedClusters: WalletCluster[],
    topCorrelatedPairs: CorrelatedPairData[],
    processingStats: ProcessingStats,
    uniqueTokenCountsPerWallet: Record<string, number>
  ): string[] {
    const messages: string[] = [];
    let currentMessageLines: string[] = [];
    const MAX_MESSAGE_LENGTH = 3800;

    const addLine = (line: string) => currentMessageLines.push(line);
    const pushCurrentMessage = () => {
      if (currentMessageLines.length > 0) {
        messages.push(currentMessageLines.join('\n'));
        currentMessageLines = [];
      }
    };

    addLine('<b>📊 Wallet Correlation Analysis Report</b>');
    addLine(`<i>Generated: ${new Date().toLocaleString()}</i>`);
    addLine('');
    addLine('<b>📋 Summary:</b>');
    addLine(`Requested for Analysis: ${requestedWalletsCount} wallets`);
    
    if (botFilteredCount > 0) {
      addLine(`Wallets Filtered (e.g., bot-like): ${botFilteredCount}`);
    }
    addLine(`Wallets Analyzed (post-filter): ${analyzedWalletsCount}`);
    if (globalTokenStats && analyzedWalletsCount > 0) {
        addLine(`Total Unique Mints (in analyzed wallets): ${globalTokenStats.totalUniqueTokens}`);
    }
    pushCurrentMessage(); 

    if (identifiedClusters.length > 0) {
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
      addLine('<b>🔗 Identified Wallet Clusters (3+ members):</b>');

      identifiedClusters.forEach((cluster, index) => {
        const clusterSpecificLines: string[] = [];
        clusterSpecificLines.push('');
        clusterSpecificLines.push(`🧲 <b>Cluster ${index + 1}:</b> (${cluster.wallets.length} wallets)`);
        clusterSpecificLines.push(`Avg Pair Score in Cluster: ${cluster.score.toFixed(2)}`);
        
        if (cluster.sharedNonObviousTokens) {
            clusterSpecificLines.push(`Shared Non-Obvious Tokens in Cluster: ${cluster.sharedNonObviousTokens.length}`);
        } else {
            clusterSpecificLines.push('Shared Non-Obvious Tokens in Cluster: 0');
        }

        clusterSpecificLines.push('Wallets (PNL approx.):');
        cluster.wallets.forEach(walletAddr => {
            const pnl = walletPnLs[walletAddr]?.toFixed(2) ?? 'N/A';
            const uniqueTokenCount = uniqueTokenCountsPerWallet[walletAddr] ?? 0;
            clusterSpecificLines.push(`  - <code>${walletAddr}</code> (${uniqueTokenCount} unique tokens, ${pnl} SOL)`);
        });

        const tempClusterReportFragment = clusterSpecificLines.join('\n');
        if ([...currentMessageLines, tempClusterReportFragment].join('\n').length > MAX_MESSAGE_LENGTH && currentMessageLines.length > 0) {
            pushCurrentMessage();
            if (messages.length === 0 || !messages[messages.length-1].includes('Identified Wallet Clusters')){
                 currentMessageLines.push('<b>🔗 Identified Wallet Clusters (3+ members) (continued):</b>');
            }
        }
        currentMessageLines.push(...clusterSpecificLines);
      });
    } else if (analyzedWalletsCount >= 2) {
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
      addLine('<i>No significant clusters (3+ wallets) identified with current settings.</i>');
      addLine('<i>This means no groups of 3 or more wallets were found where pairs consistently met the minimum correlation score for clustering.</i>');
    } else if (requestedWalletsCount > 0 && analyzedWalletsCount < 2 ) {
        if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
        addLine('<i>Not enough wallets remained after filtering to perform cluster analysis (need at least 2).</i>');
    } else {
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
      addLine('<i>No wallets provided or all failed initial processing.</i>');
    }
    
    // Add Top Correlated Pairs section
    if (topCorrelatedPairs.length > 0) {
      if (currentMessageLines.join('\n').length > MAX_MESSAGE_LENGTH - 500 && currentMessageLines.length > 0) { // Check if adding this section would overflow
        pushCurrentMessage();
      }
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push('');
      addLine('<b>✨ Top Correlated Wallet Pairs:</b>');
      topCorrelatedPairs.forEach((pair, index) => {
        const pairLines: string[] = [];
        const pnlA = walletPnLs[pair.walletA_address]?.toFixed(2) ?? 'N/A';
        const pnlB = walletPnLs[pair.walletB_address]?.toFixed(2) ?? 'N/A';
        const uniqueTokensA = uniqueTokenCountsPerWallet[pair.walletA_address] ?? 0;
        const uniqueTokensB = uniqueTokenCountsPerWallet[pair.walletB_address] ?? 0;

        pairLines.push('');
        pairLines.push(`Pair #${index + 1} (Score: ${pair.score.toFixed(2)}):`); // Using Japanese for "Pair" to test
        pairLines.push(`  A: <code>${pair.walletA_address}</code> (PNL: ${pnlA} SOL, ${uniqueTokensA} unique tokens)`);
        pairLines.push(`  B: <code>${pair.walletB_address}</code> (PNL: ${pnlB} SOL, ${uniqueTokensB} unique tokens)`);
        
        const tempPairReportFragment = pairLines.join('\n');
        if ([...currentMessageLines, tempPairReportFragment].join('\n').length > MAX_MESSAGE_LENGTH && currentMessageLines.length > 0) {
          pushCurrentMessage();
            if (messages.length === 0 || !messages[messages.length-1].includes('Top Correlated Wallet Pairs')){
                 currentMessageLines.push('<b>✨ Top Correlated Wallet Pairs (continued):</b>');
            }
        }
        currentMessageLines.push(...pairLines);
      });
    }

    if (currentMessageLines.length > 0) {
        currentMessageLines.push('');
        currentMessageLines.push("<i>PNL is approximate. Verify independently.</i>");
        pushCurrentMessage();
    } else if (messages.length > 0) { 
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg.includes("PNL is approximate")) {
            messages[messages.length - 1] = lastMsg + '\n\n' + "<i>PNL is approximate. Verify independently.</i>";
        }
    } else {
        if (messages.length === 1 && !messages[0].includes("PNL is approximate")) {
            messages[0] += '\n\n' + "<i>PNL is approximate. Verify independently.</i>";
        }
    }
    
    return messages.filter(msg => msg.trim().length > 0);
  }
} 