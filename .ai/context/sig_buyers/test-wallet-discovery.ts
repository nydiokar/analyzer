#!/usr/bin/env ts-node

import { HeliusApiClient } from '../../../src/core/services/helius-api-client';
import { DatabaseService } from '../../../src/api/services/database.service';
import { mapHeliusTransactionsToIntermediateRecords } from '../../../src/core/services/helius-transaction-mapper';
import { HELIUS_CONFIG } from '../../../src/config/constants';
import { HeliusTransaction } from '../../../src/types/helius-api';
import { getErrorMessage, getErrorDetails } from '../../../src/core/utils/error-utils';
import logger from '../../../src/core/utils/logger';
import * as path from 'path';
import * as fs from 'fs';



/**
 * WORKING VERSION: Time-based wallet discovery using RPC approach
 * This actually finds wallets - don't break it by trying to "clean it up"
 */

// Global telemetry counters
const globalTelemetry = {
  apiCalls: {
    getSignaturesViaRpcPage: 0,
    getTransactionsBySignatures: 0,
    getAllTransactionsForMint: 0,
  },
  transactions: {
    totalFetched: 0,
    swapTransactions: 0,
    transferTransactions: 0,
  },
  wallets: {
    totalUnique: 0,
    significantFound: 0,
  }
};

