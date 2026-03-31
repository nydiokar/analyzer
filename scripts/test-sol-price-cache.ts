import { prisma } from '../src/core/services/database-service';
import { backfillSolPrices, buildSolPriceMap, timestampToDateKey } from '../src/core/services/market-context-standalone';

async function test() {
  try {
    // 1. Backfill
    console.log('Backfilling SOL prices...');
    await backfillSolPrices(prisma, 730);

    // 2. Verify: look up a known date
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    const priceMap = await buildSolPriceMap(prisma, [threeDaysAgo]);
    const dateKey = timestampToDateKey(threeDaysAgo);
    const price = priceMap.get(dateKey) ?? null;
    console.log(`SOL price 3 days ago: $${price?.toFixed(2) ?? 'NOT FOUND'}`);

    // 3. Count cached rows
    const count = await prisma.solDailyPrice.count();
    console.log(`Total cached days: ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

test().catch(console.error);
