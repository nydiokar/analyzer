#!/usr/bin/env ts-node

import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { prisma } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';
import { mapHeliusTransactionsToIntermediateRecords } from '../core/services/helius-transaction-mapper';
import * as path from 'path';
import * as fs from 'fs';

// Enable Helius V2 for time-based filtering
process.env.ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES = 'true';

const logger = createLogger('TimeBasedSignificantBuyersAnalysis');

interface SignificantBuyerResult {
  walletAddress: string;
  mint: string;
  totalSolSpent: number;
  totalSolReceived: number;
  netPnl: number;
  transactionCount: number;
  firstBuyTimestamp: number;
  lastActivityTimestamp: number;
  currentTokenBalance: number;
  currentSolBalance: number;
  timePeriodStart: number;
  timePeriodEnd: number;
}

interface CachedPeriodResult {
  id: string;
  mint: string;
  startBlockTime: number;
  endBlockTime: number;
  processedAt: Date;
  walletAddresses: string[];
  totalTransactions: number;
}

/**
 * Script to find significant buyers of tokens within specific time periods using Helius V2 API.
 *
 * Features:
 * - Time-based filtering using blockTime ranges
 * - Database caching to avoid re-processing periods
 * - Aggregates wallet activity across time periods
 * - Finds significant investors (configurable minimum SOL investment)
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/timeBasedSignificantBuyersAnalysis.ts <MINT_ADDRESS> --start-timestamp=1704067200 --end-timestamp=1704153600 --min-sol=2 --expand-hours=24
 *
 * Parameters:
 * - MINT_ADDRESS: Token mint address (required)
 * - --start-timestamp=N: Start timestamp (Unix seconds, required)
 * - --end-timestamp=N: End timestamp (Unix seconds, required)
 * - --min-sol=N: Minimum SOL investment to be considered significant (default: 2)
 * - --expand-hours=N: Hours to expand search before/after period (default: 0)
 * - --max-transactions=N: Maximum transactions to process per period (default: 10000)
 */

function parseArgs(argv: string[]): {
  mint: string;
  startTimestamp: number;
  endTimestamp: number;
  minSol: number;
  expandHours: number;
  maxTransactions: number;
} {
  const args = argv.slice(2);

  if (args.length === 0 || args[0].startsWith('--')) {
    throw new Error('Mint address is required as the first argument');
  }

  const mint = args[0];
  let startTimestamp = 0;
  let endTimestamp = 0;
  let minSol = 2;
  let expandHours = 0;
  let maxTransactions = 10000;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--start-timestamp=')) {
      startTimestamp = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end-timestamp=')) {
      endTimestamp = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--min-sol=')) {
      minSol = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--expand-hours=')) {
      expandHours = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--max-transactions=')) {
      maxTransactions = parseInt(arg.split('=')[1]);
    }
  }

  if (startTimestamp === 0 || endTimestamp === 0) {
    throw new Error('Both --start-timestamp and --end-timestamp are required');
  }

  if (endTimestamp <= startTimestamp) {
    throw new Error(`End timestamp (${endTimestamp}) must be after start timestamp (${startTimestamp})`);
  }

  const timeRangeDays = (endTimestamp - startTimestamp) / 86400;
  if (timeRangeDays > 365) {
    logger.warn(`Warning: Very large time range (${timeRangeDays.toFixed(0)} days). This may take a long time and hit API limits.`);
  }

  return { mint, startTimestamp, endTimestamp, minSol, expandHours, maxTransactions };
}