async function discoverSignificantWallets() {
  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY environment variable is not set');
    console.log('Please set it with: $env:HELIUS_API_KEY = "your-api-key-here"');
    return;
  }

  console.log('🔍 Discovering significant wallets using DATABASE-FIRST approach...\n');

  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);

  // Configuration
  const config = {
    mintAddress: '7opAGer4hk78N7VtYjk2bVif6SzvPkBm8PzQAvzspump',
    minSolSpent: 0.7,
    minUsdcSpent: 70,
    maxTransactions: 5000,
    startTime: 1772149020,     // 2026-02-26T23:20:00.000Z
    endTime: 1772149140,       // 2026-02-26T23:45:00.000Z
    minWallets: 1
  };

  // Extract variables for easier use
  const startTime = config.startTime;
  const endTime = config.endTime;

  console.log('📊 Configuration:');
  console.log(`   Token: ${config.mintAddress}`);
  console.log(`   Min SOL spent: ${config.minSolSpent}`);
  console.log(`   Min USDC spent: ${config.minUsdcSpent}`);
  console.log(`   Max transactions: ${config.maxTransactions}`);
  console.log(`   Min wallets to find: ${config.minWallets}\n`);

  console.log(`⏰ Time range: ${new Date(startTime * 1000).toISOString()} - ${new Date(endTime * 1000).toISOString()}`);
    console.log(`   Duration: ${((endTime - startTime) / 3600).toFixed(1)} hours\n`);

  try {

    // Target wallets for debugging
    const targetWallets = [
      '7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg',
      'G8JbnuUxgBFHUPQycaJHz3uCLTqjk71qSbcnts9T6CYq'
    ];

    // Declare walletAnalysis at the correct scope
    const walletAnalysis = new Map<string, {
      solSpent: number;
      usdcSpent: number;
      solReceived: number;
      usdcReceived: number;
      transactionCount: number;
      firstTransaction: number;
      lastTransaction: number;
    }>();

    console.log('🚀 FETCHING TRANSACTIONS from Helius API...\n');

    // USE THE SMART METHOD: Enhanced API with time filters
    const transactions = await fetchEnhancedTransactionsForMintWindow(
      heliusClient,
      config.mintAddress,
      ['SWAP', 'TRANSFER'],
      startTime,
      endTime,
      {
        useAnchorBatch: true,
        maxPages: 200,
        maxTransactions: 10000
      }
    );

    console.log(`✅ Fetched ${transactions.length} transactions using Enhanced API\n`);
    globalTelemetry.apiCalls.getAllTransactionsForMint = 1;
    globalTelemetry.transactions.totalFetched = transactions.length;

    if (transactions.length === 0) {
      console.log('❌ No transactions found for this time period');
      return;
    }

    // Show actual time range
    const timestamps = transactions.map(tx => tx.timestamp).filter(t => t);
    if (timestamps.length > 0) {
      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);
      console.log(`⏰ ACTUAL TIME RANGE of fetched transactions:`);
      console.log(`   Oldest:  ${new Date(minTime * 1000).toISOString()} (${minTime})`);
      console.log(`   Newest:  ${new Date(maxTime * 1000).toISOString()} (${maxTime})`);
      console.log(`   Target:  ${new Date(startTime * 1000).toISOString()} - ${new Date(endTime * 1000).toISOString()}`);
      console.log(`   Match:   ${minTime <= startTime && maxTime >= endTime ? '✅ COVERS TARGET' : '⚠️ PARTIAL COVERAGE'}\n`);
    }

    // DEBUG: Show transaction structure and check what Helius actually parsed
    console.log('🔍 DEBUG: Checking what Helius Enhanced API actually returned...');
    let totalWithSwapEvents = 0;
    let totalWithTokenTransfers = 0;
    let totalWithNativeTransfers = 0;
    let totalSolAmount = 0;

    transactions.slice(0, 10).forEach((tx, i) => {
      const hasSwap = !!tx.events?.swap;
      const hasTokenTransfers = !!tx.tokenTransfers;
      const hasNativeTransfers = !!tx.nativeTransfers;

      if (hasSwap) totalWithSwapEvents++;
      if (hasTokenTransfers) totalWithTokenTransfers++;
      if (hasNativeTransfers) totalWithNativeTransfers++;

      console.log(`   TX ${i+1}:`);
      console.log(`     - Events: ${Object.keys(tx.events || {}).join(', ') || 'NONE'}`);
      console.log(`     - Swap event: ${hasSwap}`);
      console.log(`     - Token transfers: ${hasTokenTransfers}`);
      console.log(`     - Native transfers: ${hasNativeTransfers}`);
      console.log(`     - Instructions: ${tx.instructions?.length || 0}`);
      console.log(`     - Program IDs: ${(tx.instructions || []).map(inst => inst.programId?.substring(0, 8)).join(', ') || 'NONE'}`);
      console.log(`     - Timestamp: ${new Date(tx.timestamp * 1000).toISOString().slice(11, 19)}`);
      console.log('');
    });

    console.log(`   📊 SUMMARY of 10 sample transactions:`);
    console.log(`     - With swap events: ${totalWithSwapEvents}`);
    console.log(`     - With token transfers: ${totalWithTokenTransfers}`);
    console.log(`     - With native transfers: ${totalWithNativeTransfers}`);
    console.log(`     - Total SOL in sample: ${totalSolAmount.toFixed(4)} SOL\n`);

    // Check if pump.fun transactions are actually parsed
    console.log('🔍 CHECKING: Are pump.fun transactions actually parsed by Helius?');
    const pumpFunTxs = transactions.filter(tx =>
      tx.instructions?.some(inst =>
        inst.programId === '6EF8rrecthR5Dkzon8NQtmHcWgCMAH1' || // pump.fun program
        inst.programId === 'TSLvdd1pWNpU8G5LRTK5TMbS8o9aQ1y'    // pump.fun program
      )
    );
    console.log(`   Found ${pumpFunTxs.length} transactions involving pump.fun program`);
    console.log(`   (Out of ${transactions.length} total transactions)\n`);

    // Group transactions by wallet
    console.log('🔄 Grouping transactions by wallet...');
    const transactionsByWallet = new Map<string, HeliusTransaction[]>();
    const addressTypes = new Map<string, 'wallet' | 'ata' | 'unknown'>();

    for (const tx of transactions) {
      const walletAddresses: string[] = [];

      // Extract wallets from swap events (this is how significantBuyersAnalysis.ts does it)
      if (tx.events?.swap) {
        const swap = tx.events.swap;
        if (swap.nativeInput?.account) walletAddresses.push(swap.nativeInput.account);
        if (swap.nativeOutput?.account) walletAddresses.push(swap.nativeOutput.account);
        if (swap.tokenInputs?.[0]?.userAccount) walletAddresses.push(swap.tokenInputs[0].userAccount);
        if (swap.tokenOutputs?.[0]?.userAccount) walletAddresses.push(swap.tokenOutputs[0].userAccount);
      }

      // Also extract from token transfers
      if (tx.tokenTransfers) {
        tx.tokenTransfers.forEach(transfer => {
          if (transfer.fromUserAccount) walletAddresses.push(transfer.fromUserAccount);
          if (transfer.toUserAccount) walletAddresses.push(transfer.toUserAccount);
        });
      }

        // Debug first few transactions
      if (transactions.indexOf(tx) < 3) {
        console.log(`   TX ${transactions.indexOf(tx)}: ${walletAddresses.length} wallets found, events: ${Object.keys(tx.events || {})}`);
        if (walletAddresses.length > 0) {
          console.log(`     Wallets: ${walletAddresses.slice(0, 3).map(w => w.substring(0, 8)).join(', ')}`);
        }
      }

      // Check if our target wallet appears in ANY transaction
      if (walletAddresses.includes('7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg')) {
        console.log(`🎯 FOUND GPsdQQDY... TARGET WALLET in TX ${transactions.indexOf(tx)}: ${tx.signature?.substring(0, 8)}... at ${new Date(tx.timestamp * 1000).toISOString().slice(11, 19)}`);
        console.log(`   Wallets in this TX: ${walletAddresses.join(', ')}`);
      }

      // Set address types for the wallets we found
      walletAddresses.forEach(addr => {
        addressTypes.set(addr, 'wallet');
      });

      // Add transaction to each wallet's list
      const uniqueWallets = [...new Set(walletAddresses.filter(addr => addr && addr !== config.mintAddress))];
      uniqueWallets.forEach(wallet => {
        if (!transactionsByWallet.has(wallet)) {
          transactionsByWallet.set(wallet, []);
        }
        transactionsByWallet.get(wallet)!.push(tx);
      });
    }

    console.log(`📊 Found ${transactionsByWallet.size} unique wallets across ${transactions.length} transactions`);
    console.log(`📋 Address types: ${Array.from(addressTypes.entries()).filter(([addr, type]) => type === 'wallet').length} wallets\n`);

    // Check target wallets
    targetWallets.forEach(targetWallet => {
      const hasTargetWallet = transactionsByWallet.has(targetWallet);
      const txCount = hasTargetWallet ? transactionsByWallet.get(targetWallet)!.length : 0;
      console.log(`🎯 Target wallet ${targetWallet.substring(0, 8)}...: ${hasTargetWallet ? `FOUND (${txCount} tx)` : 'NOT FOUND'} in this time window`);

      // Show transaction details for found wallets
      if (hasTargetWallet) {
        const walletTxs = transactionsByWallet.get(targetWallet)!;
        walletTxs.slice(0, 2).forEach((tx, i) => {
          if (tx.events?.swap) {
            const swap = tx.events.swap;
            const solSpent = swap.nativeInput?.amount ? Number(swap.nativeInput.amount) / 1e9 : 0;
            const solReceived = swap.nativeOutput?.amount ? Number(swap.nativeOutput.amount) / 1e9 : 0;
            console.log(`   TX ${i+1}: ${solSpent.toFixed(4)} SOL spent, ${solReceived.toFixed(4)} SOL received`);
          }
        });
      }
    });
    console.log();

    // USE THE MAPPER - this is what makes significantBuyersAnalysis.ts work!
    console.log('💰 Analyzing wallets using MAPPER (the proven method from significantBuyersAnalysis.ts)...');

    // Group transactions by wallet for mapper analysis (this is the key!)
    const transactionsByWalletForMapper = new Map<string, HeliusTransaction[]>();

    for (const tx of transactions) {
      // Extract ALL wallets from this transaction (comprehensive approach)
      const walletsInTx: string[] = [];

      // From token transfers (most important for mint transactions)
      if (tx.tokenTransfers) {
        tx.tokenTransfers.forEach(transfer => {
          if (transfer.fromUserAccount) walletsInTx.push(transfer.fromUserAccount);
          if (transfer.toUserAccount) walletsInTx.push(transfer.toUserAccount);
        });
      }

      // From native transfers (SOL movements)
      if (tx.nativeTransfers) {
        tx.nativeTransfers.forEach(transfer => {
          if (transfer.fromUserAccount) walletsInTx.push(transfer.fromUserAccount);
          if (transfer.toUserAccount) walletsInTx.push(transfer.toUserAccount);
        });
      }

      // From swap events (if they exist)
      if (tx.events?.swap) {
        const swap = tx.events.swap;
        if (swap.nativeInput?.account) walletsInTx.push(swap.nativeInput.account);
        if (swap.nativeOutput?.account) walletsInTx.push(swap.nativeOutput.account);
        if (swap.tokenInputs?.[0]?.userAccount) walletsInTx.push(swap.tokenInputs[0].userAccount);
        if (swap.tokenOutputs?.[0]?.userAccount) walletsInTx.push(swap.tokenOutputs[0].userAccount);
      }

      // Add transaction to each wallet's list (exclude mint address)
      const uniqueWallets = [...new Set(walletsInTx.filter(addr => addr && addr !== config.mintAddress))];
      uniqueWallets.forEach(wallet => {
        if (!transactionsByWalletForMapper.has(wallet)) {
          transactionsByWalletForMapper.set(wallet, []);
        }
        transactionsByWalletForMapper.get(wallet)!.push(tx);
      });
    }

    console.log(`📊 Grouped ${transactionsByWalletForMapper.size} wallets for mapper analysis`);

    // Collect all analysis inputs to save to database
    const allAnalysisInputs: any[] = [];

    // Now use the mapper for PROPER SOL calculation (this is what significantBuyersAnalysis.ts does!)
    for (const [walletAddress, walletTransactions] of transactionsByWalletForMapper) {
      try {
        // Use the mapper to get properly calculated SOL values
        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
          walletAddress,
          walletTransactions
        );

        // Add ALL analysis inputs to our collection for database save (not just target mint)
        allAnalysisInputs.push(...analysisInputs);

        // Filter for transactions involving the target mint
        const relevantInputs = analysisInputs.filter(input => input.mint === config.mintAddress);

        if (relevantInputs.length === 0) continue;

        // DEBUG FOR TARGET WALLET - PROVE SELF-HEALING
        if (walletAddress === '7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg') {
          console.log(`\n🔍 ============ DEBUG TARGET WALLET ============`);
          console.log(`   Wallet: ${walletAddress}`);
          console.log(`   Total transactions for wallet: ${walletTransactions.length}`);
          console.log(`   Relevant inputs for mint: ${relevantInputs.length}`);
          console.log(`\n   📊 MAPPER OUTPUT FOR EACH INPUT:`);
          relevantInputs.forEach((input, idx) => {
            console.log(`   Input ${idx + 1}:`);
            console.log(`      Signature: ${input.signature.substring(0, 30)}...`);
            console.log(`      Direction: ${input.direction}`);
            console.log(`      Amount: ${input.amount}`);
            console.log(`      associatedSolValue: ${input.associatedSolValue} ⬅️ THIS IS WHAT WE'RE SUMMING`);
            console.log(`      timestamp: ${new Date(input.timestamp * 1000).toISOString()}`);
          });

          // Now check raw transaction data
          console.log(`\n   🔍 RAW TRANSACTION DATA (PROOF):`);
          walletTransactions.slice(0, 3).forEach((tx, idx) => {
            console.log(`\n   TX ${idx + 1}: ${tx.signature?.substring(0, 30)}...`);
            console.log(`      timestamp: ${new Date((tx.timestamp || 0) * 1000).toISOString()}`);
            console.log(`      Has nativeTransfers: ${!!tx.nativeTransfers}`);
            console.log(`      nativeTransfers count: ${tx.nativeTransfers?.length || 0}`);
            if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
              console.log(`      Native transfers involving wallet:`);
              tx.nativeTransfers.forEach((nt, ntIdx) => {
                if (nt.fromUserAccount === walletAddress || nt.toUserAccount === walletAddress) {
                  const direction = nt.fromUserAccount === walletAddress ? 'SPENT' : 'RECEIVED';
                  const amount = (nt.amount || 0) / 1e9;
                  console.log(`         ${ntIdx + 1}. ${direction} ${amount.toFixed(6)} SOL ⬅️ ACTUAL SOL AMOUNT`);
                }
              });
            }
          });
          console.log(`\n   ============================================\n`);
        }

        // Calculate SOL metrics using mapper data
        // IMPORTANT: direction: 'in' = tokens coming IN (BUY) = SOL SPENT
        //            direction: 'out' = tokens going OUT (SELL) = SOL RECEIVED
        const solSpent = relevantInputs
          .filter(input => input.direction === 'in')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const usdcSpent = relevantInputs
          .filter(input => input.direction === 'in')
          .reduce((sum, input) => sum + (input.associatedUsdcValue ?? 0), 0);

        const solReceived = relevantInputs
          .filter(input => input.direction === 'out')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const usdcReceived = relevantInputs
          .filter(input => input.direction === 'out')
          .reduce((sum, input) => sum + (input.associatedUsdcValue ?? 0), 0);

        const timestamps = relevantInputs.map(input => input.timestamp).filter(t => t && t > 0);
        const firstTransaction = timestamps.length > 0 ? Math.min(...timestamps) : 0;
        const lastTransaction = timestamps.length > 0 ? Math.max(...timestamps) : 0;

        walletAnalysis.set(walletAddress, {
          solSpent,
          usdcSpent,
          solReceived,
          usdcReceived,
          transactionCount: relevantInputs.length,
          firstTransaction,
          lastTransaction
        });

        // Debug for target wallets
        if (walletAddress === '7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg') {
          console.log(`🎯 ${walletAddress.substring(0, 8)}...: ${solSpent.toFixed(4)} SOL spent, ${relevantInputs.length} tx`);
        }

      } catch (error) {
        logger.warn(`❌ Failed to analyze wallet ${walletAddress}:`, getErrorMessage(error));
      }
    }

    // Save all mapped data to database for future runs
    if (allAnalysisInputs.length > 0) {
      console.log(`\n💾 Saving ${allAnalysisInputs.length} analysis inputs to database...`);
      try {
        await databaseService.saveSwapAnalysisInputs(allAnalysisInputs);
        console.log(`   ✅ Successfully saved to database\n`);
      } catch (error) {
        console.log(`   ⚠️  Failed to save to database: ${getErrorMessage(error)}`);
        console.log(`   Continuing with analysis...\n`);
      }
    }

    // Filter wallets that meet criteria
    let qualifyingWallets = Array.from(walletAnalysis.entries())
      .filter(([, analysis]) => analysis.solSpent >= config.minSolSpent)
      .sort(([, a], [, b]) => b.solSpent - a.solSpent);

    // If no wallets spent ≥1 SOL, show any with SOL spent
    if (qualifyingWallets.length === 0) {
      console.log('⚠️  No wallets spent ≥1 SOL. Showing wallets with any SOL spent...');
      qualifyingWallets = Array.from(walletAnalysis.entries())
        .filter(([, analysis]) => analysis.solSpent > 0)
        .sort(([, a], [, b]) => b.solSpent - a.solSpent);
    }

    console.log(`\n🏆 RESULTS: Found ${qualifyingWallets.length} wallets with SOL spent\n`);

    if (qualifyingWallets.length > 0) {
      console.log('┌─────────────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ Rank │ Wallet Address                           │ SOL Spent │ SOL Recvd │ TX │ First TX │ Last TX │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────┤');

      qualifyingWallets.slice(0, 20).forEach(([wallet, analysis], index) => {
      const rank = (index + 1).toString().padStart(4, ' ');
        const shortAddr = wallet.substring(0, 40).padEnd(40, ' ');
      const solSpent = analysis.solSpent.toFixed(4).padStart(9, ' ');
      const solReceived = analysis.solReceived.toFixed(4).padStart(9, ' ');
      const txCount = analysis.transactionCount.toString().padStart(2, ' ');
        const firstTx = new Date(analysis.firstTransaction * 1000).toISOString().slice(11, 19);
        const lastTx = new Date(analysis.lastTransaction * 1000).toISOString().slice(11, 19);

        const marker = targetWallets.includes(wallet) ? '🎯' : '  ';
        console.log(`│${marker}${rank} │ ${shortAddr} │ ${solSpent} │ ${solReceived} │ ${txCount} │ ${firstTx} │ ${lastTx} │`);
      });

      console.log('└─────────────────────────────────────────────────────────────────────────────────────────┘');

      // Check target wallets
      targetWallets.forEach(targetWallet => {
        const analysis = walletAnalysis.get(targetWallet);
        if (analysis) {
          console.log(`🎯 TARGET FOUND: ${targetWallet.substring(0, 8)}... spent ${analysis.solSpent.toFixed(4)} SOL in ${analysis.transactionCount} tx`);
        } else {
          console.log(`❌ Target wallet ${targetWallet.substring(0, 8)}... not found in analysis`);
        }
      });

      // EXPORT TO CSV
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
      const csvPath = path.join(__dirname, `../../../analysis_reports/wallet_discovery_${config.mintAddress.substring(0, 8)}_${timestamp}.csv`);

      const csvLines = [
        'Rank,Wallet Address,SOL Spent,SOL Received,Net PnL,Transaction Count,First Transaction,Last Transaction'
      ];

      qualifyingWallets.forEach(([wallet, analysis], index) => {
        const rank = index + 1;
        const netPnl = analysis.solReceived - analysis.solSpent;
        const firstTx = new Date(analysis.firstTransaction * 1000).toISOString();
        const lastTx = new Date(analysis.lastTransaction * 1000).toISOString();

        csvLines.push(
          `${rank},${wallet},${analysis.solSpent.toFixed(6)},${analysis.solReceived.toFixed(6)},${netPnl.toFixed(6)},${analysis.transactionCount},${firstTx},${lastTx}`
        );
      });

      fs.writeFileSync(csvPath, csvLines.join('\n'));
      console.log(`\n📁 CSV exported to: ${csvPath}`);
      console.log(`   Total wallets: ${qualifyingWallets.length}`);
    }

  } catch (error) {
    logger.error('❌ Error:', getErrorMessage(error));
  }
}

