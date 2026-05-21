/**
 * Validates behavior analysis on saved EVM wallet records.
 * Usage: pnpm ts-node -r tsconfig-paths/register src/scripts/evm-validate-behavior.ts <0x...>
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DatabaseService } from '../core/services/database-service';
import { BehaviorService } from '../core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '../types/analysis';

async function main() {
  const walletAddress = (process.argv[2] ?? '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad').toLowerCase();

  const db = new DatabaseService();
  const config: BehaviorAnalysisConfig = {};
  const behaviorService = new BehaviorService(db, config);

  console.log(`\nRunning behavior analysis for ${walletAddress}...`);
  const t0 = Date.now();

  const metrics = await behaviorService.analyzeWalletBehavior(walletAddress);
  const ms = Date.now() - t0;

  if (!metrics) {
    console.log('Result: null (no data or insufficient records)');
    return;
  }

  console.log(`\n--- Behavior Metrics (${ms}ms) ---`);
  console.log(`  speedCategory:       ${metrics.speedCategory}`);
  console.log(`  medianHoldTime:      ${metrics.medianHoldTime?.toFixed(2)} hours`);
  console.log(`  uniqueTokensTraded:  ${metrics.uniqueTokensTraded}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
