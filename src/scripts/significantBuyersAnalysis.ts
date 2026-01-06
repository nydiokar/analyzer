#!/usr/bin/env ts-node

import { TokenFirstBuyersService } from '../core/services/token-first-buyers-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { prisma } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '@/core/services/helius-transaction-mapper';
import { HELIUS_CONFIG, PROCESSING_CONFIG, DB_CONFIG } from '../config/constants';
import { HeliusTransaction } from '@/types/helius-api';
import * as path from 'path';
import * as fs from 'fs';
import pLimit from 'p-limit';

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
 * - TIME-FILTERED MODE: When --before-time, --after-time, or --end-time is specified
 *   Uses ONLY Enhanced API for precise time-filtered analysis
 * - LEGACY MODE: When no time filters specified
 *   Uses Step 1 (first buyers) + Step 1.5 (pre-filtering)
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
  topTradersPerToken: number;
  sortBy: 'pnl' | 'investment';
  beforeTime?: number;
  afterTime?: number;
  endTime?: number;
  transactionType: string;
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
  let topTradersPerToken = 20;
  let sortBy: 'pnl' | 'investment' = 'pnl';
  let beforeTime: number | undefined;
  let afterTime: number | undefined;
  let endTime: number | undefined;
  let transactionType = 'SWAP';

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
      transactionType = arg.split('=')[1];
    }
  }

  return { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, topTradersPerToken, sortBy, beforeTime, afterTime, endTime, transactionType };
}

