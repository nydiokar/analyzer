import 'reflect-metadata';
import { DatabaseService, prisma } from '../src/core/services/database-service';
import { AnalysisOperationsQueue } from '../src/queues/queues/analysis-operations.queue';
import { JobPriority } from '../src/queues/config/queue.config';
import { getErrorMessage } from '../src/core/utils/error-utils';
import logger from '../src/core/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import type { DashboardWalletAnalysisJobData } from '../src/queues/jobs/types';
import type { DashboardAnalysisScope } from '../src/shared/dashboard-analysis.types';
import { Redis } from 'ioredis';

/**
 * God Mode Import Script
 *
 * Imports wallets from JSON file and queues analysis with custom configuration.
 * Bypasses all UI/API constraints for admin testing and research.
 *
 * Usage:
 *   npm run ts-node scripts/god-mode-import-favorites.ts <file> [options]
 *   npx ts-node -r tsconfig-paths/register scripts/god-mode-import-favorites.ts .ai/list.txt --collection "NAME!!" --scope deep --sigs 5000 --force-analyze
 *  
 *
 * Options:
 *   --scope <flash|working|deep>    Analysis scope (default: deep)
 *   --sigs <number>                 Target signature count (default: scope default)
 *   --batch-size <number>           Wallets to queue at once (default: 10)
 *   --batch-delay <ms>              Delay between batches (default: 5000ms)
 *   --priority <low|normal|high>    Queue priority (default: normal)
 *   --collection <name>             Add all wallets to this collection
 *   --force-analyze                 Queue analysis even for existing favorites
 *   --no-analyze                    Skip analysis completely (only import/update)
 *   --dry-run                       Show what would be imported without doing it
 *
 * Input Format (JSON):
 *   [
 *     {
 *       "trackedWalletAddress": "wallet123...",
 *       "name": "Whale Alpha",
 *       "emoji": "🐋",
 *       "alertsOn": true
 *     },
 *     ...
 *   ]
 */

interface WalletInput {
  trackedWalletAddress?: string;
  walletAddress?: string;
  name?: string;
  nickname?: string;
  emoji?: string;
  alertsOn?: boolean;
  collection?: string;
  collections?: string[];
  metadata?: any;
}

interface ScriptOptions {
  scope: DashboardAnalysisScope;
  targetSignatureCount?: number;
  batchSize: number;
  batchDelay: number;
  priority: JobPriority;
  collection?: string;
  dryRun: boolean;
  forceAnalyze: boolean;
  noAnalyze: boolean;
}

const USER_ID = 'cmkzo1izj0000vhts6hx3t5sy';

function parseArgs(): { file: string; options: ScriptOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0].startsWith('--')) {
    console.error('Error: Missing input file path');
    console.error('Usage: npm run ts-node scripts/god-mode-import-favorites.ts <file> [options]');
    process.exit(1);
  }

  const file = args[0];
  const options: ScriptOptions = {
    scope: 'deep',
    batchSize: 10,
    batchDelay: 5000,
    priority: JobPriority.NORMAL,
    dryRun: false,
    forceAnalyze: false,
    noAnalyze: false,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--scope':
        if (!next || !['flash', 'working', 'deep'].includes(next)) {
          console.error('Error: --scope must be flash, working, or deep');
          process.exit(1);
        }
        options.scope = next as DashboardAnalysisScope;
        i++;
        break;
      case '--sigs':
        options.targetSignatureCount = parseInt(next, 10);
        if (isNaN(options.targetSignatureCount) || options.targetSignatureCount <= 0) {
          console.error('Error: --sigs must be a positive number');
          process.exit(1);
        }
        i++;
        break;
      case '--batch-size':
        options.batchSize = parseInt(next, 10);
        if (isNaN(options.batchSize) || options.batchSize <= 0) {
          console.error('Error: --batch-size must be a positive number');
          process.exit(1);
        }
        i++;
        break;
      case '--batch-delay':
        options.batchDelay = parseInt(next, 10);
        if (isNaN(options.batchDelay) || options.batchDelay < 0) {
          console.error('Error: --batch-delay must be a non-negative number');
          process.exit(1);
        }
        i++;
        break;
      case '--priority':
        const priorityMap: Record<string, JobPriority> = {
          low: JobPriority.LOW,
          normal: JobPriority.NORMAL,
          high: JobPriority.HIGH,
        };
        if (!next || !priorityMap[next]) {
          console.error('Error: --priority must be low, normal, or high');
          process.exit(1);
        }
        options.priority = priorityMap[next];
        i++;
        break;
      case '--collection':
        options.collection = next;
        i++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force-analyze':
        options.forceAnalyze = true;
        break;
      case '--no-analyze':
        options.noAnalyze = true;
        break;
      default:
        console.error(`Error: Unknown option ${arg}`);
        process.exit(1);
    }
  }

  return { file, options };
}

