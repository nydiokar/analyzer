import * as dotenv from 'dotenv';
import { DatabaseService } from '../../../src/api/services/database.service';
import { buildFifoLotsForToken } from '../../../src/core/analysis/swap/fifo-lot-tracker';

dotenv.config();

async function main() {
  const wallet = 'CFVVFXTQWc3WTjeUSPKWWXxqdSgkFuDZZ9oe1ERvVn2B';
  const mint = '9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump';

  const db = new DatabaseService();

  // Get all swap inputs for this wallet
  const allInputs = await db.getSwapAnalysisInputs(wallet);
  const tokenInputs = allInputs.filter(i => i.mint === mint);

  console.log(`\nTotal SwapAnalysisInputs for this token: ${tokenInputs.length}`);
  console.log(`Ins: ${tokenInputs.filter(i => i.direction === 'in').length}`);
  console.log(`Outs: ${tokenInputs.filter(i => i.direction === 'out').length}`);

  // Show first few inputs chronologically
  const sorted = tokenInputs.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`\nFirst 10 transactions (chronological):`);
  sorted.slice(0, 10).forEach(input => {
    console.log(`  ${new Date(input.timestamp * 1000).toISOString()} | ${input.direction.padEnd(3)} | ${input.amount.toString().padStart(15)} tokens | ${input.associatedSolValue.toString().padStart(10)} SOL | ${input.interactionType || 'SWAP'}`);
  });

  console.log(`\n... (skipping middle) ...\n`);

  console.log(`Last 10 transactions:`);
  sorted.slice(-10).forEach(input => {
    console.log(`  ${new Date(input.timestamp * 1000).toISOString()} | ${input.direction.padEnd(3)} | ${input.amount.toString().padStart(15)} tokens | ${input.associatedSolValue.toString().padStart(10)} SOL | ${input.interactionType || 'SWAP'}`);
  });

  // Run FIFO
  console.log(`\n=== Running FIFO tracker ===`);
  const fifoResult = buildFifoLotsForToken(
    tokenInputs.map(input => ({
      timestamp: input.timestamp,
      signature: input.signature,
      direction: input.direction as 'in' | 'out',
      amount: input.amount,
      associatedSolValue: input.associatedSolValue,
      associatedUsdcValue: input.associatedUsdcValue,
      interactionType: input.interactionType,
    }))
  );

  console.log(`\nFIFO Result:`);
  console.log(`  hasIncompleteHistory: ${fifoResult.hasIncompleteHistory}`);
  console.log(`  realizedPnlSol: ${fifoResult.realizedPnlSol}`);
  console.log(`  remainingCostBasisSol: ${fifoResult.remainingCostBasisSol}`);
  console.log(`  Total lots created: ${fifoResult.lots.length}`);
  console.log(`  Lots with remaining balance: ${fifoResult.lots.filter(l => l.amountRemaining > 0).length}`);

  if (fifoResult.hasIncompleteHistory) {
    console.log(`\n❌ INCOMPLETE HISTORY DETECTED!`);
    console.log(`This means: A sell transaction tried to sell tokens that don't have a corresponding buy lot.`);

    // Find where it failed
    let totalBought = 0;
    let totalSold = 0;
    for (const input of sorted) {
      if (input.direction === 'in') {
        totalBought += Math.abs(input.amount);
      } else {
        totalSold += Math.abs(input.amount);
      }
      if (totalSold > totalBought) {
        console.log(`\n⚠️  FIRST OVERSELL at timestamp ${new Date(input.timestamp * 1000).toISOString()}:`);
        console.log(`   Total bought so far: ${totalBought}`);
        console.log(`   Total sold so far: ${totalSold}`);
        console.log(`   Trying to sell: ${Math.abs(input.amount)}`);
        console.log(`   Transaction: ${input.signature}`);
        console.log(`   Type: ${input.interactionType || 'SWAP'}`);
        console.log(`   SOL value: ${input.associatedSolValue}`);
        break;
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