// Direct database analysis - no transaction reconstruction needed!
async function analyzeWalletFromDatabaseRecords(
  walletAddress: string,
  mint: string,
  startBlockTime: number,
  endBlockTime: number
): Promise<SignificantBuyerResult | null> {
  try {
    // Query existing SwapAnalysisInput records directly for this wallet/mint/time period
    const swapRecords = await prisma.swapAnalysisInput.findMany({
      where: {
        walletAddress: walletAddress,
        mint: mint,
        timestamp: {
          gte: startBlockTime,
          lte: endBlockTime
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    if (swapRecords.length === 0) {
      return null;
    }

    // Calculate metrics directly from database records
    let totalSolSpent = 0;
    let totalSolReceived = 0;
    let firstBuyTimestamp = Infinity;
    let lastActivityTimestamp = 0;

    for (const record of swapRecords) {
      if (record.direction === 'in') {
        // Buying tokens (spending SOL)
        totalSolSpent += Math.abs(record.associatedSolValue || 0);
      } else if (record.direction === 'out') {
        // Selling tokens (receiving SOL)
        totalSolReceived += Math.abs(record.associatedSolValue || 0);
      }

      firstBuyTimestamp = Math.min(firstBuyTimestamp, record.timestamp);
      lastActivityTimestamp = Math.max(lastActivityTimestamp, record.timestamp);
    }

    const netPnl = totalSolReceived - totalSolSpent;

    // Skip current balance fetching for historical analysis - not needed
    const currentSolBalance = 0; // Historical analysis doesn't need current balances
    const currentTokenBalance = 0; // Historical analysis doesn't need current balances

    return {
      walletAddress,
      mint,
      totalSolSpent,
      totalSolReceived,
      netPnl,
      transactionCount: swapRecords.length,
      firstBuyTimestamp: firstBuyTimestamp === Infinity ? 0 : firstBuyTimestamp,
      lastActivityTimestamp,
      currentTokenBalance,
      currentSolBalance,
      timePeriodStart: startBlockTime,
      timePeriodEnd: endBlockTime
    };

  } catch (error) {
    logger.error(`Error analyzing wallet ${walletAddress} from database:`, error);
    return null;
  }
}

async function checkCacheForPeriod(
  mint: string,
  startBlockTime: number,
  endBlockTime: number
): Promise<CachedPeriodResult | null> {
  try {
    const cached = await prisma.significantBuyersCache.findFirst({
      where: {
        mint,
        startBlockTime: { lte: startBlockTime },
        endBlockTime: { gte: endBlockTime },
        processedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Cache valid for 24 hours
        }
      }
    });

    return cached ? {
      id: cached.id,
      mint: cached.mint,
      startBlockTime: cached.startBlockTime,
      endBlockTime: cached.endBlockTime,
      processedAt: cached.processedAt,
      walletAddresses: JSON.parse(cached.walletAddresses),
      totalTransactions: cached.totalTransactions
    } : null;
  } catch (error) {
    logger.warn('Failed to check cache:', error);
    return null;
  }
}

async function saveToCache(
  mint: string,
  startBlockTime: number,
  endBlockTime: number,
  walletAddresses: string[],
  totalTransactions: number
): Promise<void> {
  try {
    await prisma.significantBuyersCache.upsert({
      where: {
        mint_startBlockTime_endBlockTime: {
          mint,
          startBlockTime,
          endBlockTime
        }
      },
      update: {
        walletAddresses: JSON.stringify(walletAddresses),
        totalTransactions,
        processedAt: new Date()
      },
      create: {
        mint,
        startBlockTime,
        endBlockTime,
        walletAddresses: JSON.stringify(walletAddresses),
        totalTransactions,
        processedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to save to cache:', error);
  }
}

async function fetchTransactionsForTimePeriod(
  heliusClient: HeliusApiClient,
  mint: string,
  startBlockTime: number,
  endBlockTime: number,
  maxTransactions: number
): Promise<{ transactions: any[], signatures: any[], totalProcessed: number }> {
  logger.info(`🔍 Fetching transactions for ${mint} between ${new Date(startBlockTime * 1000).toISOString()} and ${new Date(endBlockTime * 1000).toISOString()}`);

  let allSignatures: any[] = [];
  let allTransactions: any[] = [];
  let paginationToken: string | undefined;
  let totalProcessed = 0;

  try {
    while (totalProcessed < maxTransactions) {
      const result = await heliusClient['getTransactionsForAddressSignatures'](
        mint, // Use mint address for token transactions
        {
          limit: Math.min(1000, maxTransactions - totalProcessed),
          sortOrder: 'asc', // Chronological order
          paginationToken,
          filters: {
            blockTime: {
              gte: startBlockTime,
              lte: endBlockTime
            }
          }
        }
      );

      if (!result || !result.signatures || result.signatures.length === 0) {
        if (!result) {
          logger.error(`Helius API returned null/undefined at ${totalProcessed} transactions - possible rate limit or API error`);
          throw new Error('Helius pagination failed - API returned null');
        }
        break;
      }

      allSignatures.push(...result.signatures);
      totalProcessed += result.signatures.length;

      // Fetch full transaction details immediately
      const signatureStrings = result.signatures.map((s: any) => s.signature);
      const transactions = await heliusClient['getTransactionsBySignatures'](signatureStrings);

      if (!transactions || transactions.length === 0) {
        logger.warn(`No transaction details returned for ${signatureStrings.length} signatures - skipping batch`);
        continue;
      }

      allTransactions.push(...transactions);

      // Check if we have a pagination token for next page
      if (!result.paginationToken) {
        break;
      }

      paginationToken = result.paginationToken;

      logger.debug(`Fetched ${result.signatures.length} signatures, total: ${totalProcessed}`);

      // Safety check to prevent infinite loops
      if (totalProcessed >= maxTransactions) {
        logger.warn(`Reached max transactions limit: ${maxTransactions}`);
        break;
      }
    }
  } catch (error) {
    logger.error('Error fetching transactions:', error);
    throw error;
  }

  logger.info(`✅ Found ${allSignatures.length} signatures (${allTransactions.length} transactions) in time period`);
  return { transactions: allTransactions, signatures: allSignatures, totalProcessed };
}

async function analyzeWalletActivityFromTransactions(
  heliusClient: HeliusApiClient,
  databaseService: DatabaseService,
  walletAddress: string,
  mint: string,
  walletTransactions: any[],
  startBlockTime: number,
  endBlockTime: number
): Promise<SignificantBuyerResult | null> {
  try {
    // Filter for transactions involving our specific mint (already done in grouping, but double-check)
    const relevantTransactions = walletTransactions.filter(tx =>
      tx?.tokenTransfers?.some(transfer => transfer.mint === mint)
    );

    if (relevantTransactions.length === 0) {
      return null;
    }

    // Map to intermediate records and filter for our mint
    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
      walletAddress,
      relevantTransactions
    );

    const mintAnalysisInputs = analysisInputs.filter(record => record.mint === mint);

    if (mintAnalysisInputs.length === 0) {
      return null;
    }

    // Calculate metrics
    let totalSolSpent = 0;
    let totalSolReceived = 0;
    let firstBuyTimestamp = Infinity;
    let lastActivityTimestamp = 0;

    for (const swap of mintAnalysisInputs) {
      if (swap.direction === 'in') {
        totalSolSpent += Math.abs(swap.associatedSolValue || 0);
      } else if (swap.direction === 'out') {
        totalSolReceived += Math.abs(swap.associatedSolValue || 0);
      }

      firstBuyTimestamp = Math.min(firstBuyTimestamp, swap.timestamp);
      lastActivityTimestamp = Math.max(lastActivityTimestamp, swap.timestamp);
    }

    const netPnl = totalSolReceived - totalSolSpent;

    // Skip current balance fetching for historical analysis
    const currentSolBalance = 0;
    const currentTokenBalance = 0;

    return {
      walletAddress,
      mint,
      totalSolSpent,
      totalSolReceived,
      netPnl,
      transactionCount: mintAnalysisInputs.length,
      firstBuyTimestamp,
      lastActivityTimestamp,
      currentTokenBalance,
      currentSolBalance,
      timePeriodStart: startBlockTime,
      timePeriodEnd: endBlockTime
    };

  } catch (error) {
    logger.error(`Error analyzing wallet ${walletAddress}:`, error);
    return null;
  }
}

// Fallback function for cached wallet lists - still much better than original approach
async function analyzeWalletActivityCached(
  heliusClient: HeliusApiClient,
  databaseService: DatabaseService,
  walletAddress: string,
  mint: string,
  startBlockTime: number,
  endBlockTime: number
): Promise<SignificantBuyerResult | null> {
  try {
    // Fetch transactions for this specific wallet (only for cached case)
    const walletSignatures = await heliusClient['getTransactionsForAddressSignatures'](
      walletAddress,
      {
        limit: 1000,
        sortOrder: 'asc',
        filters: {
          blockTime: {
            gte: startBlockTime,
            lte: endBlockTime
          }
        }
      }
    );

    if (!walletSignatures.signatures || walletSignatures.signatures.length === 0) {
      return null;
    }

    // Get full transaction details
    const signatureStrings = walletSignatures.signatures.map(s => s.signature);
    const transactions = await heliusClient['getTransactionsBySignatures'](signatureStrings);

    // Filter for transactions involving our specific mint
    const relevantTransactions = transactions.filter(tx =>
      tx?.tokenTransfers?.some(transfer => transfer.mint === mint)
    );

    if (relevantTransactions.length === 0) {
      return null;
    }

    // Map to intermediate records and filter for our mint
    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(
      walletAddress,
      relevantTransactions
    );

    const mintAnalysisInputs = analysisInputs.filter(record => record.mint === mint);

    if (mintAnalysisInputs.length === 0) {
      return null;
    }

    // Calculate metrics
    let totalSolSpent = 0;
    let totalSolReceived = 0;
    let firstBuyTimestamp = Infinity;
    let lastActivityTimestamp = 0;

    for (const swap of mintAnalysisInputs) {
      if (swap.direction === 'in') {
        totalSolSpent += Math.abs(swap.associatedSolValue || 0);
      } else if (swap.direction === 'out') {
        totalSolReceived += Math.abs(swap.associatedSolValue || 0);
      }

      firstBuyTimestamp = Math.min(firstBuyTimestamp, swap.timestamp);
      lastActivityTimestamp = Math.max(lastActivityTimestamp, swap.timestamp);
    }

    const netPnl = totalSolReceived - totalSolSpent;

    // Skip current balance fetching for historical analysis
    const currentSolBalance = 0;
    const currentTokenBalance = 0;

    return {
      walletAddress,
      mint,
      totalSolSpent,
      totalSolReceived,
      netPnl,
      transactionCount: mintAnalysisInputs.length,
      firstBuyTimestamp,
      lastActivityTimestamp,
      currentTokenBalance,
      currentSolBalance,
      timePeriodStart: startBlockTime,
      timePeriodEnd: endBlockTime
    };

  } catch (error) {
    logger.error(`Error analyzing wallet ${walletAddress}:`, error);
    return null;
  }
}

async function main(): Promise<void> {
  try {
    const { mint, startTimestamp, endTimestamp, minSol, expandHours, maxTransactions } = parseArgs(process.argv);

    if (!process.env.HELIUS_API_KEY) {
      console.error('❌ HELIUS_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info(`Starting time-based significant buyers analysis for token: ${mint}`);
    logger.info(`Time period: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);
    logger.info(`Parameters: minSol=${minSol}, expandHours=${expandHours}, maxTransactions=${maxTransactions}`);

    // Expand time period if requested
    const expandedStart = expandHours > 0 ? startTimestamp - (expandHours * 3600) : startTimestamp;
    const expandedEnd = expandHours > 0 ? endTimestamp + (expandHours * 3600) : endTimestamp;

    logger.info(`Expanded period: ${new Date(expandedStart * 1000).toISOString()} to ${new Date(expandedEnd * 1000).toISOString()}`);

    // Initialize services
    const databaseService = new DatabaseService();
    const heliusClient = new HeliusApiClient({
      apiKey: process.env.HELIUS_API_KEY,
      network: 'mainnet',
      requestsPerSecond: 20
    }, databaseService);

    // Validate Helius V2 API is available
    if (typeof heliusClient['getTransactionsForAddressSignatures'] !== 'function') {
      logger.error('Helius V2 API (getTransactionsForAddressSignatures) not available. Check HeliusApiClient implementation or ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES flag.');
      process.exit(1);
    }

    const startTime = Date.now();

    // Check cache first
    const cached = await checkCacheForPeriod(mint, expandedStart, expandedEnd);
    let walletAddresses: string[];
    let transactions: any[] = [];

    if (cached) {
      logger.info(`✅ Using cached data from ${cached.processedAt.toISOString()}`);
      walletAddresses = cached.walletAddresses;
      // For cached data, we analyze directly from database without reconstructing transactions
      logger.info('🔍 Will analyze cached wallets directly from database records');
    } else {
      logger.info('🔄 No valid cache found, fetching fresh data...');

      // Fetch all transactions for the mint within the time period
      const result = await fetchTransactionsForTimePeriod(
        heliusClient,
        mint,
        expandedStart,
        expandedEnd,
        maxTransactions
      );
      transactions = result.transactions;

      // Extract unique wallet addresses from the already-fetched transactions
      const uniqueWallets = new Set<string>();

      for (const tx of transactions) {
        if (!tx?.tokenTransfers) continue;

        // Find wallets that received this token (filter out likely program accounts)
        const receivers = tx.tokenTransfers
          .filter(transfer =>
            transfer.mint === mint &&
            transfer.toUserAccount &&
            !transfer.toUserAccount.startsWith('1111111') && // System program
            transfer.toUserAccount.length === 44 // Valid Solana address length
          )
          .map(transfer => transfer.toUserAccount);

        receivers.forEach(addr => uniqueWallets.add(addr));
      }

      walletAddresses = Array.from(uniqueWallets);
      logger.info(`✅ Found ${walletAddresses.length} unique wallets that interacted with ${mint}`);

      // Cache the results
      await saveToCache(mint, expandedStart, expandedEnd, walletAddresses, result.totalProcessed);
    }

    // Analyze each wallet for significant activity
    logger.info(`📊 Analyzing ${walletAddresses.length} wallets for significant activity (>= ${minSol} SOL)...`);

    const significantBuyers: SignificantBuyerResult[] = [];
    let processedCount = 0;

    for (const walletAddress of walletAddresses) {
      processedCount++;

      if (processedCount % 50 === 0) {
        const passRate = processedCount > 0 ? ((significantBuyers.length / processedCount) * 100).toFixed(1) : '0.0';
        logger.info(`Progress: ${processedCount}/${walletAddresses.length} wallets analyzed (${significantBuyers.length} significant buyers found, ${passRate}% pass rate)`);
      }

      let result: SignificantBuyerResult | null = null;

      if (cached && transactions.length === 0) {
        // Use direct database aggregation for cached wallets (most efficient!)
        result = await analyzeWalletFromDatabaseRecords(walletAddress, mint, expandedStart, expandedEnd);
      } else if (transactions.length > 0) {
        // Use efficient method with pre-fetched transactions
        const transactionsByWallet = new Map<string, any[]>();

        for (const tx of transactions) {
          if (!tx?.tokenTransfers) continue;

          // Find all wallets involved in this transaction for our mint
          const walletsInTx = new Set<string>();

          for (const transfer of tx.tokenTransfers) {
            if (transfer.mint === mint) {
              if (transfer.toUserAccount) walletsInTx.add(transfer.toUserAccount);
              if (transfer.fromUserAccount) walletsInTx.add(transfer.fromUserAccount);
            }
          }

          // Add this transaction to each wallet's transaction list
          for (const walletAddr of walletsInTx) {
            if (!transactionsByWallet.has(walletAddr)) {
              transactionsByWallet.set(walletAddr, []);
            }
            transactionsByWallet.get(walletAddr)!.push(tx);
          }
        }

        // CRITICAL FIX: Deduplicate transactions for this wallet
        const walletTransactions = [...new Set(transactionsByWallet.get(walletAddress) || [])];

        if (walletTransactions.length === 0) {
          logger.debug(`Wallet ${walletAddress} has no transactions for mint ${mint} in this period`);
          continue; // Skip to next wallet
        }

        result = await analyzeWalletActivityFromTransactions(
          heliusClient,
          databaseService,
          walletAddress,
          mint,
          walletTransactions,
          expandedStart,
          expandedEnd
        );
      } else {
        // Fallback to individual API calls for fresh data without cache
        result = await analyzeWalletActivityCached(
          heliusClient,
          databaseService,
          walletAddress,
          mint,
          expandedStart,
          expandedEnd
        );
      }

      if (result && result.totalSolSpent >= minSol) {
        significantBuyers.push(result);
        logger.debug(`✅ Significant buyer: ${walletAddress} - ${result.totalSolSpent.toFixed(2)} SOL spent`);
      }
    }

    // Sort by total SOL spent (descending)
    significantBuyers.sort((a, b) => b.totalSolSpent - a.totalSolSpent);

    const duration = (Date.now() - startTime) / 1000;

    // Generate reports
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'analysis_reports');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const csvPath = path.join(outputDir, `time_based_significant_buyers_${mint}_${timestamp}.csv`);
    const mdPath = path.join(outputDir, `time_based_significant_buyers_${mint}_${timestamp}.md`);
    const txtPath = path.join(outputDir, `wallet_addresses_time_based_${mint}_${timestamp}.txt`);

    // Generate CSV
    const csvLines = [
      'Rank,Wallet Address,SOL Spent,SOL Received,Net PnL,Transaction Count,First Buy Date,Last Activity Date,Current Token Balance,Current SOL Balance'
    ];

    significantBuyers.forEach((result, index) => {
      const firstBuyDate = new Date(result.firstBuyTimestamp * 1000).toISOString();
      const lastActivityDate = new Date(result.lastActivityTimestamp * 1000).toISOString();
      csvLines.push(
        `${index + 1},${result.walletAddress},${result.totalSolSpent.toFixed(4)},${result.totalSolReceived.toFixed(4)},${result.netPnl.toFixed(4)},${result.transactionCount},${firstBuyDate},${lastActivityDate},${result.currentTokenBalance.toFixed(2)},${result.currentSolBalance.toFixed(4)}`
      );
    });

    fs.writeFileSync(csvPath, csvLines.join('\n'));

    // Generate Markdown report
    const totalSolInvested = significantBuyers.reduce((sum, r) => sum + r.totalSolSpent, 0);
    const averagePnl = significantBuyers.length > 0 ? significantBuyers.reduce((sum, r) => sum + r.netPnl, 0) / significantBuyers.length : 0;
    const winnersCount = significantBuyers.filter(r => r.netPnl > 0).length;
    const losersCount = significantBuyers.filter(r => r.netPnl < 0).length;

    const mdLines = [
      `# Time-Based Significant Buyers Analysis Report`,
      ``,
      `**Token Mint:** \`${mint}\`  `,
      `**Analysis Date:** ${new Date().toISOString()}  `,
      `**Time Period:** ${new Date(expandedStart * 1000).toISOString()} to ${new Date(expandedEnd * 1000).toISOString()}  `,
      `**Criteria:** Min ${minSol} SOL spent  `,
      `**Expand Hours:** ${expandHours}  `,
      ``,
      `## Summary`,
      ``,
      `- **Wallets Analyzed:** ${walletAddresses.length}`,
      `- **Significant Buyers Found:** ${significantBuyers.length}`,
      `- **Total SOL Invested:** ${totalSolInvested.toFixed(2)} SOL`,
      `- **Average PnL:** ${averagePnl.toFixed(4)} SOL`,
      `- **Winners:** ${winnersCount} (${((winnersCount / significantBuyers.length) * 100).toFixed(1)}%)`,
      `- **Losers:** ${losersCount} (${((losersCount / significantBuyers.length) * 100).toFixed(1)}%)`,
      `- **Processing Time:** ${duration.toFixed(2)} seconds`,
      ``,
      `## Top Significant Buyers by Investment`,
      ``,
      `| Rank | Wallet Address | SOL Spent | Net PnL | TX Count | First Buy | Last Activity | Current Tokens | Current SOL |`,
      `|------|---------------|-----------|---------|----------|-----------|---------------|----------------|-------------|`
    ];

    significantBuyers.slice(0, 50).forEach((result, index) => {
      const firstBuyDate = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
      const lastActivityDate = new Date(result.lastActivityTimestamp * 1000).toISOString().split('T')[0];
      mdLines.push(
        `| ${index + 1} | \`${result.walletAddress}\` | ${result.totalSolSpent.toFixed(2)} | **${result.netPnl.toFixed(2)}** | ${result.transactionCount} | ${firstBuyDate} | ${lastActivityDate} | ${result.currentTokenBalance.toFixed(2)} | ${result.currentSolBalance.toFixed(4)} |`
      );
    });

    if (significantBuyers.length > 50) {
      mdLines.push(``, `*... and ${significantBuyers.length - 50} more significant buyers (see CSV for full list)*`);
    }

    fs.writeFileSync(mdPath, mdLines.join('\n'));

    // Generate simple wallet list
    const walletList = significantBuyers.map(r => r.walletAddress).join('\n');
    fs.writeFileSync(txtPath, walletList);

    // Console output
    console.log('\n' + '='.repeat(100));
    console.log('TIME-BASED SIGNIFICANT BUYERS ANALYSIS COMPLETE');
    console.log('='.repeat(100));
    console.log(`Token Mint: ${mint}`);
    console.log(`Time Period: ${new Date(expandedStart * 1000).toISOString()} to ${new Date(expandedEnd * 1000).toISOString()}`);
    console.log(`Criteria: Min ${minSol} SOL spent`);
    console.log(`Wallets Analyzed: ${walletAddresses.length}`);
    console.log(`Significant Buyers Found: ${significantBuyers.length}`);
    console.log(`Total SOL Invested: ${totalSolInvested.toFixed(2)} SOL`);
    console.log(`Average PnL: ${averagePnl.toFixed(4)} SOL`);
    console.log(`Winners: ${winnersCount} (${((winnersCount / significantBuyers.length) * 100).toFixed(1)}%)`);
    console.log(`Losers: ${losersCount} (${((losersCount / significantBuyers.length) * 100).toFixed(1)}%)`);
    console.log(`Processing Time: ${duration.toFixed(2)} seconds`);
    console.log('='.repeat(100));

    if (significantBuyers.length > 0) {
      console.log('\n📋 TOP 20 SIGNIFICANT BUYERS BY INVESTMENT:');
      console.log('-'.repeat(120));
      console.log('Rank | Wallet Address                                     | SOL Spent | Net PnL  | TX | First Buy | Last Activity | Tokens  | SOL Bal');
      console.log('-'.repeat(120));

      significantBuyers.slice(0, 20).forEach((result, index) => {
        const firstBuyDate = new Date(result.firstBuyTimestamp * 1000).toISOString().split('T')[0];
        const lastActivityDate = new Date(result.lastActivityTimestamp * 1000).toISOString().split('T')[0];
        const rank = (index + 1).toString().padStart(2, ' ');
        const spent = result.totalSolSpent.toFixed(2).padStart(9, ' ');
        const pnl = result.netPnl.toFixed(2).padStart(8, ' ');
        const tx = result.transactionCount.toString().padStart(2, ' ');
        const tokenBal = result.currentTokenBalance.toFixed(0).padStart(7, ' ');
        const solBal = result.currentSolBalance.toFixed(2).padStart(7, ' ');

        console.log(`${rank}   | ${result.walletAddress} | ${spent} | ${pnl} | ${tx} | ${firstBuyDate} | ${lastActivityDate} | ${tokenBal} | ${solBal}`);
      });

      if (significantBuyers.length > 20) {
        console.log(`... and ${significantBuyers.length - 20} more significant buyers (see full report)`);
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
      console.log('npx ts-node -r tsconfig-paths/register src/scripts/timeBasedSignificantBuyersAnalysis.ts <MINT_ADDRESS> [options]');
      console.log('\nRequired Options:');
      console.log('  --start-timestamp=N    Start timestamp (Unix seconds)');
      console.log('  --end-timestamp=N      End timestamp (Unix seconds)');
      console.log('\nOptional:');
      console.log('  --min-sol=N           Minimum SOL investment (default: 2)');
      console.log('  --expand-hours=N      Hours to expand search before/after (default: 0)');
      console.log('  --max-transactions=N  Maximum transactions to process (default: 10000)');
      console.log('\nExample:');
      console.log('npx ts-node -r tsconfig-paths/register src/scripts/timeBasedSignificantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --start-timestamp=1704067200 --end-timestamp=1704153600 --min-sol=2 --expand-hours=24');
    }

    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
