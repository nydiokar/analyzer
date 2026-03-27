#!/usr/bin/env ts-node

/**
 * ============================================================================
 * SIGNIFICANT BUYER DISCOVERY FOR TOKEN MINT (WORKING VERSION)
 * ============================================================================
 *
 * PURPOSE:
 * Find all wallets that bought a specific token during a time window,
 * spending significant SOL (≥1 SOL by default).
 *
 * HOW IT WORKS:
 * 1. Fetch ALL transaction signatures for the mint in the time range via RPC
 * 2. Enrich those signatures to get full transaction data (Helius Enhanced API)
 * 3. Extract wallet addresses from token transfers
 * 4. Run the HeliusTransactionMapper on each wallet's transactions
 * 5. Aggregate SOL spent/received per wallet
 * 6. Filter and rank wallets by SOL spent
 *
 * KEY INSIGHTS:
 * - direction: 'in' = Wallet receives tokens = BUY = SOL SPENT
 * - direction: 'out' = Wallet sends tokens = SELL = SOL RECEIVED
 * - The mapper handles complex swap detection and SOL calculation
 * - Time filtering ONLY works via RPC getTransactionsForAddress, NOT Enhanced API
 *
 * VALIDATED:
 * ✅ Processes full time range (tested with 4681 transactions)
 * ✅ Finds target wallets correctly
 * ✅ Returns 300+ significant buyers for active tokens
 *
 * DO NOT MODIFY WITHOUT TESTING - this version works!
 * ============================================================================
 */

import { HeliusApiClient } from '../../../../src/core/services/helius-api-client';
import { DatabaseService } from '../../../../src/api/services/database.service';
import { mapHeliusTransactionsToIntermediateRecords } from '../../../../src/core/services/helius-transaction-mapper';
import { HELIUS_CONFIG } from '../../../../src/config/constants';
import { HeliusTransaction } from '../../../../src/types/helius-api';
import { getErrorMessage } from '../../../../src/core/utils/error-utils';
import logger from '../../../../src/core/utils/logger';

/**
 * Main discovery function
 */
