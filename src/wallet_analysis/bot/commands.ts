import { Context } from 'telegraf';
import { createLogger } from '../../utils/logger';
import { prisma } from '../services/database-service';
import { WalletInfo, WalletCluster } from '../../types/wallet';
import { DEFAULT_EXCLUDED_MINTS, DEFAULT_RECENT_TRANSACTION_COUNT, CLUSTERING_CONFIG } from '../../config/constants';

const logger = createLogger('WalletAnalysisCommands');

// Interface from activityCorrelator.ts (amount is fetched by script but not used in its PNL/core correlation)
interface CorrelatorTransactionData {
    mint: string;
    timestamp: number; // Unix timestamp (seconds)
    direction: 'in' | 'out';
    // amount: number; // Not strictly needed by core logic based on script
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

// For storing global token stats from analysis for the report
interface GlobalTokenStats {
    totalUniqueTokens: number;
    totalPopularTokens: number;
    totalNonObviousTokens: number;
}

// Define ProcessingStats if not already defined elsewhere and imported
interface ProcessingStats {
  totalTransactions: number;
  timeRangeHours: number;
}

export class WalletAnalysisCommands {
  // No Helius client needed if mirroring script's Prisma-only fetch
  // constructor(heliusApiKey: string) { ... }

  // Simpler constructor if no API key needed for this command set now
  constructor() {
    logger.info('WalletAnalysisCommands initialized for Prisma-based analysis.');
  }

  async analyzeWallets(ctx: Context, walletAddressesInput: string[]) {
    try {
      await ctx.reply('🔄 Initializing analysis for provided wallets...');
      const initialWallets: WalletInfo[] = walletAddressesInput.map(addr => ({ address: addr.trim().toString() }));
      
      const allFetchedTransactions: Record<string, CorrelatorTransactionData[]> = {};
      const failedWallets: string[] = [];

      // Step 1: Fetch transactions (mirroring script's fetchRecentTransactions)
      for (const wallet of initialWallets) {
        try {
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.address)) {
            throw new Error(`Invalid Solana address format: ${wallet.address}`);
          }
          const txs = await this.fetchTransactionsForWalletFromPrisma(wallet.address, DEFAULT_RECENT_TRANSACTION_COUNT, CLUSTERING_CONFIG.excludedMints);
          if (txs.length === 0) {
            logger.warn(`Fetched 0 relevant transactions from DB for ${wallet.address}.`);
          }
          allFetchedTransactions[wallet.address] = txs;
        } catch (error) {
          const err = error as Error;
          logger.error(`Failed to fetch transactions from DB for ${wallet.address}: ${err.message}`);
          failedWallets.push(`${wallet.address} (DB fetch error: ${err.message})`);
          allFetchedTransactions[wallet.address] = [];
        }
      }

      if (failedWallets.length > 0) {
        await ctx.replyWithHTML(`⚠️ Encountered issues fetching data for some wallets:<br>${failedWallets.join('<br>')}`);
      }
      await ctx.reply('✅ Transaction fetching from database complete.');

      // Step 2: Bot Filtering (mirroring script logic)
      const { walletsForAnalysis /*, dailyTokenCountsByWallet */ } = this.filterOutBotWallets(initialWallets, allFetchedTransactions, CLUSTERING_CONFIG.MAX_DAILY_TOKENS_FOR_FILTER);
      const numFilteredOut = initialWallets.length - walletsForAnalysis.length;
      if (numFilteredOut > 0) {
        await ctx.reply(`ℹ️ Filtered out ${numFilteredOut} wallets suspected of bot activity. Analyzing ${walletsForAnalysis.length} wallets.`);
      }

      if (walletsForAnalysis.length < 2) {
        await ctx.reply("ℹ️ Not enough wallets remaining after filtering to perform correlation analysis (need at least 2). Analysis halted.");
        return;
      }
      
      await ctx.reply('📊 Calculating PNL and running correlation analysis...');

      // Step 3: PNL Calculation (for walletsForAnalysis)
      const walletPnLs: Record<string, number> = {};
      for (const wallet of walletsForAnalysis) {
        const txs = allFetchedTransactions[wallet.address] || [];
        walletPnLs[wallet.address] = this.calculateWalletPnl(txs);
      }

      // Step 4: Run Core Correlation Analysis (mirroring script's analyzeCorrelations)
      // The transactions passed to analysis should be for `walletsForAnalysis` only.
      const transactionsForAnalysisOnly: Record<string, CorrelatorTransactionData[]> = {};
      walletsForAnalysis.forEach(w => {
        transactionsForAnalysisOnly[w.address] = allFetchedTransactions[w.address];
      });