// Helper function to determine fetch address (adapted from TokenFirstBuyersService)
async function determineFetchAddress(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  addressType: 'bonding-curve' | 'mint' | 'auto',
  bondingCurveAddress?: string
): Promise<{ address: string; type: string }> {
  switch (addressType) {
    case 'mint':
      console.log(`📍 Using mint address directly (may miss bonding curve period)`);
      return { address: mintAddress, type: 'mint address' };

    case 'bonding-curve':
      if (bondingCurveAddress) {
        console.log(`📍 Using provided bonding curve address`);
        return { address: bondingCurveAddress, type: 'bonding curve (provided)' };
      } else {
        // Try to detect bonding curve automatically
        const detectedAddress = await detectBondingCurveAddress(heliusClient, mintAddress);
        if (detectedAddress) {
          console.log(`🎯 Auto-detected bonding curve address: ${detectedAddress}`);
          return { address: detectedAddress, type: 'bonding curve (detected)' };
        } else {
          console.log(`⚠️ Bonding curve requested but none found. Using mint address.`);
          return { address: mintAddress, type: 'mint address (fallback)' };
        }
      }

    case 'auto':
    default:
      // Try to detect if it's a pump.fun token
      const detectedAddress = await detectBondingCurveAddress(heliusClient, mintAddress);
      if (detectedAddress) {
        console.log(`🎯 Auto-detected pump.fun token! Using bonding curve address: ${detectedAddress}`);
        return { address: detectedAddress, type: 'bonding curve (auto-detected)' };
      } else {
        console.log(`🤖 Auto mode: No bonding curve detected, using mint address`);
        return { address: mintAddress, type: 'mint address (auto)' };
      }
  }
}

