/**
 * Quick analysis script to understand unknownTxSkippedNoJito patterns
 * Run with: npx ts-node src/scripts/analyze-unknown-tx-patterns.ts
 */

import { WalletClassificationService } from '../core/services/wallet-classification.service';
import { createLogger } from '../core/utils/logger';

const logger = createLogger('UnknownTxAnalysis');
const classificationService = new WalletClassificationService();

async function analyzeUnknownTxPatterns() {
  try {
    logger.info('🔍 Analyzing unknown transaction patterns...');

    // Get wallets with high unknown transaction skip rates
    const highVolumeWallets = await classificationService.getHighVolumeWallets(20);
    
    if (highVolumeWallets.length === 0) {
      logger.info('No wallets found with high unknown transaction skip rates');
      return;
    }

    logger.info(`\n📊 Top ${highVolumeWallets.length} wallets with high unknown transaction skip rates:\n`);

    console.table(highVolumeWallets.map(wallet => ({
      'Wallet': `${wallet.walletAddress.substring(0, 8)}...${wallet.walletAddress.substring(wallet.walletAddress.length - 8)}`,
      'Total Txns': wallet.totalTransactions,
      'Unknown Skipped': wallet.unknownSkipped,
      'Successful': wallet.successfullyProcessed,
      'Skip Ratio': (wallet.skipRatio * 100).toFixed(1) + '%'
    })));

    // Analyze patterns
    const totalWallets = highVolumeWallets.length;
    const avgSkipRatio = highVolumeWallets.reduce((sum, w) => sum + w.skipRatio, 0) / totalWallets;
    const highSkipRatioWallets = highVolumeWallets.filter(w => w.skipRatio > 0.5).length;

    logger.info(`\n📈 Analysis Summary:`);
    logger.info(`• Total high-volume wallets analyzed: ${totalWallets}`);
    logger.info(`• Average skip ratio: ${(avgSkipRatio * 100).toFixed(1)}%`);
    logger.info(`• Wallets with >50% skip ratio: ${highSkipRatioWallets} (${((highSkipRatioWallets / totalWallets) * 100).toFixed(1)}%)`);

    // Test smart fetch recommendations for top 5 wallets
    logger.info(`\n🤖 Smart Fetch Recommendations for Top 5 Wallets:`);
    
    for (let i = 0; i < Math.min(5, highVolumeWallets.length); i++) {
      const wallet = highVolumeWallets[i];
      const recommendation = await classificationService.getSmartFetchRecommendation(wallet.walletAddress);
      
      logger.info(`\n${i + 1}. ${wallet.walletAddress.substring(0, 8)}...`);
      logger.info(`   Should Limit: ${recommendation.shouldLimitFetch ? '✅ YES' : '❌ NO'}`);
      logger.info(`   Max Signatures: ${recommendation.maxSignatures}`);
      logger.info(`   Reason: ${recommendation.reason}`);
      if (recommendation.cacheHours) {
        logger.info(`   Cache Hours: ${recommendation.cacheHours}`);
      }
    }

    logger.info(`\n💡 Recommendations:`);
    if (avgSkipRatio > 0.3) {
      logger.info(`• High skip ratio detected (${(avgSkipRatio * 100).toFixed(1)}%) - Consider implementing fetch limiting`);
    }
    if (highSkipRatioWallets > totalWallets * 0.3) {
      logger.info(`• Many wallets (${highSkipRatioWallets}) show bot-like behavior - Consider auto-classification`);
    }
    logger.info(`• Current Jito filtering is working but may be too aggressive`);
    logger.info(`• Consider showing user notification for wallets with >5000 unknown skipped transactions`);

  } catch (error) {
    logger.error('Error analyzing unknown transaction patterns:', error);
  }
}

// Run the analysis
if (require.main === module) {
  analyzeUnknownTxPatterns()
    .then(() => {
      logger.info('✅ Analysis complete');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Analysis failed:', error);
      process.exit(1);
    });
} 