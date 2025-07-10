import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugWalletTokens() {
  try {
    console.log('=== DEBUGGING WALLET TOKENS VS DATABASE ===\n');
    
    // Get wallets from recent analysis based on the logs
    const wallets = [
      '6Ai1h7J9DUr1XvtXB1SeukPsYr8aMWF9ZGyf8z8xSu8R',
      '6xyjf28KkrrK3xm7pEF45XdDiGpoyVTF1yqEzw4A6Myf', 
      'Ce9M7RwBQzMzzURfvyL2ZyWjcRrdwZ7gXWPzegTEBjU5'
    ];
    
    console.log('1. Checking what tokens these wallets actually hold...');
    
    // Check if we have token balance data cached or stored
    for (const wallet of wallets) {
      console.log(`\nWallet: ${wallet}`);
      
      // Check if wallet exists in our system
      const walletRecord = await prisma.wallet.findUnique({
        where: { address: wallet },
        select: { address: true, analyzedTimestampStart: true }
      });
      
      if (walletRecord) {
        console.log(`  - Exists in DB, analyzed at: ${walletRecord.analyzedTimestampStart}`);
      } else {
        console.log(`  - ❌ Not found in DB`);
      }
    }
    
    // 2. Check what tokens are commonly in similarity analysis results
    console.log('\n2. Checking recent similarity analysis tokens...');
    
    // Look for any cached balance data or recent token usage
    const recentResults = await prisma.analysisResult.findMany({
      select: { tokenAddress: true },
      distinct: ['tokenAddress'],
      take: 20,
      orderBy: { updatedAt: 'desc' }
    });
    
    console.log(`Found ${recentResults.length} recent token addresses in analysis results:`);
    for (const result of recentResults.slice(0, 10)) {
      const tokenInfo = await prisma.tokenInfo.findUnique({
        where: { tokenAddress: result.tokenAddress },
        select: { name: true, symbol: true }
      });
      
      console.log(`  - ${result.tokenAddress}: ${tokenInfo?.name || 'Unknown'} (${tokenInfo?.symbol || 'N/A'})`);
    }
    
    // 3. Check if 21Gy token appears in any analysis results
    console.log('\n3. Checking if 21Gy token appears in any analysis results...');
    const gyTokenInResults = await prisma.analysisResult.findFirst({
      where: { 
        tokenAddress: {
          startsWith: '21Gy'
        }
      },
      select: { tokenAddress: true, walletAddress: true, updatedAt: true }
    });
    
    if (gyTokenInResults) {
      console.log(`✅ Found 21Gy token in analysis results:`);
      console.log(`  - Token: ${gyTokenInResults.tokenAddress}`);
      console.log(`  - Wallet: ${gyTokenInResults.walletAddress}`);
      console.log(`  - Time: ${gyTokenInResults.updatedAt}`);
    } else {
      console.log(`❌ 21Gy token NOT found in any analysis results`);
    }
    
  } catch (error) {
    console.error('Error in wallet debug script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugWalletTokens(); 