#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../src/core/utils/logger';

const logger = createLogger('ClearHeliusCache');
const prisma = new PrismaClient();

function requireAllFlag(value: unknown): boolean {
  const all = value === true;
  if (!all) {
    throw new Error('Refusing to proceed without --all. This clears the entire HeliusTransactionCache table.');
  }
  return all;
}

(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('clear-helius-cache')
    .usage('$0 --all [options]')
    .option('all', {
      description: 'Delete every row in HeliusTransactionCache',
      type: 'boolean',
      default: false
    })
    .option('dryRun', {
      alias: 'd',
      description: 'Report how many rows would be deleted without deleting',
      type: 'boolean',
      default: false
    })
    .strict()
    .help()
    .alias('help', 'h')
    .epilogue('Clears the Helius transaction cache table. Use with extreme caution.')
    .parse();

  try {
    requireAllFlag(argv.all);

    const totalCount = await prisma.heliusTransactionCache.count();
    logger.info(`HeliusTransactionCache: Found ${totalCount} records`);

    if (argv.dryRun) {
      logger.info('DRY RUN: No records deleted');
      await prisma.$disconnect();
      process.exit(0);
    }

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise<void>((resolve) => {
      readline.question('Are you sure you want to delete ALL HeliusTransactionCache records? This cannot be undone! (yes/no): ', (answer: string) => {
        if (answer.toLowerCase() !== 'yes') {
          logger.info('Operation cancelled by user');
          process.exit(0);
        }
        readline.close();
        resolve();
      });
    });

    const result = await prisma.heliusTransactionCache.deleteMany();
    logger.info(`HeliusTransactionCache: Deleted ${result.count} records`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Unhandled error during cache cleanup', { error });
    await prisma.$disconnect();
    process.exit(1);
  }
})();
