import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = 'CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B';
  const mint = 'fRfKGCriduzDwSudCwpL7ySCEiboNuryhZDVJtr1a1C';

  const db = new DatabaseService();
  const allInputs = await db.getSwapAnalysisInputs(wallet);
  const tokenInputs = allInputs.filter(i => i.mint === mint);

  console.log(`\n=== TOKEN: ${mint} ===\n`);
  console.log(`Total transactions: ${tokenInputs.length}\n`);

  // Group by interaction type
  const byType = new Map<string, { count: number; ins: number; outs: number; solIn: number; solOut: number }>();

  for (const input of tokenInputs) {
    const type = input.interactionType?.toUpperCase() ?? 'NULL';
    if (!byType.has(type)) {
      byType.set(type, { count: 0, ins: 0, outs: 0, solIn: 0, solOut: 0 });
    }
    const stat = byType.get(type)!;
    stat.count++;

    if (input.direction === 'in') {
      stat.ins++;
      stat.solIn += Math.abs(input.associatedSolValue);
    } else {
      stat.outs++;
      stat.solOut += Math.abs(input.associatedSolValue);
    }
  }

  console.log(`Breakdown by interaction type:`);
  for (const [type, stat] of byType.entries()) {
    console.log(`  ${type}: ${stat.count} total (${stat.ins} in, ${stat.outs} out)`);
    console.log(`    SOL in: ${stat.solIn.toFixed(4)}, SOL out: ${stat.solOut.toFixed(4)}`);
  }

  // Check for UNKNOWN tiny
  const THRESHOLD = 0.01;
  const unknownTiny = tokenInputs.filter(i => {
    const type = i.interactionType?.toUpperCase() ?? '';
    return type === 'UNKNOWN' &&
      Math.abs(i.associatedSolValue) < THRESHOLD &&
      Math.abs(i.associatedUsdcValue ?? 0) < THRESHOLD;
  });

  console.log(`\nUNKNOWN tiny transfers: ${unknownTiny.length}`);

  if (unknownTiny.length > 0) {
    console.log(`Details:`);
    for (const input of unknownTiny) {
      console.log(`  ${input.direction.toUpperCase()}: ${Math.abs(input.amount).toLocaleString()} tokens, ${Math.abs(input.associatedSolValue).toFixed(8)} SOL`);
    }
  }

  // Get analysis result
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet, tokenAddress: mint } });
  if (results.length > 0) {
    const r = results[0];
    console.log(`\n=== ANALYSIS RESULT ===`);
    console.log(`hasIncompleteHistory: ${r.hasIncompleteHistory}`);
    console.log(`totalAmountIn: ${r.totalAmountIn}`);
    console.log(`totalAmountOut: ${r.totalAmountOut}`);
    console.log(`currentUiBalance: ${r.currentUiBalance}`);
    console.log(`Net (in - out): ${(r.totalAmountIn || 0) - (r.totalAmountOut || 0)}`);
  }

  process.exit(0);
}

main().catch(console.error);
