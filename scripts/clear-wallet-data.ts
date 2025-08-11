#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../src/core/utils/logger';

// Set up logger
const logger = createLogger('ClearWalletData');

// Initialize Prisma client
const prisma = new PrismaClient();

/**
 * Clear all data for a specific wallet address
 */
async function clearWalletData(walletAddress: string, dryRun: boolean = false) {
  logger.info(`Starting cleanup for wallet: ${walletAddress}`);
  
  if (dryRun) {
    logger.info('DRY RUN MODE: No records will be deleted');
  }

  // Tables to clear (in order of dependencies)
  const tables = [
    { name: 'HeliusTransactionCache', field: 'signature', where: {} },
    { name: 'SwapAnalysisInput', field: 'walletAddress', where: { walletAddress } },
    { name: 'AnalysisResult', field: 'walletAddress', where: { walletAddress } },
    { name: 'WalletPnlSummary', field: 'walletAddress', where: { walletAddress } },
    { name: 'WalletBehaviorProfile', field: 'walletAddress', where: { walletAddress } },
    { name: 'AnalysisRun', field: 'walletAddress', where: { walletAddress } },
    { name: 'ActivityLog', field: 'walletAddress', where: { walletAddress } },
    { name: 'MappingActivityLog', field: 'walletAddress', where: { walletAddress } },
    { name: 'WalletNote', field: 'walletAddress', where: { walletAddress } },
    { name: 'UserFavoriteWallet', field: 'walletAddress', where: { walletAddress } },
    { name: 'Wallet', field: 'address', where: { address: walletAddress } }
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

  if (dryRun) {
    logger.info(`DRY RUN COMPLETE: Would delete ${totalDeleted} total records`);
  } else {
    logger.info(`CLEANUP COMPLETE: Deleted ${totalDeleted} total records for wallet ${walletAddress}`);
    logger.info('Next sync will re-fetch all data for this wallet');
  }
}

// CLI setup
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('clear-wallet-data')
    .usage('$0 --wallet <WALLET_ADDRESS> [options]')
    .option('wallet', {
      alias: 'w',
      description: 'Wallet address to clear all data for',
      type: 'string',
      demandOption: true
    })
    .option('dryRun', {
      alias: 'd',
      description: 'Perform a dry run without actually deleting records',
      type: 'boolean',
      default: false
    })
    .example('$0 --wallet DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', 'Clear all data for specific wallet')
    .example('$0 --wallet abc123 --dryRun', 'Dry run to see what would be deleted')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .epilogue('Clears all database records for a specific wallet address. Use with caution!')
    .parse();

  try {
    // Confirm before proceeding (unless dry run)
    if (!argv.dryRun) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      await new Promise<void>((resolve) => {
        readline.question(`Are you sure you want to delete ALL data for wallet ${argv.wallet}? This cannot be undone! (yes/no): `, (answer: string) => {
          if (answer.toLowerCase() !== 'yes') {
            logger.info('Operation cancelled by user');
            process.exit(0);
          }
          readline.close();
          resolve();
        });
      });
    }

    await clearWalletData(argv.wallet, argv.dryRun);
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Unhandled error during cleanup process', { error });
    await prisma.$disconnect();
    process.exit(1);
  }
})(); 