// Helper function to derive pump.fun bonding curve address from mint address
async function derivePumpFunBondingCurve(mintAddress: string): Promise<string | null> {
  // Pump.fun uses a deterministic PDA derivation for bonding curves
  // The formula is: findProgramAddress(["bonding-curve", mintAddress], PUMP_FUN_PROGRAM_ID)

  console.log(`🔧 Attempting to derive bonding curve for mint: ${mintAddress}`);

  // We can't use web3.js findProgramAddress directly in this environment,
  // but we can provide the command to run it externally

  console.log(`💡 To derive the bonding curve address, run this command:`);
  console.log(`   npx ts-node -e "`);
  console.log(`   const { PublicKey } = require('@solana/web3.js');`);
  console.log(`   const [address] = PublicKey.findProgramAddressSync(`);
  console.log(`     [Buffer.from('bonding-curve'), new PublicKey('${mintAddress}')],`);
  console.log(`     new PublicKey('6EF8rrecthR5Dkzon8NQtmHcWgCMAH1')`);
  console.log(`   );`);
  console.log(`   console.log('Derived bonding curve:', address.toString());`);
  console.log(`   "`);

  console.log(`📝 Or check manually on:`);
  console.log(`   1. Solscan: https://solscan.io/token/${mintAddress}`);
  console.log(`   2. Pump.fun website if still listed`);
  console.log(`   3. DEX screener for migration history`);

  // For now, return null - user needs to provide manually
  return null;
}