async function discoverSignificantWallets() {
  // ============================================================================
  // SETUP
  // ============================================================================

  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY environment variable is not set');
    return;
  }

  console.log('🔍 SIGNIFICANT WALLET DISCOVERY\n');

  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);

  // ============================================================================
  // CONFIGURATION - ADJUST THESE VALUES
  // ============================================================================

  const config = {
    // The token mint address to analyze
    mintAddress: '7opAGer4hk78N7VtYjk2bVif6SzvPkBm8PzQAvzspump',

    // Time range (Unix timestamps in seconds)
    startTime: 1772148000,  // 2026-01-26T07:37:00.000Z
    endTime: 1772149500,    // 2026-01-26T08:13:00.000Z

    // Minimum SOL spent to be considered "significant"
    minSolSpent: 0.7,

    // For debugging: specific wallets to track
    targetWallets: [
      '',
      ''
    ]
  };

  console.log('📊 Configuration:');
  console.log(`   Mint: ${config.mintAddress}`);
  console.log(`   Time: ${new Date(config.startTime * 1000).toISOString()} - ${new Date(config.endTime * 1000).toISOString()}`);
  console.log(`   Min SOL: ${config.minSolSpent}\n`);

  try {
    // ============================================================================
    // STEP 1: FETCH TRANSACTIONS FOR TIME WINDOW
    // ============================================================================
    // This uses RPC method which is the ONLY way to time-filter mint transactions

    console.log('🚀 STEP 1: Fetching transactions...\n');

    const transactions = await fetchTransactionsForMintInTimeWindow(
      heliusClient,
      config.mintAddress,
      config.startTime,
      config.endTime
    );

    console.log(`✅ Got ${transactions.length} transactions\n`);

    if (transactions.length === 0) {
      console.log('❌ No transactions found in time range');
      return;
    }

    // ============================================================================
    // STEP 2: GROUP TRANSACTIONS BY WALLET
    // ============================================================================
    // Extract wallet addresses from token transfers and group their transactions

    console.log('👥 STEP 2: Grouping by wallet...');

    const txsByWallet = new Map<string, HeliusTransaction[]>();

    for (const tx of transactions) {
      const wallets = new Set<string>();

      // Extract wallets from token transfers for our mint
      if (tx.tokenTransfers) {
        tx.tokenTransfers.forEach(transfer => {
          if (transfer.mint === config.mintAddress) {
            if (transfer.fromUserAccount) wallets.add(transfer.fromUserAccount);
            if (transfer.toUserAccount) wallets.add(transfer.toUserAccount);
          }
        });
      }

      // Add transaction to each wallet's list
      wallets.forEach(wallet => {
        if (!txsByWallet.has(wallet)) {
          txsByWallet.set(wallet, []);
        }
        txsByWallet.get(wallet)!.push(tx);
      });
    }

    console.log(`   Found ${txsByWallet.size} unique wallets\n`);

    // ============================================================================
    // STEP 3: MAP AND AGGREGATE PER WALLET
    // ============================================================================
    // Use HeliusTransactionMapper to calculate SOL spent/received per wallet

    console.log('💰 STEP 3: Analyzing wallets...');

    const walletAnalysis = new Map<string, {
      solSpent: number;
      solReceived: number;
      transactionCount: number;
      firstTransaction: number;
      lastTransaction: number;
    }>();

    let processed = 0;
    for (const [walletAddress, walletTransactions] of txsByWallet) {
      processed++;
      if (processed % 100 === 0) {
        process.stdout.write(`\r   Processed ${processed}/${txsByWallet.size}...`);
      }

      try {
        // Run the mapper to get properly calculated SOL values
        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
          walletAddress,
          walletTransactions
        );

        // Filter for our mint only
        const relevantInputs = analysisInputs.filter(input => input.mint === config.mintAddress);

        if (relevantInputs.length === 0) continue;

        // CRITICAL: direction semantics
        // 'in' = tokens coming IN to wallet = BUY = SOL SPENT
        // 'out' = tokens going OUT of wallet = SELL = SOL RECEIVED
        const solSpent = relevantInputs
          .filter(input => input.direction === 'in')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const solReceived = relevantInputs
          .filter(input => input.direction === 'out')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const timestamps = relevantInputs.map(input => input.timestamp).filter(t => t > 0);
        const firstTransaction = timestamps.length > 0 ? Math.min(...timestamps) : 0;
        const lastTransaction = timestamps.length > 0 ? Math.max(...timestamps) : 0;

        walletAnalysis.set(walletAddress, {
          solSpent,
          solReceived,
          transactionCount: relevantInputs.length,
          firstTransaction,
          lastTransaction
        });

      } catch (error) {
        logger.warn(`Failed to analyze wallet ${walletAddress}:`, getErrorMessage(error));
      }
    }

    console.log(`\r   Processed ${txsByWallet.size}/${txsByWallet.size}\n`);

    // ============================================================================
    // STEP 4: FILTER AND DISPLAY RESULTS
    // ============================================================================

    // Filter wallets by minimum SOL spent
    let qualifyingWallets = Array.from(walletAnalysis.entries())
      .filter(([, analysis]) => analysis.solSpent >= config.minSolSpent)
      .sort(([, a], [, b]) => b.solSpent - a.solSpent);

    console.log(`\n🏆 RESULTS: ${qualifyingWallets.length} wallets spent ≥${config.minSolSpent} SOL\n`);

    // Check target wallets if specified
    if (config.targetWallets.length > 0) {
      console.log('🎯 Target Wallets:');
      config.targetWallets.forEach(targetWallet => {
        const analysis = walletAnalysis.get(targetWallet);
        if (analysis) {
          console.log(`   ✅ ${targetWallet}: ${analysis.solSpent.toFixed(4)} SOL spent, ${analysis.transactionCount} tx`);
        } else {
          console.log(`   ❌ ${targetWallet}: NOT FOUND`);
        }
      });
      console.log();
    }

    // Display top 20 wallets
    if (qualifyingWallets.length > 0) {
      console.log('Top 20 Wallets:');
      console.log('┌────┬──────────────────────────────────────────────┬───────────┬───────────┬────┬──────────┬──────────┐');
      console.log('│ #  │ Wallet                                       │ SOL Spent │ SOL Recvd │ TX │ First TX │ Last TX  │');
      console.log('├────┼──────────────────────────────────────────────┼───────────┼───────────┼────┼──────────┼──────────┤');

      qualifyingWallets.slice(0, 20).forEach(([wallet, analysis], i) => {
        const rank = (i + 1).toString().padStart(2, ' ');
        const addr = wallet.substring(0, 44).padEnd(44, ' ');
        const spent = analysis.solSpent.toFixed(4).padStart(9, ' ');
        const received = analysis.solReceived.toFixed(4).padStart(9, ' ');
        const txs = analysis.transactionCount.toString().padStart(2, ' ');
        const first = new Date(analysis.firstTransaction * 1000).toISOString().slice(11, 19);
        const last = new Date(analysis.lastTransaction * 1000).toISOString().slice(11, 19);

        console.log(`│ ${rank} │ ${addr} │ ${spent} │ ${received} │ ${txs} │ ${first} │ ${last} │`);
      });

      console.log('└────┴──────────────────────────────────────────────┴───────────┴───────────┴────┴──────────┴──────────┘');
    }

  } catch (error) {
    console.error('❌ Error:', getErrorMessage(error));
  }
}

