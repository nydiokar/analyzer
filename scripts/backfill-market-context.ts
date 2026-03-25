import { PrismaClient } from "@prisma/client";
import { backfillSolPrices } from "../src/services/market-context/sol-price-cache";
import { enrichAll } from "../src/services/market-context/enrichment-engine";

async function backfill() {
  const prisma = new PrismaClient();

  // Check how far back our data goes
  const oldest = await prisma.swapAnalysisInput.findFirst({
    where: { enrichedAt: null },
    orderBy: { timestamp: "asc" },
  });

  if (oldest) {
    const daysBack = Math.ceil((Date.now() / 1000 - oldest.timestamp) / 86400);
    console.log(`Oldest un-enriched swap: ${daysBack} days ago.`);
    console.log(`Backfilling SOL prices for ${daysBack} days...`);
    await backfillSolPrices(prisma, Math.min(daysBack + 5, 365)); // +5 buffer
  }

  // Enrich all un-enriched rows
  const total = await prisma.swapAnalysisInput.count({ where: { enrichedAt: null } });
  console.log(`\n${total} swap records to enrich. Starting...\n`);

  await enrichAll(prisma);

  await prisma.$disconnect();
}

backfill().catch(console.error);
