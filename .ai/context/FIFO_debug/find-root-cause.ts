import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = 'ACgGWUySLSudRFPdfVe1R5i4m1j6M3ovb42oF7hcL8Ud';

  const db = new DatabaseService();
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet } });
  const allInputs = await db.getSwapAnalysisInputs(wallet);

  const incompleteTokens = results.filter(r => r.hasIncompleteHistory);

  console.log(`\n🔍 ROOT CAUSE ANALYSIS FOR INCOMPLETE HISTORY\n`);
  console.log('='.repeat(100));

  const UNKNOWN_TRANSFER_THRESHOLD_SOL = 0.01;
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  for (const token of incompleteTokens) {
    const mint = token.tokenAddress;
    const tokenInputs = allInputs.filter(i => i.mint === mint);

    // Simulate FIFO logic
    const fifoInputs = tokenInputs.filter(input => {
      const interactionType = input.interactionType?.toUpperCase() ?? '';
      const isNonEconomicTransfer = interactionType === 'BURN' ||
        (interactionType === 'UNKNOWN' &&
         Math.abs(input.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL &&
         Math.abs(input.associatedUsdcValue ?? 0) < UNKNOWN_TRANSFER_THRESHOLD_SOL);
      return input.mint !== SOL_MINT && !isNonEconomicTransfer;
    });

    // Sort by timestamp (FIFO processes chronologically)
    const sorted = [...fifoInputs].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.direction === 'in' ? -1 : 1;
    });

    // Track lots manually
    const lots: Array<{ amount: number; costBasis: number; remaining: number }> = [];
    let hasIncomplete = false;
    let problematicTx: typeof sorted[0] | null = null;

    for (const tx of sorted) {
      const amount = Math.abs(tx.amount);

      if (tx.direction === 'in') {
        lots.push({
          amount,
          costBasis: Math.abs(tx.associatedSolValue),
          remaining: amount,
        });
      } else {
        // Selling
        let remaining = amount;
        const tolerance = Math.max(amount * 0.001, 0.001);

        while (remaining > tolerance) {
          const nextLot = lots.find(lot => lot.remaining > 0.001);
          if (!nextLot) {
            hasIncomplete = true;
            problematicTx = tx;
            break;
          }

          const consumed = Math.min(remaining, nextLot.remaining);
          nextLot.remaining -= consumed;
          remaining -= consumed;
        }

        if (hasIncomplete) break;
      }
    }

    if (hasIncomplete && problematicTx) {
      console.log(`\n📍 ${mint.substring(0, 30)}...`);

      const totalInFifo = sorted.filter(t => t.direction === 'in')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const totalOutFifo = sorted.filter(t => t.direction === 'out')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      console.log(`\n   📊 FIFO Balance:`);
      console.log(`      Total IN (buys): ${totalInFifo.toLocaleString()} tokens`);
      console.log(`      Total OUT (sells): ${totalOutFifo.toLocaleString()} tokens`);
      console.log(`      Difference: ${(totalInFifo - totalOutFifo).toLocaleString()} tokens`);

      console.log(`\n   🚨 INCOMPLETE DETECTED at transaction:`);
      const date = new Date(problematicTx.timestamp * 1000).toISOString();
      console.log(`      Signature: ${problematicTx.signature.substring(0, 20)}...`);
      console.log(`      Timestamp: ${date}`);
      console.log(`      Direction: ${problematicTx.direction}`);
      console.log(`      Amount: ${Math.abs(problematicTx.amount).toLocaleString()} tokens`);
      console.log(`      SOL Value: ${Math.abs(problematicTx.associatedSolValue).toFixed(4)} SOL`);
      console.log(`      Type: ${problematicTx.interactionType || 'null'}`);

      const availableInLots = lots.reduce((sum, lot) => sum + lot.remaining, 0);
      console.log(`\n   💡 ROOT CAUSE:`);
      console.log(`      Trying to sell: ${Math.abs(problematicTx.amount).toLocaleString()} tokens`);
      console.log(`      Available in lots: ${availableInLots.toLocaleString()} tokens`);
      console.log(`      Missing: ${(Math.abs(problematicTx.amount) - availableInLots).toLocaleString()} tokens`);

      // Check if there are any filtered transactions
      const filteredCount = tokenInputs.length - fifoInputs.length;
      if (filteredCount > 0) {
        const filteredIns = tokenInputs.filter(input => {
          const interactionType = input.interactionType?.toUpperCase() ?? '';
          const isNonEconomic = interactionType === 'BURN' ||
            (interactionType === 'UNKNOWN' &&
             Math.abs(input.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL &&
             Math.abs(input.associatedUsdcValue ?? 0) < UNKNOWN_TRANSFER_THRESHOLD_SOL);
          return isNonEconomic && input.direction === 'in';
        });

        console.log(`\n   ⚠️  FILTERED TRANSACTIONS:`);
        console.log(`      ${filteredCount} transactions were filtered as "non-economic"`);
        if (filteredIns.length > 0) {
          const filteredAmount = filteredIns.reduce((sum, i) => sum + Math.abs(i.amount), 0);
          console.log(`      Including ${filteredIns.length} INs totaling ${filteredAmount.toLocaleString()} tokens`);
          console.log(`      These might explain the missing tokens!`);
        }
      }

      // Check earliest transaction timestamp
      const earliestTx = Math.min(...tokenInputs.map(t => t.timestamp));
      const earliestDate = new Date(earliestTx * 1000).toISOString();
      console.log(`\n   📅 TRANSACTION HISTORY:`);
      console.log(`      Earliest transaction: ${earliestDate}`);
      console.log(`      Total transactions: ${tokenInputs.length}`);

      if (totalOutFifo > totalInFifo) {
        console.log(`\n   ❗ LIKELY CAUSES:`);
        console.log(`      1. Token was acquired BEFORE ${earliestDate}`);
        console.log(`      2. Token was received via airdrop/transfer not captured`);
        console.log(`      3. Some buy transactions failed to be recorded`);
      }

      console.log('\n' + '-'.repeat(100));
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('\n✅ Analysis complete!\n');

  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
