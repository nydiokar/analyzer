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

  console.log(`\n=== ANALYZING UNKNOWN TRANSFERS ===\n`);

  // Separate UNKNOWN from economic transfers
  const unknownTiny = tokenInputs.filter(i => {
    const interactionType = i.interactionType?.toUpperCase() ?? '';
    return interactionType === 'UNKNOWN' &&
      Math.abs(i.associatedSolValue) < THRESHOLD &&
      Math.abs(i.associatedUsdcValue ?? 0) < THRESHOLD;
  });

  const economic = tokenInputs.filter(i => {
    const interactionType = i.interactionType?.toUpperCase() ?? '';
    return !(interactionType === 'UNKNOWN' &&
      Math.abs(i.associatedSolValue) < THRESHOLD &&
      Math.abs(i.associatedUsdcValue ?? 0) < THRESHOLD);
  });

  console.log(`Total transactions: ${tokenInputs.length}`);
  console.log(`Economic (SWAP, etc.): ${economic.length}`);
  console.log(`UNKNOWN tiny SOL: ${unknownTiny.length}\n`);

  // Calculate totals for economic only
  let economicIn = 0;
  let economicOut = 0;
  for (const input of economic) {
    if (input.direction === 'in') {
      economicIn += Math.abs(input.amount);
    } else {
      economicOut += Math.abs(input.amount);
    }
  }

  console.log(`=== ECONOMIC TRANSFERS (what we're using for FIFO) ===`);
  console.log(`  Total IN: ${economicIn.toLocaleString()} tokens`);
  console.log(`  Total OUT: ${economicOut.toLocaleString()} tokens`);
  console.log(`  Net (IN - OUT): ${(economicIn - economicOut).toLocaleString()} tokens`);
  console.log(`  Expected remaining: ${(economicIn - economicOut).toLocaleString()} tokens\n`);

  // Calculate totals for UNKNOWN tiny
  let unknownIn = 0;
  let unknownOut = 0;
  let unknownInSol = 0;
  let unknownOutSol = 0;

  console.log(`=== UNKNOWN TINY TRANSFERS (what we're filtering out) ===`);
  for (const input of unknownTiny) {
    const amt = Math.abs(input.amount);
    const sol = Math.abs(input.associatedSolValue);
    if (input.direction === 'in') {
      unknownIn += amt;
      unknownInSol += sol;
      console.log(`  ↓ IN:  ${amt.toLocaleString().padStart(20)} tokens (${sol.toFixed(8)} SOL) - ${input.signature.slice(0, 8)}`);
    } else {
      unknownOut += amt;
      unknownOutSol += sol;
      console.log(`  ↑ OUT: ${amt.toLocaleString().padStart(20)} tokens (${sol.toFixed(8)} SOL) - ${input.signature.slice(0, 8)}`);
    }
  }

  console.log(`\n  Summary:`);
  console.log(`    Total UNKNOWN IN: ${unknownIn.toLocaleString()} tokens (${unknownInSol.toFixed(8)} SOL)`);
  console.log(`    Total UNKNOWN OUT: ${unknownOut.toLocaleString()} tokens (${unknownOutSol.toFixed(8)} SOL)`);
  console.log(`    Net UNKNOWN: ${(unknownIn - unknownOut).toLocaleString()} tokens\n`);

  // Show the impact
  console.log(`=== IMPACT OF FILTERING ===`);
  console.log(`  If we INCLUDE UNKNOWN:`);
  console.log(`    Total IN: ${(economicIn + unknownIn).toLocaleString()}`);
  console.log(`    Total OUT: ${(economicOut + unknownOut).toLocaleString()}`);
  console.log(`    Net: ${(economicIn + unknownIn - economicOut - unknownOut).toLocaleString()}`);

  console.log(`\n  If we EXCLUDE UNKNOWN (current approach):`);
  console.log(`    Total IN: ${economicIn.toLocaleString()}`);
  console.log(`    Total OUT: ${economicOut.toLocaleString()}`);
  console.log(`    Net: ${(economicIn - economicOut).toLocaleString()}`);

  console.log(`\n  INFLATION from filtering out UNKNOWN:`);
  const inflation = (economicIn - economicOut) - (economicIn + unknownIn - economicOut - unknownOut);
  console.log(`    ${inflation.toLocaleString()} tokens`);
  console.log(`    (FIFO thinks you have ${inflation.toLocaleString()} MORE tokens than you actually do)\n`);

  // Get actual balance from AnalysisResult
  const results = await db.getAnalysisResults({ where: { walletAddress: wallet, tokenAddress: mint } });
  if (results.length > 0) {
    const actual = results[0].currentUiBalance || 0;
    console.log(`=== VERIFICATION ===`);
    console.log(`  Current on-chain balance: ${actual.toLocaleString()} tokens`);
    console.log(`  FIFO expected (filtered): ${(economicIn - economicOut).toLocaleString()} tokens`);
    console.log(`  Difference: ${((economicIn - economicOut) - actual).toLocaleString()} tokens`);

    console.log(`\n  If we included UNKNOWN in supply:`);
    const withUnknown = economicIn + unknownIn - economicOut - unknownOut;
    console.log(`    Net balance: ${withUnknown.toLocaleString()} tokens`);
    console.log(`    Difference from actual: ${(withUnknown - actual).toLocaleString()} tokens`);
  }

  process.exit(0);
}

main().catch(console.error);