// Helper function to detect bonding curve address for pump.fun tokens
async function detectBondingCurveAddress(heliusClient: HeliusApiClient, mintAddress: string): Promise<string | null> {
  try {
    console.log(`🔍 Attempting to detect bonding curve for token: ${mintAddress}`);

    // First, try to derive it programmatically
    const derivedAddress = derivePumpFunBondingCurve(mintAddress);
    if (derivedAddress) {
      console.log(`✅ Derived bonding curve address: ${derivedAddress}`);
      return derivedAddress;
    }

    // Method 1: Look at recent transactions to find pump.fun program interactions
    const recentTxs = await heliusClient.getAllTransactionsForMint(mintAddress, 20, {
      type: 'SWAP',
    });

    console.log(`📊 Found ${recentTxs.length} recent transactions for analysis`);

    // Look for pump.fun program interactions
    const pumpFunProgramIds = ['6EF8rrecthR5Dkzon8NQtmHcWgCMAH1', 'TSLvdd1pWNpU8G5LRTK5TMbS8o9aQ1y'];
    const potentialBondingCurves = new Map<string, number>();

    for (const tx of recentTxs) {
      if (tx.instructions) {
        for (const instruction of tx.instructions) {
          // Check if this instruction uses a pump.fun program
          if (pumpFunProgramIds.includes(instruction.programId)) {
            console.log(`🎯 Found pump.fun program interaction: ${instruction.programId}`);

            // The bonding curve is typically one of the accounts in the instruction
            // Usually not the mint address and not common system programs
            if (instruction.accounts) {
              for (const account of instruction.accounts) {
                // Skip the mint address and common system programs
                if (account !== mintAddress &&
                    account !== '11111111111111111111111111111112' && // System program
                    account !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && // Token program
                    account !== 'SysvarRent111111111111111111111111111111111') { // Rent sysvar

                  potentialBondingCurves.set(account, (potentialBondingCurves.get(account) || 0) + 1);
                }
              }
            }
          }
        }
      }
    }

    // Find the most frequent account that appeared with pump.fun programs
    let bestCandidate: string | null = null;
    let maxScore = 0;

    for (const [account, score] of potentialBondingCurves.entries()) {
      if (score > maxScore) {
        maxScore = score;
        bestCandidate = account;
      }
    }

    if (bestCandidate && maxScore >= 2) {
      console.log(`🎯 Detected potential bonding curve: ${bestCandidate} (score: ${maxScore})`);
      return bestCandidate;
    }

    console.log(`❌ No bonding curve detected for this token`);
    console.log(`💡 This token may not be a pump.fun token, or it may have migrated to a DEX already`);
    return null;

  } catch (error) {
    console.log(`⚠️ Error detecting bonding curve: ${error}`);
    return null;
  }
}

