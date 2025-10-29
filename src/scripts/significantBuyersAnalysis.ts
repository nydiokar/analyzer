#!/usr/bin/env ts-node

import { TokenFirstBuyersService } from '../core/services/token-first-buyers-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { createLogger } from '../core/utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '../core/services/helius-transaction-mapper';
import * as path from 'path';
import * as fs from 'fs';

// Set log level to info to reduce verbosity for this script
process.env.LOG_LEVEL = 'info';

const logger = createLogger('SignificantBuyersAnalysis');

interface WalletAnalysisResult {
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
  mint: string;
  minSol: number;
  maxTx: number;
  addressType: 'bonding-curve' | 'mint' | 'auto';
  bondingCurve?: string;
  maxSignatures: number;
} {
  const args = argv.slice(2);
  
  if (args.length === 0 || args[0].startsWith('--')) {
    throw new Error('Mint address is required as the first argument');
  }

  const mint = args[0];
  let minSol = 50;
  let maxTx = 5;
  let addressType: 'bonding-curve' | 'mint' | 'auto' = 'auto';
  let bondingCurve: string | undefined;
  let maxSignatures = 5000;

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
    }
  }

  return { mint, minSol, maxTx, addressType, bondingCurve, maxSignatures };
}

async function main(): Promise<void> {
  try {
    const { mint, minSol, maxTx, addressType, bondingCurve, maxSignatures } = parseArgs(process.argv);

    if (!process.env.HELIUS_API_KEY) {
      console.error('❌ HELIUS_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info(`Starting significant buyers analysis for token: ${mint}`);
    logger.info(`Parameters: minSol=${minSol}, maxTx=${maxTx}, addressType=${addressType}, maxSignatures=${maxSignatures}`);
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

    // Step 1: Get all wallets who interacted with this token
    logger.info('📊 Step 1: Fetching all wallets who interacted with the token...');
    const allBuyers = await tokenBuyersService.getFirstBuyers(mint, {
      maxBuyers: 1000, // Get up to 1000 unique wallets
      maxSignatures,
      batchSize: 100,
      addressType,
      bondingCurveAddress: bondingCurve
    });

    logger.info(`Found ${allBuyers.length} unique wallets who interacted with the token`);

    if (allBuyers.length === 0) {
      console.log('❌ No wallets found. Exiting.');
      return;
    }

    // Step 2: Analyze each wallet to calculate PnL and filter by criteria
    logger.info('📊 Step 2: Analyzing each wallet for SOL spent, transaction count, and PnL...');
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
        const swapRecords = await databaseService.prismaClient.swapAnalysisInput.findMany({
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

    const duration = (Date.now() - startTime) / 1000;

    // Step 3: Sort results by net PnL (descending)
    results.sort((a, b) => b.netPnl - a.netPnl);

    // Step 4: Generate and save report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'analysis_reports');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const csvPath = path.join(outputDir, `significant_buyers_${mint}_${timestamp}.csv`);
    const mdPath = path.join(outputDir, `significant_buyers_${mint}_${timestamp}.md`);
    const txtPath = path.join(outputDir, `wallet_addresses_${mint}_${timestamp}.txt`);

    // Generate CSV
    const csvLines = [
      'Rank,Wallet Address,SOL Spent,SOL Received,Net PnL,Transaction Count,Current Token Balance,Current SOL Balance,First Buy Date'
    ];

    results.forEach((result, index) => {
      const date = new Date(result.firstBuyTimestamp * 1000).toISOString();
      csvLines.push(
        `${index + 1},${result.walletAddress},${result.totalSolSpent.toFixed(4)},${result.totalSolReceived.toFixed(4)},${result.netPnl.toFixed(4)},${result.transactionCount},${result.currentTokenBalance.toFixed(2)},${result.currentSolBalance.toFixed(4)},${date}`
      );
    });

    fs.writeFileSync(csvPath, csvLines.join('\n'));

    // Generate Markdown report
    const successfulAnalyses = results.filter(r => r.analysisSuccess).length;
    const totalSolInvested = results.reduce((sum, r) => sum + r.totalSolSpent, 0);
    const averagePnl = results.length > 0 ? results.reduce((sum, r) => sum + r.netPnl, 0) / results.length : 0;
    const winnersCount = results.filter(r => r.netPnl > 0).length;
    const losersCount = results.filter(r => r.netPnl < 0).length;

    const mdLines = [
      `# Significant Buyers Analysis Report`,
      ``,
      `**Token Mint:** \`${mint}\`  `,
      `**Analysis Date:** ${new Date().toISOString()}  `,
      `**Criteria:** Min ${minSol} SOL spent, Max ${maxTx} transactions  `,
      `${bondingCurve ? `**Bonding Curve:** \`${bondingCurve}\`  ` : ''}`,
      ``,
      `## Summary`,
      ``,
      `- **Total Wallets Analyzed:** ${allBuyers.length}`,
      `- **Wallets Matching Criteria:** ${results.length}`,
      `- **Successful Analyses:** ${successfulAnalyses}`,
      `- **Total SOL Invested:** ${totalSolInvested.toFixed(2)} SOL`,
      `- **Average PnL:** ${averagePnl.toFixed(4)} SOL`,
      `- **Winners:** ${winnersCount} (${((winnersCount / results.length) * 100).toFixed(1)}%)`,
      `- **Losers:** ${losersCount} (${((losersCount / results.length) * 100).toFixed(1)}%)`,
      `- **Processing Time:** ${duration.toFixed(2)} seconds`,
      ``,
      `## Top Performing Wallets`,
      ``,
      `| Rank | Wallet Address | SOL Spent | Net PnL | TX Count | Current Token Balance | Current SOL Balance | First Buy Date |`,
      `|------|---------------|-----------|---------|----------|---------------------|-------------------|----------------|`
    ];

    results.slice(0, 50).forEach((result, index) => {
      const date = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
      mdLines.push(
        `| ${index + 1} | \`${result.walletAddress}\` | ${result.totalSolSpent.toFixed(2)} | **${result.netPnl.toFixed(2)}** | ${result.transactionCount} | ${result.currentTokenBalance.toFixed(2)} | ${result.currentSolBalance.toFixed(4)} | ${date} |`
      );
    });

    if (results.length > 50) {
      mdLines.push(``, `*... and ${results.length - 50} more wallets (see CSV for full list)*`);
    }

    fs.writeFileSync(mdPath, mdLines.join('\n'));

    // Generate simple wallet list
    const walletList = results.map(r => r.walletAddress).join('\n');
    fs.writeFileSync(txtPath, walletList);

    // Console output
    console.log('\n' + '='.repeat(100));
    console.log('SIGNIFICANT BUYERS ANALYSIS COMPLETE');
    console.log('='.repeat(100));
    console.log(`Token Mint: ${mint}`);
    console.log(`Criteria: Min ${minSol} SOL spent, Max ${maxTx} transactions`);
    console.log(`Total Wallets Analyzed: ${allBuyers.length}`);
    console.log(`Wallets Matching Criteria: ${results.length}`);
    console.log(`Successful Analyses: ${successfulAnalyses}`);
    console.log(`Total SOL Invested: ${totalSolInvested.toFixed(2)} SOL`);
    console.log(`Average PnL: ${averagePnl.toFixed(4)} SOL`);
    console.log(`Winners: ${winnersCount} (${((winnersCount / results.length) * 100).toFixed(1)}%)`);
    console.log(`Losers: ${losersCount} (${((losersCount / results.length) * 100).toFixed(1)}%)`);
    console.log(`Processing Time: ${duration.toFixed(2)} seconds`);
    console.log('='.repeat(100));

    if (results.length > 0) {
      console.log('\n📋 TOP 20 WALLETS BY PNL:');
      console.log('-'.repeat(100));
      console.log('Rank | Wallet Address                                     | SOL Spent | Net PnL  | TX | Token Bal  | SOL Bal | First Buy');
      console.log('-'.repeat(100));

      results.slice(0, 20).forEach((result, index) => {
        const date = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
        const rank = (index + 1).toString().padStart(2, ' ');
        const spent = result.totalSolSpent.toFixed(2).padStart(9, ' ');
        const pnl = result.netPnl.toFixed(2).padStart(8, ' ');
        const tx = result.transactionCount.toString().padStart(2, ' ');
        const tokenBal = result.currentTokenBalance.toFixed(0).padStart(10, ' ');
        const solBal = result.currentSolBalance.toFixed(2).padStart(7, ' ');
        
        console.log(`${rank}   | ${result.walletAddress} | ${spent} | ${pnl} | ${tx} | ${tokenBal} | ${solBal} | ${date}`);
      });

      if (results.length > 20) {
        console.log(`... and ${results.length - 20} more wallets (see full report)`);
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
      console.log('\nOptions:');
      console.log('  --min-sol=N          Minimum SOL spent (default: 50)');
      console.log('  --max-tx=N           Maximum transaction count (default: 5)');
      console.log('  --address-type=TYPE  Address type: bonding-curve|mint|auto (default: auto)');
      console.log('  --bonding-curve=ADDR Bonding curve address (for pump.fun tokens)');
      console.log('  --max-signatures=N   Maximum signatures to process (default: 5000)');
      console.log('\nExample:');
      console.log('npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --min-sol=50 --max-tx=5');
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

