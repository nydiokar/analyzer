#!/usr/bin/env ts-node

import { HeliusApiClient } from './src/core/services/helius-api-client';
import { DatabaseService } from './src/api/services/database.service';
import { mapHeliusTransactionsToIntermediateRecords } from './src/core/services/helius-transaction-mapper';
import { HELIUS_CONFIG } from './src/config/constants';
import { HeliusTransaction } from './src/types/helius-api';

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

  console.log('🔍 Discovering significant wallets using WORKING RPC approach...\n');

  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);

  // Configuration
  const config = {
    mintAddress: '3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump',
    minSolSpent: 1.0,
    minUsdcSpent: 150,
    maxTransactions: 1000, // Reduced to avoid API limits, but let's try to get more
    startTime: 1767464280, // Original start time
    endTime: 1767472500, // End at 23:00 instead of 00:18
    minWallets: 50
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
    console.log('🚀 Fetching transactions using ENHANCED API with TIME FILTERING...');
    console.log('🔍 This is the CORRECT approach that actually worked before!');

    // THE WORKING APPROACH: Get signatures via RPC with extensive pagination
    // We need to paginate BACKWARDS through history to find the target time period
    console.log('🔄 Paginating backwards through signature history to find target period...');

    let allSignatures: any[] = [];
    let beforeSignature: string | null = null;
    let pagesFetched = 0;
    const maxPages = 100; // Go back much further to find historical data
    const signatureLimit = 10000; // Collect more signatures before processing
    let foundTargetPeriod = false;

    while (allSignatures.length < signatureLimit && pagesFetched < maxPages) {
      pagesFetched++;

      const pageSignatures = await heliusClient['getSignaturesViaRpcPage'](
      config.mintAddress,
        1000, // Get max per page
        beforeSignature
      );

      if (pageSignatures.length === 0) {
        console.log(`   📄 Reached end of signature history at page ${pagesFetched}`);
        break;
      }

      allSignatures.push(...pageSignatures);
      console.log(`   📄 Page ${pagesFetched}: +${pageSignatures.length} signatures (total: ${allSignatures.length})`);

      // Check if we've reached our target time period
      const targetSignatures = pageSignatures.filter(sig =>
        sig.blockTime && sig.blockTime >= startTime && sig.blockTime <= endTime
      );

      if (targetSignatures.length > 0) {
        console.log(`   ✅ FOUND TARGET PERIOD! Page ${pagesFetched} has ${targetSignatures.length} signatures in time range`);
        foundTargetPeriod = true;
      }

      // Check if we've gone past our target time (signatures are ordered newest first)
      const oldestInPage = pageSignatures[pageSignatures.length - 1];
      if (oldestInPage.blockTime && oldestInPage.blockTime < startTime) {
        if (foundTargetPeriod) {
          console.log(`   ⏰ Found target period and now gone past it at page ${pagesFetched}`);
        } else {
          console.log(`   ⏰ Gone past target time at page ${pagesFetched} without finding it`);
        }
        break;
      }

      // Set up for next page
      beforeSignature = oldestInPage.signature;

      // If we got fewer than 1000, we've reached the end
      if (pageSignatures.length < 1000) {
        console.log(`   📄 Reached end of available signatures at page ${pagesFetched}`);
        break;
      }
    }

    console.log(`📄 Total signatures collected: ${allSignatures.length} across ${pagesFetched} pages`);

    if (allSignatures.length === 0) {
      console.log('❌ No signatures found for this mint address');
      return;
    }

    // Apply time filtering to ALL collected signatures
    let signatureStrings = allSignatures.map(info => info.signature);

    if (startTime && endTime) {
      const filteredSignatures = allSignatures.filter(sig =>
        sig.blockTime && sig.blockTime >= startTime && sig.blockTime <= endTime
      );
      signatureStrings = filteredSignatures.map(info => info.signature);
      console.log(`⏰ After time filtering: ${signatureStrings.length} signatures in target period`);
    }

    // Fetch transaction details - this gives us parseable data
    console.log('📥 Fetching transaction details...');
    const batchSize = 100;
    const fetchedTransactions: any[] = [];

    for (let i = 0; i < signatureStrings.length; i += batchSize) {
      const batch = signatureStrings.slice(i, i + batchSize);
      console.log(`   Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(signatureStrings.length/batchSize)} (${batch.length} signatures)...`);

      try {
        const batchTransactions = await heliusClient['getTransactionsBySignatures'](batch);
        fetchedTransactions.push(...batchTransactions);
      } catch (error) {
        console.log(`   ❌ Error fetching batch ${Math.floor(i/batchSize) + 1}: ${error}`);
        break;
      }
    }

    console.log(`✅ Fetched ${fetchedTransactions.length} transaction details`);

    // Filter out null transactions
    const transactions = fetchedTransactions.filter(tx => tx !== null);
    console.log(`✅ Valid transactions: ${transactions.length}\n`);
    globalTelemetry.apiCalls.getSignaturesViaRpcPage = 1;
    globalTelemetry.apiCalls.getTransactionsBySignatures = Math.ceil(signatureStrings.length / batchSize);
    globalTelemetry.transactions.totalFetched = transactions.length;

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
      if (walletAddresses.includes('GPsdQQDYewZuYjG6u2fhvpTbPce9kKfoSE4usNLZUXPU')) {
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
    const targetWallets = [
      '2aXKbrrzC36LMLYqY4jMXsqZbS9GupDkFjJwMB1qXEf7',
      'GPsdQQDYewZuYjG6u2fhvpTbPce9kKfoSE4usNLZUXPU',
      'omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq' // The one from the working file
    ];

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
    const walletAnalysis = new Map<string, {
      solSpent: number;
      usdcSpent: number;
      solReceived: number;
      usdcReceived: number;
      transactionCount: number;
      firstTransaction: number;
      lastTransaction: number;
    }>();

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

    // Now use the mapper for PROPER SOL calculation (this is what significantBuyersAnalysis.ts does!)
    for (const [walletAddress, walletTransactions] of transactionsByWalletForMapper) {
      try {
        // Use the mapper to get properly calculated SOL values
        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
          walletAddress,
          walletTransactions
        );

        // Filter for transactions involving the target mint
        const relevantInputs = analysisInputs.filter(input => input.mint === config.mintAddress);

        if (relevantInputs.length === 0) continue;

        // Calculate SOL metrics using mapper data
        const solSpent = relevantInputs
          .filter(input => input.direction === 'out')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const usdcSpent = relevantInputs
          .filter(input => input.direction === 'out')
          .reduce((sum, input) => sum + (input.associatedUsdcValue ?? 0), 0);

        const solReceived = relevantInputs
          .filter(input => input.direction === 'in')
          .reduce((sum, input) => sum + input.associatedSolValue, 0);

        const usdcReceived = relevantInputs
          .filter(input => input.direction === 'in')
          .reduce((sum, input) => sum + (input.associatedUsdcValue ?? 0), 0);

        const timestamps = relevantInputs.map(input => input.timestamp);
        const firstTransaction = Math.min(...timestamps);
        const lastTransaction = Math.max(...timestamps);

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
        if (walletAddress === 'GPsdQQDYewZuYjG6u2fhvpTbPce9kKfoSE4usNLZUXPU' ||
            walletAddress === 'omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq') {
          console.log(`🎯 ${walletAddress.substring(0, 8)}...: ${solSpent.toFixed(4)} SOL spent, ${relevantInputs.length} tx`);
        }

      } catch (error) {
        console.warn(`❌ Failed to analyze wallet ${walletAddress}:`, error);
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
    }

  } catch (error) {
    console.error('❌ Error:', error);
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
  const targetWallet = 'GPsdQQDYewZuYjG6u2fhvpTbPce9kKfoSE4usNLZUXPU';
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
    mintAddress: '3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump',
    minSolSpent: 1.0,
    startTime: 1767464280, // 2026-01-03T18:18:00.000Z
    endTime: 1767481200,   // 2026-01-03T23:00:00.000Z
  };

  console.log(`🎯 Target time range: ${new Date(config.startTime * 1000).toISOString()} - ${new Date(config.endTime * 1000).toISOString()}`);
  console.log(`🎯 Target wallet: GPsdQQDYewZuYjG6u2fhvpTbPce9kKfoSE4usNLZUXPU\n`);

  // Test multiple approaches including manual bonding curve input
  //
  // HOW TO FIND BONDING CURVE ADDRESS:
  // 1. Go to https://solscan.io/token/3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump
  // 2. Look at "Token Extensions" or "Program Accounts" section
  // FOUND FROM TRANSACTION ANALYSIS:
  // Address 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf appears in multiple pump.fun transactions
  // and is consistently involved in token swaps - this is likely the bonding curve!
  const manualBondingCurve = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';

  const approaches = [
    { addressType: 'auto' as const, name: 'AUTO-DETECT (Mint vs Bonding Curve)', bondingCurveAddress: undefined },
    { addressType: 'mint' as const, name: 'MINT ADDRESS ONLY', bondingCurveAddress: undefined },
    { addressType: 'bonding-curve' as const, name: 'MANUAL BONDING CURVE (if provided)', bondingCurveAddress: manualBondingCurve || undefined },
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
        console.log('🎯 Using BONDING CURVE APPROACH: Get all transactions for bonding curve, then filter for our token\n');

        // Get transactions for the bonding curve address with time filters
        const bondingCurveTxs = await heliusClient.getAllTransactionsForAddress(
          fetchAddress.address,
          1000,
          undefined,
          undefined,
          undefined,
          config.startTime, // start time
          config.endTime    // end time
        );

        console.log(`✅ Found ${bondingCurveTxs.length} transactions for bonding curve address`);

        // Filter for transactions involving our specific token
        const relevantTxs = bondingCurveTxs.filter(tx =>
          tx.tokenTransfers?.some(transfer => transfer.mint === config.mintAddress)
        );

        console.log(`🎯 Filtered to ${relevantTxs.length} transactions involving our token: ${config.mintAddress}\n`);

        const allTransactions = relevantTxs;
        console.log(`📊 Total relevant transactions: ${allTransactions.length}`);

        if (allTransactions.length === 0) {
          console.log('❌ No transactions found for our token on this address');
          continue;
        }

        // Analyze the filtered transactions
        const walletMap = analyzeTransactionsForWallets(allTransactions, config.mintAddress);

        // Check for target wallet
        const found = checkForTargetWallet(walletMap, approach.name);
        if (found) foundInAnyApproach = true;

      } else {
        console.log('🎯 Using MINT ADDRESS APPROACH: Get transactions directly for mint\n');

        // Original approach: get transactions directly for the mint
        const swapTransactions = await heliusClient.getAllTransactionsForMint(
          config.mintAddress,
          1000,
          {
            type: 'SWAP',
            gteTime: config.startTime,
            lteTime: config.endTime
          }
        );
        console.log(`✅ SWAP transactions found: ${swapTransactions.length}`);

        const transferTransactions = await heliusClient.getAllTransactionsForMint(
          config.mintAddress,
          1000,
          {
            type: 'TRANSFER',
            gteTime: config.startTime,
            lteTime: config.endTime
          }
        );
        console.log(`✅ TRANSFER transactions found: ${transferTransactions.length}`);

        const allTransactions = [...swapTransactions, ...transferTransactions];
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
      console.error(`❌ Error with ${approach.name}:`, error);
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

// Run the discovery
// discoverSignificantWallets().catch(console.error);

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
    console.error('❌ Error testing bonding curve:', error);
  }
}

quickBondingCurveTest().catch(console.error);
