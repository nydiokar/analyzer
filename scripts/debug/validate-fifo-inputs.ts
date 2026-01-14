import * as dotenv from 'dotenv';
import { DatabaseService } from '../../src/api/services/database.service';
import { SwapAnalyzer } from '../../src/core/analysis/swap/analyzer';

dotenv.config();

async function main() {
  const wallet = process.argv[2] || 'kapD6ok2UTZsCLeqvuykmN7UE6wWBsLEfct9861esrh';
  const mintFilterArg = process.argv[3];
  const targetMints = mintFilterArg
    ? new Set(mintFilterArg.split(',').map(m => m.trim()).filter(Boolean))
    : null;

  const db = new DatabaseService();

  console.log(`\n🔍 FIFO INPUT VALIDATION - What Actually Goes to FIFO?\n`);
  console.log('='.repeat(120));

  // Get analysis results
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet } });
  const incompleteTokens = results.filter(r => r.hasIncompleteHistory);
  const filteredTokens = targetMints
    ? incompleteTokens.filter(r => targetMints.has(r.tokenAddress.trim()))
    : incompleteTokens;

  console.log(`\n📊 Summary:`);
  console.log(`   Total tokens: ${results.length}`);
  console.log(`   Complete: ${results.filter(r => !r.hasIncompleteHistory).length}`);
  console.log(`   Incomplete: ${incompleteTokens.length}`);
  console.log(`   With P&L data: ${results.filter(r => r.realizedPnlSol !== null).length}`);

  if (filteredTokens.length === 0) {
    if (targetMints) {
      console.log('\n?o. No incomplete history tokens matched the mint filter.');
      console.log(`   Requested mints: ${Array.from(targetMints).join(', ')}`);
      console.log(`   Incomplete mints: ${incompleteTokens.map(t => t.tokenAddress).join(', ')}`);
    } else {
      console.log('\n? No incomplete history tokens!');
    }
    process.exit(0);
  }

  // Get all swap inputs
  const allInputs = await db.getSwapAnalysisInputs(wallet);

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const analyzer = new SwapAnalyzer();
  console.log(`\n\n⚠️  INCOMPLETE HISTORY TOKENS:\n`);

  // Run the real analyzer once so this script reflects live FIFO inputs.
  const analysis = analyzer.analyze(allInputs, wallet);
  const fifoInputsByMint = analysis.fifoInputsByMint;

  const buildKey = (input: { signature: string; mint: string; direction: string; amount: number; timestamp: number }) =>
    `${input.signature}:${input.mint}:${input.direction}:${Math.abs(input.amount).toFixed(9)}:${input.timestamp}`;

  for (const token of filteredTokens) {
    const mint = token.tokenAddress;
    const tokenInputs = allInputs.filter(i => i.mint === mint);

    console.log(`\n${'='.repeat(120)}`);
    console.log(`📍 ${mint}`);
    console.log(`   Has P&L: ${token.realizedPnlSol !== null ? `YES (${token.realizedPnlSol?.toFixed(4)} SOL realized)` : 'NO (null)'}`);
    console.log(`   Total transactions in DB: ${tokenInputs.length}\n`);

    // Categorize by what happens in FIFO input selection (actual analyzer behavior)
    const fifoInputs = fifoInputsByMint.get(mint) || [];
    const fifoKeys = new Set(fifoInputs.map(buildKey));
    const passedToFifo = tokenInputs.filter(i => fifoKeys.has(buildKey(i)));
    const filteredOut = tokenInputs.filter(i => !fifoKeys.has(buildKey(i)));

    console.log(`   ✅ Passed to FIFO: ${passedToFifo.length}`);
    console.log(`   ❌ Filtered out: ${filteredOut.length}\n`);

    // Analyze what passed to FIFO
    if (passedToFifo.length > 0) {
      const buys = passedToFifo.filter(i => i.direction === 'in');
      const sells = passedToFifo.filter(i => i.direction === 'out');
      const solIn = buys.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);
      const solOut = sells.reduce((sum, i) => sum + Math.abs(i.associatedSolValue), 0);
      const usdcIn = buys.reduce((sum, i) => sum + Math.abs(i.associatedUsdcValue ?? 0), 0);
      const usdcOut = sells.reduce((sum, i) => sum + Math.abs(i.associatedUsdcValue ?? 0), 0);
      const tokenIn = buys.reduce((sum, i) => sum + Math.abs(i.amount), 0);
      const tokenOut = sells.reduce((sum, i) => sum + Math.abs(i.amount), 0);

      console.log(`   📊 FIFO INPUT BREAKDOWN:`);
      console.log(`      Buys (IN): ${buys.length} txs, ${solIn.toFixed(4)} SOL`);
      console.log(`      Sells (OUT): ${sells.length} txs, ${solOut.toFixed(4)} SOL\n`);
      console.log(`      Token Amounts: IN ${tokenIn.toLocaleString()} | OUT ${tokenOut.toLocaleString()} | NET ${(tokenIn - tokenOut).toLocaleString()}`);
      console.log(`      USDC Values: IN ${usdcIn.toFixed(4)} | OUT ${usdcOut.toFixed(4)} | NET ${(usdcIn - usdcOut).toFixed(4)}\n`);

      // Group by interaction type
      const typeStats = new Map<string, { ins: number; outs: number; solIn: number; solOut: number; usdcIn: number; usdcOut: number; tokenIn: number; tokenOut: number }>();
      for (const tx of passedToFifo) {
        const type = tx.interactionType?.toUpperCase() || 'NULL';
        if (!typeStats.has(type)) {
          typeStats.set(type, { ins: 0, outs: 0, solIn: 0, solOut: 0, usdcIn: 0, usdcOut: 0, tokenIn: 0, tokenOut: 0 });
        }
        const stat = typeStats.get(type)!;
        if (tx.direction === 'in') {
          stat.ins++;
          stat.solIn += Math.abs(tx.associatedSolValue);
          stat.usdcIn += Math.abs(tx.associatedUsdcValue ?? 0);
          stat.tokenIn += Math.abs(tx.amount);
        } else {
          stat.outs++;
          stat.solOut += Math.abs(tx.associatedSolValue);
          stat.usdcOut += Math.abs(tx.associatedUsdcValue ?? 0);
          stat.tokenOut += Math.abs(tx.amount);
        }
      }

      console.log(`      By Type:`);
      for (const [type, stat] of typeStats.entries()) {
        console.log(`         ${type}: ${stat.ins} IN (${stat.solIn.toFixed(4)} SOL, ${stat.tokenIn.toLocaleString()} tokens, ${stat.usdcIn.toFixed(4)} USDC), ${stat.outs} OUT (${stat.solOut.toFixed(4)} SOL, ${stat.tokenOut.toLocaleString()} tokens, ${stat.usdcOut.toFixed(4)} USDC)`);
      }

      console.log(`\n      🔍 Individual Transactions Passed to FIFO:`);
      const sorted = [...passedToFifo].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      for (const tx of sorted) {
        const type = (tx.interactionType?.toUpperCase() || 'NULL').padEnd(12);
        const dir = tx.direction.toUpperCase().padEnd(3);
        const amt = Math.abs(tx.amount).toLocaleString().padStart(20);
        const sol = Math.abs(tx.associatedSolValue).toFixed(6).padStart(10);
        const usdc = Math.abs(tx.associatedUsdcValue ?? 0).toFixed(6).padStart(10);
        const ts = tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : 'unknown-ts';
        console.log(`         ${dir} | ${type} | ${amt} tokens | ${sol} SOL | ${usdc} USDC | ${ts} | ${tx.signature}`);
      }

      // Check if incomplete is legitimate
      if (buys.length === 0 && sells.length > 0) {
        console.log(`\n      ❌ INCOMPLETE: Sells without buys (LEGITIMATE)`);
      } else if (buys.length > 0 && sells.length > 0) {
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

        if (tx.mint === SOL_MINT) {
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


