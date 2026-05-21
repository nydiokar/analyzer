/**
 * Validates that PnL analysis runs correctly on saved EVM SwapAnalysisInput records.
 * Usage: pnpm ts-node -r tsconfig-paths/register src/scripts/evm-validate-pnl.ts <0x...>
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DatabaseService } from '../core/services/database-service';
import { PnlAnalysisService } from '../core/services/pnl-analysis-service';

async function main() {
  const walletAddress = (process.argv[2] ?? '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad').toLowerCase();

  const db = new DatabaseService();
  const pnlService = new PnlAnalysisService(db, null, null);

  console.log(`\nRunning PnL analysis for ${walletAddress}...`);
  const t0 = Date.now();

  const result = await pnlService.analyzeWalletPnl(walletAddress, undefined, {
    isViewOnly: true,
    skipBalanceFetch: true,
  });

  const ms = Date.now() - t0;

  if (!result) {
    console.log('Result: null (wallet skipped or no data)');
    return;
  }

  if ((result as any).analysisSkipped) {
    console.log('Result: analysis skipped (system wallet)');
    return;
  }

  console.log(`\n--- PnL Summary (${ms}ms) ---`);
  console.log(`  realizedPnl:              ${result.realizedPnl?.toFixed(4)}`);
  console.log(`  netPnl:                   ${result.netPnl?.toFixed(4)}`);
  console.log(`  totalVolume:              ${result.totalVolume?.toFixed(4)}`);
  console.log(`  totalFees:                ${result.totalFees?.toFixed(6)}`);
  console.log(`  totalExecutedSwapsCount:  ${result.totalExecutedSwapsCount}`);
  console.log(`  profitableTokensCount:    ${result.profitableTokensCount}`);
  console.log(`  unprofitableTokensCount:  ${result.unprofitableTokensCount}`);
  console.log(`  stablecoinNetFlow:        ${result.stablecoinNetFlow?.toFixed(4)}`);
  console.log(`  tokenResults count:       ${result.results?.length ?? 0}`);

  if (result.results && result.results.length > 0) {
    console.log('\n--- Top 5 tokens by SOL volume ---');
    const sorted = [...result.results]
      .sort((a, b) => (Math.abs(b.totalSolSpent) + Math.abs(b.totalSolReceived)) - (Math.abs(a.totalSolSpent) + Math.abs(a.totalSolReceived)));
    for (const t of sorted.slice(0, 5)) {
      console.log(`  ${t.tokenAddress.slice(0, 16)}  spent=${t.totalSolSpent.toFixed(4)}  recv=${t.totalSolReceived.toFixed(4)}  pnl=${(t.netSolProfitLoss ?? 0).toFixed(4)}`);
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
