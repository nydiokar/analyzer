import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = 'ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud';

  // Focus on specific problematic tokens
  const problemTokens = [
    '6Vik7Zf4biqGXZbpm8DCZUtvJQvTvc2vAhTx6yNupump', // User's example - 4 in/3 out, 103.48 SOL / 50.87 SOL
    '4TafVse4Sf35tLXQkKhJ8tTrAMCLWVBWvg6CK2xwjups', // ALL UNKNOWN - 5 in/6 out, 1.86 SOL / 13.73 SOL
    'JBmWFTrzcE9LmmYzvCWXA1zhgJFtGXZZ6u23U7BFpump', // 0 buys, 1 sell - missing buy transactions?
  ];

  const db = new DatabaseService();
  const allInputs = await db.getSwapAnalysisInputs(wallet);

  console.log(`\n🔍 FIFO FILTERING DIAGNOSTIC\n`);
  console.log('='.repeat(100));

  const UNKNOWN_TRANSFER_THRESHOLD_SOL = 0.01;
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  for (const mint of problemTokens) {
    const tokenInputs = allInputs.filter(i => i.mint === mint);

    console.log(`\n📍 TOKEN: ${mint.substring(0, 20)}...`);
    console.log(`   Total transactions in DB: ${tokenInputs.length}\n`);

    // Simulate FIFO filtering logic from SwapAnalyzer
    const wouldPassToFifo: typeof tokenInputs = [];
    const filteredOut: typeof tokenInputs = [];

    for (const input of tokenInputs) {
      const interactionType = input.interactionType?.toUpperCase() ?? '';

      // Replicate the filtering logic from SwapAnalyzer lines 109-112, 119
      const isNonEconomicTransfer = interactionType === 'BURN' ||
        (interactionType === 'UNKNOWN' &&
         Math.abs(input.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL &&
         Math.abs(input.associatedUsdcValue ?? 0) < UNKNOWN_TRANSFER_THRESHOLD_SOL);

      const splMint = input.mint;

      if (splMint !== SOL_MINT && !isNonEconomicTransfer) {
        wouldPassToFifo.push(input);
      } else {
        filteredOut.push(input);
      }
    }

    console.log(`   ✅ Would pass to FIFO: ${wouldPassToFifo.length}`);
    console.log(`   ❌ Filtered out: ${filteredOut.length}\n`);

    // Analyze what passes to FIFO
    if (wouldPassToFifo.length > 0) {
      const buys = wouldPassToFifo.filter(i => i.direction === 'in');
      const sells = wouldPassToFifo.filter(i => i.direction === 'out');
      const solBought = buys.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);
      const solSold = sells.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);

      console.log(`   📊 FIFO Input Analysis:`);
      console.log(`      Buys: ${buys.length} (${solBought.toFixed(4)} SOL)`);
      console.log(`      Sells: ${sells.length} (${solSold.toFixed(4)} SOL)`);

      if (buys.length === 0 && sells.length > 0) {
        console.log(`      ⚠️  PROBLEM: Sells without buys = incomplete history!`);
      }

      console.log(`\n      Transaction Details:`);
      for (const tx of wouldPassToFifo) {
        const type = tx.interactionType?.toUpperCase() || 'NULL';
        const dir = tx.direction.toUpperCase();
        const amt = Math.abs(tx.amount).toLocaleString();
        const sol = Math.abs(tx.associatedSolValue).toFixed(4);
        console.log(`        ${dir} | ${type.padEnd(12)} | ${amt.padStart(15)} tokens | ${sol.padStart(10)} SOL`);
      }
    }

    // Analyze what was filtered out
    if (filteredOut.length > 0) {
      console.log(`\n   ⚠️  Filtered Out (not passed to FIFO):`);
      for (const tx of filteredOut) {
        const type = tx.interactionType?.toUpperCase() || 'NULL';
        const dir = tx.direction.toUpperCase();
        const amt = Math.abs(tx.amount).toLocaleString();
        const sol = Math.abs(tx.associatedSolValue).toFixed(4);
        const usdc = Math.abs(tx.associatedUsdcValue ?? 0).toFixed(4);
        const reason = type === 'BURN' ? 'BURN' :
                      (Math.abs(tx.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL ? 'UNKNOWN tiny' : 'OTHER');
        console.log(`        ${dir} | ${type.padEnd(12)} | ${amt.padStart(15)} tokens | ${sol.padStart(10)} SOL | ${usdc.padStart(10)} USDC | Reason: ${reason}`);
      }
    }

    // Check if this explains the incomplete history
    const results = await db.getAnalysisResults({ where: { walletAddress: wallet, tokenAddress: mint } });
    if (results.length > 0 && results[0].hasIncompleteHistory) {
      console.log(`\n   🚨 ROOT CAUSE ANALYSIS:`);
      if (wouldPassToFifo.filter(i => i.direction === 'in').length === 0 &&
          wouldPassToFifo.filter(i => i.direction === 'out').length > 0) {
        console.log(`      ❌ CONFIRMED: No buy transactions passed to FIFO, but sells exist`);
        console.log(`      → This causes "hasIncompleteHistory = true"`);

        const filteredBuys = filteredOut.filter(i => i.direction === 'in');
        if (filteredBuys.length > 0) {
          console.log(`      → ${filteredBuys.length} potential buy(s) were filtered out!`);
          console.log(`      → These are likely the missing buy transactions`);
        }
      } else if (wouldPassToFifo.length === 0) {
        console.log(`      ❌ NO transactions passed to FIFO at all!`);
        console.log(`      → All ${tokenInputs.length} transactions were filtered as non-economic`);
      }
    }

    console.log('\n' + '-'.repeat(100));
  }

  console.log('\n' + '='.repeat(100));
  console.log('\n✅ Diagnostic complete!\n');

  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