// Helper function to analyze transactions for wallets
function analyzeTransactionsForWallets(transactions: any[], mintAddress: string) {
  const walletMap = new Map<string, { solSpent: number; txCount: number }>();

  for (const tx of transactions) {
    const wallets: string[] = [];

    // Extract from nativeTransfers
    if (tx.nativeTransfers) {
      tx.nativeTransfers.forEach((transfer: any) => {
        if (transfer.fromUserAccount && transfer.fromUserAccount !== mintAddress) {
          wallets.push(transfer.fromUserAccount);
        }
        if (transfer.toUserAccount && transfer.toUserAccount !== mintAddress) {
          wallets.push(transfer.toUserAccount);
        }
      });
    }

    // Extract from tokenTransfers
    if (tx.tokenTransfers) {
      tx.tokenTransfers.forEach((transfer: any) => {
        if (transfer.fromUserAccount && transfer.fromUserAccount !== mintAddress) {
          wallets.push(transfer.fromUserAccount);
        }
        if (transfer.toUserAccount && transfer.toUserAccount !== mintAddress) {
          wallets.push(transfer.toUserAccount);
        }
      });
    }

    // Calculate SOL spent (simplified)
    let solSpent = 0;
    if (tx.nativeTransfers) {
      solSpent = tx.nativeTransfers.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0) / 1e9;
    }

    const uniqueWallets = [...new Set(wallets)];
    uniqueWallets.forEach(wallet => {
      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, { solSpent: 0, txCount: 0 });
      }
      const data = walletMap.get(wallet)!;
      data.solSpent += solSpent;
      data.txCount += 1;
    });
  }

  return walletMap;
}

// Helper function to check for target wallet
function checkForTargetWallet(walletMap: Map<string, { solSpent: number; txCount: number }>, approachName: string): boolean {
  const targetWallet = '7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg';
  const targetData = walletMap.get(targetWallet);

  if (targetData) {
    console.log(`🎯 TARGET WALLET FOUND via ${approachName}!`);
    console.log(`   SOL spent: ${targetData.solSpent.toFixed(4)}`);
    console.log(`   Transactions: ${targetData.txCount}`);
    return true;
  } else {
    console.log(`❌ Target wallet NOT found in ${approachName} results`);
    return false;
  }
}

