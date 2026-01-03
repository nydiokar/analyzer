import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';
import { PnlAnalysisService } from '../../../src/core/services/pnl-analysis-service';
import { HeliusApiClient } from '../../../src/core/services/helius-api-client';
import { TokenInfoService } from '../../../src/api/services/token-info.service';
import { DexscreenerService } from '../../../src/api/services/dexscreener.service';
import { DexscreenerPriceProvider } from '../../../src/api/services/dexscreener-price-provider';
import { OnchainMetadataService } from '../../../src/core/services/onchain-metadata.service';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';

dotenv.config();

async function main() {
  const wallet = 'CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B';
  const targetMint = '9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump';

  const db = new DatabaseService();
  const heliusClient = new HeliusApiClient(
    {
      apiKey: process.env.HELIUS_API_KEY!,
      network: 'mainnet',
      requestsPerSecond: 20,
    },
    db,
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
    redisClient,
  );

  const pnlService = new PnlAnalysisService(db, heliusClient, tokenInfoService);

  console.log(`\n🔄 Re-running PnL analysis for ${wallet}...`);
  await pnlService.analyzeWalletPnl(wallet, undefined, { isViewOnly: false, skipBalanceFetch: false });

  console.log(`\n📊 Fetching results from database...`);
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet } });

  const targetToken = results.find(r => r.tokenAddress === targetMint);

  if (!targetToken) {
    console.error(`❌ Token ${targetMint} not found in results!`);
    process.exit(1);
  }

  console.log(`\n✅ Found token ${targetMint}:`);
  console.log(`   hasIncompleteHistory: ${targetToken.hasIncompleteHistory}`);
  console.log(`   realizedPnlSol: ${targetToken.realizedPnlSol}`);
  console.log(`   unrealizedPnlSol: ${targetToken.unrealizedPnlSol}`);
  console.log(`   totalPnlSol: ${targetToken.totalPnlSol}`);
  console.log(`   netSolProfitLoss: ${targetToken.netSolProfitLoss}`);
  console.log(`   totalSolSpent: ${targetToken.totalSolSpent}`);
  console.log(`   totalSolReceived: ${targetToken.totalSolReceived}`);
  console.log(`   currentHoldingsValueSol: ${targetToken.currentHoldingsValueSol}`);
  console.log(`   currentHoldingsCostBasisSol: ${targetToken.currentHoldingsCostBasisSol}`);

  // Summary for all tokens
  const incompleteCount = results.filter(r => r.hasIncompleteHistory).length;
  const completeCount = results.filter(r => !r.hasIncompleteHistory).length;

  console.log(`\n📈 Summary for wallet:`);
  console.log(`   Total tokens: ${results.length}`);
  console.log(`   Complete history: ${completeCount}`);
  console.log(`   Incomplete history: ${incompleteCount}`);

  if (incompleteCount > 0) {
    console.log(`\n⚠️  Tokens with incomplete history:`);
    results.filter(r => r.hasIncompleteHistory).forEach(r => {
      console.log(`   - ${r.tokenAddress}`);
    });
  }

  await redisClient.quit();
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
