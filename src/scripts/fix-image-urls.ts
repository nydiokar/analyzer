/**
 * Script to fix CDN-wrapped image URLs in the database
 *
 * Removes Helius CDN wrapper and uses raw IPFS/Arweave URLs:
 * FROM: https://cdn.helius-rpc.com/cdn-cgi/image/https://ipfs.io/ipfs/...
 * TO:   https://ipfs.io/ipfs/...
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/fix-image-urls.ts
 */

import { prisma } from '../core/services/database-service';
import { getErrorMessage, getErrorDetails } from '../core/utils/error-utils';
import logger from '../core/utils/logger';




function extractRawUrl(url: string | null): string | null {
  if (!url) return null;

  // If it's a CDN-wrapped URL, extract the raw URL
  if (url.includes('cdn.helius-rpc.com/cdn-cgi/image/')) {
    // Extract everything after "cdn-cgi/image/"
    const match = url.match(/cdn-cgi\/image\/+(.*)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Already a raw URL, return as-is
  return url;
}

async function main() {
  console.log('🔍 Finding tokens with CDN-wrapped image URLs...\n');

  // Find all tokens with CDN URLs in onchainImageUrl
  const tokensWithCdnUrls = await prisma.tokenInfo.findMany({
    where: {
      onchainImageUrl: {
        contains: 'cdn.helius-rpc.com',
      },
    },
    select: {
      tokenAddress: true,
      onchainImageUrl: true,
      name: true,
      symbol: true,
    },
  });

  console.log(`📊 Found ${tokensWithCdnUrls.length} tokens with CDN-wrapped URLs\n`);

  if (tokensWithCdnUrls.length === 0) {
    console.log('✅ No tokens need fixing!');
    return;
  }

  console.log('Sample of tokens to be fixed:');
  tokensWithCdnUrls.slice(0, 5).forEach((token, idx) => {
    const rawUrl = extractRawUrl(token.onchainImageUrl);
    console.log(`\n${idx + 1}. ${token.name || 'Unknown'} (${token.symbol || 'N/A'})`);
    console.log(`   CDN URL:  ${token.onchainImageUrl}`);
    console.log(`   Raw URL:  ${rawUrl}`);
  });

  if (tokensWithCdnUrls.length > 5) {
    console.log(`\n... and ${tokensWithCdnUrls.length - 5} more tokens`);
  }

  console.log('\n🔧 Extracting raw URLs...');

  let fixedCount = 0;
  let errorCount = 0;

  for (const token of tokensWithCdnUrls) {
    try {
      const rawUrl = extractRawUrl(token.onchainImageUrl);

      await prisma.tokenInfo.update({
        where: { tokenAddress: token.tokenAddress },
        data: { onchainImageUrl: rawUrl },
      });

      fixedCount++;

      if (fixedCount % 100 === 0) {
        console.log(`   Progress: ${fixedCount}/${tokensWithCdnUrls.length} fixed...`);
      }
    } catch (error) {
      logger.error(`   ❌ Failed to fix ${token.tokenAddress}:`, getErrorMessage(error));
      errorCount++;
    }
  }

  console.log(`\n✅ Completed!`);
  console.log(`   Fixed: ${fixedCount} tokens`);
  if (errorCount > 0) {
    console.log(`   Errors: ${errorCount} tokens`);
  }
}

main()
  .catch((error) => {
    logger.error('❌ Script failed:', getErrorMessage(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
