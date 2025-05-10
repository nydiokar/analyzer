import { Context } from 'telegraf';
import { createLogger } from '../../utils/logger';
import { WalletInfo, WalletCluster } from '../../types/wallet';
import { DEFAULT_EXCLUDED_MINTS, DEFAULT_RECENT_TRANSACTION_COUNT, CLUSTERING_CONFIG } from '../../config/constants';
import { HeliusApiClient } from '../services/helius-api-client';
import { mapHeliusTransactionsToIntermediateRecords } from '../services/helius-transaction-mapper';
import {
  getSwapAnalysisInputs,
  saveSwapAnalysisInputs,
  getWallet,
  updateWallet
} from '../services/database-service';
import { SwapAnalysisInput, Wallet } from '@prisma/client';
import { HeliusTransaction } from '../../types/helius-api';

const logger = createLogger('WalletAnalysisCommands');

interface CorrelatorTransactionData {
    mint: string;
    timestamp: number;
    direction: 'in' | 'out';
    associatedSolValue: number;
}

interface CorrelatedPairData {
    walletA_address: string;
    walletB_address: string;
    score: number;
    sharedNonObviousTokens: { mint: string, countA: number, countB: number }[];
    synchronizedEvents: {
        mint: string,
        direction: 'in' | 'out',
        timestampA: number,
        timestampB: number,
        timeDiffSeconds: number
    }[];
}

interface GlobalTokenStats {
    totalUniqueTokens: number;
    totalPopularTokens: number;
    totalNonObviousTokens: number;
}

interface ProcessingStats {
  totalTransactions: number;
  timeRangeHours: number;
}

export class WalletAnalysisCommands {
  private readonly heliusApiClient: HeliusApiClient;
  private readonly heliusApiKey: string | undefined;

  constructor(heliusApiKey?: string) {
    this.heliusApiKey = heliusApiKey;
    if (heliusApiKey) {
      this.heliusApiClient = new HeliusApiClient({ apiKey: heliusApiKey, network: 'mainnet' });
      logger.info('WalletAnalysisCommands initialized with HeliusApiClient.');
    } else {
      this.heliusApiClient = new HeliusApiClient({ apiKey: '', network: 'mainnet' });
      logger.warn('WalletAnalysisCommands initialized WITHOUT a valid Helius API key. RPC functionality will be impaired or disabled.');
    }
  }

