#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
// Simple logger to avoid chalk compatibility issues
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : ''),
  warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '')
};

// Initialize Prisma client
const prisma = new PrismaClient();

interface CleanupStats {
  watchedTokensDeleted: number;
  messagesDeleted: number;
  messageMentionsDeleted: number;
  messageRevisionsDeleted: number;
  tokenTagsDeleted: number;
  tagsDeleted: number;
  tokenInfoDeleted: number;
  totalRecordsDeleted: number;
}

/**
 * Clean up watched tokens and related data
 */
async function cleanupWatchedTokens(options: {
  dryRun: boolean;
  olderThanDays?: number;
  list?: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG';
  keepActive?: boolean;
}): Promise<CleanupStats> {
  const stats: CleanupStats = {
    watchedTokensDeleted: 0,
    messagesDeleted: 0,
    messageMentionsDeleted: 0,
    messageRevisionsDeleted: 0,
    tokenTagsDeleted: 0,
    tagsDeleted: 0,
    tokenInfoDeleted: 0,
    totalRecordsDeleted: 0
  };

  logger.info('Starting watched tokens cleanup...');

  if (options.dryRun) {
    logger.info('DRY RUN MODE: No records will be deleted');
  }

  try {
    // Build where clause for watched tokens
    let watchedTokenWhere: any = {};
    
    if (options.list) {
      watchedTokenWhere.list = options.list;
    }
    
    if (options.olderThanDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.olderThanDays);
      watchedTokenWhere.createdAt = { lt: cutoffDate };
    }

    // Get watched tokens to delete
    const watchedTokens = await prisma.watchedToken.findMany({
      where: watchedTokenWhere,
      select: { 
        id: true, 
        tokenAddress: true,
        createdAt: true,
        list: true
      }
    });

    if (watchedTokens.length === 0) {
      logger.info('No watched tokens found matching criteria');
      return stats;
    }

    logger.info(`Found ${watchedTokens.length} watched tokens to clean up`);

    // If keeping active tokens, filter out those with recent messages
    let tokensToDelete = watchedTokens;
    if (options.keepActive) {
      const activeTokens = new Set<string>();
      
      for (const token of watchedTokens) {
        const recentMessage = await prisma.message.findFirst({
          where: {
            mentions: {
              some: {
                kind: 'TOKEN',
                refId: token.tokenAddress
              }
            },
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
            }
          }
        });
        
        if (!recentMessage) {
          activeTokens.add(token.tokenAddress);
        }
      }
      
      tokensToDelete = watchedTokens.filter(t => activeTokens.has(t.tokenAddress));
      logger.info(`Filtered to ${tokensToDelete.length} inactive tokens (${watchedTokens.length - tokensToDelete.length} active tokens kept)`);
    }

    if (tokensToDelete.length === 0) {
      logger.info('No inactive watched tokens found after filtering');
      return stats;
    }

    const tokenAddresses = tokensToDelete.map(t => t.tokenAddress);

    // Delete in dependency order
    if (!options.dryRun) {
      await prisma.$transaction(async (tx) => {
        // 1. Delete message mentions for these tokens
        const messageMentionsResult = await tx.messageMention.deleteMany({
          where: {
            kind: 'TOKEN',
            refId: { in: tokenAddresses }
          }
        });
        stats.messageMentionsDeleted = messageMentionsResult.count;
        logger.info(`Deleted ${messageMentionsResult.count} message mentions`);

        // 2. Delete token tags
        const tokenTagsResult = await tx.tokenTag.deleteMany({
          where: {
            tokenAddress: { in: tokenAddresses }
          }
        });
        stats.tokenTagsDeleted = tokenTagsResult.count;
        logger.info(`Deleted ${tokenTagsResult.count} token tags`);

        // 3. Delete watched tokens
        const watchedTokensResult = await tx.watchedToken.deleteMany({
          where: {
            id: { in: tokensToDelete.map(t => t.id) }
          }
        });
        stats.watchedTokensDeleted = watchedTokensResult.count;
        logger.info(`Deleted ${watchedTokensResult.count} watched tokens`);

        // 4. Delete orphaned tags (tags with no remaining token associations)
        const orphanedTags = await tx.tag.findMany({
          where: {
            tokenTags: {
              none: {}
            }
          },
          select: { id: true }
        });

        if (orphanedTags.length > 0) {
          const tagsResult = await tx.tag.deleteMany({
            where: {
              id: { in: orphanedTags.map(t => t.id) }
            }
          });
          stats.tagsDeleted = tagsResult.count;
          logger.info(`Deleted ${tagsResult.count} orphaned tags`);
        }

        // 5. Delete orphaned token info (tokens with no watched associations)
        const orphanedTokenInfo = await tx.tokenInfo.findMany({
          where: {
            tokenAddress: { in: tokenAddresses },
            watchedTokens: {
              none: {}
            }
          },
          select: { tokenAddress: true }
        });

        if (orphanedTokenInfo.length > 0) {
          const tokenInfoResult = await tx.tokenInfo.deleteMany({
            where: {
              tokenAddress: { in: orphanedTokenInfo.map(t => t.tokenAddress) }
            }
          });
          stats.tokenInfoDeleted = tokenInfoResult.count;
          logger.info(`Deleted ${tokenInfoResult.count} orphaned token info records`);
        }
      });
    } else {
      // Dry run - just count what would be deleted
      const messageMentionsCount = await prisma.messageMention.count({
        where: {
          kind: 'TOKEN',
          refId: { in: tokenAddresses }
        }
      });
      stats.messageMentionsDeleted = messageMentionsCount;

      const tokenTagsCount = await prisma.tokenTag.count({
        where: {
          tokenAddress: { in: tokenAddresses }
        }
      });
      stats.tokenTagsDeleted = tokenTagsCount;

      stats.watchedTokensDeleted = tokensToDelete.length;

      logger.info(`DRY RUN: Would delete ${messageMentionsCount} message mentions`);
      logger.info(`DRY RUN: Would delete ${tokenTagsCount} token tags`);
      logger.info(`DRY RUN: Would delete ${tokensToDelete.length} watched tokens`);
    }

    stats.totalRecordsDeleted = stats.watchedTokensDeleted + stats.messageMentionsDeleted + 
                               stats.tokenTagsDeleted + stats.tagsDeleted + stats.tokenInfoDeleted;

  } catch (error) {
    logger.error('Error during watched tokens cleanup', { error });
    throw error;
  }

  return stats;
}

