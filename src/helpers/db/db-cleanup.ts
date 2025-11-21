#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { prisma } from '../../core/services/database-service';
import { createLogger } from '../../core/utils/logger';

// Set up logger
const logger = createLogger('DbCleanupScript');

// Initialize Prisma client

/**
 * Cleanup database tables safely using batched deletion
 */
async function cleanupTable(options: {
  table: string;
  batchSize: number;
  where?: Record<string, any>;
  dryRun: boolean;
  startId?: number;
  endId?: number;
  olderThan?: string;
  newerThan?: string;
  walletAddress?: string;
}) {
  const { 
    table, 
    batchSize, 
    where = {}, 
    dryRun, 
    startId, 
    endId, 
    olderThan, 
    newerThan,
    walletAddress 
  } = options;

  logger.info(`Starting cleanup for table: ${table}`);
  if (dryRun) {
    logger.info('DRY RUN MODE: No records will be deleted');
  }

  // Build where clause
  const whereClause: Record<string, any> = { ...where };
  
  // Add ID range if specified
  if (startId !== undefined) {
    whereClause.id = whereClause.id || {};
    whereClause.id.gte = startId;
  }
  if (endId !== undefined) {
    whereClause.id = whereClause.id || {};
    whereClause.id.lte = endId;
  }
  
  // Add timestamp filters if specified
  if (olderThan) {
    // Handle different timestamp field names based on table
    let timestampField = 'timestamp';
    if (table === 'HeliusTransactionCache') {
      timestampField = 'timestamp';
    } else if (table === 'AnalysisRun') {
      timestampField = 'runTimestamp';
    } else if (table === 'Wallet') {
      timestampField = 'lastSuccessfulFetchTimestamp';
    }
    
    const olderThanDate = new Date(olderThan);
    // For timestamp fields that are stored as integers (Unix timestamps)
    if (table === 'SwapAnalysisInput' || table === 'HeliusTransactionCache') {
      whereClause[timestampField] = { 
        lt: Math.floor(olderThanDate.getTime() / 1000) 
      };
    } else {
      // For DateTime fields
      whereClause[timestampField] = { lt: olderThanDate };
    }
  }
  
  if (newerThan) {
    // Handle different timestamp field names based on table
    let timestampField = 'timestamp';
    if (table === 'HeliusTransactionCache') {
      timestampField = 'timestamp';
    } else if (table === 'AnalysisRun') {
      timestampField = 'runTimestamp';
    } else if (table === 'Wallet') {
      timestampField = 'lastSuccessfulFetchTimestamp';
    }
    
    const newerThanDate = new Date(newerThan);
    // For timestamp fields that are stored as integers (Unix timestamps)
    if (table === 'SwapAnalysisInput' || table === 'HeliusTransactionCache') {
      whereClause[timestampField] = {
        ...whereClause[timestampField],
        gt: Math.floor(newerThanDate.getTime() / 1000)
      };
    } else {
      // For DateTime fields
      whereClause[timestampField] = {
        ...whereClause[timestampField],
        gt: newerThanDate
      };
    }
  }
  
  // Add wallet address filter if specified
  if (walletAddress) {
    whereClause.walletAddress = walletAddress;
  }

  // Get count of matching records
  let totalCount = 0;
  try {
    // @ts-ignore - Dynamic table access
    totalCount = await prisma[table].count({ where: whereClause });
    logger.info(`Found ${totalCount} records matching criteria`);
  } catch (error) {
    logger.error(`Error counting records in ${table}`, { error });
    process.exit(1);
  }

  if (totalCount === 0) {
    logger.info('No records to delete. Exiting.');
    return;
  }

  if (dryRun) {
    logger.info(`DRY RUN: Would delete ${totalCount} records in batches of ${batchSize}`);
    return;
  }

  // Confirm with user before proceeding
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise<void>((resolve) => {
    readline.question(`Are you sure you want to delete ${totalCount} records from ${table}? (yes/no): `, (answer: string) => {
      if (answer.toLowerCase() !== 'yes') {
        logger.info('Operation cancelled by user');
        process.exit(0);
      }
      readline.close();
      resolve();
    });
  });

  // Process in batches
  let deleted = 0;
  let batchNum = 1;
  
  while (deleted < totalCount) {
    try {
      // Find batch of records to delete
      // @ts-ignore - Dynamic table access
      const recordsToDelete = await prisma[table].findMany({
        where: whereClause,
        take: batchSize,
        orderBy: { id: 'asc' },
        select: { id: true }
      });
      
      if (recordsToDelete.length === 0) break;
      
      // Extract IDs for this batch
      const idsToDelete = recordsToDelete.map((r: { id: number }) => r.id);
      
      // Delete the batch
      // @ts-ignore - Dynamic table access
      const result = await prisma[table].deleteMany({
        where: { id: { in: idsToDelete } }
      });
      
      deleted += result.count;
      logger.info(`Batch ${batchNum}: Deleted ${result.count} records (${deleted}/${totalCount})`);
      batchNum++;
      
      // Optional: Add a small delay to reduce database pressure
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.error(`Error in batch ${batchNum}`, { error });
      // Continue with next batch despite errors
    }
  }

  logger.info(`Cleanup completed. Total records deleted: ${deleted}`);
}

// CLI setup
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('db-cleanup')
    .usage('$0 --table TABLE_NAME [options]')
    .option('table', {
      alias: 't',
      description: 'Table to clean up (SwapAnalysisInput, HeliusTransactionCache, AnalysisRun, etc.)',
      type: 'string',
      demandOption: true
    })
    .option('batchSize', {
      alias: 'b',
      description: 'Number of records to delete in each batch',
      type: 'number',
      default: 500
    })
    .option('dryRun', {
      alias: 'd',
      description: 'Perform a dry run without actually deleting records',
      type: 'boolean',
      default: false
    })
    .option('startId', {
      description: 'Start ID for range deletion',
      type: 'number'
    })
    .option('endId', {
      description: 'End ID for range deletion',
      type: 'number'
    })
    .option('olderThan', {
      description: 'Delete records older than this date (YYYY-MM-DD)',
      type: 'string'
    })
    .option('newerThan', {
      description: 'Delete records newer than this date (YYYY-MM-DD)',
      type: 'string'
    })
    .option('walletAddress', {
      alias: 'w',
      description: 'Wallet address to filter records by',
      type: 'string'
    })
    .example('$0 --table SwapAnalysisInput --batchSize 1000', 'Delete all SwapAnalysisInput records in batches of 1000')
    .example('$0 --table HeliusTransactionCache --olderThan 2023-01-01', 'Delete transactions older than Jan 1, 2023')
    .example('$0 --table SwapAnalysisInput --walletAddress abc123 --dryRun', 'Dry run for deleting all records for a specific wallet')
    .example('$0 --table AnalysisRun --startId 1 --endId 100', 'Delete analysis runs with IDs between 1 and 100')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .epilogue('Safely cleans up database tables using batched deletions to avoid timeouts.')
    .parse();

  try {
    await cleanupTable({
      table: argv.table,
      batchSize: argv.batchSize,
      dryRun: argv.dryRun,
      startId: argv.startId,
      endId: argv.endId,
      olderThan: argv.olderThan,
      newerThan: argv.newerThan,
      walletAddress: argv.walletAddress
    });
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Unhandled error during cleanup process', { error });
    await prisma.$disconnect();
    process.exit(1);
  }
})(); 