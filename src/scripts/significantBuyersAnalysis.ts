#!/usr/bin/env ts-node

import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { createLogger } from '../core/utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '@/core/services/helius-transaction-mapper';
import { HELIUS_CONFIG, PROCESSING_CONFIG, DB_CONFIG } from '../config/constants';
import { HeliusTransaction } from '@/types/helius-api';
import * as path from 'path';
import * as fs from 'fs';
import pLimit from 'p-limit';
import { getErrorMessage, getErrorDetails } from '../core/utils/error-utils';


// ANSI escape codes for progress display
const ESC = '\x1b[';

// Set log level to info to reduce verbosity for this script
process.env.LOG_LEVEL = 'info';

const logger = createLogger('SignificantBuyersAnalysis');

// Global telemetry counters
let globalTelemetry = {
  apiCalls: {
    getSignaturesViaRpcPage: 0,
    getTransactionsBySignatures: 0,
    getTransactionsViaEnhancedAPI: 0,
    getAllTransactionsForMint: 0,
    getTokenAccountsByOwner: 0,
    getMultipleAccounts: 0
  },
  wallets: {
    totalReviewed: 0,
    relevantFound: 0,
    analyzedSuccessfully: 0,
    failedAnalysis: 0
  }
};

interface WalletAnalysisResult {
  mint: string;
  walletAddress: string;
  totalSolSpent: number;
  totalSolReceived: number;
  netPnl: number;
  transactionCount: number;
  firstBuyTimestamp: number;
  currentTokenBalance: number;
  currentSolBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  analysisSuccess: boolean;
  errorMessage?: string;
}

/**
 * Script to analyze wallets that bought significant amounts (50+ SOL) of a specific token
 * with fewer than 5 transactions (to exclude bots).
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS> [options]
 *
 * MODES:
 * - ENHANCED-ONLY MODE: Uses Helius Enhanced API for mint transactions and local filtering
 *   Time filters (if provided) are applied locally after Enhanced pagination.
 *
 * Time filtering options:
 * --before-time=N      Unix timestamp - transactions before this time
 * --after-time=N       Unix timestamp - transactions after this time
 * --end-time=N         Unix timestamp - look backwards from this time
 * --transaction-type=T Type: SWAP (default), TRANSFER (includes airdrops), etc.
 * 
 * Example:
 * npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --min-sol=50 --max-tx=5
 */

function parseArgs(argv: string[]): {
  mints: string[];
  minSol: number;
  maxTx: number;
  addressType: 'bonding-curve' | 'mint' | 'auto';
  bondingCurve?: string;
  maxSignatures: number;
  maxPages: number | null;
  useAnchorBatch: boolean;
  watchWallets: string[];
  topTradersPerToken: number;
  sortBy: 'pnl' | 'investment';
  beforeTime?: number;
  afterTime?: number;
  endTime?: number;
  transactionTypes: string[];
} {
  const args = argv.slice(2);

  if (args.length === 0 || args[0].startsWith('--')) {
    throw new Error('At least one mint address is required as the first argument (comma-separated for multiple)');
  }

  // Support comma-separated mints or multiple arguments
  const mintInput = args[0];
  const mints = mintInput.includes(',') ? mintInput.split(',').map(m => m.trim()) : [mintInput];

  let minSol = 50;
  let maxTx = 5;
  let addressType: 'bonding-curve' | 'mint' | 'auto' = 'auto';
  let bondingCurve: string | undefined;
  let maxSignatures = 5000;
  let maxPages: number | null = null;
  let useAnchorBatch = true;
  let watchWallets: string[] = [];
  let topTradersPerToken = 20;
  let sortBy: 'pnl' | 'investment' = 'pnl';
  let beforeTime: number | undefined;
  let afterTime: number | undefined;
  let endTime: number | undefined;
  let transactionTypes = ['SWAP', 'TRANSFER'];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--min-sol=')) {
      minSol = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--max-tx=')) {
      maxTx = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--address-type=')) {
      addressType = arg.split('=')[1] as any;
    } else if (arg.startsWith('--bonding-curve=')) {
      bondingCurve = arg.split('=')[1];
    } else if (arg.startsWith('--max-signatures=')) {
      maxSignatures = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--max-pages=')) {
      maxPages = parseInt(arg.split('=')[1]);
    } else if (arg === '--no-anchor') {
      useAnchorBatch = false;
    } else if (arg.startsWith('--watch-wallet=')) {
      const walletArg = arg.split('=')[1];
      watchWallets = walletArg.split(',').map(addr => addr.trim()).filter(Boolean);
    } else if (arg.startsWith('--top-traders=')) {
      topTradersPerToken = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--sort-by=')) {
      sortBy = arg.split('=')[1] as 'pnl' | 'investment';
    } else if (arg.startsWith('--before-time=')) {
      beforeTime = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--after-time=')) {
      afterTime = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end-time=')) {
      endTime = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--transaction-type=')) {
      const rawTypes = arg.split('=')[1];
      transactionTypes = rawTypes.split(',').map(type => type.trim()).filter(Boolean);
    }
  }

  return { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, maxPages, useAnchorBatch, watchWallets, topTradersPerToken, sortBy, beforeTime, afterTime, endTime, transactionTypes };
}