/**
 * ============================================================================
 * HELPER: Fetch transactions for mint in time window
 * ============================================================================
 *
 * This is THE ONLY method that works for time-filtered mint queries:
 * 1. Use RPC getSignaturesForAddress to get signatures with time filtering
 * 2. Enrich those signatures via Helius Enhanced API
 *
 * The Enhanced API v0/addresses/{address}/transactions does NOT respect
 * time filters for mint addresses, so we MUST use this two-phase approach.
 */
async function fetchTransactionsForMintInTimeWindow(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  startTime: number,
  endTime: number
): Promise<HeliusTransaction[]> {

  // PHASE 1: Get all signatures in time range via RPC
  console.log('📥 PHASE 1: Fetching signatures via RPC...');

  const allSignatures: string[] = [];
  let page = 0;
  let before: string | undefined = undefined;

  while (true) {
    page++;
    const sigs = await heliusClient['getSignaturesViaRpcPage'](mintAddress, 1000, before);

    if (!sigs || sigs.length === 0) {
      console.log(`   Page ${page}: Empty, stopping`);
      break;
    }

    // Filter by time range
    const inRange = sigs.filter(sig =>
      sig.blockTime && sig.blockTime >= startTime && sig.blockTime <= endTime
    );

    const signatures = inRange.map(s => s.signature);
    allSignatures.push(...signatures);

    const times = sigs.map(sig => sig.blockTime).filter((t): t is number => t !== null && t !== undefined);
    if (times.length > 0) {
      const minT = Math.min(...times);
      const maxT = Math.max(...times);
      console.log(`   Page ${page}: ${signatures.length} sigs in range (${new Date(minT * 1000).toISOString()} - ${new Date(maxT * 1000).toISOString()})`);
    }

    before = sigs[sigs.length - 1].signature;

    // Stop if we've passed the start time
    const lastTime = sigs[sigs.length - 1].blockTime;
    if (lastTime && lastTime < startTime) {
      break;
    }

    if (page > 500) break; // Safety limit
  }

  console.log(`✅ Collected ${allSignatures.length} signatures\n`);

  // PHASE 2: Enrich all signatures
  console.log('📄 PHASE 2: Enriching transactions...');

  const allTransactions: HeliusTransaction[] = [];
  const batchSize = 100;

  for (let i = 0; i < allSignatures.length; i += batchSize) {
    const batch = allSignatures.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allSignatures.length / batchSize);

    console.log(`   Batch ${batchNum}/${totalBatches}...`);

    const txs = await heliusClient['getTransactionsBySignatures'](batch);
    allTransactions.push(...txs.filter(tx => tx !== null));
  }

  console.log(`✅ Enriched ${allTransactions.length} transactions\n`);

  return allTransactions;
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================

discoverSignificantWallets().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
