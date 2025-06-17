import { PrismaClient } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { DexscreenerService } from '../src/core/services/dexscreener-service';
import { DatabaseService } from '../src/core/services/database-service';

const prisma = new PrismaClient();

async function backfillDexscreenerData() {
  console.log('🚀 Starting DexScreener data backfill...');
  
  try {
    // Initialize services
    const httpService = new HttpService();
    const databaseService = new DatabaseService();
    const dexscreenerService = new DexscreenerService(databaseService, httpService);

    // Get all token addresses that don't have DexScreener data yet
    const tokensToUpdate = await prisma.tokenInfo.findMany({
      where: {
        OR: [
          { marketCapUsd: null },
          { liquidityUsd: null },
          { dexscreenerUpdatedAt: null }
        ]
      },
      select: {
        tokenAddress: true,
        name: true,
        symbol: true
      }
    });

    console.log(`📊 Found ${tokensToUpdate.length} tokens to update with DexScreener data`);

    if (tokensToUpdate.length === 0) {
      console.log('✅ All tokens already have DexScreener data!');
      return;
    }

    // Extract just the addresses
    const tokenAddresses = tokensToUpdate.map(t => t.tokenAddress);

    // Fetch and save DexScreener data
    console.log('🔄 Fetching data from DexScreener API...');
    await dexscreenerService.fetchAndSaveTokenInfo(tokenAddresses);

    // Check how many were successfully updated
    const updatedTokens = await prisma.tokenInfo.count({
      where: {
        tokenAddress: { in: tokenAddresses },
        dexscreenerUpdatedAt: { not: null }
      }
    });

    console.log(`✅ Successfully updated ${updatedTokens} tokens with DexScreener data`);
    console.log(`ℹ️  ${tokenAddresses.length - updatedTokens} tokens were not found on DexScreener (likely new/unlisted tokens)`);

  } catch (error) {
    console.error('❌ Error during backfill:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backfill
backfillDexscreenerData()
  .then(() => {
    console.log('🎉 Backfill completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Backfill failed:', error);
    process.exit(1);
  }); 