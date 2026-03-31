import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { prisma } from '../src/core/services/database-service';
import { MarketContextService } from '../src/api/services/market-context.service';
import { runSanityCheck } from '../src/core/services/market-context-standalone';

async function testWithOwnWallet() {
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;
  const YOUR_WALLET = 'YOUR_WALLET_ADDRESS_HERE'; // <-- replace

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });
    const marketContextService = app.get(MarketContextService);

    const yourSwaps = await prisma.swapAnalysisInput.findMany({
      where: { walletAddress: YOUR_WALLET, enrichedAt: null },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    console.log(`Found ${yourSwaps.length} un-enriched swaps for your wallet.\n`);

    for (const swap of yourSwaps) {
      console.log(`  ${swap.direction} | ${swap.amount} tokens | ${swap.associatedSolValue} SOL | mint: ${swap.mint.slice(0, 12)}...`);
    }

    console.log('\nEnriching wallet-scoped batch...');
    await marketContextService.enrichSwapBatch(10, YOUR_WALLET);

    const enrichedSwaps = await prisma.swapAnalysisInput.findMany({
      where: { walletAddress: YOUR_WALLET, enrichedAt: { not: null } },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    console.log('\n=== ENRICHED RESULTS ===\n');
    for (const swap of enrichedSwaps) {
      console.log(`  ${swap.direction.toUpperCase()} ${swap.amount} tokens`);
      console.log(`    SOL spent: ${swap.associatedSolValue} SOL @ $${swap.solPriceUsd?.toFixed(2)}/SOL`);
      console.log(`    USD value: $${swap.usdValue?.toFixed(2)}`);
      console.log(`    Token price: $${swap.tokenPriceUsd?.toExponential(4)}`);
      console.log(`    Market cap: $${swap.marketCapUsd ? formatMcap(swap.marketCapUsd) : 'N/A'}`);
      console.log(`    Bucket: ${swap.mcapBucket ?? 'N/A'}`);
      console.log();
    }

    await runSanityCheck(prisma);
  } finally {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }
}

function formatMcap(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

testWithOwnWallet().catch(console.error);