async function main(): Promise<void> {
  try {
    const { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, maxPages, useAnchorBatch, watchWallets, topTradersPerToken, sortBy, beforeTime, afterTime, endTime, transactionTypes } = parseArgs(process.argv);

    if (!process.env.HELIUS_API_KEY) {
      console.error('❌ HELIUS_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info(`Starting significant buyers analysis for ${mints.length} token(s): ${mints.join(', ')}`);
    logger.info(`Parameters: minSol=${minSol}, maxTx=${maxTx}, maxSignatures=${maxSignatures}, maxPages=${maxPages ?? 'auto'}, anchor=${useAnchorBatch}, topTradersPerToken=${topTradersPerToken}, sortBy=${sortBy}`);
    logger.info(`Time filters: beforeTime=${beforeTime}, afterTime=${afterTime}, endTime=${endTime}, transactionTypes=${transactionTypes.join(',')}`);
    if (watchWallets.length > 0) {
      logger.info(`Watch wallets: ${watchWallets.join(', ')}`);
    }
    if (addressType !== 'auto' || bondingCurve) {
      logger.info(`Note: addressType/bondingCurve options are ignored in Enhanced-only mode.`);
    }

    // Initialize services
    const databaseService = new DatabaseService();
    const heliusClient = new HeliusApiClient({
      apiKey: process.env.HELIUS_API_KEY,
      network: 'mainnet',
      requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS // Use established config (40 RPS)
    }, databaseService);

    const startTime = Date.now();
    const allResults: WalletAnalysisResult[] = [];
    const allAnalysisInputs: any[] = []; // Collect all analysis inputs for batch saving

    // Process each mint
    for (const mint of mints) {
      logger.info(`\n🔄 Processing token: ${mint}`);

      const hasTimeFilters = beforeTime || afterTime || endTime;
      const windowStart = afterTime;
      const windowEnd = beforeTime ?? endTime;
      const maxPagesToUse = maxPages ?? Math.max(1, Math.ceil(maxSignatures / 100) + 5);
      let walletsToAnalyze: { walletAddress: string }[] = [];
      let mintTransactions: HeliusTransaction[] = [];

      logger.info(`🚀 ENHANCED-ONLY MODE: Fetching mint transactions via Enhanced API...`);

      try {
        mintTransactions = await fetchEnhancedTransactionsForMintWindow(
          heliusClient,
          mint,
          transactionTypes,
          windowStart,
          windowEnd,
          {
            useAnchorBatch: hasTimeFilters && useAnchorBatch,
            maxPages: maxPagesToUse,
            maxTransactions: maxSignatures
          }
        );
      } catch (error) {
        logger.error(`❌ Enhanced API fetch failed for ${mint}:`, error);
        throw error;
      }

      logger.info(`✅ Fetched ${mintTransactions.length} transactions for mint ${mint} (types=${transactionTypes.join(',')})`);

      if (mintTransactions.length === 0) {
        logger.warn(`No transactions found for ${mint}. Skipping.`);
        continue;
      }

      const timestamps = mintTransactions.map(tx => tx.timestamp);
      if (timestamps.length > 0) {
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        logger.info(`📊 Time range in fetched txs: ${new Date(minTime * 1000).toISOString()} - ${new Date(maxTime * 1000).toISOString()}`);
      }

      // Group transactions by wallet address
      const transactionsByWallet = new Map<string, HeliusTransaction[]>();
      for (const tx of mintTransactions) {
        const walletAddresses: string[] = [];

        if (tx.events?.swap) {
          const swap = tx.events.swap;
          if (swap.nativeInput?.account) walletAddresses.push(swap.nativeInput.account);
          if (swap.nativeOutput?.account) walletAddresses.push(swap.nativeOutput.account);
          if (swap.tokenInputs?.[0]?.userAccount) walletAddresses.push(swap.tokenInputs[0].userAccount);
          if (swap.tokenOutputs?.[0]?.userAccount) walletAddresses.push(swap.tokenOutputs[0].userAccount);
        }

        if (tx.tokenTransfers) {
          tx.tokenTransfers.forEach(transfer => {
            if (transfer.fromUserAccount) walletAddresses.push(transfer.fromUserAccount);
            if (transfer.toUserAccount) walletAddresses.push(transfer.toUserAccount);
          });
        }

        if (tx.nativeTransfers) {
          tx.nativeTransfers.forEach(transfer => {
            if (transfer.fromUserAccount) walletAddresses.push(transfer.fromUserAccount);
            if (transfer.toUserAccount) walletAddresses.push(transfer.toUserAccount);
          });
        }

        const uniqueWallets = [...new Set(walletAddresses.filter(addr => addr && addr !== mint))];
        uniqueWallets.forEach(wallet => {
          if (!transactionsByWallet.has(wallet)) {
            transactionsByWallet.set(wallet, []);
          }
          transactionsByWallet.get(wallet)!.push(tx);
        });
      }

      walletsToAnalyze = Array.from(transactionsByWallet.keys()).map(walletAddress => ({ walletAddress }));
      if (watchWallets.length > 0) {
        const present = watchWallets.filter(addr => transactionsByWallet.has(addr));
        const missing = watchWallets.filter(addr => !transactionsByWallet.has(addr));
        if (present.length > 0) {
          logger.info(`✅ Watch wallets present in mint transactions: ${present.join(', ')}`);
        }
        if (missing.length > 0) {
          logger.warn(`⚠️ Watch wallets missing from mint transactions: ${missing.join(', ')}`);
        }
      }
      globalTelemetry.wallets.totalReviewed += walletsToAnalyze.length;
      logger.info(`📊 Found ${walletsToAnalyze.length} unique wallets in Enhanced API transactions`);

      const cacheStartBlockTime = windowStart ?? 0;
      const cacheEndBlockTime = windowEnd ?? 0;
      const transactionSummaries = mintTransactions.map(tx => ({
        signature: tx.signature,
        timestamp: tx.timestamp
      }));

      await databaseService.upsertSignificantBuyersCache({
        mint,
        startBlockTime: cacheStartBlockTime,
        endBlockTime: cacheEndBlockTime,
        walletAddresses: walletsToAnalyze.map(w => w.walletAddress),
        transactions: transactionSummaries,
      });

      logger.info(`📊 Step 2: Analyzing ${walletsToAnalyze.length} wallets for ${mint}...`);
      const results: WalletAnalysisResult[] = [];
      let processedCount = 0;

      // Function to process a single wallet using mint transactions only
      const processWallet = async (buyer: { walletAddress: string }, walletTransactions: HeliusTransaction[]): Promise<{ result: WalletAnalysisResult; analysisInputs: any[] }> => {
        try {
          const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
            buyer.walletAddress,
            walletTransactions
          );

          const relevantInputs = analysisInputs.filter(input => input.mint === mint);
          const filteredInputs = relevantInputs.filter(input => {
            if (windowStart !== undefined && input.timestamp < windowStart) return false;
            if (windowEnd !== undefined && input.timestamp >= windowEnd) return false;
            return true;
          });

          if (filteredInputs.length === 0) {
            if (watchWallets.includes(buyer.walletAddress)) {
              logger.warn(`⚠️ Watch wallet ${buyer.walletAddress}: no filtered inputs (wallet txs=${walletTransactions.length}, relevantInputs=${relevantInputs.length})`);
            }
            return {
              result: {
                mint,
                walletAddress: buyer.walletAddress,
                totalSolSpent: 0,
                totalSolReceived: 0,
                netPnl: 0,
                transactionCount: 0,
                firstBuyTimestamp: 0,
                currentTokenBalance: 0,
                currentSolBalance: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                analysisSuccess: false,
                errorMessage: 'No relevant transactions for mint'
              },
              analysisInputs: []
            };
          }

          const totalSolSpent = filteredInputs
            .filter(input => input.direction === 'out')
            .reduce((sum, input) => sum + Math.abs(input.associatedSolValue || 0), 0);

          const totalSolReceived = filteredInputs
            .filter(input => input.direction === 'in')
            .reduce((sum, input) => sum + Math.abs(input.associatedSolValue || 0), 0);

          // Prefer swap event amounts when present (more direct than mapper for Enhanced API)
          let swapSolSpent = 0;
          let swapSolReceived = 0;
          let swapTxCount = 0;
          let swapBuyTimestamp: number | undefined;

          for (const tx of walletTransactions) {
            if (windowStart !== undefined && tx.timestamp < windowStart) continue;
            if (windowEnd !== undefined && tx.timestamp >= windowEnd) continue;

            const swap = tx.events?.swap;
            if (!swap) continue;

            let involved = false;
            const tokenOutputs = swap.tokenOutputs ?? [];
            const tokenInputs = swap.tokenInputs ?? [];
            const isBuy = tokenOutputs.some(output => output.userAccount === buyer.walletAddress && output.mint === mint);
            const isSell = tokenInputs.some(input => input.userAccount === buyer.walletAddress && input.mint === mint);

            if (isBuy && swap.nativeInput?.amount) {
              swapSolSpent += Number(swap.nativeInput.amount || 0) / 1e9;
              involved = true;
              swapBuyTimestamp = swapBuyTimestamp ?? tx.timestamp;
            }
            if (isSell && swap.nativeOutput?.amount) {
              swapSolReceived += Number(swap.nativeOutput.amount || 0) / 1e9;
              involved = true;
            }
            if (isBuy || isSell) involved = true;

            if (involved) swapTxCount += 1;
          }

          let transferSolSpent = 0;
          let transferSolReceived = 0;
          let transferTxCount = 0;

          for (const tx of walletTransactions) {
            if (windowStart !== undefined && tx.timestamp < windowStart) continue;
            if (windowEnd !== undefined && tx.timestamp >= windowEnd) continue;

            const tokenTransfers = tx.tokenTransfers ?? [];
            const receivedMint = tokenTransfers.some(t => t.toUserAccount === buyer.walletAddress && t.mint === mint);
            const sentMint = tokenTransfers.some(t => t.fromUserAccount === buyer.walletAddress && t.mint === mint);

            if (!receivedMint && !sentMint) continue;

            const nativeTransfers = tx.nativeTransfers ?? [];
            const nativeOut = nativeTransfers
              .filter(t => t.fromUserAccount === buyer.walletAddress)
              .reduce((sum, t) => sum + Number(t.amount || 0), 0);
            const nativeIn = nativeTransfers
              .filter(t => t.toUserAccount === buyer.walletAddress)
              .reduce((sum, t) => sum + Number(t.amount || 0), 0);

            if (receivedMint && nativeOut > 0) transferSolSpent += nativeOut / 1e9;
            if (sentMint && nativeIn > 0) transferSolReceived += nativeIn / 1e9;
            transferTxCount += 1;
          }

          const useSwapTotals = swapSolSpent > 0 || swapSolReceived > 0;
          const useTransferTotals = !useSwapTotals && (transferSolSpent > 0 || transferSolReceived > 0);
          const effectiveSolSpent = useSwapTotals ? swapSolSpent : (useTransferTotals ? transferSolSpent : totalSolSpent);
          const effectiveSolReceived = useSwapTotals ? swapSolReceived : (useTransferTotals ? transferSolReceived : totalSolReceived);
          const transactionCount = useSwapTotals ? swapTxCount : (useTransferTotals ? transferTxCount : filteredInputs.length);

          if (watchWallets.includes(buyer.walletAddress)) {
            logger.info(`🔎 Watch wallet ${buyer.walletAddress}: mapperSpent=${totalSolSpent.toFixed(4)}, swapSpent=${swapSolSpent.toFixed(4)}, transferSpent=${transferSolSpent.toFixed(4)}, mapperTx=${filteredInputs.length}, swapTx=${swapTxCount}, transferTx=${transferTxCount}`);
          }

          if (effectiveSolSpent < minSol) {
            if (watchWallets.includes(buyer.walletAddress)) {
              logger.warn(`⚠️ Watch wallet ${buyer.walletAddress}: below minSol (spent=${effectiveSolSpent.toFixed(4)}, tx=${transactionCount})`);
            }
            return {
              result: {
                mint,
                walletAddress: buyer.walletAddress,
                totalSolSpent: 0,
                totalSolReceived: 0,
                netPnl: 0,
                transactionCount: 0,
                firstBuyTimestamp: 0,
                currentTokenBalance: 0,
                currentSolBalance: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                analysisSuccess: false,
                errorMessage: `Spent only ${effectiveSolSpent.toFixed(2)} SOL (< ${minSol})`
              },
              analysisInputs: []
            };
          }

          if (transactionCount >= maxTx) {
            if (watchWallets.includes(buyer.walletAddress)) {
              logger.warn(`⚠️ Watch wallet ${buyer.walletAddress}: too many tx (spent=${totalSolSpent.toFixed(4)}, tx=${transactionCount})`);
            }
            return {
              result: {
                mint,
                walletAddress: buyer.walletAddress,
                totalSolSpent: 0,
                totalSolReceived: 0,
                netPnl: 0,
                transactionCount: 0,
                firstBuyTimestamp: 0,
                currentTokenBalance: 0,
                currentSolBalance: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                analysisSuccess: false,
                errorMessage: `Too many transactions (${transactionCount} >= ${maxTx})`
              },
              analysisInputs: []
            };
          }

          const netPnl = effectiveSolReceived - effectiveSolSpent;
          const buyTimestamps = filteredInputs.filter(input => input.direction === 'in').map(input => input.timestamp);
          const firstBuyTimestamp = buyTimestamps.length > 0
            ? Math.min(...buyTimestamps)
            : (swapBuyTimestamp ?? Math.min(...filteredInputs.map(input => input.timestamp)));

          const realizedPnl = netPnl;
          const unrealizedPnl = 0;

          logger.info(`✅ Wallet ${buyer.walletAddress}: ${effectiveSolSpent.toFixed(2)} SOL spent, ${transactionCount} tx, PnL: ${netPnl.toFixed(2)} SOL`);

          return {
            result: {
              mint,
              walletAddress: buyer.walletAddress,
              totalSolSpent: effectiveSolSpent,
              totalSolReceived: effectiveSolReceived,
              netPnl,
              transactionCount,
              firstBuyTimestamp,
              currentTokenBalance: 0,
              currentSolBalance: 0,
              realizedPnl,
              unrealizedPnl,
              analysisSuccess: true
            },
            analysisInputs: filteredInputs
          };
        } catch (error) {
          logger.error(`Error analyzing wallet ${buyer.walletAddress}:`, error);
          return {
            result: {
              mint,
              walletAddress: buyer.walletAddress,
              totalSolSpent: 0,
              totalSolReceived: 0,
              netPnl: 0,
              transactionCount: 0,
              firstBuyTimestamp: 0,
              currentTokenBalance: 0,
              currentSolBalance: 0,
              realizedPnl: 0,
              unrealizedPnl: 0,
              analysisSuccess: false,
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            },
            analysisInputs: []
          };
        }
      };

    // ANSI progress counter - always visible
    const updateProgress = () => {
      process.stdout.write(`${ESC}2K\rProgress: ${processedCount}/${walletsToAnalyze.length} wallets analyzed (${results.length} match criteria so far)`);
    };

    // Process wallets in parallel with concurrency limit
    const concurrencyLimit = pLimit(PROCESSING_CONFIG.WALLET_SYNC_CONCURRENCY); // Use established config (5 concurrent wallets)
    const analysisPromises = walletsToAnalyze.map(buyer =>
      concurrencyLimit(async () => {
        const walletTransactions = transactionsByWallet.get(buyer.walletAddress) || [];
        const walletResult = await processWallet(buyer, walletTransactions);
        processedCount++;
        updateProgress();
        return walletResult;
      })
    );

    // Wait for all wallets to be processed
    const walletResults = await Promise.all(analysisPromises);

    // Separate results and analysis inputs
    for (const walletResult of walletResults) {
      if (walletResult.result.analysisSuccess) {
        results.push(walletResult.result);
        globalTelemetry.wallets.relevantFound++;
        globalTelemetry.wallets.analyzedSuccessfully++;
      } else {
        globalTelemetry.wallets.failedAnalysis++;
      }
      // Collect all analysis inputs for batch saving
      allAnalysisInputs.push(...walletResult.analysisInputs);
    }

    if (watchWallets.length > 0) {
      const resultAddresses = new Set(results.map(r => r.walletAddress));
      const found = watchWallets.filter(addr => resultAddresses.has(addr));
      const missing = watchWallets.filter(addr => !resultAddresses.has(addr));
      if (found.length > 0) {
        logger.info(`✅ Watch wallets in qualifying results: ${found.join(', ')}`);
      }
      if (missing.length > 0) {
        logger.warn(`⚠️ Watch wallets NOT in qualifying results: ${missing.join(', ')}`);
      }
    }

    // Batch save all analysis inputs at once (using established batch size)
    if (allAnalysisInputs.length > 0) {
      logger.info(`Batch saving ${allAnalysisInputs.length} analysis inputs to database...`);
      await databaseService.saveSwapAnalysisInputs(allAnalysisInputs);
      logger.info(`✅ Successfully saved all analysis inputs`);
    }

    // Clear the progress line
    console.log();

      const tokenDuration = (Date.now() - startTime) / 1000;

      // Step 3: Sort results by specified criteria (descending)
      if (sortBy === 'investment') {
        results.sort((a, b) => b.totalSolSpent - a.totalSolSpent);
      } else {
        results.sort((a, b) => b.netPnl - a.netPnl);
      }

      // Keep full results for files; topTradersPerToken is only a display cap
      const topResults = results.slice(0, topTradersPerToken);
      allResults.push(...results);

      logger.info(`✅ Completed analysis for ${mint}: ${results.length} qualifying traders (${topResults.length} in top cap, ${tokenDuration.toFixed(2)}s)`);

    } // End of mint loop

    const totalDuration = (Date.now() - startTime) / 1000;

    // Step 4: Generate and save combined report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'analysis_reports');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const tokenList = mints.join('_').substring(0, 50); // Truncate for filename
    const csvPath = path.join(outputDir, `significant_buyers_multi_${tokenList}_${timestamp}.csv`);
    const mdPath = path.join(outputDir, `significant_buyers_multi_${tokenList}_${timestamp}.md`);
    const txtPath = path.join(outputDir, `wallet_addresses_multi_${tokenList}_${timestamp}.txt`);

    // Generate CSV
    const csvLines = [
      'Rank,Mint,Wallet Address,SOL Spent,SOL Received,Net PnL,Transaction Count,Current Token Balance,Current SOL Balance,First Buy Date'
    ];

    allResults.forEach((result, index) => {
      const date = new Date(result.firstBuyTimestamp * 1000).toISOString();
      csvLines.push(
        `${index + 1},${result.mint},${result.walletAddress},${result.totalSolSpent.toFixed(4)},${result.totalSolReceived.toFixed(4)},${result.netPnl.toFixed(4)},${result.transactionCount},${result.currentTokenBalance.toFixed(2)},${result.currentSolBalance.toFixed(4)},${date}`
      );
    });

    fs.writeFileSync(csvPath, csvLines.join('\n'));

    // Generate Markdown report
    const successfulAnalyses = allResults.filter(r => r.analysisSuccess).length;
    const totalSolInvested = allResults.reduce((sum, r) => sum + r.totalSolSpent, 0);
    const averagePnl = allResults.length > 0 ? allResults.reduce((sum, r) => sum + r.netPnl, 0) / allResults.length : 0;
    const winnersCount = allResults.filter(r => r.netPnl > 0).length;
    const losersCount = allResults.filter(r => r.netPnl < 0).length;
    const uniqueTokens = [...new Set(allResults.map(r => r.mint))].length;

    const mdLines = [
      `# Significant Buyers Analysis Report (Multi-Token)`,
      ``,
      `**Tokens Analyzed:** ${mints.map(m => `\`${m}\``).join(', ')} (${uniqueTokens} unique tokens)`,
      `**Analysis Date:** ${new Date().toISOString()}  `,
      `**Criteria:** Min ${minSol} SOL spent, Max ${maxTx} transactions, Sorted by ${sortBy}  `,
      `${bondingCurve ? `**Bonding Curve:** \`${bondingCurve}\`  ` : ''}`,
      ``,
      `## Summary`,
      ``,
      `- **Tokens Processed:** ${uniqueTokens}`,
      `- **Qualified Traders:** ${allResults.length}`,
      `- **Successful Analyses:** ${successfulAnalyses}`,
      `- **Total SOL Invested:** ${totalSolInvested.toFixed(2)} SOL`,
      `- **Average PnL:** ${averagePnl.toFixed(4)} SOL`,
      `- **Winners:** ${winnersCount} (${((winnersCount / allResults.length) * 100).toFixed(1)}%)`,
      `- **Losers:** ${losersCount} (${((losersCount / allResults.length) * 100).toFixed(1)}%)`,
      `- **Note:** CSV/TXT include all qualifying traders; tables are capped for readability`,
      `- **Processing Time:** ${totalDuration.toFixed(2)} seconds`,
      ``,
      `## Top Performing Traders Across All Tokens`,
      ``,
      `| Rank | Token | Wallet Address | SOL Spent | Net PnL | TX Count | Current Token Balance | Current SOL Balance | First Buy Date |`,
      `|------|-------|---------------|-----------|---------|----------|---------------------|-------------------|----------------|`
    ];

    // Sort all results for the combined report
    const sortedAllResults = [...allResults].sort((a, b) => {
      if (sortBy === 'investment') {
        return b.totalSolSpent - a.totalSolSpent;
      } else {
        return b.netPnl - a.netPnl;
      }
    });

    sortedAllResults.slice(0, 50).forEach((result, index) => {
      const date = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
      mdLines.push(
        `| ${index + 1} | \`${result.mint.substring(0, 8)}...\` | \`${result.walletAddress}\` | ${result.totalSolSpent.toFixed(2)} | **${result.netPnl.toFixed(2)}** | ${result.transactionCount} | ${result.currentTokenBalance.toFixed(2)} | ${result.currentSolBalance.toFixed(4)} | ${date} |`
      );
    });

    if (allResults.length > 50) {
      mdLines.push(``, `*... and ${allResults.length - 50} more traders (see CSV for full list)*`);
    }

    fs.writeFileSync(mdPath, mdLines.join('\n'));

    // Generate simple wallet list
    const walletList = sortedAllResults.map(r => r.walletAddress).join('\n');
    fs.writeFileSync(txtPath, walletList);

    // Console output
    console.log('\n' + '='.repeat(100));
    console.log('SIGNIFICANT BUYERS ANALYSIS COMPLETE (MULTI-TOKEN)');
    console.log('='.repeat(100));
    console.log(`Tokens Analyzed: ${mints.join(', ')}`);
    console.log(`Criteria: Min ${minSol} SOL spent, Max ${maxTx} transactions, Sorted by ${sortBy}`);
    console.log(`Qualified Traders: ${allResults.length} (files include all; top ${topTradersPerToken} per token is only a display cap)`);
    console.log(`Successful Analyses: ${successfulAnalyses}`);
    console.log(`Total SOL Invested: ${totalSolInvested.toFixed(2)} SOL`);
    console.log(`Average PnL: ${averagePnl.toFixed(4)} SOL`);
    console.log(`Winners: ${winnersCount} (${((winnersCount / allResults.length) * 100).toFixed(1)}%)`);
    console.log(`Losers: ${losersCount} (${((losersCount / allResults.length) * 100).toFixed(1)}%)`);
    console.log(`Processing Time: ${totalDuration.toFixed(2)} seconds`);
    console.log('='.repeat(100));

    if (sortedAllResults.length > 0) {
      console.log('\n📋 TOP 20 TRADERS ACROSS ALL TOKENS:');
      console.log('-'.repeat(120));
      console.log('Rank | Token       | Wallet Address                                     | SOL Spent | Net PnL  | TX | Token Bal  | SOL Bal | First Buy');
      console.log('-'.repeat(120));

      sortedAllResults.slice(0, 20).forEach((result, index) => {
        const date = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
        const rank = (index + 1).toString().padStart(2, ' ');
        const token = result.mint.substring(0, 10).padStart(10, ' ');
        const spent = result.totalSolSpent.toFixed(2).padStart(9, ' ');
        const pnl = result.netPnl.toFixed(2).padStart(8, ' ');
        const tx = result.transactionCount.toString().padStart(2, ' ');
        const tokenBal = result.currentTokenBalance.toFixed(0).padStart(10, ' ');
        const solBal = result.currentSolBalance.toFixed(2).padStart(7, ' ');

        console.log(`${rank}   | ${token} | ${result.walletAddress} | ${spent} | ${pnl} | ${tx} | ${tokenBal} | ${solBal} | ${date}`);
      });

      if (allResults.length > 20) {
        console.log(`... and ${allResults.length - 20} more traders (see full report)`);
      }
    }

    console.log('\n📁 Reports saved to:');
    console.log(`   CSV: ${csvPath}`);
    console.log(`   Markdown: ${mdPath}`);
    console.log(`   Wallet List: ${txtPath}`);
    console.log('\n✅ Analysis completed successfully!');

    // Log final telemetry
    console.log('\n📊 FINAL TELEMETRY:');
    console.log('='.repeat(50));
    console.log('API CALLS:');
    Object.entries(globalTelemetry.apiCalls).forEach(([method, count]) => {
      if (count > 0) console.log(`  ${method}: ${count}`);
    });
    console.log('\nWALLETS PROCESSED:');
    console.log(`  Total reviewed: ${globalTelemetry.wallets.totalReviewed}`);
    console.log(`  Relevant found: ${globalTelemetry.wallets.relevantFound}`);
    console.log(`  Successfully analyzed: ${globalTelemetry.wallets.analyzedSuccessfully}`);
    console.log(`  Failed analysis: ${globalTelemetry.wallets.failedAnalysis}`);
    console.log('='.repeat(50));

  } catch (error) {
    logger.error('Error during analysis:', error);
    console.error('\n❌ Analysis failed:', error instanceof Error ? error.message : 'Unknown error');
    
    if (error instanceof Error && error.message.includes('Mint address is required')) {
      console.log('\n📖 Usage:');
      console.log('npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS> [options]');
      console.log('Multiple tokens: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts "MINT1,MINT2,MINT3" [options]');
      console.log('\n📊 MODE:');
      console.log('  ENHANCED-ONLY: Uses Enhanced API mint transactions + local filtering');
      console.log('\nOptions:');
      console.log('  --min-sol=N          Minimum SOL spent (default: 50)');
      console.log('  --max-tx=N           Maximum transaction count (default: 5)');
      console.log('  --max-signatures=N   Maximum signatures to process (default: 5000)');
      console.log('  --max-pages=N        Maximum Enhanced API pages to fetch per type (default: auto)');
      console.log('  --no-anchor          Disable time-filtered anchor batch even when time filters are set');
      console.log('  --watch-wallet=A,B   Comma-separated wallets to check for presence');
      console.log('  --top-traders=N      Number of top traders to return per token (default: 20)');
      console.log('  --sort-by=CRITERIA   Sort by: pnl|investment (default: pnl)');
      console.log('  --before-time=N      Unix timestamp - transactions before this time');
      console.log('  --after-time=N       Unix timestamp - transactions after this time');
      console.log('  --end-time=N         Unix timestamp - look backwards from this time');
      console.log('  --transaction-type=T Transaction types, comma-separated (default: SWAP,TRANSFER)');
      console.log('\nExamples:');
      console.log('Enhanced-only: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts TOKEN --min-sol=50 --max-tx=5');
      console.log('Time-filtered: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts TOKEN --end-time=1704067200 --transaction-type=TRANSFER');
      console.log('Multiple tokens: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts "TOKEN1,TOKEN2" --min-sol=2 --top-traders=30');
    }
    
    process.exit(1);
  }
}

