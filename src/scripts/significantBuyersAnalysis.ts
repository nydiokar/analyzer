#!/usr/bin/env ts-node

import { TokenFirstBuyersService } from '../core/services/token-first-buyers-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { prisma } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '../core/services/helius-transaction-mapper';
import * as path from 'path';
import * as fs from 'fs';

// Set log level to info to reduce verbosity for this script
process.env.LOG_LEVEL = 'info';

const logger = createLogger('SignificantBuyersAnalysis');

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
 * npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS> [--min-sol=50] [--max-tx=5] [--address-type=bonding-curve|mint|auto] [--bonding-curve=ADDRESS]
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
    }
  }

  return { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, topTradersPerToken, sortBy };
}

async function main(): Promise<void> {
  try {
    const { mints, minSol, maxTx, addressType, bondingCurve, maxSignatures, topTradersPerToken, sortBy } = parseArgs(process.argv);

    if (!process.env.HELIUS_API_KEY) {
      console.error('❌ HELIUS_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info(`Starting significant buyers analysis for ${mints.length} token(s): ${mints.join(', ')}`);
    logger.info(`Parameters: minSol=${minSol}, maxTx=${maxTx}, addressType=${addressType}, maxSignatures=${maxSignatures}, topTradersPerToken=${topTradersPerToken}, sortBy=${sortBy}`);
    if (bondingCurve) {
      logger.info(`Bonding curve address: ${bondingCurve}`);
    }

    // Initialize services
    const databaseService = new DatabaseService();
    const heliusClient = new HeliusApiClient({
      apiKey: process.env.HELIUS_API_KEY,
      network: 'mainnet',
      requestsPerSecond: 20
    }, databaseService);

    const tokenBuyersService = new TokenFirstBuyersService(heliusClient, databaseService);

    const startTime = Date.now();
    const allResults: WalletAnalysisResult[] = [];

    // Process each mint
    for (const mint of mints) {
      logger.info(`\n🔄 Processing token: ${mint}`);

      // Step 1: Get wallets who interacted with this token
      logger.info(`📊 Step 1: Fetching wallets who interacted with ${mint}...`);
      const allBuyers = await tokenBuyersService.getFirstBuyers(mint, {
        maxBuyers: Math.max(5000, topTradersPerToken * 10), // Get enough wallets to find top traders
        maxSignatures,
        batchSize: 100,
        addressType,
        bondingCurveAddress: bondingCurve
      });

      logger.info(`Found ${allBuyers.length} unique wallets who interacted with ${mint}`);

      if (allBuyers.length === 0) {
        logger.warn(`No wallets found for ${mint}. Skipping.`);
        continue;
      }

      // Step 2: Analyze each wallet to calculate PnL and filter by criteria
      logger.info(`📊 Step 2: Analyzing each wallet for ${mint}...`);
      const results: WalletAnalysisResult[] = [];
      let processedCount = 0;

    for (const buyer of allBuyers) {
      processedCount++;
      
      if (processedCount % 50 === 0) {
        logger.info(`Progress: ${processedCount}/${allBuyers.length} wallets analyzed (${results.length} match criteria so far)`);
      }

      try {
        // Fetch and save transactions for this wallet and mint
        await fetchAndSaveWalletTransactions(
          heliusClient,
          databaseService,
          buyer.walletAddress,
          mint
        );

        // Get swap analysis input records from database for this wallet and token
        const swapRecords = await prisma.swapAnalysisInput.findMany({
          where: {
            walletAddress: buyer.walletAddress,
            mint
          },
          orderBy: {
            timestamp: 'asc'
          }
        });

        if (!swapRecords || swapRecords.length === 0) {
          logger.debug(`No swap records found for wallet ${buyer.walletAddress} on token ${mint}`);
          continue;
        }

        // Calculate metrics
        let totalSolSpent = 0;
        let totalSolReceived = 0;
        const transactionCount = swapRecords.length;

        for (const swap of swapRecords) {
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
          continue;
        }

        if (transactionCount >= maxTx) {
          logger.debug(`Wallet ${buyer.walletAddress} has ${transactionCount} transactions (>= ${maxTx}), skipping (possible bot)`);
          continue;
        }

        const netPnl = totalSolReceived - totalSolSpent;

        // Get current balances
        let currentSolBalance = 0;
        let currentTokenBalance = 0;

        try {
          // Fetch current SOL balance
          const accountInfo = await heliusClient.getMultipleAccounts([buyer.walletAddress], 'finalized', 'base64');
          if (accountInfo.value && accountInfo.value[0]) {
            currentSolBalance = (accountInfo.value[0].lamports || 0) / 1e9; // Convert lamports to SOL
          }

          // Fetch current token balance
          const tokenAccounts = await heliusClient.getTokenAccountsByOwner(
            buyer.walletAddress,
            mint,
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'finalized',
            'jsonParsed'
          );

          if (tokenAccounts.value && tokenAccounts.value.length > 0) {
            for (const acc of tokenAccounts.value) {
              const parsed = (acc as any).account?.data?.parsed?.info;
              if (parsed?.tokenAmount?.uiAmount) {
                currentTokenBalance += parsed.tokenAmount.uiAmount;
              }
            }
          }
        } catch (balanceError) {
          logger.warn(`Failed to fetch balances for ${buyer.walletAddress}: ${balanceError}`);
        }

        // Calculate realized and unrealized PnL
        const realizedPnl = netPnl;
        const unrealizedPnl = 0; // Would need current token price to calculate accurately

        results.push({
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
        });

        logger.info(`✅ Wallet ${buyer.walletAddress}: ${totalSolSpent.toFixed(2)} SOL spent, ${transactionCount} tx, PnL: ${netPnl.toFixed(2)} SOL`);

      } catch (error) {
        logger.error(`Error analyzing wallet ${buyer.walletAddress}:`, error);
        results.push({
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
        });
      }
    }

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

  } catch (error) {
    logger.error('Error during analysis:', error);
    console.error('\n❌ Analysis failed:', error instanceof Error ? error.message : 'Unknown error');
    
    if (error instanceof Error && error.message.includes('Mint address is required')) {
      console.log('\n📖 Usage:');
      console.log('npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS> [options]');
      console.log('Multiple tokens: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts "MINT1,MINT2,MINT3" [options]');
      console.log('\nOptions:');
      console.log('  --min-sol=N          Minimum SOL spent (default: 50)');
      console.log('  --max-tx=N           Maximum transaction count (default: 5)');
      console.log('  --address-type=TYPE  Address type: bonding-curve|mint|auto (default: auto)');
      console.log('  --bonding-curve=ADDR Bonding curve address (for pump.fun tokens)');
      console.log('  --max-signatures=N   Maximum signatures to process (default: 5000)');
      console.log('  --top-traders=N      Number of top traders to return per token (default: 20)');
      console.log('  --sort-by=CRITERIA   Sort by: pnl|investment (default: pnl)');
      console.log('\nExamples:');
      console.log('Single token: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --min-sol=50 --max-tx=5');
      console.log('Multiple tokens: npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts "TOKEN1,TOKEN2,TOKEN3" --min-sol=2 --top-traders=30 --sort-by=investment');
    }
    
    process.exit(1);
  }
}

/**
 * Fetches and saves transactions for a specific wallet and mint using the Helius method.
 * This is adapted from TokenFirstBuyersService.
 */
async function fetchAndSaveWalletTransactions(
  heliusClient: HeliusApiClient,
  databaseService: DatabaseService,
  walletAddress: string,
  mintAddress: string
): Promise<number> {
  try {
    logger.debug(`🔄 Fetching transactions for wallet ${walletAddress} and mint ${mintAddress}`);

    // Fetch all transactions for this wallet
    const transactions = await heliusClient.getAllTransactionsForAddress(
      walletAddress,
      100, // batch size
      1000, // max signatures - limit to avoid long processing
      undefined,
      undefined,
      undefined,
      5 // internal concurrency
    );

    if (!transactions || transactions.length === 0) {
      logger.debug(`No transactions found for wallet ${walletAddress}`);
      return 0;
    }

    // Filter for transactions involving this specific mint
    const relevantTransactions = transactions.filter(tx => 
      tx.tokenTransfers?.some(transfer => transfer.mint === mintAddress)
    );

    logger.debug(`Found ${relevantTransactions.length} relevant transactions for wallet ${walletAddress} on mint ${mintAddress}`);

    if (relevantTransactions.length === 0) {
      return 0;
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
      return 0;
    }

    // Save analysis inputs to database
    await databaseService.saveSwapAnalysisInputs(mintAnalysisInputs);

    logger.debug(`✅ Saved ${mintAnalysisInputs.length} swap analysis inputs for wallet ${walletAddress} on mint ${mintAddress}`);

    return mintAnalysisInputs.length;

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

