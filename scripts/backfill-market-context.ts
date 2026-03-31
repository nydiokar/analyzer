import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { prisma } from '../src/core/services/database-service';
import { MarketContextService } from '../src/api/services/market-context.service';

async function backfill() {
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });
    const marketContextService = app.get(MarketContextService);

    const oldest = await prisma.swapAnalysisInput.findFirst({
      where: { enrichedAt: null },
      orderBy: { timestamp: 'asc' },
    });

    if (oldest) {
      const daysBack = Math.ceil((Date.now() / 1000 - oldest.timestamp) / 86400);
      console.log(`Oldest un-enriched swap: ${daysBack} days ago.`);
      console.log(`Backfilling SOL prices for ${daysBack} days...`);
      await marketContextService.backfillSolPrices(Math.min(daysBack + 5, 365));
    }

    const total = await prisma.swapAnalysisInput.count({ where: { enrichedAt: null } });
    console.log(`\n${total} swap records to enrich. Starting...\n`);

    await marketContextService.enrichAll();
  } finally {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }
}

backfill().catch(console.error);