/**
 * Clean up global chat messages
 */
async function cleanupGlobalChat(options: {
  dryRun: boolean;
  olderThanDays?: number;
  keepLast?: number;
  source?: 'DASHBOARD' | 'TELEGRAM' | 'BOT';
}): Promise<CleanupStats> {
  const stats: CleanupStats = {
    watchedTokensDeleted: 0,
    messagesDeleted: 0,
    messageMentionsDeleted: 0,
    messageRevisionsDeleted: 0,
    tokenTagsDeleted: 0,
    tagsDeleted: 0,
    tokenInfoDeleted: 0,
    totalRecordsDeleted: 0
  };

  logger.info('Starting global chat cleanup...');

  if (options.dryRun) {
    logger.info('DRY RUN MODE: No records will be deleted');
  }

  try {
    // Build where clause for messages
    let messageWhere: any = {};
    
    if (options.source) {
      messageWhere.source = options.source;
    }
    
    if (options.olderThanDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.olderThanDays);
      messageWhere.createdAt = { lt: cutoffDate };
    }

    // Get messages to delete
    let messagesToDelete = await prisma.message.findMany({
      where: messageWhere,
      select: { 
        id: true, 
        createdAt: true,
        source: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (messagesToDelete.length === 0) {
      logger.info('No messages found matching criteria');
      return stats;
    }

    // If keepLast is specified, keep the most recent N messages
    if (options.keepLast && options.keepLast > 0) {
      messagesToDelete = messagesToDelete.slice(options.keepLast);
      logger.info(`Keeping last ${options.keepLast} messages, ${messagesToDelete.length} will be deleted`);
    }

    if (messagesToDelete.length === 0) {
      logger.info('No messages to delete after applying keepLast filter');
      return stats;
    }

    logger.info(`Found ${messagesToDelete.length} messages to clean up`);

    const messageIds = messagesToDelete.map(m => m.id);

    // Delete in dependency order
    if (!options.dryRun) {
      await prisma.$transaction(async (tx) => {
        // 1. Delete message revisions
        const revisionsResult = await tx.messageRevision.deleteMany({
          where: {
            messageId: { in: messageIds }
          }
        });
        stats.messageRevisionsDeleted = revisionsResult.count;
        logger.info(`Deleted ${revisionsResult.count} message revisions`);

        // 2. Delete message mentions
        const mentionsResult = await tx.messageMention.deleteMany({
          where: {
            messageId: { in: messageIds }
          }
        });
        stats.messageMentionsDeleted = mentionsResult.count;
        logger.info(`Deleted ${mentionsResult.count} message mentions`);

        // 3. Delete messages
        const messagesResult = await tx.message.deleteMany({
          where: {
            id: { in: messageIds }
          }
        });
        stats.messagesDeleted = messagesResult.count;
        logger.info(`Deleted ${messagesResult.count} messages`);
      });
    } else {
      // Dry run - just count what would be deleted
      const revisionsCount = await prisma.messageRevision.count({
        where: {
          messageId: { in: messageIds }
        }
      });
      stats.messageRevisionsDeleted = revisionsCount;

      const mentionsCount = await prisma.messageMention.count({
        where: {
          messageId: { in: messageIds }
        }
      });
      stats.messageMentionsDeleted = mentionsCount;

      stats.messagesDeleted = messagesToDelete.length;

      logger.info(`DRY RUN: Would delete ${revisionsCount} message revisions`);
      logger.info(`DRY RUN: Would delete ${mentionsCount} message mentions`);
      logger.info(`DRY RUN: Would delete ${messagesToDelete.length} messages`);
    }

    stats.totalRecordsDeleted = stats.messagesDeleted + stats.messageMentionsDeleted + stats.messageRevisionsDeleted;

  } catch (error) {
    logger.error('Error during global chat cleanup', { error });
    throw error;
  }

  return stats;
}

/**
 * Show current statistics
 */
async function showStats() {
  logger.info('Current database statistics:');
  
  const watchedTokensCount = await prisma.watchedToken.count();
  const messagesCount = await prisma.message.count();
  const messageMentionsCount = await prisma.messageMention.count();
  const messageRevisionsCount = await prisma.messageRevision.count();
  const tokenTagsCount = await prisma.tokenTag.count();
  const tagsCount = await prisma.tag.count();
  const tokenInfoCount = await prisma.tokenInfo.count();

  logger.info(`Watched Tokens: ${watchedTokensCount}`);
  logger.info(`Messages: ${messagesCount}`);
  logger.info(`Message Mentions: ${messageMentionsCount}`);
  logger.info(`Message Revisions: ${messageRevisionsCount}`);
  logger.info(`Token Tags: ${tokenTagsCount}`);
  logger.info(`Tags: ${tagsCount}`);
  logger.info(`Token Info: ${tokenInfoCount}`);

  // Show breakdown by list
  const watchedTokensByList = await prisma.watchedToken.groupBy({
    by: ['list'],
    _count: { list: true }
  });

  logger.info('Watched tokens by list:');
  for (const group of watchedTokensByList) {
    logger.info(`  ${group.list}: ${group._count.list}`);
  }

  // Show breakdown by source
  const messagesBySource = await prisma.message.groupBy({
    by: ['source'],
    _count: { source: true }
  });

  logger.info('Messages by source:');
  for (const group of messagesBySource) {
    logger.info(`  ${group.source}: ${group._count.source}`);
  }
}

// Simple argument parsing to avoid yargs compatibility issues
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === '--help' || command === '-h') {
    console.log(`
Cleanup Watched Tokens and Global Chat

Usage: npm run cleanup-watched-tokens-chat <command> [options]

Commands:
  tokens                 Clean up watched tokens
  chat                   Clean up global chat messages  
  stats                  Show current database statistics
  all                    Clean up both watched tokens and chat messages

Options:
  --dryRun, -d           Perform a dry run without actually deleting records
  --olderThanDays, -o    Only delete records older than N days
  --list, -l             Only clean up specific list (FAVORITES, GRADUATION, HOLDSTRONG)
  --keepActive, -k       Keep tokens with recent message activity (last 7 days)
  --keepLast             Keep the last N messages
  --source, -s           Only clean up messages from specific source (DASHBOARD, TELEGRAM, BOT)
  --keepLastMessages     Keep the last N messages (for 'all' command)

Examples:
  npm run cleanup-watched-tokens-chat tokens --dryRun
  npm run cleanup-watched-tokens-chat tokens --olderThanDays 30 --keepActive
  npm run cleanup-watched-tokens-chat chat --olderThanDays 7 --keepLast 100
  npm run cleanup-watched-tokens-chat stats
  npm run cleanup-watched-tokens-chat all --dryRun
`);
    process.exit(0);
  }

  const options: any = {};
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--dryRun':
      case '-d':
        options.dryRun = true;
        break;
      case '--olderThanDays':
      case '-o':
        options.olderThanDays = parseInt(nextArg);
        i++;
        break;
      case '--list':
      case '-l':
        options.list = nextArg;
        i++;
        break;
      case '--keepActive':
      case '-k':
        options.keepActive = true;
        break;
      case '--keepLast':
        options.keepLast = parseInt(nextArg);
        i++;
        break;
      case '--source':
      case '-s':
        options.source = nextArg;
        i++;
        break;
      case '--keepLastMessages':
        options.keepLastMessages = parseInt(nextArg);
        i++;
        break;
    }
  }
  
  return { command, options };
}