// Test function to verify Enhanced API time filtering works with raw data and bonding curve logic
async function testEnhancedApiTimeFiltering() {
  console.log('🧪 TESTING Enhanced API Time Filtering with Raw Data Processing + Bonding Curve Logic\n');

  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY environment variable is not set');
    return false;
  }

  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);
  const config = {
    mintAddress: 'DzrScTJ32QqLWNQz6UEwRe5QaTw9SJbAepAuh95wBAGS',
    minSolSpent: 1.0,
    startTime: 1769413020, // 2026-01-03T18:18:00.000Z
    endTime: 1769415180
  };

  console.log(`🎯 Target time range: ${new Date(config.startTime * 1000).toISOString()} - ${new Date(config.endTime * 1000).toISOString()}`);
  console.log(`🎯 Target wallet: 7rnTq4E9bgkYTqMx62142zAFXnyifkDdJgGZc8jNq1xg\n`);

  // Enhanced API ONLY: mint address approach (no bonding curve, no RPC)
  const approaches = [
    { addressType: 'mint' as const, name: 'MINT ADDRESS ONLY', bondingCurveAddress: undefined },
  ];

  let foundInAnyApproach = false;

  for (const approach of approaches) {
    console.log(`\n🔄 TESTING APPROACH: ${approach.name}`);
    console.log('='.repeat(60));

    try {
      // Determine which address to fetch from
      const fetchAddress = await determineFetchAddress(
        heliusClient,
        config.mintAddress,
        approach.addressType,
        approach.bondingCurveAddress
      );

      console.log(`📍 Will fetch transactions from: ${fetchAddress.address} (${fetchAddress.type})\n`);

      // If we're using a different address than the mint, we need to get transactions for that address
      // and then filter for ones involving our token
      if (fetchAddress.address !== config.mintAddress) {
        console.log('❌ Unexpected fetch address (bonding curve path disabled in this test).');
        continue;
      } else {
        console.log('🎯 Using MINT ADDRESS APPROACH: Get transactions directly for mint\n');

        const allTransactions = await fetchEnhancedTransactionsForMintWindow(
          heliusClient,
          config.mintAddress,
          ['SWAP', 'TRANSFER'],
          config.startTime,
          config.endTime,
          {
            useAnchorBatch: true,
            maxPages: 200,
            maxTransactions: 5000
          }
        );
        console.log(`📊 Total Enhanced API transactions: ${allTransactions.length}\n`);

        if (allTransactions.length === 0) {
          console.log('❌ No transactions found for this time range');
          continue;
        }

        // DEBUG: Check time range of returned transactions
        console.log('🔍 Checking time range of returned transactions...');
        const timestamps = allTransactions.map(tx => tx.timestamp);
        if (timestamps.length > 0) {
          const minTime = Math.min(...timestamps);
          const maxTime = Math.max(...timestamps);
          console.log(`   Earliest: ${new Date(minTime * 1000).toISOString()}`);
          console.log(`   Latest: ${new Date(maxTime * 1000).toISOString()}`);
          console.log(`   Count: ${timestamps.length}\n`);
        }

        // Analyze transactions
        const walletMap = analyzeTransactionsForWallets(allTransactions, config.mintAddress);

        // Check for target wallet
        const found = checkForTargetWallet(walletMap, approach.name);
        if (found) foundInAnyApproach = true;
      }

    } catch (error) {
      logger.error(`❌ Error with ${approach.name}:`, getErrorMessage(error));
    }
  }

  console.log('\n🎯 FINAL RESULT:');
  console.log('='.repeat(50));
  if (foundInAnyApproach) {
    console.log('✅ TARGET WALLET FOUND in at least one approach!');
    return true;
  } else {
    console.log('❌ Target wallet NOT found in any approach');
    console.log('💡 This suggests the wallet may have transacted outside our time range');
    console.log('💡 Or the token may not be accessible via current API methods');
    return false;
  }
}

async function fetchEnhancedTransactionsForMintWindow(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  types: string[],
  startTime: number,
  endTime: number,
  options: {
    useAnchorBatch: boolean;
    maxPages: number;
    maxTransactions: number;
  }
): Promise<HeliusTransaction[]> {
  // RPC method doesn't support type filtering, so just fetch once
  // (ignoring the 'types' parameter since RPC returns all types)
  return await fetchEnhancedTransactionsForMintWindowByType(
    heliusClient,
    mintAddress,
    'ALL', // Not used by RPC method
    startTime,
    endTime,
    options
  );
}

