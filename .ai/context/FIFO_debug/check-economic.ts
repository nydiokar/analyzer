import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = 'CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B';
  const mint = '9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump';

  const db = new DatabaseService();
  const allInputs = await db.getSwapAnalysisInputs(wallet);
  const tokenInputs = allInputs.filter(i => i.mint === mint);

  const THRESHOLD = 0.01;

  // Group by interaction type and whether they're economic
  const byType = new Map<string, {
    count: number;
    ins: number;
    outs: number;
    solIn: number;
    solOut: number;
    tokensIn: number;
    tokensOut: number;
    isEconomic: boolean;
  }>();

  for (const input of tokenInputs) {
    const type = input.interactionType?.toUpperCase() ?? 'NULL';

    // Determine if economic (matches our filter logic)
    const isNonEconomic = type === 'BURN' ||
      (type === 'UNKNOWN' &&
       Math.abs(input.associatedSolValue) < THRESHOLD &&
       Math.abs(input.associatedUsdcValue ?? 0) < THRESHOLD);

    const isEconomic = !isNonEconomic;

    if (!byType.has(type)) {
      byType.set(type, {
        count: 0,
        ins: 0,
        outs: 0,
        solIn: 0,
        solOut: 0,
        tokensIn: 0,
        tokensOut: 0,
        isEconomic
      });
    }

    const stat = byType.get(type)!;
    stat.count++;

    if (input.direction === 'in') {
      stat.ins++;
      stat.solIn += Math.abs(input.associatedSolValue);
      stat.tokensIn += Math.abs(input.amount);
    } else {
      stat.outs++;
      stat.solOut += Math.abs(input.associatedSolValue);
      stat.tokensOut += Math.abs(input.amount);
    }
  }

  console.log(`\n=== BREAKDOWN BY INTERACTION TYPE ===\n`);

  let totalEconomicSolIn = 0;
  let totalEconomicSolOut = 0;
  let totalEconomicTokensIn = 0;
  let totalEconomicTokensOut = 0;

  for (const [type, stat] of byType.entries()) {
    const label = stat.isEconomic ? '✓ ECONOMIC' : '✗ NON-ECONOMIC';
    console.log(`${type} (${label}):`);
    console.log(`  Count: ${stat.count} (${stat.ins} in, ${stat.outs} out)`);
    console.log(`  Tokens: ${stat.tokensIn.toLocaleString()} in, ${stat.tokensOut.toLocaleString()} out`);
    console.log(`  SOL: ${stat.solIn.toFixed(4)} in, ${stat.solOut.toFixed(4)} out\n`);

    if (stat.isEconomic) {
      totalEconomicSolIn += stat.solIn;
      totalEconomicSolOut += stat.solOut;
      totalEconomicTokensIn += stat.tokensIn;
      totalEconomicTokensOut += stat.tokensOut;
    }
  }

  console.log(`=== ECONOMIC TOTALS (what we use for PnL) ===`);
  console.log(`  SOL spent: ${totalEconomicSolIn.toFixed(2)} SOL`);
  console.log(`  SOL received: ${totalEconomicSolOut.toFixed(2)} SOL`);
  console.log(`  Tokens in: ${totalEconomicTokensIn.toLocaleString()}`);
  console.log(`  Tokens out: ${totalEconomicTokensOut.toLocaleString()}`);
  console.log(`  Net tokens: ${(totalEconomicTokensIn - totalEconomicTokensOut).toLocaleString()}`);

  console.log(`\n=== COMPARISON ===`);
  console.log(`  GMGN shows: 2,460 SOL spent, 467 SOL received`);
  console.log(`  We show: ${totalEconomicSolIn.toFixed(2)} SOL spent, ${totalEconomicSolOut.toFixed(2)} SOL received`);
  console.log(`  Difference: ${(totalEconomicSolIn - 2460).toFixed(2)} SOL (spent), ${(totalEconomicSolOut - 467).toFixed(2)} SOL (received)`);

  process.exit(0);
}

main().catch(console.error);