  async analyzeWallets(ctx: Context, walletAddressesInput: string[], userRequestedTxCount?: number) {
    try {
      await ctx.reply('🔄 Initializing analysis for provided wallets...');
      const initialWallets: WalletInfo[] = walletAddressesInput.map(addr => ({ address: addr.trim().toString() }));
      
      const allFetchedCorrelatorTransactions: Record<string, CorrelatorTransactionData[]> = {};
      const failedWallets: string[] = [];

      for (const walletInfo of initialWallets) {
        const walletAddress = walletInfo.address;
        try {
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
            throw new Error(`Invalid Solana address format: ${walletAddress}`);
          }
          const countToFetchForAnalysis = userRequestedTxCount !== undefined && userRequestedTxCount > 0 
                                           ? userRequestedTxCount 
                                           : DEFAULT_RECENT_TRANSACTION_COUNT;
          
          logger.info(`Processing wallet: ${walletAddress}. Target transactions for final analysis: ${countToFetchForAnalysis}.`);

          if (!this.heliusApiKey) {
            logger.warn(`Helius API key not configured. Skipping Helius fetch for ${walletAddress}. Relying on existing DB data.`);
            await ctx.reply(`⚠️ Helius API key not configured. Analysis for ${walletAddress} will use existing database data only.`);
          } else {
            await ctx.reply(`🔄 Fetching & updating transaction data for ${walletAddress}...`);
            const walletState: Wallet | null = await getWallet(walletAddress);
            logger.debug(`Wallet state for ${walletAddress}: ${walletState ? JSON.stringify(walletState) : 'null'}`);

            const isInitialFetch = !walletState || !walletState.lastSuccessfulFetchTimestamp;
            
            const heliusMaxSignatures = isInitialFetch 
                ? Math.max(countToFetchForAnalysis * 2, 300) 
                : Math.max(Math.floor(countToFetchForAnalysis * 1.5), 200);
            const stopAtSignature = walletState?.newestProcessedSignature ?? undefined;
            const newestProcessedTs = walletState?.newestProcessedTimestamp ?? undefined;

            logger.info(`Calling HeliusApiClient for ${walletAddress}. MaxSignatures: ${heliusMaxSignatures}, StopAtSig: ${stopAtSignature}, NewestTs: ${newestProcessedTs}`);

            const rawHeliusTxs: HeliusTransaction[] = await this.heliusApiClient.getAllTransactionsForAddress(
              walletAddress,
              100,
              heliusMaxSignatures,
              stopAtSignature,
              newestProcessedTs,
              true,
            );

            logger.info(`HeliusApiClient returned ${rawHeliusTxs.length} raw Helius transactions for ${walletAddress}.`);

            if (rawHeliusTxs.length > 0) {
              const mappedInputs = mapHeliusTransactionsToIntermediateRecords(walletAddress, rawHeliusTxs);
              logger.info(`Mapped ${rawHeliusTxs.length} raw Helius txs to ${mappedInputs.length} SwapAnalysisInput records for ${walletAddress}.`);
              
              if (mappedInputs.length > 0) {
                const saveResult = await saveSwapAnalysisInputs(mappedInputs);
                logger.info(`Saved ${saveResult.count} new SwapAnalysisInput records to DB for ${walletAddress} from Helius data.`);
              }

              const latestTx = rawHeliusTxs.reduce((latest, current) => (!latest || current.timestamp > latest.timestamp) ? current : latest, null as HeliusTransaction | null);
              const oldestTxInBatch = rawHeliusTxs.reduce((oldest, current) => (!oldest || current.timestamp < oldest.timestamp) ? current : oldest, null as HeliusTransaction | null);
              
              const updateData: Partial<Omit<Wallet, 'address'>> = { lastSuccessfulFetchTimestamp: new Date() };
              if (latestTx) {
                updateData.newestProcessedSignature = latestTx.signature;
                updateData.newestProcessedTimestamp = latestTx.timestamp;
              }
              if (isInitialFetch && oldestTxInBatch) {
                  updateData.firstProcessedTimestamp = oldestTxInBatch.timestamp;
              } else if (walletState && oldestTxInBatch && (!walletState.firstProcessedTimestamp || oldestTxInBatch.timestamp < walletState.firstProcessedTimestamp)) {
                  updateData.firstProcessedTimestamp = oldestTxInBatch.timestamp;
              }
              
              await updateWallet(walletAddress, updateData);
              logger.info(`Wallet state updated for ${walletAddress}.`);
            } else {
              logger.info(`No new raw transactions fetched from Helius for ${walletAddress}. Database should be up-to-date based on previous state.`);
              await updateWallet(walletAddress, { lastSuccessfulFetchTimestamp: new Date() });
            }
             await ctx.reply(`✅ Transaction data for ${walletAddress} updated.`);
          }

          logger.info(`Fetching SwapAnalysisInput records from DB for analysis of ${walletAddress}...`);
          let swapInputsForAnalysis: SwapAnalysisInput[] = await getSwapAnalysisInputs(walletAddress);
          
          swapInputsForAnalysis.sort((a, b) => b.timestamp - a.timestamp);
          let finalInputsForAnalysis = swapInputsForAnalysis.slice(0, countToFetchForAnalysis);
          finalInputsForAnalysis.sort((a, b) => a.timestamp - b.timestamp); 
          
          logger.info(`Retrieved ${finalInputsForAnalysis.length} SwapAnalysisInput records for ${walletAddress} for core analysis.`);

          const correlatorTxs: CorrelatorTransactionData[] = finalInputsForAnalysis
            .filter(input => !CLUSTERING_CONFIG.excludedMints.includes(input.mint))
            .map(input => ({
              mint: input.mint,
              timestamp: input.timestamp,
              direction: input.direction as 'in' | 'out',
              associatedSolValue: input.associatedSolValue || 0,
            }));
          
          allFetchedCorrelatorTransactions[walletAddress] = correlatorTxs;
          logger.info(`Prepared ${correlatorTxs.length} CorrelatorTransactionData records for ${walletAddress}.`);
          if (correlatorTxs.length === 0 && countToFetchForAnalysis > 0) {
             logger.warn(`No relevant transactions available for ${walletAddress} after full data pipeline.`);
             await ctx.reply(`⚠️ No relevant transaction data found for ${walletAddress} to analyze.`);
          }

        } catch (error: any) {
          logger.error(`Failed to process wallet ${walletAddress}: ${error.message}`, { stack: error.stack });
          failedWallets.push(`${walletAddress} (Error: ${error.message})`);
          allFetchedCorrelatorTransactions[walletAddress] = [];
          await ctx.reply(`❌ Error processing ${walletAddress}: ${error.message}`);
        }
      }
      
      if (failedWallets.length > 0) {
        await ctx.replyWithHTML(`⚠️ Encountered issues processing some wallets:<br>${failedWallets.join('<br>')}`);
      }
      
      const walletInfosForAnalysis = initialWallets.filter(w => !failedWallets.some(fw => fw.startsWith(w.address)));

      if (walletInfosForAnalysis.length < 2 && initialWallets.length >=2) {
        await ctx.reply("ℹ️ Not enough wallets successfully processed to perform correlation analysis (need at least 2).");
        return;
      }
       if (walletInfosForAnalysis.length === 0 && initialWallets.length > 0) {
        await ctx.reply("ℹ️ No wallets could be processed. Analysis halted.");
        return;
      }
       if (initialWallets.length < 2) {
         await ctx.reply("ℹ️ Please provide at least two wallets for correlation analysis.");
         return;
       }

      const { walletsForAnalysis } = this.filterOutBotWallets(
        walletInfosForAnalysis, 
        allFetchedCorrelatorTransactions, 
        CLUSTERING_CONFIG.MAX_DAILY_TOKENS_FOR_FILTER
      );
      const numFilteredOutByBotLogic = walletInfosForAnalysis.length - walletsForAnalysis.length;
      if (numFilteredOutByBotLogic > 0) {
        await ctx.reply(`ℹ️ Filtered out ${numFilteredOutByBotLogic} wallets suspected of bot activity (based on transaction patterns). Analyzing ${walletsForAnalysis.length} wallets.`);
      }

      if (walletsForAnalysis.length < 2) {
        await ctx.reply("ℹ️ Not enough wallets remaining after bot-activity filtering to perform correlation analysis (need at least 2). Analysis halted.");
        return;
      }
      
      await ctx.reply('📊 Calculating PNL and running correlation analysis on processed data...');

      const walletPnLs: Record<string, number> = {};
      for (const wallet of walletsForAnalysis) {
        const txs = allFetchedCorrelatorTransactions[wallet.address] || [];
        walletPnLs[wallet.address] = this.calculateWalletPnl(txs);
      }

      const transactionsForCorrelation: Record<string, CorrelatorTransactionData[]> = {};
      walletsForAnalysis.forEach(w => {
        transactionsForCorrelation[w.address] = allFetchedCorrelatorTransactions[w.address];
      });

      const { clusters, globalTokenStats } = await this.runCorrelationAnalysis(
        walletsForAnalysis, 
        transactionsForCorrelation, 
        CLUSTERING_CONFIG
      );
      
      let totalRelevantCorrelatorTransactions = 0;
      walletsForAnalysis.forEach(w => {
        totalRelevantCorrelatorTransactions += (allFetchedCorrelatorTransactions[w.address] || []).length;
      });
      
      const processingStats: ProcessingStats = {
         totalTransactions: totalRelevantCorrelatorTransactions, 
         timeRangeHours: 0
      };

      const reportMessages: string[] = this.generateTelegramReport(
        initialWallets.length,
        walletsForAnalysis.length,
        walletPnLs,
        globalTokenStats,
        clusters,
        processingStats
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

  private filterOutBotWallets(
    initialWallets: WalletInfo[],
    allTransactions: Record<string, CorrelatorTransactionData[]>,
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

  private calculateWalletPnl(transactions: CorrelatorTransactionData[]): number {
    let pnl = 0;
    for (const tx of transactions) {
      const solValue = Number(tx.associatedSolValue);
      if (isNaN(solValue)) continue;
      if (tx.direction === 'in') pnl -= solValue;
      else if (tx.direction === 'out') pnl += solValue;
    }
    return pnl;
  }

  private buildClustersFromPairs(
    scoredPairs: CorrelatedPairData[],
    minClusterScoreThreshold: number 
  ): WalletCluster[] {
    const clusters: WalletCluster[] = [];
    const adj: Map<string, string[]> = new Map();
    const visited: Set<string> = new Set();
    const allWalletsInPairs: Set<string> = new Set();
    const pairDetailsMap: Map<string, CorrelatedPairData> = new Map();

    for (const pair of scoredPairs) {
      if (pair.score >= minClusterScoreThreshold) {
        adj.set(pair.walletA_address, [...(adj.get(pair.walletA_address) || []), pair.walletB_address]);
        adj.set(pair.walletB_address, [...(adj.get(pair.walletB_address) || []), pair.walletA_address]);
        allWalletsInPairs.add(pair.walletA_address);
        allWalletsInPairs.add(pair.walletB_address);
        const pairKey = [pair.walletA_address, pair.walletB_address].sort().join('-');
        pairDetailsMap.set(pairKey, pair);
      }
    }

    function dfs(wallet: string, currentClusterMembers: string[]) {
      visited.add(wallet);
      currentClusterMembers.push(wallet);
      const neighbors = adj.get(wallet) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, currentClusterMembers);
        }
      }
    }

    for (const wallet of allWalletsInPairs) {
      if (!visited.has(wallet)) {
        const currentClusterMembers: string[] = [];
        dfs(wallet, currentClusterMembers);

        if (currentClusterMembers.length >= 3) {
          let totalScore = 0;
          let contributingPairsCount = 0;
          const clusterSharedTokensMap: Map<string, number> = new Map();

          for (let i = 0; i < currentClusterMembers.length; i++) {
            for (let j = i + 1; j < currentClusterMembers.length; j++) {
              const pairKey = [currentClusterMembers[i], currentClusterMembers[j]].sort().join('-');
              const pairData = pairDetailsMap.get(pairKey);
              if (pairData) {
                totalScore += pairData.score;
                contributingPairsCount++;
                pairData.sharedNonObviousTokens.forEach(token => {
                  clusterSharedTokensMap.set(token.mint, (clusterSharedTokensMap.get(token.mint) || 0) + 1);
                });
              }
            }
          }
          
          const representativeScore = contributingPairsCount > 0 ? totalScore / contributingPairsCount : 0;
          const finalSharedTokens = Array.from(clusterSharedTokensMap.keys()).map(mint => ({ mint }));

          clusters.push({
            id: currentClusterMembers.sort().join('-'),
            wallets: currentClusterMembers.sort(),
            score: representativeScore,
            sharedNonObviousTokens: finalSharedTokens,
          });
        }
      }
    }
    logger.info(`Built ${clusters.length} wallet clusters (3+ members, min pair score for inclusion: ${minClusterScoreThreshold}).`);
    return clusters;
  }