async function fetchEnhancedTransactionsForMintWindow(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  types: string[],
  windowStart: number | undefined,
  windowEnd: number | undefined,
  options: {
    useAnchorBatch: boolean;
    maxPages: number;
    maxTransactions: number;
  }
): Promise<HeliusTransaction[]> {
  const allBySignature = new Map<string, HeliusTransaction>();

  for (const type of types) {
    const typeTransactions = await fetchEnhancedTransactionsForMintWindowByType(
      heliusClient,
      mintAddress,
      type,
      windowStart,
      windowEnd,
      options
    );

    for (const tx of typeTransactions) {
      const existing = allBySignature.get(tx.signature);
      if (!existing) {
        allBySignature.set(tx.signature, tx);
        continue;
      }

      allBySignature.set(tx.signature, pickPreferredTransaction(existing, tx));
    }
  }

  return Array.from(allBySignature.values()).slice(0, options.maxTransactions);
}

function pickPreferredTransaction(a: HeliusTransaction, b: HeliusTransaction): HeliusTransaction {
  const score = (tx: HeliusTransaction): number => {
    let value = 0;
    if (tx.events?.swap) value += 10;
    if (tx.nativeTransfers?.length) value += 3;
    if (tx.tokenTransfers?.length) value += 2;
    if (tx.accountData?.length) value += 1;
    if (tx.instructions?.length) value += 1;
    return value;
  };

  const scoreA = score(a);
  const scoreB = score(b);

  if (scoreB > scoreA) return b;
  if (scoreA > scoreB) return a;

  // Prefer SWAP-typed transactions if equal score
  if (a.type === 'SWAP' && b.type !== 'SWAP') return a;
  if (b.type === 'SWAP' && a.type !== 'SWAP') return b;

  return a;
}

