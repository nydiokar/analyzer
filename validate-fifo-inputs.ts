import * as dotenv from 'dotenv';
import { DatabaseService } from './src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = 'HAsNv9GjHsCrcSN6bRWwsxbH8fD89tZiYY5D6YpaUQLz';

  const db = new DatabaseService();

  console.log(`\n🔍 FIFO INPUT VALIDATION - What Actually Goes to FIFO?\n`);
  console.log('='.repeat(120));

  // Get analysis results
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet } });
  const incompleteTokens = results.filter(r => r.hasIncompleteHistory);

  console.log(`\n📊 Summary:`);
  console.log(`   Total tokens: ${results.length}`);
  console.log(`   Complete: ${results.filter(r => !r.hasIncompleteHistory).length}`);
  console.log(`   Incomplete: ${incompleteTokens.length}`);
  console.log(`   With P&L data: ${results.filter(r => r.realizedPnlSol !== null).length}`);

  if (incompleteTokens.length === 0) {
    console.log('\n✅ No incomplete history tokens!');
    process.exit(0);
  }

  // Get all swap inputs
  const allInputs = await db.getSwapAnalysisInputs(wallet);

  // Replicate FIFO filtering logic EXACTLY as in analyzer.ts
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const UNKNOWN_TRANSFER_THRESHOLD_SOL = 0.01;

  console.log(`\n\n⚠️  INCOMPLETE HISTORY TOKENS:\n`);

  for (const token of incompleteTokens) {
    const mint = token.tokenAddress;
    const tokenInputs = allInputs.filter(i => i.mint === mint);

    console.log(`\n${'='.repeat(120)}`);
    console.log(`📍 ${mint.substring(0, 40)}...`);
    console.log(`   Has P&L: ${token.realizedPnlSol !== null ? `YES (${token.realizedPnlSol?.toFixed(4)} SOL realized)` : 'NO (null)'}`);
    console.log(`   Total transactions in DB: ${tokenInputs.length}\n`);

    // Categorize by what happens in FIFO filtering
    const passedToFifo: typeof tokenInputs = [];
    const filteredOut: typeof tokenInputs = [];

    for (const input of tokenInputs) {
      const interactionType = input.interactionType?.toUpperCase() ?? '';
      const splMint = input.mint;

      // Exact replication of analyzer.ts lines 110-113
      const isNonEconomicTransfer = interactionType === 'BURN' ||
        ((interactionType === 'UNKNOWN' || interactionType === 'TRANSFER') &&
         Math.abs(input.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL &&
         Math.abs(input.associatedUsdcValue ?? 0) < UNKNOWN_TRANSFER_THRESHOLD_SOL);

      // Exact replication of analyzer.ts lines 121-128
      if (splMint !== SOL_MINT && !isNonEconomicTransfer) {
        passedToFifo.push(input);
      } else {
        filteredOut.push(input);
      }
    }

    console.log(`   ✅ Passed to FIFO: ${passedToFifo.length}`);
    console.log(`   ❌ Filtered out: ${filteredOut.length}\n`);

    // Analyze what passed to FIFO
    if (passedToFifo.length > 0) {
      const buys = passedToFifo.filter(i => i.direction === 'in');
      const sells = passedToFifo.filter(i => i.direction === 'out');
      const solIn = buys.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);
      const solOut = sells.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);

      console.log(`   📊 FIFO INPUT BREAKDOWN:`);
      console.log(`      Buys (IN): ${buys.length} txs, ${solIn.toFixed(4)} SOL`);
      console.log(`      Sells (OUT): ${sells.length} txs, ${solOut.toFixed(4)} SOL\n`);

      // Group by interaction type
      const typeStats = new Map<string, { ins: number; outs: number; solIn: number; solOut: number }>();
      for (const tx of passedToFifo) {
        const type = tx.interactionType?.toUpperCase() || 'NULL';
        if (!typeStats.has(type)) {
          typeStats.set(type, { ins: 0, outs: 0, solIn: 0, solOut: 0 });
        }
        const stat = typeStats.get(type)!;
        if (tx.direction === 'in') {
          stat.ins++;
          stat.solIn += Math.abs(tx.associatedSolValue);
        } else {
          stat.outs++;
          stat.solOut += Math.abs(tx.associatedSolValue);
        }
      }

      console.log(`      By Type:`);
      for (const [type, stat] of typeStats.entries()) {
        console.log(`         ${type}: ${stat.ins} IN (${stat.solIn.toFixed(4)} SOL), ${stat.outs} OUT (${stat.solOut.toFixed(4)} SOL)`);
      }

      console.log(`\n      🔍 Individual Transactions Passed to FIFO:`);
      for (const tx of passedToFifo) {
        const type = (tx.interactionType?.toUpperCase() || 'NULL').padEnd(12);
        const dir = tx.direction.toUpperCase().padEnd(3);
        const amt = Math.abs(tx.amount).toLocaleString().padStart(20);
        const sol = Math.abs(tx.associatedSolValue).toFixed(6).padStart(10);
        const usdc = Math.abs(tx.associatedUsdcValue ?? 0).toFixed(6).padStart(10);
        console.log(`         ${dir} | ${type} | ${amt} tokens | ${sol} SOL | ${usdc} USDC`);
      }

      // Check if incomplete is legitimate
      if (buys.length === 0 && sells.length > 0) {
        console.log(`\n      ❌ INCOMPLETE: Sells without buys (LEGITIMATE)`);
      } else if (buys.length > 0 && sells.length > 0) {
        const tokenIn = buys.reduce((sum, i) => sum + Math.abs(i.amount), 0);
        const tokenOut = sells.reduce((sum, i) => sum + Math.abs(i.amount), 0);
        if (tokenOut > tokenIn) {
          console.log(`\n      ❌ INCOMPLETE: Sold more than bought (${tokenOut.toLocaleString()} out > ${tokenIn.toLocaleString()} in) (LEGITIMATE)`);
        } else {
          console.log(`\n      ⚠️  INCOMPLETE: Has buys and sells, but flagged incomplete - check FIFO rounding/precision`);
        }
      }
    } else {
      console.log(`      ❌ NO transactions passed to FIFO - all filtered out`);
    }

    // Analyze what was filtered
    if (filteredOut.length > 0) {
      console.log(`\n   ⚠️  FILTERED OUT (Not Passed to FIFO):`);

      const filterReasons = new Map<string, typeof filteredOut>();
      for (const tx of filteredOut) {
        const type = tx.interactionType?.toUpperCase() || 'NULL';
        let reason = '';

        if (type === 'BURN') {
          reason = 'BURN (always filtered)';
        } else if (type === 'UNKNOWN' || type === 'TRANSFER') {
          if (Math.abs(tx.associatedSolValue) < UNKNOWN_TRANSFER_THRESHOLD_SOL) {
            reason = `${type} with tiny SOL (< 0.01)`;
          } else {
            reason = `${type} - WEIRD (has value but still filtered?)`;
          }
        } else if (tx.mint === SOL_MINT) {
          reason = 'SOL_MINT (native SOL)';
        } else {
          reason = 'OTHER';
        }

        if (!filterReasons.has(reason)) {
          filterReasons.set(reason, []);
        }
        filterReasons.get(reason)!.push(tx);
      }

      for (const [reason, txs] of filterReasons.entries()) {
        console.log(`\n      ${reason}: ${txs.length} txs`);
        for (const tx of txs.slice(0, 3)) { // Show first 3
          const dir = tx.direction.toUpperCase().padEnd(3);
          const amt = Math.abs(tx.amount).toLocaleString().padStart(20);
          const sol = Math.abs(tx.associatedSolValue).toFixed(6).padStart(10);
          const usdc = Math.abs(tx.associatedUsdcValue ?? 0).toFixed(6).padStart(10);
          console.log(`         ${dir} | ${amt} tokens | ${sol} SOL | ${usdc} USDC`);
        }
        if (txs.length > 3) console.log(`         ... and ${txs.length - 3} more`);
      }
    }

    console.log(`\n   📋 VERDICT:`);
    if (passedToFifo.length === 0) {
      console.log(`      ❌ WRONGFULLY INCOMPLETE - No transactions passed to FIFO (all filtered)`);
    } else if (passedToFifo.filter(i => i.direction === 'in').length === 0 &&
               passedToFifo.filter(i => i.direction === 'out').length > 0) {
      console.log(`      ✅ RIGHTFULLY INCOMPLETE - Sells without buys`);
    } else {
      console.log(`      ⚠️  NEEDS INVESTIGATION - Has buys and sells but incomplete`);
    }

    if (token.realizedPnlSol !== null) {
      console.log(`      ✅ P&L DERIVED - Shows ${token.realizedPnlSol.toFixed(4)} SOL realized`);
    } else {
      console.log(`      ❌ NO P&L - Shows null (old behavior?)`);
    }
  }

  console.log(`\n${'='.repeat(120)}\n`);
  console.log(`✅ Validation complete!\n`);

  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
