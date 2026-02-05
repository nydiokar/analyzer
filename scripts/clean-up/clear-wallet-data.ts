#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../src/core/utils/logger';

// Set up logger
const logger = createLogger('ClearWalletData');

// Initialize Prisma client
const prisma = new PrismaClient();

/**
 * Clear all data for a specific wallet address
 */
const SIGNATURE_CHUNK_SIZE = 10000;

function ensureWalletAddress(value: unknown): string {
  const wallet = typeof value === 'string' ? value.trim() : '';
  if (!wallet || wallet.toLowerCase() === 'undefined') {
    throw new Error('Wallet address is required and must be a non-empty string.');
  }
  return wallet;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function clearWalletData(walletAddress: string, dryRun: boolean = false) {
  const wallet = ensureWalletAddress(walletAddress);
  logger.info(`Starting cleanup for wallet: ${wallet}`);

  if (dryRun) {
    logger.info('DRY RUN MODE: No records will be deleted');
  }

  // First, we need to get all signatures associated with this wallet to clear transaction cache
  logger.info('Step 1: Identifying cached transactions to clear...');
  const swapSignatures = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: wallet },
    select: { signature: true },
    distinct: ['signature']
  });
  const signaturesToClear = swapSignatures.map(s => s.signature);
  logger.info(`Found ${signaturesToClear.length} unique signatures to clear from HeliusTransactionCache`);

  // Tables to clear (in order of dependencies)
  // Must delete child tables with foreign keys first, then parent Wallet table last
  const tables = [
    // Independent tables without foreign keys to Wallet
    { name: 'SwapAnalysisInput', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'AnalysisRun', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'MappingActivityLog', field: 'walletAddress', where: { walletAddress: wallet } },
    // Tables with foreign keys to Wallet (must be deleted before Wallet)
    { name: 'HolderProfileSnapshot', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'TokenLot', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'AnalysisResult', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'ActivityLog', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'WalletNote', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'UserFavoriteWallet', field: 'walletAddress', where: { walletAddress: wallet } },
    // WalletPnlSummary and its child (AdvancedTradeStats will cascade delete)
    { name: 'WalletPnlSummary', field: 'walletAddress', where: { walletAddress: wallet } },
    { name: 'WalletBehaviorProfile', field: 'walletAddress', where: { walletAddress: wallet } },
    // Finally delete the Wallet record itself
    { name: 'Wallet', field: 'address', where: { address: wallet } }
  ];

  let totalDeleted = 0;

  for (const table of tables) {
    try {
      // Count records
      // @ts-ignore - Dynamic table access
      const count = await prisma[table.name].count({ where: table.where });
      
      if (count === 0) {
        logger.info(`${table.name}: No records to delete`);
        continue;
      }

      logger.info(`${table.name}: Found ${count} records to delete`);

      if (dryRun) {
        logger.info(`DRY RUN: Would delete ${count} records from ${table.name}`);
        totalDeleted += count;
        continue;
      }

      // Delete records
      // @ts-ignore - Dynamic table access
      const result = await prisma[table.name].deleteMany({ where: table.where });
      
      logger.info(`${table.name}: Deleted ${result.count} records`);
      totalDeleted += result.count;

    } catch (error) {
      logger.error(`Error clearing ${table.name}`, { error });
    }
  }

  // Step 2: Clear HeliusTransactionCache for this wallet's signatures
  logger.info('Step 2: Clearing HeliusTransactionCache...');
  if (signaturesToClear.length > 0) {
    try {
      for (const chunk of chunkArray(signaturesToClear, SIGNATURE_CHUNK_SIZE)) {
        if (dryRun) {
          const cacheCount = await prisma.heliusTransactionCache.count({
            where: { signature: { in: chunk } }
          });
          logger.info(`DRY RUN: Would delete ${cacheCount} HeliusTransactionCache records`);
          totalDeleted += cacheCount;
        } else {
          const result = await prisma.heliusTransactionCache.deleteMany({
            where: { signature: { in: chunk } }
          });
          totalDeleted += result.count;
        }
      }
      if (!dryRun) {
        logger.info('HeliusTransactionCache: Deleted cached transaction records');
      }
    } catch (error) {
      logger.error('Error clearing HeliusTransactionCache', { error });
    }
  } else {
    logger.info('HeliusTransactionCache: No signatures to clear (wallet had no swap records)');
  }

  if (dryRun) {
    logger.info(`DRY RUN COMPLETE: Would delete ${totalDeleted} total records`);
  } else {
    logger.info(`CLEANUP COMPLETE: Deleted ${totalDeleted} total records for wallet ${wallet}`);
    logger.info('Next sync will re-fetch all data for this wallet');
  }
}

// CLI setup
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('clear-wallet-data')
    .command('$0 <wallet>', 'Clear all data for a specific wallet', (cmd) =>
      cmd.positional('wallet', {
        description: 'Wallet address to clear all data for',
        type: 'string',
        demandOption: true
      })
    )
    .option('dryRun', {
      alias: 'd',
      description: 'Perform a dry run without actually deleting records',
      type: 'boolean',
      default: false
    })
    .example('$0 DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', 'Clear all data for specific wallet')
    .example('$0 abc123 --dryRun', 'Dry run to see what would be deleted')
    .strict()
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .epilogue('Clears all database records for a specific wallet address. Use with caution!')
    .parse();

  try {
    // Confirm before proceeding (unless dry run)
    const wallet = ensureWalletAddress(argv.wallet);

    if (!argv.dryRun) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      await new Promise<void>((resolve) => {
        readline.question(`Are you sure you want to delete ALL data for wallet ${wallet}? This cannot be undone! (yes/no): `, (answer: string) => {
          if (answer.toLowerCase() !== 'yes') {
            logger.info('Operation cancelled by user');
            process.exit(0);
          }
          readline.close();
          resolve();
        });
      });
    }

    await clearWalletData(wallet, argv.dryRun);
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Unhandled error during cleanup process', { error });
    await prisma.$disconnect();
    process.exit(1);
  }
})(); 
