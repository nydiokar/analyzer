/**
 * Reprocessing script for wallets affected by USDC bug
 *
 * This script reprocesses PnL for wallets that have USDC swaps
 * to apply the USDC→SOL conversion fix.
 *
 * Usage: npx ts-node -r tsconfig-paths/register scripts/reprocess-usdc-wallets.ts
 */

import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '../src/api/services/database.service';
import { PnlAnalysisService } from '../src/core/services/pnl-analysis-service';
import { HeliusApiClient } from '../src/core/services/helius-api-client';
import { TokenInfoService } from '../src/api/services/token-info.service';
import { DexscreenerService } from '../src/api/services/dexscreener.service';
import { DexscreenerPriceProvider } from '../src/api/services/dexscreener-price-provider';
import { OnchainMetadataService } from '../src/core/services/onchain-metadata.service';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('REPROCESSING WALLETS AFFECTED BY USDC BUG');
  console.log('='.repeat(80));

  // Find all wallets with USDC transactions
  const walletsWithUsdc = await prisma.swapAnalysisInput.findMany({
    where: {
      associatedUsdcValue: { not: null, gt: 0 },
      associatedSolValue: { lte: 0.01 },
    },
    distinct: ['walletAddress'],
    select: { walletAddress: true },
  });

  console.log(`\nFound ${walletsWithUsdc.length} wallets with USDC transactions\n`);

  if (walletsWithUsdc.length === 0) {
    console.log('No wallets to reprocess.');
    await prisma.$disconnect();
    return;
  }

  // Setup services
  const db = new DatabaseService();
  const heliusClient = new HeliusApiClient(
    {
      apiKey: process.env.HELIUS_API_KEY!,
      network: 'mainnet',
      requestsPerSecond: 20,
    },
    db
  );

  const httpService = new HttpService();
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    lazyConnect: true,
  });

  const dexscreenerService = new DexscreenerService(db, httpService, redisClient);
  const dexscreenerProvider = new DexscreenerPriceProvider(db, httpService);
  const onchainMetadataService = new OnchainMetadataService(heliusClient);
  const tokenInfoService = new TokenInfoService(
    db,
    dexscreenerService,
    dexscreenerProvider,
    onchainMetadataService,
    heliusClient,
    redisClient
  );

  const pnlService = new PnlAnalysisService(db, heliusClient, tokenInfoService);

  // Reprocess each wallet
  let processed = 0;
  let failed = 0;

  for (const { walletAddress } of walletsWithUsdc) {
    try {
      console.log(`[${processed + failed + 1}/${walletsWithUsdc.length}] Reprocessing ${walletAddress}...`);

      await pnlService.analyzeWalletPnl(walletAddress, undefined, {
        isViewOnly: false,
        skipBalanceFetch: false,
      });

      processed++;
      console.log(`✅ Success\n`);
    } catch (error) {
      failed++;
      console.error(`❌ Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('='.repeat(80));
  console.log('REPROCESSING COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${walletsWithUsdc.length}`);
  console.log(`Successfully processed: ${processed}`);
  console.log(`Failed: ${failed}`);

  await redisClient.quit();
  await prisma.$disconnect();
}

main().catch(console.error);