// CLI setup
(async () => {
  const { command, options } = parseArgs();

  try {
    if (command === 'stats') {
      await showStats();
    } else if (command === 'tokens') {
      const stats = await cleanupWatchedTokens({
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays,
        list: options.list as any,
        keepActive: options.keepActive
      });
      
      logger.info('Watched tokens cleanup completed:');
      logger.info(`  Watched tokens deleted: ${stats.watchedTokensDeleted}`);
      logger.info(`  Message mentions deleted: ${stats.messageMentionsDeleted}`);
      logger.info(`  Token tags deleted: ${stats.tokenTagsDeleted}`);
      logger.info(`  Tags deleted: ${stats.tagsDeleted}`);
      logger.info(`  Token info deleted: ${stats.tokenInfoDeleted}`);
      logger.info(`  Total records deleted: ${stats.totalRecordsDeleted}`);
      
    } else if (command === 'chat') {
      const stats = await cleanupGlobalChat({
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays,
        keepLast: options.keepLast,
        source: options.source as any
      });
      
      logger.info('Global chat cleanup completed:');
      logger.info(`  Messages deleted: ${stats.messagesDeleted}`);
      logger.info(`  Message mentions deleted: ${stats.messageMentionsDeleted}`);
      logger.info(`  Message revisions deleted: ${stats.messageRevisionsDeleted}`);
      logger.info(`  Total records deleted: ${stats.totalRecordsDeleted}`);
      
    } else if (command === 'all') {
      logger.info('Starting comprehensive cleanup...');
      
      const tokenStats = await cleanupWatchedTokens({
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays,
        keepActive: options.keepActive
      });
      
      const chatStats = await cleanupGlobalChat({
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays,
        keepLast: options.keepLastMessages
      });
      
      logger.info('Comprehensive cleanup completed:');
      logger.info(`  Watched tokens deleted: ${tokenStats.watchedTokensDeleted}`);
      logger.info(`  Messages deleted: ${chatStats.messagesDeleted}`);
      logger.info(`  Total records deleted: ${tokenStats.totalRecordsDeleted + chatStats.totalRecordsDeleted}`);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error('Use --help to see available commands');
      process.exit(1);
    }

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Unhandled error during cleanup process', { error });
    await prisma.$disconnect();
    process.exit(1);
  }
})();