  private async runCorrelationAnalysis(
    walletsForAnalysis: WalletInfo[],
    transactionsForAnalysis: Record<string, CorrelatorTransactionData[]>,
    config: typeof CLUSTERING_CONFIG
  ): Promise<{ clusters: WalletCluster[], globalTokenStats: GlobalTokenStats }> {
    logger.info(`Starting correlation analysis for ${walletsForAnalysis.length} wallets. Sync window: ${config.syncTimeWindowSeconds}s.`);

    const globalTokenFrequency: Record<string, number> = {};
    let totalTransactionCountForStats = 0;
    for (const walletAddress of walletsForAnalysis.map(w => w.address)) {
        const txs = transactionsForAnalysis[walletAddress] || [];
        totalTransactionCountForStats += txs.length;
        for (const tx of txs) {
            if (tx.mint) globalTokenFrequency[tx.mint] = (globalTokenFrequency[tx.mint] || 0) + 1;
        }
    }

    if (totalTransactionCountForStats === 0) {
        logger.warn("No transactions found for any of the filtered wallets for correlation. Skipping correlation.");
        return { clusters: [], globalTokenStats: { totalUniqueTokens: 0, totalPopularTokens: 0, totalNonObviousTokens: 0 } };
    }

    const sortedGlobalTokens = Object.entries(globalTokenFrequency).sort(([, countA], [, countB]) => countB - countA);
    const popularTokens = new Set<string>();
    const thresholdIndex = Math.floor(sortedGlobalTokens.length * config.nonObviousTokenThresholdPercent);
    for (let i = 0; i < sortedGlobalTokens.length; i++) {
        const [mint, count] = sortedGlobalTokens[i];
        if (i < thresholdIndex || count > config.minOccurrencesForPopular) popularTokens.add(mint);
    }
    
    const globalStats: GlobalTokenStats = {
        totalUniqueTokens: sortedGlobalTokens.length,
        totalPopularTokens: popularTokens.size,
        totalNonObviousTokens: sortedGlobalTokens.length - popularTokens.size
    };
    logger.info(`Global token analysis: ${globalStats.totalUniqueTokens} unique, ${globalStats.totalPopularTokens} popular, ${globalStats.totalNonObviousTokens} non-obvious.`);
    if (globalStats.totalUniqueTokens > 0 && globalStats.totalPopularTokens === globalStats.totalUniqueTokens) {
        logger.warn("All tokens identified as popular. Correlation based on non-obvious tokens might not yield results.");
    }

    const correlatedPairs: CorrelatedPairData[] = [];
    for (let i = 0; i < walletsForAnalysis.length; i++) {
        for (let j = i + 1; j < walletsForAnalysis.length; j++) {
            const walletA = walletsForAnalysis[i];
            const walletB = walletsForAnalysis[j];
            const txsA = transactionsForAnalysis[walletA.address] || [];
            const txsB = transactionsForAnalysis[walletB.address] || [];
            if (txsA.length === 0 || txsB.length === 0) continue;

            const nonObviousTradedByA = new Map<string, number>();
            txsA.forEach(tx => { if (tx.mint && !popularTokens.has(tx.mint) && !config.excludedMints.includes(tx.mint)) nonObviousTradedByA.set(tx.mint, (nonObviousTradedByA.get(tx.mint) || 0) + 1); });
            
            const nonObviousTradedByB = new Map<string, number>();
            txsB.forEach(tx => { if (tx.mint && !popularTokens.has(tx.mint) && !config.excludedMints.includes(tx.mint)) nonObviousTradedByB.set(tx.mint, (nonObviousTradedByB.get(tx.mint) || 0) + 1); });

            const currentSharedNonObvious: CorrelatedPairData['sharedNonObviousTokens'] = [];
            nonObviousTradedByA.forEach((countA, mint) => {
                if (nonObviousTradedByB.has(mint)) currentSharedNonObvious.push({ mint, countA, countB: nonObviousTradedByB.get(mint)! });
            });

            const currentSyncEvents: CorrelatedPairData['synchronizedEvents'] = [];
            if (currentSharedNonObvious.length > 0) {
                for (const shared of currentSharedNonObvious) {
                    const mintToAnalyze = shared.mint;
                    const buysA = txsA.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'in');
                    const buysB = txsB.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'in');
                    const sellsA = txsA.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'out');
                    const sellsB = txsB.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'out');

                    for (const buyA of buysA) {
                        for (const buyB of buysB) {
                            const timeDiff = Math.abs(buyA.timestamp - buyB.timestamp);
                            if (timeDiff <= config.syncTimeWindowSeconds) currentSyncEvents.push({ mint: mintToAnalyze, direction: 'in', timestampA: buyA.timestamp, timestampB: buyB.timestamp, timeDiffSeconds: timeDiff });
                        }
                    }
                    for (const sellA of sellsA) {
                        for (const sellB of sellsB) {
                            const timeDiff = Math.abs(sellA.timestamp - sellB.timestamp);
                            if (timeDiff <= config.syncTimeWindowSeconds) currentSyncEvents.push({ mint: mintToAnalyze, direction: 'out', timestampA: sellA.timestamp, timestampB: sellB.timestamp, timeDiffSeconds: timeDiff });
                        }
                    }
                }
                currentSyncEvents.sort((a,b) => a.timeDiffSeconds - b.timeDiffSeconds || a.timestampA - b.timestampA);
            }

            if (currentSharedNonObvious.length >= config.minSharedNonObviousTokens || currentSyncEvents.length >= config.minSyncEvents) {
                let score = (currentSharedNonObvious.length * config.weightSharedNonObvious) + (currentSyncEvents.length * config.weightSyncEvents);
                if (score > 0) {
                    correlatedPairs.push({
                        walletA_address: walletA.address, walletB_address: walletB.address, score: parseFloat(score.toFixed(2)),
                        sharedNonObviousTokens: currentSharedNonObvious, synchronizedEvents: currentSyncEvents
                    });
                }
            }
        }
    }
    correlatedPairs.sort((a, b) => b.score - a.score);
    logger.info(`Pairwise analysis: ${correlatedPairs.length} pairs meeting score > 0 before cluster threshold.`);

    const clusters: WalletCluster[] = this.buildClustersFromPairs(correlatedPairs, config.minClusterScoreThreshold);
    return { clusters, globalTokenStats: globalStats };
  }

  private generateTelegramReport(
    requestedWalletsCount: number,
    analyzedWalletsCount: number,
    walletPnLs: Record<string, number>,
    globalTokenStats: GlobalTokenStats | null,
    identifiedClusters: WalletCluster[],
    processingStats: ProcessingStats
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
    
    const failedOrNotProcessedCount = requestedWalletsCount - (walletPnLs ? Object.keys(walletPnLs).length : analyzedWalletsCount);
    if (failedOrNotProcessedCount > 0 && requestedWalletsCount > analyzedWalletsCount) {
        // This implies some wallets failed before bot-activity filter, or are not in walletPnLs
        // analyzedWalletsCount is after bot-filter.
        // A more precise count of "wallets that had data fetched but were bot-filtered" vs "wallets that failed data fetching" might be good.
        // For now, let's use analyzedWalletsCount as the count of wallets that passed pre-analysis filters.
    }

    const numBotFiltered = (walletPnLs ? Object.keys(walletPnLs).length : 0) - analyzedWalletsCount;
    if (numBotFiltered > 0) {
         addLine(`Wallets Filtered (e.g., bot-like): ${numBotFiltered}`);
    }
    addLine(`Wallets Analyzed (post-filter): ${analyzedWalletsCount}`);
    if (globalTokenStats && analyzedWalletsCount > 0) {
        addLine(`Total Unique Mints (in analyzed wallets): ${globalTokenStats.totalUniqueTokens}`);
        // addLine(`Total Transactions Analyzed (post-filter): ${processingStats.totalTransactions}`); // New line for clarity
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
            clusterSpecificLines.push(`  - <code>${walletAddr}</code> (${pnl} SOL)`);
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