async function fetchEnhancedTransactionsForMintWindowByType(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  type: string,
  startTime: number,
  endTime: number,
  options: {
    useAnchorBatch: boolean;
    maxPages: number;
    maxTransactions: number;
  }
): Promise<HeliusTransaction[]> {
  console.log(`\n📊 PAGINATION DEBUG for type=${type}:`);
  console.log(`   startTime: ${startTime} (${new Date(startTime * 1000).toISOString()})`);
  console.log(`   endTime: ${endTime} (${new Date(endTime * 1000).toISOString()})`);
  console.log(`   maxTransactions: ${options.maxTransactions}, maxPages: ${options.maxPages}`);

  const allTransactions: HeliusTransaction[] = [];
  const limit = 100;
  let beforeSignature: string | undefined;
  let pagesFetched = 0;

  // TWO-PHASE APPROACH:
  // Phase 1: Get signatures via RPC with time filters (FAST, supports blockTime filters)
  // Phase 2: Enrich those signatures via Enhanced API (gets us parsed data)

  console.log(`\n📄 PHASE 1: Collecting signatures via RPC with blockTime filters`);
  console.log(`   This is the ONLY method that supports time filtering for mint addresses!`);

  let paginationToken: string | undefined;
  let allSignatures: string[] = [];

  while (allSignatures.length < options.maxTransactions && pagesFetched < options.maxPages) {
    // Use RPC to get SIGNATURES ONLY (not full transactions)
    const result = await heliusClient['getTransactionsForAddressSignatures'](mintAddress, {
      limit: 1000, // Can fetch up to 1000 signatures per page
      sortOrder: 'desc', // Newest first
      paginationToken,
      filters: {
        blockTime: {
          gte: startTime,
          lte: endTime
        }
      }
    });

    pagesFetched += 1;
    const signaturesInPage = result.signatures.map(sig => sig.signature);
    console.log(`   Page ${pagesFetched}: Got ${signaturesInPage.length} signatures`);

    if (signaturesInPage.length === 0) {
      console.log(`   ⛔ Empty batch, stopping pagination`);
      break;
    }

    const times = result.signatures.map(sig => sig.blockTime).filter((t): t is number => t !== null && t !== undefined);
    if (times.length > 0) {
      const minT = Math.min(...times);
      const maxT = Math.max(...times);
      console.log(`      Time range: ${new Date(minT * 1000).toISOString()} - ${new Date(maxT * 1000).toISOString()}`);
    }

    allSignatures.push(...signaturesInPage);
    console.log(`      Total signatures collected: ${allSignatures.length}`);

    paginationToken = result.paginationToken;

    if (!paginationToken) {
      console.log(`   ✅ No more pages available`);
      break;
    }
  }

  console.log(`\n✅ PHASE 1 COMPLETE: Collected ${allSignatures.length} signatures in ${pagesFetched} pages`);

  if (allSignatures.length === 0) {
    console.log(`   ⚠️ No signatures found in time window, skipping Phase 2`);
    return allTransactions;
  }

  // PHASE 2: Enrich ALL signatures via Enhanced API
  console.log(`\n📄 PHASE 2: Enriching ${allSignatures.length} signatures via Enhanced API...`);

  const batchSize = 100;
  let enrichedCount = 0;

  for (let i = 0; i < allSignatures.length; i += batchSize) {
    const batch = allSignatures.slice(i, i + batchSize);
    console.log(`   Enriching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allSignatures.length/batchSize)} (${batch.length} signatures)...`);

    const enrichedTxs = await heliusClient['getTransactionsBySignatures'](batch);
    const validTxs = enrichedTxs.filter(tx => tx !== null);

    allTransactions.push(...validTxs);
    enrichedCount += validTxs.length;
    console.log(`      Enriched: ${validTxs.length}/${batch.length}, Total: ${enrichedCount}`);
  }

  console.log(`\n✅ PHASE 2 COMPLETE: Enriched ${enrichedCount} transactions`);

  // Show example of what we got
  if (allTransactions.length > 0) {
    const sample = allTransactions[0];
    console.log(`\n📋 Sample enriched transaction:`);
    console.log(`   Has tokenTransfers: ${!!sample.tokenTransfers}`);
    console.log(`   Has nativeTransfers: ${!!sample.nativeTransfers}`);
    console.log(`   Has events.swap: ${!!sample.events?.swap}`);
    console.log(`   timestamp: ${sample.timestamp}`);
  }

  console.log(`\n✅ Type ${type}: Collected ${allTransactions.length} transactions after ${pagesFetched} pages\n`);
  return allTransactions;
}

// Run the discovery
discoverSignificantWallets().catch(console.error);

// Quick test of bonding curve address
async function quickBondingCurveTest() {
  console.log('🧪 QUICK BONDING CURVE TEST\n');

  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY environment variable is not set');
    return;
  }

  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);

  const bondingCurveAddress = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
  const mintAddress = '3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump';

  console.log(`🎯 Testing bonding curve: ${bondingCurveAddress}`);
  console.log(`🎯 For token: ${mintAddress}\n`);

  try {
    // Get just a few transactions from the bonding curve
    const txs = await heliusClient.getAllTransactionsForAddress(
      bondingCurveAddress,
      5, // Just 5 transactions
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );

    console.log(`✅ Found ${txs.length} transactions for bonding curve`);

    // Check if any involve our token
    let tokenTxs = 0;
    for (const tx of txs) {
      if (tx.tokenTransfers?.some(t => t.mint === mintAddress)) {
        tokenTxs++;
      }
    }

    console.log(`🎯 ${tokenTxs} transactions involve our token`);

    if (tokenTxs > 0) {
      console.log('✅ BONDING CURVE WORKS! This address has our token transactions.');
    } else {
      console.log('❌ No token transactions found on this address');
    }

  } catch (error) {
    logger.error('❌ Error testing bonding curve:', getErrorMessage(error));
  }
}

// testEnhancedApiTimeFiltering().catch(console.error);
// quickBondingCurveTest().catch(console.error);
