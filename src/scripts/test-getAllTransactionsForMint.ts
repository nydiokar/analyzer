#!/usr/bin/env ts-node

import { HeliusApiClient } from '@/core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { HELIUS_CONFIG } from '../config/constants';

async function testGetAllTransactionsForMint() {
  // Check if API key is available
  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY environment variable is not set');
    console.log('Please set it with: $env:HELIUS_API_KEY = "your-api-key-here"');
    return;
  }

  console.log('🚀 Testing getAllTransactionsForMint...');

  // Initialize services
  const databaseService = new DatabaseService();
  const heliusClient = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY,
    network: 'mainnet',
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS
  }, databaseService);

  // Use a well-known token mint address for testing
  // BONK token as an example - you can change this to any mint you want to test
  const testMintAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK token

  console.log(`📋 Fetching transactions for mint: ${testMintAddress}`);

  try {
    // Fetch just a few transactions to see the structure
    const transactions = await heliusClient.getAllTransactionsForMint(
      testMintAddress,
      5, // Only fetch 5 transactions for testing
      { type: 'SWAP' } // Only swap transactions
    );

    console.log(`\n✅ Successfully fetched ${transactions.length} transactions\n`);

    if (transactions.length === 0) {
      console.log('❌ No transactions found for this mint. Try a different mint address or check if it has any transactions.');
      return;
    }

    // Show the structure of the first transaction
    console.log('📊 FIRST TRANSACTION STRUCTURE:');
    console.log('=====================================');
    console.log(JSON.stringify(transactions[0], null, 2));

    console.log('\n🔍 KEY FIELDS BREAKDOWN:');
    console.log('========================');
    const tx = transactions[0];
    console.log(`Signature: ${tx.signature}`);
    console.log(`Timestamp: ${new Date(tx.timestamp * 1000).toISOString()}`);
    console.log(`Type: ${tx.type}`);
    console.log(`Description: ${tx.description}`);
    console.log(`Fee: ${tx.fee / 1e9} SOL`);
    console.log(`Fee Payer: ${tx.feePayer}`);

    // Show swap event details if available
    if (tx.events?.swap) {
      console.log('\n💱 SWAP EVENT DETAILS:');
      console.log('======================');
      const swap = tx.events.swap;

      if (swap.nativeInput) {
        console.log(`SOL Input: ${parseInt(swap.nativeInput.amount) / 1e9} SOL from ${swap.nativeInput.account}`);
      }

      if (swap.nativeOutput) {
        console.log(`SOL Output: ${parseInt(swap.nativeOutput.amount) / 1e9} SOL to ${swap.nativeOutput.account}`);
      }

      if (swap.tokenInputs?.length) {
        console.log(`Token Inputs: ${swap.tokenInputs.length}`);
        swap.tokenInputs.forEach((input, i) => {
          console.log(`  ${i + 1}. ${input.userAccount}: ${input.rawTokenAmount.tokenAmount} (decimals: ${input.rawTokenAmount.decimals})`);
        });
      }

      if (swap.tokenOutputs?.length) {
        console.log(`Token Outputs: ${swap.tokenOutputs.length}`);
        swap.tokenOutputs.forEach((output, i) => {
          console.log(`  ${i + 1}. ${output.userAccount}: ${output.rawTokenAmount.tokenAmount} (decimals: ${output.rawTokenAmount.decimals})`);
        });
      }
    }

    // Show token transfers if available
    if (tx.tokenTransfers?.length) {
      console.log('\n🔄 TOKEN TRANSFERS:');
      console.log('===================');
      tx.tokenTransfers.forEach((transfer, i) => {
        console.log(`${i + 1}. ${transfer.fromUserAccount} → ${transfer.toUserAccount}: ${transfer.tokenAmount} tokens (mint: ${transfer.mint})`);
      });
    }

    // Extract and show unique wallets from all transactions
    console.log('\n👥 UNIQUE WALLETS FOUND:');
    console.log('========================');
    const allWallets = new Set<string>();

    transactions.forEach(tx => {
      // From swap events
      if (tx.events?.swap) {
        const swap = tx.events.swap;
        if (swap.nativeInput?.account) allWallets.add(swap.nativeInput.account);
        if (swap.nativeOutput?.account) allWallets.add(swap.nativeOutput.account);
        if (swap.tokenInputs?.[0]?.userAccount) allWallets.add(swap.tokenInputs[0].userAccount);
        if (swap.tokenOutputs?.[0]?.userAccount) allWallets.add(swap.tokenOutputs[0].userAccount);
      }

      // From token transfers
      if (tx.tokenTransfers) {
        tx.tokenTransfers.forEach(transfer => {
          if (transfer.fromUserAccount) allWallets.add(transfer.fromUserAccount);
          if (transfer.toUserAccount) allWallets.add(transfer.toUserAccount);
        });
      }
    });

    console.log(`Found ${allWallets.size} unique wallets:`);
    Array.from(allWallets).forEach(wallet => console.log(`  - ${wallet}`));

    // Show filtering examples
    console.log('\n🎯 FILTERING EXAMPLES:');
    console.log('=====================');

    // Example: Filter wallets by SOL spent
    const walletSolSpent = new Map<string, number>();
    transactions.forEach(tx => {
      if (tx.events?.swap?.nativeInput) {
        const wallet = tx.events.swap.nativeInput.account;
        const solSpent = parseInt(tx.events.swap.nativeInput.amount) / 1e9;
        if (wallet && solSpent > 0) {
          walletSolSpent.set(wallet, (walletSolSpent.get(wallet) || 0) + solSpent);
        }
      }
    });

    console.log('Wallets by SOL spent:');
    Array.from(walletSolSpent.entries())
      .sort(([, a], [, b]) => b - a)
      .forEach(([wallet, sol]) => console.log(`  ${wallet}: ${sol.toFixed(4)} SOL`));

  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
  }
}

// Run the test
testGetAllTransactionsForMint().catch(console.error);
