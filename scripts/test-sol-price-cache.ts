import { PrismaClient } from "@prisma/client";
import { backfillSolPrices, getSolPrice } from "../src/services/market-context/sol-price-cache";

async function test() {
  const prisma = new PrismaClient();

  // 1. Backfill
  console.log("Backfilling SOL prices...");
  await backfillSolPrices(prisma, 90);

  // 2. Verify: look up a known date
  const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
  const price = await getSolPrice(prisma, threeDaysAgo);
  console.log(`SOL price 3 days ago: $${price?.toFixed(2) ?? "NOT FOUND"}`);

  // 3. Count cached rows
  const count = await prisma.solDailyPrice.count();
  console.log(`Total cached days: ${count}`);

  await prisma.$disconnect();
}

test().catch(console.error);
