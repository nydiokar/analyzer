/**
 * Trigger full analysis (no timeRange) to persist new FIFO results
 */

import { DatabaseService } from '../src/core/services/database-service';
import { PnlAnalysisService } from '../src/core/services/pnl-analysis-service';
import { createLogger } from '../src/core/utils/logger';

const logger = createLogger('TriggerFullAnalysis');

const TEST_WALLET = 'CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B';

async function main() {
  console.log('\n🔄 TRIGGERING FULL ANALYSIS (NO TIME RANGE)\n');
  console.log(`Wallet: ${TEST_WALLET}\n`);

  const db = new DatabaseService();
  const pnlService = new PnlAnalysisService(db, null, null);

  console.log('⏳ Running full analysis...\n');

  // NO timeRange parameter = full analysis with persistence
  const result = await pnlService.analyzeWalletPnl(TEST_WALLET, undefined, { isViewOnly: false });

  if (result) {
    console.log('✅ ANALYSIS COMPLETE!\n');
    console.log(`📊 Results:`);
    console.log(`   Tokens analyzed: ${result.results?.length || 0}`);
    console.log(`   Net PnL: ${result.netPnl?.toFixed(4)} SOL`);
    console.log(`   Realized PnL: ${result.realizedPnl?.toFixed(4)} SOL`);
    console.log(`   Unrealized PnL: ${result.unrealizedPnl?.toFixed(4)} SOL`);

    // Count incomplete tokens
    const incompleteCount = result.results?.filter(t => t.hasIncompleteHistory).length || 0;
    console.log(`\n   Incomplete tokens: ${incompleteCount}`);

    if (incompleteCount === 0) {
      console.log(`   🎉 All tokens now have complete history with FIFO!\n`);
    } else {
      console.log(`   ⚠️  Still have ${incompleteCount} incomplete tokens\n`);
    }
  } else {
    console.log('❌ Analysis failed\n');
  }

  console.log('━'.repeat(80));
  console.log('\n💡 Now check the frontend - it should show updated PnL values!\n');
}

main().catch(console.error);
