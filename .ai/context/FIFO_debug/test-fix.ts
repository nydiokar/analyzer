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
  // Testing SPL-to-SPL fix with the token we just fixed
  const wallet = 'ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud';
  const targetMint = 'F7pB3ZdfBnyFw2LRHydWEn9BmhEa5XihXLjhySFRpump'; // The token from our SPL-to-SPL fix

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
  console.log(`   Target token: ${targetMint} (from our SPL-to-SPL fix)`);
  await pnlService.analyzeWalletPnl(wallet, undefined, { isViewOnly: false, skipBalanceFetch: false });

  console.log(`\n📊 Fetching results from database...`);
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet } });

  const targetToken = results.find(r => r.tokenAddress === targetMint);

  if (!targetToken) {
    console.error(`❌ Token ${targetMint} not found in results!`);
    console.log(`   Available tokens: ${results.map(r => r.tokenAddress).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n✅ Found token ${targetMint} (F7pB3ZdfBnyFw2LRHydWEn9BmhEa5XihXLjhySFRpump):`);
  console.log(`   hasIncompleteHistory: ${targetToken.hasIncompleteHistory}`);
  console.log(`   realizedPnlSol: ${targetToken.realizedPnlSol}`);
  console.log(`   unrealizedPnlSol: ${targetToken.unrealizedPnlSol}`);
  console.log(`   totalPnlSol: ${targetToken.totalPnlSol}`);
  console.log(`   netSolProfitLoss: ${targetToken.netSolProfitLoss}`);
  console.log(`   totalSolSpent: ${targetToken.totalSolSpent}`);
  console.log(`   totalSolReceived: ${targetToken.totalSolReceived}`);
  console.log(`   currentBalance: ${targetToken.currentUiBalance}`);
  console.log(`   currentHoldingsValueSol: ${targetToken.currentHoldingsValueSol}`);
  console.log(`   currentHoldingsCostBasisSol: ${targetToken.currentHoldingsCostBasisSol}`);

  // Check for transactions involving this token
  console.log(`\n🔍 Checking raw transactions for ${targetMint}...`);
  const swapInputs = await db.getSwapAnalysisInputs(wallet);
  const tokenInputs = swapInputs.filter(i => i.mint === targetMint);

  console.log(`   Found ${swapInputs.length} transactions for this token:`);
  swapInputs.forEach((tx, index) => {
    console.log(`   ${index + 1}. ${tx.signature.substring(0, 8)}... | ${tx.direction} | amount: ${tx.amount} | assocSOL: ${tx.associatedSolValue} | fee: ${tx.feeAmount || 'null'}`);
  });

  // Analysis of the issue
  console.log(`\n🔍 SPL-to-SPL Fix Analysis:`);

  if (swapInputs.length === 0) {
    console.log(`   ❌ NO TRANSACTIONS FOUND - This explains "0 bought and 0 sold"!`);
  } else {
    const bought = swapInputs.filter(tx => tx.direction === 'in').length;
    const sold = swapInputs.filter(tx => tx.direction === 'out').length;
    const totalAssocSol = swapInputs.reduce((sum, tx) => sum + (tx.associatedSolValue || 0), 0);

    console.log(`   Bought transactions: ${bought}`);
    console.log(`   Sold transactions: ${sold}`);
    console.log(`   Total associated SOL value: ${totalAssocSol}`);

    if (bought === 0 && sold === 0) {
      console.log(`   ❌ CONFIRMED: "0 bought and 0 sold" - transactions exist but not counted properly!`);
    } else if (targetToken.realizedPnlSol && Math.abs(targetToken.realizedPnlSol) > 100) {
      console.log(`   ❌ ISSUE: Large realized loss (${targetToken.realizedPnlSol}) despite proper transactions!`);
      console.log(`   This suggests PnL calculation issue, not transaction mapping.`);
    }
  }

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