async function main(): Promise<void> {
  try {
    const { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, topTradersPerToken, sortBy, beforeTime, afterTime, endTime, transactionType } = parseArgs(process.argv);

    if (!process.env.HELIUS_API_KEY) {
      console.error('❌ HELIUS_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info(`Starting significant buyers analysis for ${mints.length} token(s): ${mints.join(', ')}`);
    logger.info(`Parameters: minSol=${minSol}, maxTx=${maxTx}, addressType=${addressType}, maxSignatures=${maxSignatures}, topTradersPerToken=${topTradersPerToken}, sortBy=${sortBy}`);
    logger.info(`Time filters: beforeTime=${beforeTime}, afterTime=${afterTime}, endTime=${endTime}, transactionType=${transactionType}`);
    if (bondingCurve) {
      logger.info(`Bonding curve address: ${bondingCurve}`);
    }

    // Initialize services
    const databaseService = new DatabaseService();
    const heliusClient = new HeliusApiClient({
      apiKey: process.env.HELIUS_API_KEY,
      network: 'mainnet',
      requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS // Use established config (40 RPS)
    }, databaseService);

    const tokenBuyersService = new TokenFirstBuyersService(heliusClient, databaseService);

    const startTime = Date.now();
    const allResults: WalletAnalysisResult[] = [];
    const allAnalysisInputs: any[] = []; // Collect all analysis inputs for batch saving

    // Process each mint
    for (const mint of mints) {
      logger.info(`\n🔄 Processing token: ${mint}`);

      // Determine approach based on whether time filters are specified
      const hasTimeFilters = beforeTime || afterTime || endTime;
      let walletsToAnalyze: any[] = [];
      let preFilteredWallets: string[] | null = null;

      if (hasTimeFilters) {
        // TIME-FILTERED MODE: Use ONLY Enhanced API (Step 1.5) - more efficient and precise
        logger.info(`⏰ TIME-FILTERED MODE: Using Enhanced API only (skipping Step 1)`);
        logger.info(`🚀 Step 1.5: Fetching and analyzing mint transactions with time filters...`);

        try {
          // Build time filter options
          const timeFilterOptions: any = {
            type: transactionType
          };

          if (beforeTime) timeFilterOptions.ltTime = beforeTime;
          if (afterTime) timeFilterOptions.gteTime = afterTime;
          if (endTime) timeFilterOptions.ltTime = endTime; // Look backwards from end time

          // Fetch all transactions for this mint with time filters
          const mintTransactions = await heliusClient.getAllTransactionsForMint(
            mint,
            maxSignatures,
            timeFilterOptions
          );

          logger.info(`✅ Fetched ${mintTransactions.length} transactions for mint ${mint}`);

          // Extract ALL wallets from transactions (not just buyers)
          const walletSet = new Set<string>();
          const walletSolSpent = new Map<string, number>();

          for (const tx of mintTransactions) {
            // Extract all wallet addresses from this transaction
            const addresses: string[] = [];

            // From swap events
            if (tx.events?.swap) {
              const swap = tx.events.swap;
              if (swap.nativeInput?.account) addresses.push(swap.nativeInput.account);
              if (swap.nativeOutput?.account) addresses.push(swap.nativeOutput.account);
              if (swap.tokenInputs?.[0]?.userAccount) addresses.push(swap.tokenInputs[0].userAccount);
              if (swap.tokenOutputs?.[0]?.userAccount) addresses.push(swap.tokenOutputs[0].userAccount);
            }

            // From token transfers (for TRANSFER type)
            if (tx.tokenTransfers) {
              tx.tokenTransfers.forEach(transfer => {
                if (transfer.fromUserAccount) addresses.push(transfer.fromUserAccount);
                if (transfer.toUserAccount) addresses.push(transfer.toUserAccount);
              });
            }

            // Add all unique addresses
            addresses.forEach(addr => {
              if (addr && addr !== mint) { // Exclude mint address itself
                walletSet.add(addr);
              }
            });

            // Track SOL spent for pre-filtering
            if (tx.events?.swap?.nativeInput) {
              const wallet = tx.events.swap.nativeInput.account;
              const solSpent = parseInt(tx.events.swap.nativeInput.amount) / 1e9;
              if (wallet && solSpent > 0) {
                walletSolSpent.set(wallet, (walletSolSpent.get(wallet) || 0) + solSpent);
              }
            }
          }

          // TIME-FILTERED MODE: Hybrid approach
          // Use Enhanced API to get time-filtered transactions, extract wallets, then analyze them individually
          // This gives us time filtering while still getting proper SOL amounts

          logger.info(`📊 TIME-FILTERED MODE: Hybrid approach - ${mintTransactions.length} time-filtered transactions found`);

          // Extract unique wallets from time-filtered transactions
          const timeFilteredWallets = new Set<string>();

          for (const tx of mintTransactions) {
            // From swap events (if any)
            if (tx.events?.swap) {
              const swap = tx.events.swap;
              if (swap.nativeInput?.account) timeFilteredWallets.add(swap.nativeInput.account);
              if (swap.nativeOutput?.account) timeFilteredWallets.add(swap.nativeOutput.account);
              if (swap.tokenInputs?.[0]?.userAccount) timeFilteredWallets.add(swap.tokenInputs[0].userAccount);
              if (swap.tokenOutputs?.[0]?.userAccount) timeFilteredWallets.add(swap.tokenOutputs[0].userAccount);
            }

            // From token transfers
            if (tx.tokenTransfers) {
              tx.tokenTransfers.forEach(transfer => {
                if (transfer.fromUserAccount) timeFilteredWallets.add(transfer.fromUserAccount);
                if (transfer.toUserAccount) timeFilteredWallets.add(transfer.toUserAccount);
              });
            }
          }

          logger.info(`📊 TIME-FILTERED MODE: Found ${timeFilteredWallets.size} unique wallets in time-filtered transactions`);

          if (timeFilteredWallets.size === 0) {
            logger.info(`⚠️ No wallets found in time-filtered transactions. This could mean:`);
            logger.info(`   - No transactions in the specified time range`);
            logger.info(`   - Enhanced API doesn't parse swap events for this token`);
            logger.info(`   - Try using LEGACY MODE (without time filters) to compare`);

            // Skip to next mint
            continue;
          }

          // Convert to array for analysis
          walletsToAnalyze = Array.from(timeFilteredWallets).map(walletAddress => ({
            walletAddress,
            firstBuyTimestamp: Date.now() / 1000, // Will be updated during analysis
            firstBuySignature: 'time-filtered',
            tokenAmount: 0
          }));

          globalTelemetry.wallets.totalReviewed += walletsToAnalyze.length;

          logger.info(`📊 TIME-FILTERED MODE: Analyzing ${walletsToAnalyze.length} wallets with time constraint: before ${new Date(beforeTime! * 1000).toISOString()}`);

        } catch (error) {
          logger.error(`❌ Enhanced API approach failed:`, error);
          throw new Error(`Time-filtered mode requires working Enhanced API. Error: ${error}`);
        }

      } else {
        // LEGACY MODE: Use Step 1 + Step 1.5 (backward compatibility)
        logger.info(`📊 Step 1: Fetching wallets who interacted with ${mint}...`);
        const allBuyers = await tokenBuyersService.getFirstBuyers(mint, {
          maxBuyers: Math.max(5000, topTradersPerToken * 10),
          maxSignatures,
          batchSize: 100,
          addressType,
          bondingCurveAddress: bondingCurve
        });

        logger.info(`Found ${allBuyers.length} unique wallets who interacted with ${mint}`);
        globalTelemetry.wallets.totalReviewed += allBuyers.length;

        if (allBuyers.length === 0) {
          logger.warn(`No wallets found for ${mint}. Skipping.`);
          continue;
        }

        // Step 1.5: PRE-FILTER wallets by fetching mint transactions (EFFICIENT!)
        logger.info(`🚀 Step 1.5: Pre-filtering wallets by SOL amount using Enhanced API...`);

        try {
          // Build time filter options (default to SWAP for legacy mode)
          const timeFilterOptions: any = {
            type: transactionType || 'SWAP'
          };

          const mintTransactions = await heliusClient.getAllTransactionsForMint(
            mint,
            maxSignatures,
            timeFilterOptions
          );

          logger.info(`✅ Fetched ${mintTransactions.length} swap transactions for mint ${mint}`);

          // Aggregate SOL spent per wallet from mint transactions using the mapper
          const walletSolSpent = new Map<string, number>();
          const walletTransactionCount = new Map<string, number>();
          let totalTransactionsProcessed = 0;

          logger.info(`🔍 DEBUG: Analyzing ${mintTransactions.length} transactions for SOL investment using mapper...`);

          // Debug: Log first few transactions to see their structure
          if (mintTransactions.length > 0) {
            logger.info(`📋 Sample transaction structure:`);
            const sampleTx = mintTransactions[0];
            logger.info(`  - Signature: ${sampleTx.signature}`);
            logger.info(`  - Timestamp: ${new Date(sampleTx.timestamp).toISOString()}`);
            logger.info(`  - Events: ${Object.keys(sampleTx.events || {})}`);
            if (sampleTx.events?.swap) {
              logger.info(`  - Swap event: ${JSON.stringify(sampleTx.events.swap).substring(0, 200)}...`);
            }
            if (sampleTx.tokenTransfers) {
              logger.info(`  - Token transfers: ${sampleTx.tokenTransfers.length}`);
            }
          }

          // Group transactions by wallet address to use the mapper
          const transactionsByWallet = new Map<string, HeliusTransaction[]>();

          for (const tx of mintTransactions) {
            totalTransactionsProcessed++;

            // Extract all wallet addresses involved in this transaction
            const walletAddresses: string[] = [];

            // From swap events
            if (tx.events?.swap) {
              const swap = tx.events.swap;
              if (swap.nativeInput?.account) walletAddresses.push(swap.nativeInput.account);
              if (swap.nativeOutput?.account) walletAddresses.push(swap.nativeOutput.account);
              if (swap.tokenInputs?.[0]?.userAccount) walletAddresses.push(swap.tokenInputs[0].userAccount);
              if (swap.tokenOutputs?.[0]?.userAccount) walletAddresses.push(swap.tokenOutputs[0].userAccount);
            }

            // From token transfers
            if (tx.tokenTransfers) {
              tx.tokenTransfers.forEach(transfer => {
                if (transfer.fromUserAccount) walletAddresses.push(transfer.fromUserAccount);
                if (transfer.toUserAccount) walletAddresses.push(transfer.toUserAccount);
              });
            }

            // From native transfers
            if (tx.nativeTransfers) {
              tx.nativeTransfers.forEach(transfer => {
                walletAddresses.push(transfer.fromUserAccount);
                walletAddresses.push(transfer.toUserAccount);
              });
            }

            // Add transaction to each wallet's transaction list
            const uniqueWallets = [...new Set(walletAddresses.filter(addr => addr && addr !== mint))];
            uniqueWallets.forEach(wallet => {
              if (!transactionsByWallet.has(wallet)) {
                transactionsByWallet.set(wallet, []);
              }
              transactionsByWallet.get(wallet)!.push(tx);
            });
          }

          logger.info(`📊 Found ${transactionsByWallet.size} unique wallets across ${totalTransactionsProcessed} transactions`);

          // Now use the mapper to calculate SOL investment for each wallet
          for (const [walletAddress, walletTransactions] of transactionsByWallet) {
            try {
              // Use the mapper to get properly calculated SOL values
              const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
                walletAddress,
                walletTransactions
              );

              // Filter for transactions involving the target mint
              const relevantInputs = analysisInputs.filter(input => input.mint === mint);

              if (relevantInputs.length === 0) continue;

              // Calculate total SOL spent (outgoing transactions for this mint)
              const solSpent = relevantInputs
                .filter(input => input.direction === 'out')
                .reduce((sum, input) => sum + input.associatedSolValue, 0);

              // Calculate total SOL received (incoming transactions for this mint)
              const solReceived = relevantInputs
                .filter(input => input.direction === 'in')
                .reduce((sum, input) => sum + input.associatedSolValue, 0);

              // Only count wallets that actually spent SOL (positive solSpent)
              if (solSpent > 0) {
                walletSolSpent.set(walletAddress, (walletSolSpent.get(walletAddress) || 0) + solSpent);
                walletTransactionCount.set(walletAddress, relevantInputs.length);

                if (walletSolSpent.size <= 5) { // Debug first few wallets
                  logger.debug(`Wallet ${walletAddress}: ${solSpent.toFixed(4)} SOL spent, ${solReceived.toFixed(4)} SOL received, ${relevantInputs.length} tx for mint ${mint}`);
                }
              }
            } catch (error) {
              logger.warn(`Failed to map transactions for wallet ${walletAddress}:`, error);
            }
          }

          logger.info(`📊 TELEMETRY: Transaction Analysis Complete (Using Mapper)`);
          logger.info(`   - Total transactions processed: ${totalTransactionsProcessed}`);
          logger.info(`   - Unique wallets found: ${transactionsByWallet.size}`);
          logger.info(`   - Wallets with SOL investment in target token: ${walletSolSpent.size}`);
          logger.info(`   - Total SOL invested across all wallets: ${Array.from(walletSolSpent.values()).reduce((sum, sol) => sum + sol, 0).toFixed(4)} SOL`);

          if (walletSolSpent.size > 0) {
            const sortedBySol = Array.from(walletSolSpent.entries()).sort((a, b) => b[1] - a[1]);
            logger.info(`   - Top 3 investors: ${sortedBySol.slice(0, 3).map(([wallet, sol]) => `${wallet.substring(0, 8)}...: ${sol.toFixed(4)} SOL`).join(', ')}`);
            logger.info(`   - Transaction counts: ${sortedBySol.slice(0, 3).map(([wallet]) => walletTransactionCount.get(wallet) || 0).join(', ')} tx`);
          }

          // Filter to only wallets that meet the minSol threshold
          preFilteredWallets = Array.from(walletSolSpent.entries())
            .filter(([_, solSpent]) => solSpent >= minSol)
            .map(([wallet]) => wallet);

          globalTelemetry.wallets.relevantFound += preFilteredWallets.length;
          logger.info(`✅ Pre-filtered to ${preFilteredWallets.length} wallets meeting ${minSol}+ SOL threshold`);
          logger.info(`   (Avoided fetching full histories for ${allBuyers.length - preFilteredWallets.length} wallets!)`);

        } catch (error) {
          logger.warn(`⚠️  Enhanced API pre-filtering failed, falling back to analyzing all wallets:`, error);
          preFilteredWallets = null;
        }

        // Filter allBuyers to only include pre-filtered wallets (if pre-filtering succeeded)
        walletsToAnalyze = preFilteredWallets
          ? allBuyers.filter(buyer => preFilteredWallets!.includes(buyer.walletAddress))
          : allBuyers;
      }

      logger.info(`📊 Step 2: Analyzing ${walletsToAnalyze.length} wallets for ${mint}...`);
      const results: WalletAnalysisResult[] = [];
      let processedCount = 0;

    // Function to process a single wallet
    const processWallet = async (buyer: any, solBalanceMap: Map<string, number>, tokenBalanceMap: Map<string, number>): Promise<{ result: WalletAnalysisResult; analysisInputs: any[] }> => {
      try {
        // Fetch transactions for this wallet and mint (don't save yet)
        const analysisInputs = await fetchWalletTransactions(
          heliusClient,
          buyer.walletAddress,
          mint,
          maxSignatures
        );

        // Use the fetched analysis inputs directly
        const swapRecords = analysisInputs;

        if (!swapRecords || swapRecords.length === 0) {
          logger.debug(`No swap records found for wallet ${buyer.walletAddress} on token ${mint}`);
          return {
            result: {
              mint,
              walletAddress: buyer.walletAddress,
              totalSolSpent: 0,
              totalSolReceived: 0,
              netPnl: 0,
              transactionCount: 0,
              firstBuyTimestamp: buyer.firstBuyTimestamp,
              currentTokenBalance: 0,
              currentSolBalance: 0,
              realizedPnl: 0,
              unrealizedPnl: 0,
              analysisSuccess: false,
              errorMessage: 'No swap records found'
            },
            analysisInputs: []
          };
        }

        // Calculate metrics (with time filtering if in TIME-FILTERED MODE)
        let totalSolSpent = 0;
        let totalSolReceived = 0;
        let transactionCount = 0;

        for (const swap of swapRecords) {
          // Apply time filter if specified (for TIME-FILTERED MODE)
          if (hasTimeFilters && swap.timestamp) {
            const swapTime = swap.timestamp;
            if (beforeTime && swapTime >= beforeTime) continue;
            if (afterTime && swapTime < afterTime) continue;
            if (endTime && swapTime >= endTime) continue; // endTime sets beforeTime
          }

          transactionCount++;

          if (swap.direction === 'in') {
            // Buying token (spending SOL)
            totalSolSpent += Math.abs(swap.associatedSolValue || 0);
          } else if (swap.direction === 'out') {
            // Selling token (receiving SOL)
            totalSolReceived += Math.abs(swap.associatedSolValue || 0);
          }
        }

        // Filter: must have spent 50+ SOL and fewer than maxTx transactions
        if (totalSolSpent < minSol) {
          logger.debug(`Wallet ${buyer.walletAddress} spent only ${totalSolSpent.toFixed(2)} SOL (< ${minSol}), skipping`);
          return {
            result: {
              mint,
              walletAddress: buyer.walletAddress,
              totalSolSpent: 0,
              totalSolReceived: 0,
              netPnl: 0,
              transactionCount: 0,
              firstBuyTimestamp: buyer.firstBuyTimestamp,
              currentTokenBalance: 0,
              currentSolBalance: 0,
              realizedPnl: 0,
              unrealizedPnl: 0,
              analysisSuccess: false,
              errorMessage: `Spent only ${totalSolSpent.toFixed(2)} SOL (< ${minSol})`
            },
            analysisInputs: []
          };
        }

        if (transactionCount >= maxTx) {
          logger.debug(`Wallet ${buyer.walletAddress} has ${transactionCount} transactions (>= ${maxTx}), skipping (possible bot)`);
          return {
            result: {
              mint,
              walletAddress: buyer.walletAddress,
              totalSolSpent: 0,
              totalSolReceived: 0,
              netPnl: 0,
              transactionCount: 0,
              firstBuyTimestamp: buyer.firstBuyTimestamp,
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

        const netPnl = totalSolReceived - totalSolSpent;

        // Get current balances from pre-fetched maps
        const currentSolBalance = solBalanceMap.get(buyer.walletAddress) || 0;
        const currentTokenBalance = tokenBalanceMap.get(buyer.walletAddress) || 0;

        // Calculate realized and unrealized PnL
        const realizedPnl = netPnl;
        const unrealizedPnl = 0; // Would need current token price to calculate accurately

        logger.info(`✅ Wallet ${buyer.walletAddress}: ${totalSolSpent.toFixed(2)} SOL spent, ${transactionCount} tx, PnL: ${netPnl.toFixed(2)} SOL`);

        return {
          result: {
            mint,
            walletAddress: buyer.walletAddress,
            totalSolSpent,
            totalSolReceived,
            netPnl,
            transactionCount,
            firstBuyTimestamp: buyer.firstBuyTimestamp,
            currentTokenBalance,
            currentSolBalance,
            realizedPnl,
            unrealizedPnl,
            analysisSuccess: true
          },
          analysisInputs
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
            firstBuyTimestamp: buyer.firstBuyTimestamp,
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

    // Pre-fetch all balances to avoid individual API calls
    logger.info('Pre-fetching balances for filtered wallets...');
    const walletAddresses = walletsToAnalyze.map(b => b.walletAddress);

    // Pre-fetch SOL balances in batches (using established config batch size)
    const solBalanceMap = new Map<string, number>();
    for (let i = 0; i < walletAddresses.length; i += HELIUS_CONFIG.BATCH_SIZE) {
      const batch = walletAddresses.slice(i, i + 100);
      try {
        const accountInfo = await heliusClient.getMultipleAccounts(batch, 'finalized', 'base64');
        if (accountInfo.value) {
          accountInfo.value.forEach((acc, index) => {
            const address = batch[index];
            const balance = acc ? (acc.lamports || 0) / 1e9 : 0;
            solBalanceMap.set(address, balance);
          });
        }
      } catch (error) {
        logger.warn(`Failed to fetch SOL balances for batch ${i}-${i+100}:`, error);
      }
    }

    // Pre-fetch token balances in batches
    const tokenBalanceMap = new Map<string, number>();
    for (let i = 0; i < walletAddresses.length; i += HELIUS_CONFIG.BATCH_SIZE) { // Use established batch size
      const batch = walletAddresses.slice(i, i + HELIUS_CONFIG.BATCH_SIZE);
      const tokenPromises = batch.map(async (address) => {
        try {
          const tokenAccounts = await heliusClient.getTokenAccountsByOwner(
            address,
            mint,
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'finalized',
            'jsonParsed'
          );

          let totalBalance = 0;
          if (tokenAccounts.value && tokenAccounts.value.length > 0) {
            for (const acc of tokenAccounts.value) {
              const parsed = (acc as any).account?.data?.parsed?.info;
              if (parsed?.tokenAmount?.uiAmount) {
                totalBalance += parsed.tokenAmount.uiAmount;
              }
            }
          }
          return { address, balance: totalBalance };
        } catch (error) {
          logger.warn(`Failed to fetch token balance for ${address}:`, error);
          return { address, balance: 0 };
        }
      });

      const tokenResults = await Promise.all(tokenPromises);
      tokenResults.forEach(({ address, balance }) => {
        tokenBalanceMap.set(address, balance);
      });
    }

    logger.info(`✅ Pre-fetched balances for ${walletAddresses.length} wallets`);

    // ANSI progress counter - always visible
    const updateProgress = () => {
      process.stdout.write(`${ESC}2K\rProgress: ${processedCount}/${walletsToAnalyze.length} wallets analyzed (${results.length} match criteria so far)`);
    };

    // Process wallets in parallel with concurrency limit
    const concurrencyLimit = pLimit(PROCESSING_CONFIG.WALLET_SYNC_CONCURRENCY); // Use established config (5 concurrent wallets)
    const analysisPromises = walletsToAnalyze.map((buyer, index) =>
      concurrencyLimit(async () => {
        const walletResult = await processWallet(buyer, solBalanceMap, tokenBalanceMap);
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
        globalTelemetry.wallets.analyzedSuccessfully++;
      } else {
        globalTelemetry.wallets.failedAnalysis++;
      }
      // Collect all analysis inputs for batch saving
      allAnalysisInputs.push(...walletResult.analysisInputs);
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

      // Take only top N traders for this token
      const topResults = results.slice(0, topTradersPerToken);
      allResults.push(...topResults);

      logger.info(`✅ Completed analysis for ${mint}: ${topResults.length} top traders found (${tokenDuration.toFixed(2)}s)`);

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
      `**Criteria:** Min ${minSol} SOL spent, Max ${maxTx} transactions, Top ${topTradersPerToken} per token, Sorted by ${sortBy}  `,
      `${bondingCurve ? `**Bonding Curve:** \`${bondingCurve}\`  ` : ''}`,
      ``,
      `## Summary`,
      ``,
      `- **Tokens Processed:** ${uniqueTokens}`,
      `- **Total Traders Found:** ${allResults.length}`,
      `- **Successful Analyses:** ${successfulAnalyses}`,
      `- **Total SOL Invested:** ${totalSolInvested.toFixed(2)} SOL`,
      `- **Average PnL:** ${averagePnl.toFixed(4)} SOL`,
      `- **Winners:** ${winnersCount} (${((winnersCount / allResults.length) * 100).toFixed(1)}%)`,
      `- **Losers:** ${losersCount} (${((losersCount / allResults.length) * 100).toFixed(1)}%)`,
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
    console.log(`Criteria: Min ${minSol} SOL spent, Max ${maxTx} transactions, Top ${topTradersPerToken} per token, Sorted by ${sortBy}`);
    console.log(`Total Traders Found: ${allResults.length}`);
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
      console.log('\n📊 MODES:');
      console.log('  TIME-FILTERED: When using --before-time/--after-time/--end-time → Uses ONLY Enhanced API');
      console.log('  LEGACY: No time filters → Uses Step 1 (first buyers) + Step 1.5 (pre-filtering)');
      console.log('\nOptions:');
      console.log('  --min-sol=N          Minimum SOL spent (default: 50)');
      console.log('  --max-tx=N           Maximum transaction count (default: 5)');
      console.log('  --address-type=TYPE  Address type: bonding-curve|mint|auto (default: auto)');
      console.log('  --bonding-curve=ADDR Bonding curve address (for pump.fun tokens)');
      console.log('  --max-signatures=N   Maximum signatures to process (default: 5000)');
      console.log('  --top-traders=N      Number of top traders to return per token (default: 20)');
      console.log('  --sort-by=CRITERIA   Sort by: pnl|investment (default: pnl)');
      console.log('  --before-time=N      Unix timestamp - transactions before this time (TIME-FILTERED mode)');
      console.log('  --after-time=N       Unix timestamp - transactions after this time (TIME-FILTERED mode)');
      console.log('  --end-time=N         Unix timestamp - look backwards from this time (TIME-FILTERED mode)');
      console.log('  --transaction-type=T Transaction type: SWAP|TRANSFER|etc (default: SWAP)');
      console.log('\nExamples:');
      console.log('Legacy mode: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts TOKEN --min-sol=50 --max-tx=5');
      console.log('Time-filtered: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts TOKEN --end-time=1704067200 --transaction-type=TRANSFER');
      console.log('Multiple tokens: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts "TOKEN1,TOKEN2" --min-sol=2 --top-traders=30');
    }
    
    process.exit(1);
  }
}

/**
 * Fetches and saves transactions for a specific wallet and mint using the Helius method.
 * This is adapted from TokenFirstBuyersService.
 */
async function fetchWalletTransactions(
  heliusClient: HeliusApiClient,
  walletAddress: string,
  mintAddress: string,
  maxSignaturesPerWallet: number = 1000
): Promise<any[]> {
  try {
    logger.debug(`🔄 Fetching transactions for wallet ${walletAddress} and mint ${mintAddress}`);

    // Fetch all transactions for this wallet
    const transactions = await heliusClient.getAllTransactionsForAddress(
      walletAddress,
      100, // batch size
      maxSignaturesPerWallet, // max signatures - configurable limit
      undefined,
      undefined,
      undefined,
      5 // internal concurrency
    );

    if (!transactions || transactions.length === 0) {
      logger.debug(`No transactions found for wallet ${walletAddress}`);
      return [];
    }

    // Filter for transactions involving this specific mint
    const relevantTransactions = transactions.filter(tx => 
      tx.tokenTransfers?.some(transfer => transfer.mint === mintAddress)
    );

    logger.debug(`Found ${relevantTransactions.length} relevant transactions for wallet ${walletAddress} on mint ${mintAddress}`);

    if (relevantTransactions.length === 0) {
      return [];
    }

    // Map transactions to swap analysis inputs
    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
      walletAddress,
      relevantTransactions
    );

    // Filter analysis inputs for this specific mint
    const mintAnalysisInputs = analysisInputs.filter(record => record.mint === mintAddress);

    if (mintAnalysisInputs.length === 0) {
      logger.debug(`No swap analysis inputs found for mint ${mintAddress} in wallet ${walletAddress}`);
      return [];
    }

    logger.debug(`✅ Fetched ${mintAnalysisInputs.length} swap analysis inputs for wallet ${walletAddress} on mint ${mintAddress}`);

    return mintAnalysisInputs;

  } catch (error) {
    logger.error(`Error fetching transactions for wallet ${walletAddress}:`, error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