      // runCorrelationAnalysis now returns WalletCluster[] for clusters
      const { clusters, globalTokenStats } = await this.runCorrelationAnalysis(
        walletsForAnalysis, 
        transactionsForAnalysisOnly, 
        CLUSTERING_CONFIG
      );
      
      // ProcessingStats for the report - total unique mints will be from globalTokenStats
      const processingStats: ProcessingStats = {
         // totalTransactions is no longer reported explicitly in this revised version
         // timeRangeHours can be calculated if needed, or set to 0 if not displayed.
         // For now, let's not calculate it if not displayed to save computation.
         totalTransactions: 0, // Not used in new report format
         timeRangeHours: 0   // Not used in new report format
      };

      // generateTelegramReport now returns string[]
      const reportMessages: string[] = this.generateTelegramReport(
        initialWallets.length,
        walletsForAnalysis.length,
        walletPnLs,
        globalTokenStats,
        clusters,
        processingStats
      );

      // Send each message part
      for (const messagePart of reportMessages) {
        if (messagePart.trim().length > 0) {
            try {
                await ctx.replyWithHTML(messagePart);
            } catch (error: any) {
                logger.error('Error sending a part of Telegram report:', { message: error.message, description: error.description, partLength: messagePart.length });
                await ctx.reply(`Failed to send a part of the report. Error: ${error.description || error.message}`);
                logger.debug('Report part that failed:', { reportText: messagePart });
            }
        }
      }
      logger.info(`Successfully sent wallet analysis report in ${reportMessages.length} part(s).`);

    } catch (error) {
      const err = error as Error;
      logger.error('Error in analyzeWallets:', err);
      await ctx.reply(`❌ Top-level error analyzing wallets: ${err.message}`);
    }
  }

  private async fetchTransactionsForWalletFromPrisma(
    walletAddress: string,
    transactionCount: number,
    excludedMints: readonly string[] // from ANALYSIS_CONFIG which is `as const`
  ): Promise<CorrelatorTransactionData[]> {
    logger.debug(`Fetching last ${transactionCount} transactions for ${walletAddress} from Prisma, excluding ${excludedMints.length} mints.`);
    try {
        const transactionsFromDB = await prisma.swapAnalysisInput.findMany({
            where: {
                walletAddress: walletAddress,
                NOT: {
                    mint: {
                        in: [...excludedMints], // Spread into a mutable array
                    },
                },
            },
            select: {
                mint: true,
                timestamp: true,
                direction: true,
                // amount: true, // Script fetches amount but doesn't use for PNL/correlation
                associatedSolValue: true,
            },
            orderBy: {
                timestamp: 'desc',
            },
            take: transactionCount,
        });
        logger.debug(`Fetched ${transactionsFromDB.length} transactions for ${walletAddress} from Prisma.`);
        
        return transactionsFromDB.map(t => ({
            mint: t.mint,
            timestamp: t.timestamp,
            direction: t.direction === 'in' ? 'in' : 'out', // Ensure type safety
            associatedSolValue: t.associatedSolValue,
        } as CorrelatorTransactionData )).sort((a, b) => a.timestamp - b.timestamp); // Sort ascending by timestamp as script does
    } catch (error) {
        logger.error(`Error fetching recent transactions from Prisma for wallet ${walletAddress}:`, { error });
        throw error; // Re-throw to be caught by analyzeWallets
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
    let totalTransactionCount = 0;
    for (const walletAddress of walletsForAnalysis.map(w => w.address)) {
        const txs = transactionsForAnalysis[walletAddress] || [];
        totalTransactionCount += txs.length;
        for (const tx of txs) {
            if (tx.mint) globalTokenFrequency[tx.mint] = (globalTokenFrequency[tx.mint] || 0) + 1;
        }
    }

    if (totalTransactionCount === 0) {
        logger.warn("No transactions found for any of the filtered wallets. Skipping correlation.");
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
                currentSyncEvents.sort((a,b) => a.timestampA - b.timestampA || a.timestampB - b.timestampB);
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
    const filteredOutCount = requestedWalletsCount - analyzedWalletsCount;
    if (filteredOutCount > 0) {
      addLine(`Wallets Filtered (e.g., bot-like): ${filteredOutCount}`); 
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
    } else if (analyzedWalletsCount > 1) { 
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
      addLine('<i>No significant clusters (3+ wallets) identified with current settings.</i>');
      addLine('<i>This means no groups of 3 or more wallets were found where pairs consistently met the minimum correlation score for clustering.</i>');
    } else if (requestedWalletsCount > 0 && analyzedWalletsCount <=1 ) {
        if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
        addLine('<i>Not enough wallets remained after filtering to perform cluster analysis.</i>');
    } else {
      if (messages.length > 0 && messages[messages.length-1] !== '') currentMessageLines.push(''); 
      addLine('<i>No wallets provided or all were invalid.</i>');
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