function normalizeWalletInput(input: WalletInput, defaultCollection?: string): {
  walletAddress: string;
  nickname?: string;
  collections?: string[];
  metadata?: any;
} {
  const walletAddress = input.trackedWalletAddress || input.walletAddress;
  if (!walletAddress) {
    throw new Error('Missing wallet address');
  }

  const nickname = input.name || input.nickname;

  const collections: string[] = [];
  if (defaultCollection) {
    collections.push(defaultCollection);
  }
  if (input.collection) {
    collections.push(input.collection);
  }
  if (input.collections) {
    collections.push(...input.collections);
  }

  const metadata: any = input.metadata || {};
  if (input.emoji) {
    metadata.emoji = input.emoji;
  }
  if (input.alertsOn !== undefined) {
    metadata.alertsOn = input.alertsOn;
  }

  return {
    walletAddress,
    nickname,
    collections: collections.length > 0 ? collections : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { file, options } = parseArgs();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔥 GOD MODE IMPORT - Favorites + Analysis Queue');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`User:         ${USER_ID}`);
  console.log(`File:         ${file}`);
  console.log(`Scope:        ${options.scope}`);
  console.log(`Signatures:   ${options.targetSignatureCount || 'scope default'}`);
  console.log(`Batch Size:   ${options.batchSize}`);
  console.log(`Batch Delay:  ${options.batchDelay}ms`);
  console.log(`Priority:     ${JobPriority[options.priority]}`);
  console.log(`Collection:   ${options.collection || 'none'}`);
  console.log(`Force:        ${options.forceAnalyze ? 'YES' : 'NO'}`);
  console.log(`Dry Run:      ${options.dryRun ? 'YES' : 'NO'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load wallet data
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  let rawData: WalletInput[];
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    rawData = JSON.parse(fileContent);
    if (!Array.isArray(rawData)) {
      throw new Error('File must contain a JSON array');
    }
  } catch (error) {
    console.error(`❌ Failed to parse JSON file: ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Normalize wallet data
  const wallets = rawData
    .map((w, idx) => {
      try {
        return normalizeWalletInput(w, options.collection);
      } catch (error) {
        console.warn(`⚠️  Skipping wallet at index ${idx}: ${getErrorMessage(error)}`);
        return null;
      }
    })
    .filter(Boolean) as Array<{ walletAddress: string; nickname?: string; collections?: string[]; metadata?: any }>;

  console.log(`📊 Loaded ${wallets.length} wallets from file\n`);

  if (wallets.length === 0) {
    console.error('❌ No valid wallets found in file');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('🔍 DRY RUN - Preview of wallets to import:');
    wallets.slice(0, 5).forEach((w, idx) => {
      console.log(`  ${idx + 1}. ${w.walletAddress} (${w.nickname || 'no nickname'})`);
    });
    if (wallets.length > 5) {
      console.log(`  ... and ${wallets.length - 5} more`);
    }
    console.log('\n✅ Dry run complete. Run without --dry-run to execute.');
    process.exit(0);
  }
  
  // Initialize services
  const dbService = new DatabaseService();
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  });
  const analysisQueue = new AnalysisOperationsQueue(redisClient);

  try {
    // Import wallets to favorites
    console.log('📥 Importing wallets to favorites...');
    const importResult = await dbService.bulkUpsertFavoriteWallets({
      userId: USER_ID,
      favorites: wallets,
      mergeCollections: true,
      overwriteNickname: false,
      mergeMetadata: true,
    });

    console.log(`✅ Import complete:`);
    console.log(`   Added:      ${importResult.added}`);
    console.log(`   Updated:    ${importResult.updated}`);
    console.log(`   Skipped:    ${importResult.skipped}`);
    console.log(`   Over Limit: ${importResult.overLimit}`);
    console.log(`   Created:    ${importResult.createdWallets.length}\n`);

    // Skip analysis if --no-analyze flag is set
    if (options.noAnalyze) {
      console.log('✅ Import complete. Analysis skipped (--no-analyze flag set)\n');
      return;
    }

    // Queue analysis jobs in batches
    let walletsToAnalyze: string[];

    if (options.forceAnalyze) {
      // Force mode: analyze ALL wallets (even existing ones)
      walletsToAnalyze = wallets.map(w => w.walletAddress);
      console.log(`🔥 Force mode: Analyzing all ${walletsToAnalyze.length} wallets (including existing)\n`);
    } else {
      // Normal mode: only analyze newly created wallets
      walletsToAnalyze = importResult.createdWallets;

      if (walletsToAnalyze.length === 0) {
        console.log('ℹ️  No new wallets to analyze (all already exist)');
        console.log('💡 Use --force-analyze to queue analysis anyway\n');
        return;
      }
    }
    const totalBatches = Math.ceil(walletsToAnalyze.length / options.batchSize);
    const requestId = `god-mode-${Date.now()}`;

    console.log(`🔄 Queueing ${walletsToAnalyze.length} wallets for ${options.scope} analysis...`);
    console.log(`   Batches: ${totalBatches} (${options.batchSize} per batch)\n`);

    let queuedCount = 0;
    const jobIds: string[] = [];

    for (let i = 0; i < walletsToAnalyze.length; i += options.batchSize) {
      const batchNum = Math.floor(i / options.batchSize) + 1;
      const batch = walletsToAnalyze.slice(i, i + options.batchSize);

      console.log(`📦 Batch ${batchNum}/${totalBatches}: Queueing ${batch.length} wallets...`);

      const batchJobs = await Promise.all(
        batch.map(walletAddress => {
          const jobData: DashboardWalletAnalysisJobData = {
            walletAddress,
            userId: USER_ID,
            requestId,
            analysisScope: options.scope,
            triggerSource: 'system',
            targetSignatureCount: options.targetSignatureCount,
            forceRefresh: false,
            queueWorkingAfter: false,
            queueDeepAfter: false,
          };

          return analysisQueue.addDashboardWalletAnalysisJob(jobData, {
            priority: options.priority,
            delay: 0,
          });
        })
      );

      queuedCount += batch.length;
      jobIds.push(...batchJobs.map(j => j.id as string));

      console.log(`   ✓ Queued ${batch.length} jobs (Total: ${queuedCount}/${walletsToAnalyze.length})`);

      // Sleep between batches (except after last batch)
      if (i + options.batchSize < walletsToAnalyze.length) {
        console.log(`   ⏳ Waiting ${options.batchDelay}ms before next batch...\n`);
        await sleep(options.batchDelay);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ GOD MODE IMPORT COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Imported:      ${importResult.added} wallets`);
    console.log(`Queued:        ${queuedCount} analysis jobs`);
    console.log(`Request ID:    ${requestId}`);
    console.log(`Priority:      ${JobPriority[options.priority]}`);
    console.log(`Scope:         ${options.scope}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error(`\n❌ Error: ${getErrorMessage(error)}`);
    logger.error('God mode import failed:', error);
    process.exit(1);
  } finally {
    await redisClient.quit();
    await prisma.$disconnect();
    console.log('🔌 Connections closed.');
  }
}

main().catch(error => {
  logger.error('Unhandled error in main:', error);
  prisma.$disconnect();
  process.exit(1);
});
