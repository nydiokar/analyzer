#!/usr/bin/env ts-node

/**
 * Script to find the pump.fun bonding curve address for a given mint
 *
 * Usage: npx ts-node find-bonding-curve.ts <MINT_ADDRESS>
 *
 * The bonding curve address is derived as a PDA using:
 * findProgramAddress(["bonding-curve", mintAddress], PUMP_FUN_PROGRAM_ID)
 */

const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8NQtmHcWgCMAH1';

function showFindingInstructions(mintAddress: string): void {
  console.log('🔍 METHODS TO FIND PUMP.FUN BONDING CURVE ADDRESS:');
  console.log('');

  console.log('📍 METHOD 1: Solscan Token Page (EASIEST)');
  console.log(`   Go to: https://solscan.io/token/${mintAddress}`);
  console.log('   → Scroll down to "Program Accounts" section');
  console.log('   → Look for accounts owned by: 6EF8rrecthR5Dkzon8NQtmHcWgCMAH1 (pump.fun)');
  console.log('   → The bonding curve is usually the account with the largest balance');
  console.log('');

  console.log('📍 METHOD 2: Token Creation Transaction');
  console.log(`   Go to: https://solscan.io/token/${mintAddress}`);
  console.log('   → Click on "Token Creation" transaction');
  console.log('   → Look at the accounts involved in the transaction');
  console.log('   → The bonding curve is usually created in the same transaction');
  console.log('');

  console.log('📍 METHOD 3: Pump.fun Website (if still listed)');
  console.log('   Go to: https://pump.fun');
  console.log(`   Search for: ${mintAddress}`);
  console.log('   → If found, the bonding curve address will be shown');
  console.log('');

  console.log('📍 METHOD 4: Program Account Query (Advanced)');
  console.log('   Use this RPC call to find all pump.fun accounts for this mint:');
  console.log(`   POST https://api.mainnet-beta.solana.com`);
  console.log(`   {"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["6EF8rrecthR5Dkzon8NQtmHcWgCMAH1",{"filters":[{"memcmp":{"offset":8,"bytes":"${mintAddress}"}}]}]}`);
  console.log('');

  console.log('⚠️  NOTE: Many pump.fun tokens migrate to DEXes, so the bonding curve may be closed.');
  console.log('   In that case, the first buyers will only be found on the mint address after migration.');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx ts-node find-bonding-curve.ts <MINT_ADDRESS>');
    console.log('');
    console.log('Example:');
    console.log('npx ts-node find-bonding-curve.ts 3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump');
    process.exit(1);
  }

  const mintAddress = args[0];
  console.log(`🔍 Finding bonding curve for mint: ${mintAddress}`);
  console.log('');

  showFindingInstructions(mintAddress);

  console.log('');
  console.log('🔗 Quick links to check manually:');
  console.log(`• Solscan Token: https://solscan.io/token/${mintAddress}`);
  console.log('• Solscan Search: https://solscan.io/search?q=pump.fun');
  console.log(`• Pump.fun (if still listed): Search for ${mintAddress}`);
  console.log('');

  console.log('💡 Once you find the bonding curve address, update test-wallet-discovery.ts:');
  console.log('   const manualBondingCurve = "PASTE_ADDRESS_HERE";');
  console.log('   Then run: npx ts-node test-wallet-discovery.ts');
}

if (require.main === module) {
  main();
}