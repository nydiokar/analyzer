#!/usr/bin/env node
/**
 * CLEAR WALLET STATE SCRIPT
 * 
 * PURPOSE:
 * Resets a wallet's processing state to force a fresh data fetch. This is useful when
 * you want to completely reprocess a wallet's data with new logic or when the wallet
 * state has become inconsistent.
 * 
 * WHEN TO USE:
 * ✅ After deploying mapper changes to force fresh data processing
 * ✅ When wallet state is inconsistent (wrong timestamps, missing data)
 * ✅ When you want to completely reprocess a wallet from scratch
 * ✅ Before running bulk-data-fetcher to ensure clean state
 * 
 * WHAT IT DOES:
 * 1. Clears wallet state (newest/oldest timestamps, signatures)
 * 2. Deletes existing SwapAnalysisInput records for the wallet
 * 3. Deletes existing AnalysisResult records for the wallet
 * 4. Forces next fetch to process all transactions from scratch
 * 
 * WARNING:
 * ⚠️ This will DELETE all existing analysis data for the wallet
 * ⚠️ You'll need to run bulk-data-fetcher afterward to rebuild the data
 * ⚠️ This is a destructive operation - use carefully
 * 
 * WORKFLOW:
 * 1. Run this script to clear wallet state
 * 2. Run bulk-data-fetcher to fetch fresh data with new logic
 * 3. Verify results in dashboard
 * 
 * EXAMPLE:
 * npx ts-node clear_wallet_state.ts --address WALLET_ADDRESS
 * npx ts-node bulk-data-fetcher.ts --addresses WALLET_ADDRESS --limit 100 --maxSignatures 10000
 */

import { PrismaClient } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import readline from 'readline';

const prisma = new PrismaClient();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt user for confirmation
function askForConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      const normalizedAnswer = answer.toLowerCase().trim();
      resolve(normalizedAnswer === 'yes' || normalizedAnswer === 'y');
    });
  });
}

// Function to get current data counts for the wallet
async function getWalletDataCounts(walletAddress: string) {
  try {
    const [analysisResults, swapInputs] = await Promise.all([
      prisma.analysisResult.count({ where: { walletAddress } }),
      prisma.swapAnalysisInput.count({ where: { walletAddress } })
    ]);
    
    return { analysisResults, swapInputs };
  } catch (error) {
    console.error('Error getting wallet data counts:', error);
    return { analysisResults: 0, swapInputs: 0 };
  }
}

async function clearWalletState() {
  // Parse command line arguments
  const argv = await yargs(hideBin(process.argv))
    .scriptName('clear-wallet-state')
    .usage('$0 --address WALLET_ADDRESS')
    .option('address', {
      alias: 'a',
      description: 'Solana wallet address to clear state for',
      type: 'string',
      demandOption: true
    })
    .option('force', {
      alias: 'f',
      description: 'Skip confirmation prompts (dangerous!)',
      type: 'boolean',
      default: false
    })
    .help()
    .alias('help', 'h')
    .epilog('⚠️  WARNING: This will DELETE all analysis data for the specified wallet!')
    .parse();

  const walletAddress = argv.address as string;
  
  try {
    console.log('\n🚨 CLEAR WALLET STATE SCRIPT 🚨');
    console.log('=====================================');
    console.log(`Target Wallet: ${walletAddress}`);
    
    // Get current data counts
    console.log('\n📊 Current data counts for this wallet:');
    const dataCounts = await getWalletDataCounts(walletAddress);
    console.log(`  • Analysis Results: ${dataCounts.analysisResults}`);
    console.log(`  • Swap Analysis Inputs: ${dataCounts.swapInputs}`);
    
    if (dataCounts.analysisResults === 0 && dataCounts.swapInputs === 0) {
      console.log('\n⚠️  No data found for this wallet. Nothing to clear.');
      return;
    }
    
    // Show what will be deleted
    console.log('\n🗑️  This operation will DELETE:');
    console.log(`  • All ${dataCounts.analysisResults} analysis result records`);
    console.log(`  • All ${dataCounts.swapInputs} swap analysis input records`);
    console.log(`  • Wallet processing state (timestamps, signatures)`);
    console.log('\n⚠️  This action is IRREVERSIBLE!');
    
    // User confirmation
    if (!argv.force) {
      const confirmed = await askForConfirmation('\n❓ Are you absolutely sure you want to proceed?');
      if (!confirmed) {
        console.log('\n❌ Operation cancelled by user.');
        return;
      }
      
      // Double confirmation for large datasets
      if (dataCounts.analysisResults > 100 || dataCounts.swapInputs > 1000) {
        console.log('\n⚠️  Large dataset detected! Double confirmation required.');
        const doubleConfirmed = await askForConfirmation('❓ Are you REALLY sure? Type "yes" again:');
        if (!doubleConfirmed) {
          console.log('\n❌ Operation cancelled by user.');
          return;
        }
      }
    } else {
      console.log('\n⚠️  Force flag detected - skipping confirmation prompts!');
    }
    
    console.log('\n🔄 Starting wallet state clear operation...');
    
    // Clear the wallet state
    const result = await prisma.wallet.update({
      where: { address: walletAddress },
      data: {
        firstProcessedTimestamp: null,
        newestProcessedSignature: null,
        newestProcessedTimestamp: null,
        lastSuccessfulFetchTimestamp: null,
        analyzedTimestampStart: null,
        analyzedTimestampEnd: null,
      }
    });
    
    console.log('✅ Wallet state cleared successfully');
    
    // Delete analysis results
    const deletedResults = await prisma.analysisResult.deleteMany({
      where: { walletAddress }
    });
    
    console.log(`✅ Deleted ${deletedResults.count} analysis result records`);
    
    // Delete swap analysis inputs
    const deletedInputs = await prisma.swapAnalysisInput.deleteMany({
      where: { walletAddress }
    });
    
    console.log(`✅ Deleted ${deletedInputs.count} swap analysis input records`);
    
    console.log('\n🎉 Wallet state clear operation completed successfully!');
    console.log('\n📋 Next steps:');
    console.log(`  1. Run: npx ts-node -r tsconfig-paths/register src/helpers/db/bulk-data-fetcher.ts --addresses ${walletAddress} --limit 100 --maxSignatures 10000`);
    console.log('  2. Verify results in dashboard');
    
  } catch (error) {
    console.error('\n❌ Error during wallet state clear operation:', error);
    process.exitCode = 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

clearWalletState(); 