async function fetchEnhancedTransactionsForMintWindowByType(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  type: string,
  windowStart: number | undefined,
  windowEnd: number | undefined,
  options: {
    useAnchorBatch: boolean;
    maxPages: number;
    maxTransactions: number;
  }
): Promise<HeliusTransaction[]> {
  const allTransactions: HeliusTransaction[] = [];
  const limit = 100;
  let beforeSignature: string | undefined;
  let pagesFetched = 0;

  if (options.useAnchorBatch) {
    const anchorBatch = await heliusClient.getTransactionsViaEnhancedAPI(mintAddress, {
      limit,
      type,
      ...(windowStart !== undefined ? { gteTime: windowStart } : {}),
      ...(windowEnd !== undefined ? { lteTime: windowEnd } : {})
    });

    logger.info(`🔍 Anchor batch (${type}): ${anchorBatch.length} transactions`);

    for (const tx of anchorBatch) {
      if (windowStart !== undefined && tx.timestamp < windowStart) continue;
      if (windowEnd !== undefined && tx.timestamp >= windowEnd) continue;
      allTransactions.push(tx);
    }

    if (anchorBatch.length === 0) {
      return allTransactions;
    }

    beforeSignature = anchorBatch[anchorBatch.length - 1]?.signature;
  }

  while (allTransactions.length < options.maxTransactions && pagesFetched < options.maxPages) {
    const batch = await heliusClient.getTransactionsViaEnhancedAPI(mintAddress, {
      limit,
      beforeSignature,
      type
    });

    pagesFetched += 1;

    if (batch.length === 0) break;

    for (const tx of batch) {
      if (windowStart !== undefined && tx.timestamp < windowStart) continue;
      if (windowEnd !== undefined && tx.timestamp >= windowEnd) continue;
      allTransactions.push(tx);
    }

    const oldestTx = batch[batch.length - 1];
    beforeSignature = oldestTx?.signature;

    if (windowStart !== undefined && oldestTx?.timestamp && oldestTx.timestamp < windowStart) {
      break;
    }

    if (batch.length < limit) break;
  }

  if (pagesFetched >= options.maxPages) {
    logger.info(`⚠️ Reached max pages (${options.maxPages}) for ${mintAddress} (${type}); stopping pagination.`);
  }

  return allTransactions.slice(0, options.maxTransactions);
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error:', getErrorMessage(error));
    process.exit(1);
  });
}
